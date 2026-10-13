#!/usr/bin/env python3
"""
SGRP 2.0 · Migración de archivos (carpeta RAYGROUP → Supabase Storage) · borrador v0.1

Se corre después de migrar.py. Regla de Serco: una carpeta por tipo de documento y
el archivo se llama con el número único del documento. Por eso cada documento se busca
primero por la ruta que guardó el Access y, si no está, por su número.

Uso:
    export DATABASE_URL="postgresql://postgres:<clave>@<host>:5432/postgres"
    python migrar_archivos.py ruta/a/RAYGROUP                 # solo revisa e informa (no sube nada)

    export SUPABASE_URL="https://<proyecto>.supabase.co"
    export SUPABASE_SERVICE_KEY="<service_role key>"
    python migrar_archivos.py ruta/a/RAYGROUP --subir         # sube y actualiza las rutas en la base

Se puede cortar y volver a correr: lo que ya está subido no se vuelve a subir.
"""
import mimetypes, os, re, sys, json
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import psycopg2

PREFERENCIA = ['.pdf', '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.gif', '.bmp']
CARPETAS_NUMERADAS = {'manifiestos': 'manifiesto', 'manifiestosnacion': 'nacion', 'certdispfinal': 'certificado'}


def partes_ruta(ruta):
    """\\\\USUARIO-PC\\...\\RAYGROUP\\CertDispFinal\\Quimi-0000005 → ('CertDispFinal', 'Quimi-0000005')"""
    p = [x for x in re.split(r'[\\/]', ruta or '') if x]
    up = [x.upper() for x in p]
    if 'RAYGROUP' in up:
        resto = p[up.index('RAYGROUP') + 1:]
        if len(resto) >= 2: return resto[0], '/'.join(resto[1:])
        if len(resto) == 1: return None, resto[0]
    return None, p[-1] if p else None


def sin_ext(nombre):
    base, ext = os.path.splitext(nombre)
    return (base, ext.lower()) if ext.lower() in PREFERENCIA else (nombre, '')


class Indice:
    """Todos los archivos de la copia de RAYGROUP, por carpeta y por nombre sin extensión."""
    def __init__(self, raiz):
        self.raiz = Path(raiz)
        self.por_nombre = defaultdict(lambda: defaultdict(list))   # carpeta → nombre → [rutas]
        self.por_numero = defaultdict(lambda: defaultdict(list))   # carpeta → número (al final del nombre) → [rutas]
        self.usados = set()
        self.total = 0
        for f in self.raiz.rglob('*'):
            if not f.is_file(): continue
            rel = f.relative_to(self.raiz)
            carpeta = rel.parts[0].lower() if len(rel.parts) > 1 else ''
            base, _ = sin_ext(f.name)
            self.por_nombre[carpeta][base.lower()].append(f)
            m = re.search(r'([A-Za-z]?\d[\d\-]*)$', base)
            if m: self.por_numero[carpeta][m.group(1).lower()].append(f)
            self.total += 1

    @staticmethod
    def mejor(candidatos):
        return sorted(candidatos, key=lambda f: (PREFERENCIA.index(f.suffix.lower()) if f.suffix.lower() in PREFERENCIA else 99, -f.stat().st_size))[0]

    def buscar(self, carpeta, nombre=None, numero=None):
        c = (carpeta or '').lower()
        if nombre:
            base, ext = sin_ext(nombre)
            hits = self.por_nombre[c].get(base.lower(), [])
            if ext:
                exactos = [f for f in hits if f.suffix.lower() == ext]
                hits = exactos or hits
            if hits: return self.mejor(hits), 'ruta'
        # Por número solo cuando el Access no guardó la ruta: si la guardó, esa manda
        # (en certificados el nombre lleva el prefijo del operador y el número solo puede confundir)
        if not nombre and numero and c in CARPETAS_NUMERADAS:
            hits = self.por_numero[c].get(numero.lower(), [])
            if len(hits) == 1: return hits[0], 'numero'
            # con varios candidatos (p. ej. el mismo número en dos operadores) no se adivina
        return None, None


class Subida:
    def __init__(self, url, key):
        import requests
        self.s = requests.Session()
        self.s.headers.update({'Authorization': f'Bearer {key}', 'apikey': key, 'x-upsert': 'true'})
        self.base = url.rstrip('/') + '/storage/v1/object/documentos/'

    def subir(self, local, destino):
        tipo = mimetypes.guess_type(str(local))[0] or 'application/octet-stream'
        with open(local, 'rb') as fh:
            r = self.s.post(self.base + destino, data=fh, headers={'Content-Type': tipo}, timeout=300)
        if r.status_code >= 300:
            raise RuntimeError(f'{r.status_code} {r.text[:200]}')


def main():
    if len(sys.argv) < 2 or not os.environ.get('DATABASE_URL'):
        sys.exit(__doc__)
    raiz, subir = sys.argv[1], '--subir' in sys.argv
    db = psycopg2.connect(os.environ['DATABASE_URL']); cur = db.cursor()
    idx = Indice(raiz)
    print(f'Archivos en la copia de RAYGROUP: {idx.total}')

    # (tabla, columna, id, número, operador, ruta del Access, tipo)
    docs = []
    cur.execute("select id, numero, escaneo from manifiestos")
    docs += [('manifiestos', 'escaneo', i, n, None, r, 'manifiesto') for i, n, r in cur.fetchall()]
    cur.execute("select id, numero, escaneo from manifiestos_nacion")
    docs += [('manifiestos_nacion', 'escaneo', i, n, None, r, 'nacion') for i, n, r in cur.fetchall()]
    cur.execute("select id, numero, operador_id, archivo from certificados")
    docs += [('certificados', 'archivo', i, n, o, r, 'certificado') for i, n, o, r in cur.fetchall()]
    # Habilitaciones de flota, generadores, transportistas, plantas y operadores: nombre libre
    for tabla, cols in {'camiones': ['titulo_archivo', 'cedula_archivo', 'rastreo_archivo', 'vtv_archivo', 'carga_pel_archivo', 'ruta_archivo'],
                        'choferes': ['carnet_archivo', 'carga_pel_archivo', 'sep_archivo'],
                        'generadores': ['hab_mun_archivo', 'hab_com_archivo'],
                        'transportistas': ['hab_nac_archivo', 'hab_pro_archivo', 'hab_mun_archivo'],
                        'generadores_principales': ['hab_nac_archivo', 'hab_pro_archivo', 'hab_mun_archivo'],
                        'operadores': ['hab_nac_archivo', 'hab_pro_archivo', 'hab_mun_archivo']}.items():
        for col in cols:
            cur.execute(f"select id, {col} from {tabla} where {col} is not null")
            docs += [(tabla, col, i, None, None, r, 'habilitacion') for i, r in cur.fetchall()]

    plan, faltan, resumen = [], [], defaultdict(lambda: defaultdict(int))
    for tabla, col, i, numero, op, ruta, tipo in docs:
        if ruta and '/' in ruta and not ruta.startswith('\\'):
            resumen[tipo]['ya_en_storage'] += 1; continue        # corrida anterior
        carpeta, nombre = partes_ruta(ruta)
        if tipo != 'habilitacion' and not carpeta:
            carpeta = {'manifiesto': 'Manifiestos', 'nacion': 'ManifiestosNacion', 'certificado': 'CertDispFinal'}[tipo]
        local, como = idx.buscar(carpeta, nombre, numero)
        if not local:
            resumen[tipo]['no_encontrado'] += 1
            faltan.append((tabla, i, numero, ruta)); continue
        idx.usados.add(local)
        ext = local.suffix.lstrip('.') or 'pdf'
        if tipo == 'habilitacion':
            destino = f"habilitaciones/{(carpeta or 'otros').lower()}/{re.sub(r'[^A-Za-z0-9._-]+', '_', local.name)}"
        else:
            cur.execute('select ruta_documento(%s, %s, %s, %s)', (tipo, numero, op, ext))
            destino = cur.fetchone()[0]
        resumen[tipo]['encontrado_por_' + como] += 1
        plan.append((tabla, col, i, ruta, local, destino, como))

    # Registro en migracion_archivos
    for tabla, col, i, ruta, local, destino, como in plan:
        if ruta:
            cur.execute("""update migracion_archivos set encontrado = true, archivo_local = %s, como = %s,
                           storage_path = %s, bytes = %s where ruta_access = %s""",
                        (str(local.relative_to(idx.raiz)), como, destino, local.stat().st_size, ruta))
    db.commit()

    huerfanos = sorted(str(f.relative_to(idx.raiz)) for c in idx.por_nombre.values() for l in c.values() for f in l if f not in idx.usados)
    total_bytes = sum(p[4].stat().st_size for p in plan)
    informe = {'documentos': len(docs), 'a_subir': len(plan), 'gb': round(total_bytes / 1e9, 2),
               'por_tipo': {k: dict(v) for k, v in resumen.items()}, 'archivos_sin_documento': len(huerfanos)}
    print(json.dumps(informe, indent=2, ensure_ascii=False))
    Path('archivos_no_encontrados.csv').write_text('tabla;id;numero;ruta_access\n' + '\n'.join(f'{a};{b};{c or ""};{d or ""}' for a, b, c, d in faltan), encoding='utf-8')
    Path('archivos_sin_documento.txt').write_text('\n'.join(huerfanos), encoding='utf-8')
    print('Detalle: archivos_no_encontrados.csv y archivos_sin_documento.txt')

    if not subir:
        print('Modo revisión: no se subió nada. Agregá --subir para subir al Storage.'); return

    up = Subida(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_KEY'])
    cur.execute('select storage_path from migracion_archivos where subido is not null')
    ya = {r[0] for r in cur.fetchall()}
    pendientes = {}
    for p in plan:                                             # un archivo puede servir a varios documentos
        if p[5] not in ya: pendientes[p[5]] = p[4]
    errores, hechos = [], set()
    with ThreadPoolExecutor(max_workers=8) as ex:
        fut = {ex.submit(up.subir, local, destino): destino for destino, local in pendientes.items()}
        for n, f in enumerate(as_completed(fut), 1):
            d = fut[f]
            try: f.result(); hechos.add(d)
            except Exception as e: errores.append((d, str(e)))
            if n % 500 == 0: print(f'  {n}/{len(fut)} subidos')
    hechos |= ya
    for tabla, col, i, ruta, local, destino, como in plan:
        if destino in hechos:
            cur.execute(f'update {tabla} set {col} = %s where id = %s', (destino, i))
            if ruta: cur.execute('update migracion_archivos set subido = coalesce(subido, now()) where ruta_access = %s', (ruta,))
    db.commit()
    print(f'Subidos: {len(hechos) - len(ya)} · errores: {len(errores)}')
    if errores:
        Path('archivos_con_error.txt').write_text('\n'.join(f'{d}: {e}' for d, e in errores), encoding='utf-8')


if __name__ == '__main__':
    main()
