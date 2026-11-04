#!/usr/bin/env python3
r"""
Gestión Serco · Migración de archivos del Access (carpetas de RAYGROUP) al Google Drive de Serco.

Regla de Serco: una carpeta por tipo de documento y el archivo se llama con el número único del documento.
Cada documento se busca primero por la ruta que guardó el Access y, si no está, por su número.
Se le pueden pasar varias carpetas: se busca en el orden dado (primero la copia más nueva).

En PowerShell, en C:\Apps\sgrp2\migracion:
    python migrar_archivos.py "C:\serco 26102026" "C:\RAYGROUP"            # solo revisa e informa (no sube nada)
    python migrar_archivos.py "C:\serco 26102026" "C:\RAYGROUP" --drive    # sube al Drive y anota en la base

Pide la dirección de la base (Supabase → Connect → Session pooler) sin mostrarla, o la toma de SGRP_DB.
--drive necesita migracion/.env.drive (lo arma autorizar_drive.py).
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
    """Todos los archivos de las copias de RAYGROUP, por carpeta y por nombre sin extensión."""
    def __init__(self, raices):
        self.raices = [Path(r) for r in raices]
        self.por_nombre = defaultdict(lambda: defaultdict(list))   # carpeta → nombre → [rutas]
        self.por_numero = defaultdict(lambda: defaultdict(list))   # carpeta → número (al final del nombre) → [rutas]
        self.usados = set()
        self.total = 0
        vistos = set()
        for raiz in self.raices:
          for f in raiz.rglob('*'):
            if not f.is_file() or f.name.lower() in ('thumbs.db', 'desktop.ini'): continue
            rel = f.relative_to(raiz)
            if str(rel).lower() in vistos: continue            # el mismo archivo en una copia más vieja: manda la primera
            vistos.add(str(rel).lower())
            carpeta = rel.parts[0].lower() if len(rel.parts) > 1 else ''
            base, _ = sin_ext(f.name)
            self.por_nombre[carpeta][base.lower()].append(f)
            m = re.search(r'([A-Za-z]?\d[\d\-]*)$', base)
            if m: self.por_numero[carpeta][m.group(1).lower()].append(f)
            self.total += 1

    @staticmethod
    def mejor(candidatos):
        return sorted(candidatos, key=lambda f: (PREFERENCIA.index(f.suffix.lower()) if f.suffix.lower() in PREFERENCIA else 99, -f.stat().st_size))[0]

    def relativo(self, f):
        for r in self.raices:
            try: return str(f.relative_to(r))
            except ValueError: pass
        return str(f)

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


def pedir_direccion():
    import getpass
    d = os.environ.get('SGRP_DB') or os.environ.get('DATABASE_URL')
    if d: return d
    print('Pegá la dirección de la base (Supabase → Connect → Session pooler, con tu contraseña). No se muestra mientras la pegás.')
    d = getpass.getpass('Dirección: ').strip()
    if not d.startswith(('postgresql://', 'postgres://')): sys.exit('Eso no parece una dirección de Supabase: tiene que empezar con postgresql://')
    return d


def sin_pausa_por_clic():
    """En Windows, un clic en la ventana de PowerShell la deja "seleccionando" y el programa se frena al escribir.
    Se apaga esa opción (QuickEdit) solo para esta ventana mientras corre el script."""
    if os.name != 'nt': return
    try:
        import ctypes
        k = ctypes.windll.kernel32
        h = k.GetStdHandle(-10)                      # entrada de la consola
        modo = ctypes.c_uint32()
        if k.GetConsoleMode(h, ctypes.byref(modo)):
            k.SetConsoleMode(h, (modo.value & ~0x0040) | 0x0080)   # sin QuickEdit (0x40), con modos extendidos (0x80)
    except Exception:
        pass


def main():
    sin_pausa_por_clic()
    raices = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not raices: sys.exit(__doc__)
    for r in raices:
        if not os.path.isdir(r): sys.exit(f'No encuentro la carpeta {r}')
    a_drive = '--drive' in sys.argv
    dsn = pedir_direccion()
    conectar = lambda: psycopg2.connect(dsn, connect_timeout=20, keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=5)
    db = conectar(); cur = db.cursor()
    print('Buscando los archivos en ' + ', '.join(raices) + '…')
    idx = Indice(raices)
    print(f'Archivos encontrados: {idx.total}')

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
            cur.execute("select 1 from information_schema.columns where table_name = %s and column_name = %s", (tabla, col))
            if not cur.fetchone(): continue
            cur.execute(f"select id, {col} from {tabla} where {col} is not null")
            docs += [(tabla, col, i, None, None, r, 'habilitacion') for i, r in cur.fetchall()]

    plan, faltan, resumen = [], [], defaultdict(lambda: defaultdict(int))
    for tabla, col, i, numero, op, ruta, tipo in docs:
        if ruta and (ruta.startswith('drive:') or ('/' in ruta and not ruta.startswith('\\'))):
            resumen[tipo]['ya_subido'] += 1; continue           # corrida anterior, o cargado desde el sistema nuevo
        carpeta, nombre = partes_ruta(ruta)
        if tipo != 'habilitacion' and not carpeta:
            carpeta = {'manifiesto': 'Manifiestos', 'nacion': 'ManifiestosNacion', 'certificado': 'CertDispFinal'}[tipo]
        local, como = idx.buscar(carpeta, nombre, numero)
        mismo_que_retiro = False
        if not local and tipo == 'nacion':
            # Viaje directo (sobre todo hasta 2020): el Manifiesto Nación lleva el número del manifiesto del retiro
            # y el escaneo es el mismo papel, guardado en Manifiestos. Se usa ese mismo archivo (no se sube dos veces).
            local, como = idx.buscar('Manifiestos', nombre, numero)
            if local: como, mismo_que_retiro = 'manifiesto_del_retiro', True
        if not local:
            resumen[tipo]['no_encontrado'] += 1
            faltan.append((tabla, i, numero, ruta)); continue
        idx.usados.add(local)
        ext = local.suffix.lstrip('.').lower() or 'pdf'
        if tipo == 'habilitacion':
            sub = {'vehiculos': 'camiones'}.get((carpeta or 'otros').lower(), (carpeta or 'otros').lower())
            destino = f"habilitaciones/{sub}/{re.sub(r'[^A-Za-z0-9._-]+', '_', local.name)}"
        else:   # la ruta la arma la base, todas juntas más abajo
            destino = ('manifiesto', numero, None, ext) if mismo_que_retiro else (tipo, numero, op, ext)
        resumen[tipo]['encontrado_por_' + como] += 1
        plan.append([tabla, col, i, ruta, local, destino, como])

    # Rutas de manifiestos, Manifiestos Nación y certificados: una sola consulta para todos
    # (de a una eran ~45.000 viajes a la base: horas)
    pend = [(k, *p[5]) for k, p in enumerate(plan) if isinstance(p[5], tuple)]
    if pend:
        print(f'Armando las rutas de {len(pend)} documentos…')
        cur.execute("""select x.k, ruta_documento(x.t, x.n, x.o, x.e)
                       from unnest(%s::int[], %s::text[], %s::text[], %s::bigint[], %s::text[]) as x(k, t, n, o, e)""",
                    ([a[0] for a in pend], [a[1] for a in pend], [a[2] for a in pend], [a[3] for a in pend], [a[4] for a in pend]))
        for k, r in cur.fetchall(): plan[k][5] = r
    plan = [tuple(p) for p in plan]

    # Registro en migracion_archivos (todo junto)
    print('Anotando lo encontrado…')
    from psycopg2.extras import execute_values
    filas = [(ruta, idx.relativo(local), 'numero' if como == 'numero' else 'ruta', local.stat().st_size) for _, _, _, ruta, local, _, como in plan if ruta]
    execute_values(cur, """update migracion_archivos m set encontrado = true, archivo_local = v.local, como = v.como, bytes = v.bytes
                            from (values %s) as v(ruta, local, como, bytes)
                            where m.ruta_access = v.ruta and m.subido is null""", filas, page_size=2000)
    db.commit()

    huerfanos = sorted(idx.relativo(f) for c in idx.por_nombre.values() for l in c.values() for f in l if f not in idx.usados)
    total_bytes = sum(p[4].stat().st_size for p in plan)
    informe = {'documentos': len(docs), 'a_subir': len(plan), 'gb': round(total_bytes / 1e9, 2),
               'por_tipo': {k: dict(v) for k, v in resumen.items()}, 'archivos_sin_documento': len(huerfanos)}
    print(json.dumps(informe, indent=2, ensure_ascii=False))
    Path('archivos_no_encontrados.csv').write_text('tabla;id;numero;ruta_access\n' + '\n'.join(f'{a};{b};{c or ""};{d or ""}' for a, b, c, d in faltan), encoding='utf-8')
    Path('archivos_sin_documento.txt').write_text('\n'.join(huerfanos), encoding='utf-8')
    print('Detalle: archivos_no_encontrados.csv y archivos_sin_documento.txt (en esta carpeta; no van a GitHub)')

    if not a_drive:
        print('Modo revisión: no se subió nada. Agregá --drive para subir al Google Drive de Serco.'); return

    from drive_google import Carpetas, Drive, leer_claves
    claves = leer_claves()
    d = Drive(claves)
    carpetas = Carpetas(d, db, claves['DRIVE_CARPETA'])
    pendientes = {}                                            # un archivo puede servir a varios documentos
    for p in plan: pendientes.setdefault(p[5], p[4])
    por_destino = defaultdict(list)
    for p in plan: por_destino[p[5]].append(p)

    def subir(destino, local):
        ruta_carpeta, _, nombre = destino.rpartition('/')
        padre = carpetas.id(ruta_carpeta)
        # Si ya se subió en una corrida que se cortó antes de anotarlo, se usa ese (no se sube dos veces)
        ya = d.buscar_archivo(nombre, padre)
        if ya: return 'drive:' + ya
        mime = mimetypes.guess_type(str(local))[0] or 'application/octet-stream'
        return 'drive:' + d.subir(nombre, padre, str(local), mime)

    errores, hechos, t0 = [], 0, __import__('time').time()
    bytes_hechos = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        fut = {ex.submit(subir, destino, local): destino for destino, local in pendientes.items()}
        for n, f in enumerate(as_completed(fut), 1):
            destino = fut[f]
            try:
                guardado = f.result()
            except Exception as e:
                errores.append((destino, str(e))); continue
            # Se anota y se guarda apenas sube: si se corta, lo subido no se vuelve a subir.
            # Si la conexión con la base se cayó (pasa en corridas largas), se reconecta y se reintenta.
            for intento in range(3):
                try:
                    for tabla, col, i, ruta, local, _, _ in por_destino[destino]:
                        cur.execute(f'update {tabla} set {col} = %s where id = %s', (guardado, i))
                        if ruta: cur.execute('update migracion_archivos set storage_path = %s, subido = coalesce(subido, now()) where ruta_access = %s', (guardado, ruta))
                    db.commit(); break
                except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
                    if intento == 2: raise SystemExit(f'Se perdió la conexión con la base ({e}). Volvé a correr el mismo comando: sigue donde quedó.')
                    print('  (se cortó la conexión con la base: reconectando…)')
                    try: db.close()
                    except Exception: pass
                    db = conectar(); cur = db.cursor(); carpetas.db = db
            hechos += 1; bytes_hechos += pendientes[destino].stat().st_size
            if n % 25 == 0 or n == len(fut):
                seg = __import__('time').time() - t0
                falta = (total_bytes - bytes_hechos) / (bytes_hechos / seg) if bytes_hechos else 0
                print(f'  {__import__("time").strftime("%H:%M")}  {n}/{len(fut)} · {bytes_hechos / 1e9:.2f} de {total_bytes / 1e9:.2f} GB · faltan unos {falta / 60:.0f} min', flush=True)
    print(f'Subidos: {hechos} · errores: {len(errores)}')
    if errores:
        Path('archivos_con_error.txt').write_text('\n'.join(f'{d}: {e}' for d, e in errores), encoding='utf-8')
        print('Los errores están en archivos_con_error.txt: volvé a correr el mismo comando y reintenta solo esos.')


if __name__ == '__main__':
    main()
