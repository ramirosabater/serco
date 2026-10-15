#!/usr/bin/env python3
"""
SGRP 2.0 · Carga los datos migrados del Access en Supabase.

Solo necesita Python 3 y una librería:
    pip install psycopg2-binary

Uso (en la carpeta donde está este archivo):
    python cargar_datos.py "postgresql://postgres.xxxx:CLAVE@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"

La dirección se copia del panel de Supabase: botón "Connect" → "Session pooler".
Antes hay que haber corrido 1-esquema.sql en el SQL Editor.

Si la base ya tiene datos, no toca nada. Para vaciarla y volver a cargar (por ejemplo,
con una copia más nueva del Access):
    python cargar_datos.py "<dirección>" --reemplazar
Eso borra también lo cargado desde el sistema nuevo (pide confirmación). Los usuarios
y los generadores asignados a cada cliente del portal se conservan.
"""
import gzip
import io
import json
import os
import re
import sys
import time

try:
    import psycopg2
except ImportError:
    sys.exit('Falta una librería. Corré:  pip install psycopg2-binary  y volvé a probar.')

ARCHIVO = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'datos-migrados.sql.gz')
COPY_RE = re.compile(r'^COPY (public\.\w+) \((.*)\) FROM stdin;$')


def bloques(ruta):
    """Recorre el volcado y devuelve ('copy', tabla, columnas, datos) o ('sql', sentencia)."""
    abrir = gzip.open if ruta.endswith('.gz') else open
    with abrir(ruta, 'rt', encoding='utf-8') as f:
        tabla = None
        for linea in f:
            if tabla:
                if linea == '\\.\n':
                    yield ('copy', tabla, columnas, ''.join(datos))
                    tabla = None
                else:
                    datos.append(linea)
                continue
            m = COPY_RE.match(linea.rstrip('\n'))
            if m:
                tabla, columnas, datos = m.group(1), m.group(2), []
            elif linea.startswith('SELECT pg_catalog.setval('):
                yield ('sql', linea.strip())


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    reemplazar = '--reemplazar' in sys.argv
    dsn = args[0] if args else os.environ.get('DATABASE_URL')
    if not dsn:
        sys.exit(__doc__)
    if not os.path.exists(ARCHIVO):
        sys.exit(f'No encuentro {os.path.basename(ARCHIVO)}: tiene que estar en la misma carpeta que este script.')

    print('Conectando con Supabase…')
    try:
        db = psycopg2.connect(dsn, connect_timeout=20)
    except psycopg2.OperationalError as e:
        msg = str(e)
        if 'password authentication failed' in msg:
            sys.exit('La contraseña de la base no es correcta. Es la que elegiste al crear el proyecto (se puede cambiar en Database → Settings).')
        if 'could not translate host name' in msg or 'Network is unreachable' in msg:
            sys.exit('No se pudo llegar al servidor. Usá la dirección del "Session pooler" (no la "Direct connection").')
        sys.exit(f'No se pudo conectar: {msg}')
    cur = db.cursor()

    cur.execute("select to_regclass('public.manifiestos'), to_regclass('public.migracion_corridas')")
    if None in cur.fetchone():
        sys.exit('La base no tiene las tablas. Primero corré 1-esquema.sql en el SQL Editor de Supabase.')

    # Tablas que trae el archivo
    tablas = [t for tipo, *resto in bloques(ARCHIVO) if tipo == 'copy' for t in [resto[0]]]
    cur.execute('select count(*) from manifiestos')
    if cur.fetchone()[0] and not reemplazar:
        sys.exit('La base ya tiene datos. Si querés vaciarla y volver a cargar, agregá --reemplazar al final del comando.')

    t0 = time.time()
    try:
        # Las validaciones de 3-reglas.sql (si ya se corrió) se sacan durante la carga y se vuelven a poner
        cur.execute("""select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint
                       where contype = 'c' and not convalidated and connamespace = 'public'::regnamespace""")
        reglas = cur.fetchall()
        for tabla, nombre, _ in reglas:
            cur.execute(f'alter table {tabla} drop constraint {nombre}')
        for t in tablas:
            cur.execute(f'alter table {t} disable trigger user')
        if reemplazar:
            # Lo cargado desde la app (no desde el Access) se perdería: se pide confirmación
            cur.execute('select count(*) from manifiestos where creado_por is not null')
            propios = cur.fetchone()[0]
            if propios:
                print(f'\nATENCIÓN: hay {propios} manifiestos cargados desde el sistema nuevo. Si seguís, se borran.')
                if input('Escribí BORRAR para seguir, o Enter para cancelar: ').strip() != 'BORRAR':
                    raise RuntimeError('cancelado por el usuario')
            # Los generadores asignados a cada usuario del portal se guardan y se vuelven a asignar después
            cur.execute('''create temp table _asignados on commit drop as
                           select pg.perfil_id, g.id_access from perfil_generadores pg join generadores g on g.id = pg.generador_id''')
            print('Vaciando los datos anteriores…')
            cur.execute('truncate ' + ', '.join(tablas) + ', public.historial restart identity cascade')

        n = 0
        for b in bloques(ARCHIVO):
            if b[0] == 'copy':
                _, tabla, columnas, datos = b
                cur.copy_expert(f'COPY {tabla} ({columnas}) FROM STDIN', io.StringIO(datos))
                n += 1
                print(f'  {tabla.replace("public.", ""):<28} {datos.count(chr(10)):>7} filas')
            else:
                cur.execute(b[1])

        if reemplazar:
            cur.execute('''insert into perfil_generadores (perfil_id, generador_id)
                           select a.perfil_id, g.id from _asignados a join generadores g on g.id_access = a.id_access
                           on conflict do nothing''')
        for t in tablas:
            cur.execute(f'alter table {t} enable trigger user')
        for tabla, nombre, defin in reglas:
            cur.execute(f'alter table {tabla} add constraint {nombre} {defin.replace(" NOT VALID", "")} not valid')
        # Etapa de cada manifiesto (se mantiene sola con triggers, que estaban apagados durante la carga)
        cur.execute("select to_regproc('public.recalcular_etapas')")
        if cur.fetchone()[0]:
            cur.execute('select recalcular_etapas()')
        db.commit()
    except Exception as e:
        db.rollback()
        sys.exit(f'\nSe canceló la carga y la base quedó como estaba. Error: {e}')

    print(f'\nListo en {time.time() - t0:.0f} segundos. Control contra el Access:')
    ruta_conteos = os.path.join(os.path.dirname(ARCHIVO), 'conteos.json')
    esperado = json.load(open(ruta_conteos, encoding='utf-8')) if os.path.exists(ruta_conteos) else {}
    bien = True
    for tabla, nombre in [('manifiestos', 'Manifiestos'), ('manifiesto_items', 'Residuos'), ('manifiestos_nacion', 'Manifiestos Nación'),
                          ('certificados', 'Certificados'), ('generadores', 'Generadores'), ('camiones', 'Camiones'), ('choferes', 'Choferes')]:
        cur.execute(f'select count(*) from {tabla}')
        hay = cur.fetchone()[0]
        ok = esperado.get(tabla) in (None, hay)
        bien &= ok
        print(f'  {nombre:<20} {hay:>7,}'.replace(',', '.') + ('' if ok else f'   ← se esperaban {esperado[tabla]:,}'.replace(',', '.')))
    print('Todo coincide.' if bien else 'Atención: hay diferencias con el Access. Revisalas antes de seguir.')
    print('Siguiente paso: si todavía no corriste los archivos de reglas (02 a 07), corrélos ahora en el SQL Editor; después, el del administrador.')


if __name__ == '__main__':
    main()
