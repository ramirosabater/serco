#!/usr/bin/env python3
"""
SGRP 2.0 · Migración de novedades: lo que cambió en el Access desde la carga inicial.

Compara dos copias del Access ya migradas (la que se usó para la carga y la nueva) y arma
un parche SQL con:
  - las altas nuevas (manifiestos, residuos, Manifiestos Nación, certificados, flota, generadores…)
  - los cambios del Access, campo por campo: SOLO los campos que cambiaron en el Access.
    Lo que se haya editado en el sistema nuevo (DNI de choferes, vencimientos, escaneos) se
    conserva salvo que en el Access también haya cambiado ese mismo campo.
  - Lo que se borró del Access no se borra: queda listado en el resumen.

Las filas se identifican por sus claves del Access (número de formulario + transportista,
Id del Access, patente, nombre…), nunca por los id de la base: el parche se puede aplicar
sobre Supabase aunque los id sean distintos. Se puede aplicar más de una vez sin duplicar.

Uso (en esta máquina, con mdbtools y Postgres local):
    python novedades.py viejo.mdb nuevo.mdb salida-dir/
      → crea las bases temporales sgrp_base y sgrp_nuevo, migra cada Access y deja en salida-dir:
        novedades-AAAA-MM-DD.sql.gz   (el parche, se aplica con puesta-en-marcha/novedades/aplicar_novedades.py)
        novedades-AAAA-MM-DD.txt      (resumen legible)
        esperado-AAAA-MM-DD.json      (cifras del Access nuevo para validar.py)
    python novedades.py --bases "dsn_base" "dsn_nuevo" salida-dir/   (si las bases ya están migradas)
"""
import gzip, json, os, subprocess, sys
from collections import defaultdict
from datetime import date

import psycopg2
from psycopg2.extras import Json, RealDictCursor

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)

# Columnas que no vienen del Access o que maneja el sistema nuevo: nunca se tocan
NO_TOCAR = {'id', 'creado_por', 'modificado_por', 'modificado', 'instrucciones', 'validacion_omitida',
            'ingreso_planta', 'cant_estimada', 'dni', 'capacidad', 'capacidad_um', 'grupo_incompat',
            'archivo_local', 'como', 'storage_path', 'encontrado', 'bytes', 'subido', 'corrida_id'}

# Columnas que en esa tabla no vienen del Access (las llena la base con la hora de la carga): nunca se comparan
NO_TOCAR_TABLA = {('manifiestos_nacion', 'creado')}

# tabla: (clave natural, {columna FK: tabla referida})  · en orden de carga
TABLAS = [
    ('provincias', ['nombre'], {}),
    ('ciudades', ['nombre', 'provincia'], {}),
    ('actividades', ['nombre'], {}),
    ('generadores_principales', ['id_access'], {}),
    ('generadores', ['id_access'], {'generador_principal_id': 'generadores_principales'}),
    ('generador_direcciones', ['generador_id', 'direccion'], {'generador_id': 'generadores'}),
    ('transportistas', ['id_access'], {}),
    ('camiones', ['transportista_id', 'patente'], {'transportista_id': 'transportistas'}),
    ('choferes', ['transportista_id', 'nombre'], {'transportista_id': 'transportistas'}),
    ('operadores', ['nombre'], {}),
    ('corrientes', ['codigo'], {}),
    ('planta_corrientes', ['generador_principal_id', 'corriente_id'], {'generador_principal_id': 'generadores_principales', 'corriente_id': 'corrientes'}),
    ('transportista_corrientes', ['transportista_id', 'corriente_id'], {'transportista_id': 'transportistas', 'corriente_id': 'corrientes'}),
    ('operador_corrientes', ['operador_id', 'corriente_id'], {'operador_id': 'operadores', 'corriente_id': 'corrientes'}),
    ('manifiestos_nacion', ['numero'], {'transportista_id': 'transportistas', 'generador_principal_id': 'generadores_principales',
                                        'operador_id': 'operadores', 'camion_id': 'camiones', 'chofer_id': 'choferes'}),
    ('certificados', ['numero', 'manifiesto_nacion_id'], {'manifiesto_nacion_id': 'manifiestos_nacion', 'operador_id': 'operadores',
                                                          'generador_principal_id': 'generadores_principales', 'corriente_id': 'corrientes'}),
    ('manifiestos', ['numero', 'transportista_id'], {'transportista_id': 'transportistas', 'generador_id': 'generadores',
                                                     'generador_principal_id': 'generadores_principales', 'chofer_id': 'choferes', 'camion_id': 'camiones'}),
    ('manifiesto_items', ['id_access'], {'manifiesto_id': 'manifiestos', 'corriente_id': 'corrientes',
                                         'manifiesto_nacion_id': 'manifiestos_nacion', 'certificado_id': 'certificados'}),
    ('migracion_archivos', ['ruta_access'], {}),
]
SPEC = {t: (k, f) for t, k, f in TABLAS}
# Las claves de texto se comparan en mayúsculas (el sistema nuevo guarda todo en mayúsculas)
TEXTO_EN_MAYUS = {('actividades', 'nombre'), ('generador_direcciones', 'direccion'), ('camiones', 'patente'),
                  ('choferes', 'nombre'), ('operadores', 'nombre'), ('corrientes', 'codigo')}
NOMBRES = {'manifiestos': 'Manifiestos', 'manifiesto_items': 'Residuos', 'manifiestos_nacion': 'Manifiestos Nación',
           'certificados': 'Certificados', 'generadores': 'Generadores', 'generador_direcciones': 'Direcciones de retiro',
           'generadores_principales': 'Plantas', 'transportistas': 'Transportistas', 'camiones': 'Camiones',
           'choferes': 'Choferes', 'operadores': 'Operadores', 'corrientes': 'Corrientes', 'migracion_archivos': 'Archivos enlazados'}


def mayus(s):
    return s.upper() if isinstance(s, str) else s


class Foto:
    """Una base migrada: filas por clave natural, con las FK traducidas a claves naturales."""
    def __init__(self, dsn):
        self.db = psycopg2.connect(dsn)
        self.cur = self.db.cursor(cursor_factory=RealDictCursor)
        self.nk = {}        # tabla → {id: clave natural}
        self.filas = {}     # tabla → {clave natural: {columna: valor}}
        for t, clave, fks in TABLAS:
            self.cur.execute(f'select * from {t}')
            filas = self.cur.fetchall()
            por_clave = {}
            for f in filas:
                k = self.clave(t, f)
                if 'id' in f: self.nk.setdefault(t, {})[f['id']] = k
                por_clave[k] = {c: (self.nk[fks[c]].get(v) if c in fks and v is not None else v)
                                for c, v in f.items() if c not in NO_TOCAR and (t, c) not in NO_TOCAR_TABLA}
            self.filas[t] = por_clave

    def clave(self, t, f):
        clave, fks = SPEC[t]
        partes = []
        for c in clave:
            v = f[c]
            if c in fks: v = self.nk[fks[c]].get(v) if v is not None else None
            elif (t, c) in TEXTO_EN_MAYUS: v = mayus(v)
            partes.append(v)
        return tuple(partes)


class Parche:
    def __init__(self, cur):
        self.cur = cur
        self.sql = []

    def lit(self, v):
        if isinstance(v, (dict, list)): v = Json(v)
        return self.cur.mogrify('%s', (v,)).decode()

    def ref(self, t, k):
        """Expresión SQL que devuelve el id de la fila con clave natural k en la base destino."""
        if k is None: return 'null'
        return f'(select id from {t} where {self.donde(t, k)})'

    def donde(self, t, k):
        clave, fks = SPEC[t]
        conds = []
        for c, v in zip(clave, k):
            if c in fks:
                conds.append(f'{c} is not distinct from {self.ref(fks[c], v)}')
            elif (t, c) in TEXTO_EN_MAYUS:
                conds.append(f'mayus({c}) = {self.lit(v)}')
            else:
                conds.append(f'{c} = {self.lit(v)}' if v is not None else f'{c} is null')
        return ' and '.join(conds)

    def valor(self, t, c, v):
        fks = SPEC[t][1]
        return self.ref(fks[c], v) if c in fks else self.lit(v)

    def alta(self, t, k, fila):
        cols = [c for c in fila if not (t == 'migracion_archivos' and c == 'corrida_id')]
        vals = [self.valor(t, c, fila[c]) for c in cols]
        if t == 'migracion_archivos':
            cols.append('corrida_id'); vals.append('(select id from _corrida)')
        self.sql.append(f'insert into {t} ({", ".join(cols)}) select {", ".join(vals)} '
                        f'where not exists (select 1 from {t} where {self.donde(t, k)});')

    def cambio(self, t, k, cambios):
        sets = ', '.join(f'{c} = {self.valor(t, c, v)}' for c, v in cambios.items())
        self.sql.append(f'update {t} set {sets} where {self.donde(t, k)};')


def comparar(base, nuevo, cur):
    p = Parche(cur)
    resumen = {}
    borrados = defaultdict(list)
    p.sql.append("create temp table _corrida on commit drop as "
                 "with c as (insert into migracion_corridas (fin, resumen) values (now(), '{\"tipo\": \"novedades\"}') returning id) select id from c;")
    for t, _, _ in TABLAS:
        b, n = base.filas[t], nuevo.filas[t]
        altas = [k for k in n if k not in b]
        cambios = 0
        for k in altas: p.alta(t, k, n[k])
        for k in n.keys() & b.keys():
            dif = {c: v for c, v in n[k].items() if b[k].get(c) != v}
            if dif:
                p.cambio(t, k, dif); cambios += 1
        for k in b.keys() - n.keys(): borrados[t].append(k)
        if altas or cambios or borrados[t]:
            resumen[t] = {'altas': len(altas), 'cambios': cambios, 'borrados_en_access': len(borrados[t])}
    return p, resumen, borrados


def inconsistencias_nuevas(base_dsn, nuevo_dsn, cur):
    q = 'select tabla, clave_access, resultado, problema, detalle from migracion_inconsistencias'
    with psycopg2.connect(base_dsn) as b, psycopg2.connect(nuevo_dsn) as n:
        bc, nc = b.cursor(), n.cursor()
        bc.execute(q); viejas = {(r[0], r[1], r[3]) for r in bc.fetchall()}
        nc.execute(q); todas = nc.fetchall()
    nuevas = [r for r in todas if (r[0], r[1], r[3]) not in viejas]
    p = Parche(cur)
    sql = [f'insert into migracion_inconsistencias (corrida_id, tabla, clave_access, resultado, problema, detalle) '
           f'select (select id from _corrida), {p.lit(t)}, {p.lit(k)}, {p.lit(r)}, {p.lit(pr)}, {p.lit(d)} '
           f'where not exists (select 1 from migracion_inconsistencias where tabla = {p.lit(t)} and clave_access = {p.lit(k)} and problema = {p.lit(pr)});'
           for t, k, r, pr, d in nuevas]
    return sql, len(nuevas)


def crear_base(nombre, mdb):
    """Base local con el esquema completo y el Access migrado."""
    def psql(*args, **kw): subprocess.run(['psql', '-q', '-v', 'ON_ERROR_STOP=1', *args], check=True, stdout=subprocess.DEVNULL, **kw)
    subprocess.run(['dropdb', '--if-exists', nombre], check=True)
    subprocess.run(['createdb', nombre], check=True)
    simulado = os.path.join(RAIZ, 'migracion', 'supabase_simulado.sql')
    if not os.path.exists(simulado): simulado = '/home/claude/prueba/supabase_simulado.sql'
    psql('-d', nombre, '-f', simulado, stderr=subprocess.DEVNULL)
    mig = os.path.join(RAIZ, 'supabase', 'migrations')
    for f in sorted(os.listdir(mig)):
        if f.endswith('.sql'): psql('-d', nombre, '-f', os.path.join(mig, f), stderr=subprocess.DEVNULL)
    env = dict(os.environ, DATABASE_URL=f'dbname={nombre}')
    subprocess.run([sys.executable, os.path.join(AQUI, 'migrar.py'), mdb], check=True, env=env, stdout=subprocess.DEVNULL)
    return f'dbname={nombre}'


def main():
    a = sys.argv[1:]
    if len(a) == 4 and a[0] == '--bases':
        base_dsn, nuevo_dsn, salida, mdb_nuevo = a[1], a[2], a[3], None
    elif len(a) == 3:
        print('Migrando el Access de la carga inicial…'); base_dsn = crear_base('sgrp_base', a[0])
        print('Migrando el Access nuevo…'); nuevo_dsn = crear_base('sgrp_nuevo', a[1])
        salida, mdb_nuevo = a[2], a[1]
    else:
        sys.exit(__doc__)
    os.makedirs(salida, exist_ok=True)

    print('Comparando…')
    base, nuevo = Foto(base_dsn), Foto(nuevo_dsn)
    p, resumen, borrados = comparar(base, nuevo, nuevo.db.cursor())
    inc_sql, n_inc = inconsistencias_nuevas(base_dsn, nuevo_dsn, nuevo.db.cursor())
    p.sql.extend(inc_sql)
    resumen['inconsistencias_nuevas'] = n_inc
    p.sql.append(f"update migracion_corridas set resumen = {p.lit({'tipo': 'novedades', **resumen})} where id = (select id from _corrida);")

    hoy = date.today().isoformat()
    ruta = os.path.join(salida, f'novedades-{hoy}.sql.gz')
    with gzip.open(ruta, 'wt', encoding='utf-8') as f:
        f.write(f'-- SGRP 2.0 · Novedades del Access · generado el {hoy}\n')
        f.write(f'-- {json.dumps(resumen, ensure_ascii=False)}\n')
        f.write('\n'.join(p.sql) + '\n')

    lineas = [f'Novedades del Access · {hoy}', '']
    for t, r in resumen.items():
        if t == 'inconsistencias_nuevas': continue
        lineas.append(f"{NOMBRES.get(t, t):<24} {r['altas']:>6} nuevos   {r['cambios']:>6} con cambios   {r['borrados_en_access']:>4} borrados en el Access")
    lineas += ['', f'Inconsistencias nuevas: {n_inc}']
    if any(borrados.values()):
        lineas += ['', 'Borrados en el Access (no se borran del sistema nuevo; revisar):']
        for t, ks in borrados.items():
            for k in ks[:50]: lineas.append(f'  {NOMBRES.get(t, t)}: {k}')
            if len(ks) > 50: lineas.append(f'  … y {len(ks) - 50} más')
    texto = '\n'.join(lineas)
    open(os.path.join(salida, f'novedades-{hoy}.txt'), 'w', encoding='utf-8').write(texto + '\n')
    print(texto)
    print(f'\nParche: {ruta} ({len(p.sql)} sentencias)')

    if mdb_nuevo:
        sys.path.insert(0, AQUI)
        import esperado
        json.dump(esperado.calcular(mdb_nuevo), open(os.path.join(salida, f'esperado-{hoy}.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        print(f'Cifras de control: esperado-{hoy}.json')


if __name__ == '__main__':
    main()
