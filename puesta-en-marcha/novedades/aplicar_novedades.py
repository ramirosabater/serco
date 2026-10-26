#!/usr/bin/env python3
"""
SGRP 2.0 · Aplica en Supabase las novedades del Access (lo cargado desde la migración inicial).

Solo necesita Python 3 y una librería:
    pip install psycopg2-binary

Uso (en esta carpeta, con el archivo novedades-AAAA-MM-DD.sql.gz que te pasa Claude):
    python aplicar_novedades.py novedades-AAAA-MM-DD.sql.gz "postgresql://postgres.xxxx:CLAVE@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"

La dirección es la misma de cargar_datos.py (Supabase → Connect → Session pooler).

Qué hace:
  - Agrega lo nuevo del Access y actualiza solo los campos que cambiaron allá.
    Lo editado en el sistema nuevo se conserva.
  - Todo en una sola transacción: si algo falla, la base queda como estaba.
  - Antes de confirmar muestra cuántas filas cambia y pide que escribas APLICAR.
  - Se puede correr dos veces sin duplicar nada.
"""
import gzip
import os
import re
import sys
import time

try:
    import psycopg2
except ImportError:
    sys.exit('Falta una librería. Corré:  pip install psycopg2-binary  y volvé a probar.')

TABLAS = ['provincias', 'ciudades', 'actividades', 'generadores_principales', 'generadores', 'generador_direcciones',
          'transportistas', 'camiones', 'choferes', 'operadores', 'corrientes', 'planta_corrientes',
          'transportista_corrientes', 'operador_corrientes', 'manifiestos_nacion', 'certificados', 'manifiestos',
          'manifiesto_items', 'migracion_archivos', 'migracion_inconsistencias', 'migracion_corridas']


def pedir_direccion(dada=None):
    """La dirección de la base: la variable SGRP_DB, la que se pasó (si es una de verdad) o se pide sin mostrarla."""
    import getpass
    d = (dada or '').strip()
    if d.startswith(('postgresql://', 'postgres://')) or '=' in d:
        return d
    d = os.environ.get('SGRP_DB', '').strip()
    if d: return d
    print('Pegá la dirección de la base (Supabase → Connect → Session pooler, con tu contraseña en lugar de [YOUR-PASSWORD]).')
    print('No se muestra mientras la pegás: pegala con clic derecho y tocá Enter.')
    d = getpass.getpass('Dirección: ').strip()
    if not d.startswith(('postgresql://', 'postgres://')):
        sys.exit('Eso no parece una dirección de Supabase: tiene que empezar con postgresql://')
    if '[YOUR-PASSWORD]' in d:
        sys.exit('Falta reemplazar [YOUR-PASSWORD] por la contraseña de la base.')
    return d


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) < 1:
        sys.exit(__doc__)
    ruta, dsn = args[0], pedir_direccion(args[1] if len(args) > 1 else None)
    if not os.path.exists(ruta):
        sys.exit(f'No encuentro {ruta}.')
    abrir = gzip.open if ruta.endswith('.gz') else open
    with abrir(ruta, 'rt', encoding='utf-8') as f:
        lineas = f.read().splitlines()
    sentencias = [l for l in lineas if l and not l.startswith('--')]
    resumen = next((l[3:] for l in lineas[:3] if l.startswith('-- {')), '')
    print(f'{os.path.basename(ruta)}: {len(sentencias)} sentencias')

    print('Conectando con Supabase…')
    try:
        db = psycopg2.connect(dsn, connect_timeout=20)
    except psycopg2.OperationalError as e:
        msg = str(e)
        if 'password authentication failed' in msg:
            sys.exit('La contraseña de la base no es correcta.')
        sys.exit(f'No se pudo conectar: {msg}')
    cur = db.cursor()
    cur.execute("select to_regproc('public.mayus'), to_regproc('public.recalcular_etapas')")
    if None in cur.fetchone():
        sys.exit('Faltan actualizaciones de la base: corré antes las de puesta-en-marcha/actualizaciones (hasta la de mayúsculas).')

    # Números del Access que ya se usaron en el sistema nuevo (pruebas de emisión): mientras Serco cargue en el
    # Access, el Access manda. Se muestran y, si se confirma, se borran para traer los del Access.
    choques = set(re.findall(r"^insert into manifiestos \(numero, transportista_id.*?select '(\d+)', \(select id from transportistas where id_access = (\d+)\)",
                             '\n'.join(sentencias), re.M))
    reemplazar = []
    if choques:
        cur.execute("""select m.id, m.numero, t.nombre, m.fecha, coalesce(g.nombre, ''), m.anulado
                       from manifiestos m join transportistas t on t.id = m.transportista_id left join generadores g on g.id = m.generador_id
                       where m.usuario_access is null and m.creado_por is not null and (m.numero, t.id_access) in %s""",
                    (tuple((n, int(t)) for n, t in choques),))
        reemplazar = cur.fetchall()
    if reemplazar:
        print(f'\nEstos {len(reemplazar)} números ya se usaron en el sistema nuevo (seguramente pruebas), y en el Access son manifiestos reales:')
        for _, num, tr, f, gen, anul in reemplazar:
            print(f'  {num[:3]}-{num[3:]}  {tr}  {f:%d/%m/%Y}  {gen}{"  (anulado)" if anul else ""}')
        if '--reemplazar' in sys.argv or input('Escribí REEMPLAZAR para borrarlos y traer los del Access, o Enter para dejarlos como están: ').strip() == 'REEMPLAZAR':
            # se borran antes de apagar el historial: queda registrado quién y cuándo
            ids = [r[0] for r in reemplazar]
            cur.execute('delete from manifiesto_items where manifiesto_id = any(%s)', (ids,))   # primero los residuos (la etapa se recalcula sola)
            cur.execute('delete from manifiestos where id = any(%s)', (ids,))
            print(f'  {cur.rowcount} borrados (quedan en el historial).')
        else:
            print('  Se dejan: esos números van a aparecer como faltantes en la validación.')

    t0 = time.time()
    try:
        # Igual que en la carga inicial: sin validaciones ni historial mientras se cargan datos del Access
        cur.execute("""select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint
                       where contype = 'c' and not convalidated and connamespace = 'public'::regnamespace""")
        reglas = cur.fetchall()
        for tabla, nombre, _ in reglas:
            cur.execute(f'alter table {tabla} drop constraint {nombre}')
        for t in TABLAS:
            cur.execute(f'alter table {t} disable trigger user')

        cambiadas = {'insert': 0, 'update': 0}
        for i, s in enumerate(sentencias, 1):
            cur.execute(s)
            tipo = s.split(' ', 1)[0]
            if tipo in cambiadas: cambiadas[tipo] += max(cur.rowcount, 0)
            if i % 500 == 0: print(f'  {i}/{len(sentencias)}…')

        for t in TABLAS:
            cur.execute(f'alter table {t} enable trigger user')
        for tabla, nombre, defin in reglas:
            cur.execute(f'alter table {tabla} add constraint {nombre} {defin.replace(" NOT VALID", "")} not valid')
        # Lo nuevo también en mayúsculas, y la etapa de cada manifiesto al día
        cur.execute("""select 1 from pg_trigger where tgname = 'aa_mayusculas' limit 1""")
        if cur.fetchone():
            cur.execute("""
              do $$ declare r record; cols text; sets text; conds text; begin
                for r in select tgrelid::regclass::text t, tgargs from pg_trigger where tgname = 'aa_mayusculas' loop
                  select string_agg(format('%I = mayus(%I)', c, c), ', '), string_agg(format('%I <> mayus(%I)', c, c), ' or ')
                    into sets, conds
                    from unnest(array_remove(string_to_array(encode(r.tgargs, 'escape'), '\\000'), '')) c;
                  if sets is not null then
                    execute format('alter table %s disable trigger user', r.t);
                    execute format('update %s set %s where %s', r.t, sets, conds);
                    execute format('alter table %s enable trigger user', r.t);
                  end if;
                end loop; end $$""")
        cur.execute('select recalcular_etapas()')
        etapas = cur.fetchone()[0]
        viajes = 0
        cur.execute("select to_regproc('public.marcar_formularios_viaje')")
        if cur.fetchone()[0]:   # formularios de viaje nuevos del Access: no cuentan como retiros
            cur.execute('select marcar_formularios_viaje()')
            viajes = cur.fetchone()[0]
    except Exception as e:
        db.rollback()
        sys.exit(f'\nSe canceló y la base quedó como estaba. Error: {e}')

    print(f'\nListo para confirmar ({time.time() - t0:.0f} s):')
    print(f'  filas nuevas:       {cambiadas["insert"]:,}'.replace(',', '.'))
    print(f'  filas actualizadas: {cambiadas["update"]:,}'.replace(',', '.'))
    print(f'  etapas recalculadas: {etapas:,}'.replace(',', '.'))
    if viajes: print(f'  formularios de viaje marcados: {viajes:,}'.replace(',', '.'))
    if resumen: print(f'  detalle: {resumen}')
    if '--si' not in sys.argv and input('\nEscribí APLICAR para guardar los cambios, o Enter para cancelar: ').strip() != 'APLICAR':
        db.rollback()
        sys.exit('Cancelado: la base quedó como estaba.')
    db.commit()
    print('Guardado. Siguiente paso: correr validar.py con el esperado del mismo día.')


if __name__ == '__main__':
    main()
