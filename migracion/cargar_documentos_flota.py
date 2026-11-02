"""
Sube al Google Drive de Serco los documentos de la flota habilitada (reunión del 26/10/2026) y los deja en la ficha
de cada camión y chofer (columna carga_pel_archivo).

Antes:
  1. Drive conectado (puesta-en-marcha/DRIVE.md, pasos 1 a 3, con ambientalserco@gmail.com).
  2. En Supabase, correr puesta-en-marcha/actualizaciones/2026-11-02-flota-habilitada.sql.

Uso (en PowerShell, en C:\\Apps\\sgrp2\\migracion):
  python cargar_documentos_flota.py "C:\\serco 26102026\\documentos flota"          revisa y muestra qué haría
  python cargar_documentos_flota.py "C:\\serco 26102026\\documentos flota" --drive  sube y graba

En el Drive quedan en "Gestión Serco · Documentos/habilitaciones/camiones/<patente>" y
".../habilitaciones/choferes/<nombre>". Se puede correr más de una vez: si la ficha ya tiene un archivo de Drive, no se
vuelve a subir (salvo con --reemplazar).
"""
import mimetypes, os, re, sys, unicodedata
from pathlib import Path

import psycopg2

AQUI = Path(__file__).resolve().parent
SASA = '30710247605'   # CUIT de SERCO AMBIENTAL SA

# Qué es cada documento: se reconoce por el nombre del archivo
CAMIONES = {  # patente del carnet: (otras formas en que puede venir escrita en el nombre del archivo)
    'AC683XN': ('AC683XN',), 'AG861AT': ('AG861AT', 'AG681AT'), 'IUM534': ('IUM534',),
    'MVD144': ('MVD144', 'MVD 144'), 'NSZ246': ('NSZ246',), 'PGF948': ('PGF948',),
}
CHOFERES = [  # (cómo aparece en el nombre del archivo, DNI, nombre completo del certificado)
    (r'PAEZ', '38581785', 'PAEZ NESTOR FEDERICO JAVIER'),
    (r'FLORES\s*A\b|FLORESA|FLORES_A', '36181920', 'FLORES MAURO ALEJANDRO'),
    (r'FLORES\s*M\b|FLORESM|FLORES_M', '31594320', 'FLORES MAURO RENE'),
    (r'PEROTTI', '31043848', 'PEROTTI LEONARDO JAVIER'),
]


def pedir_direccion():
    import getpass
    d = os.environ.get('SGRP_DB') or os.environ.get('DATABASE_URL')
    if d: return d
    print('Pegá la dirección de la base (Supabase → Connect → Session pooler, con tu contraseña). No se muestra mientras la pegás.')
    d = getpass.getpass('Dirección: ').strip()
    if not d.startswith(('postgresql://', 'postgres://')): sys.exit('Eso no parece una dirección de Supabase: tiene que empezar con postgresql://')
    return d


def carpeta_segura(s):
    """Nombre de carpeta que acepta el sistema: sin acentos ni símbolos"""
    s = unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'\s+', ' ', re.sub(r'[^A-Za-z0-9 ._-]+', ' ', s)).strip()[:60] or 'sin nombre'


def reconocer(archivo):
    nombre = archivo.stem.upper().replace('_', ' ')
    plano = re.sub(r'[\s-]', '', nombre)
    for patente, formas in CAMIONES.items():
        if any(re.sub(r'\s', '', f) in plano for f in formas):
            return ('camiones', patente)
    for patron, dni, completo in CHOFERES:
        if re.search(patron, nombre) or re.search(patron, archivo.stem.upper()):
            return ('choferes', dni)
    return None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args: sys.exit(__doc__)
    carpeta = Path(args[0])
    if not carpeta.is_dir(): sys.exit(f'No encuentro la carpeta {carpeta}')
    a_drive, reemplazar = '--drive' in sys.argv, '--reemplazar' in sys.argv

    db = psycopg2.connect(pedir_direccion(), connect_timeout=20); cur = db.cursor()
    plan, problemas = [], []
    for f in sorted(p for p in carpeta.iterdir() if p.is_file() and p.suffix.lower() in ('.pdf', '.jpg', '.jpeg', '.png')):
        que = reconocer(f)
        if not que: problemas.append(f'{f.name}: no sé de qué camión o chofer es'); continue
        tabla, clave = que
        if tabla == 'camiones':
            cur.execute("""select c.id, c.patente, c.carga_pel_vto, c.carga_pel_archivo from camiones c join transportistas t on t.id = c.transportista_id
                           where t.cuit = %s and upper(regexp_replace(c.patente, '[\\s_-]', '', 'g')) = %s
                           order by c.activo desc, c.id desc limit 1""", (SASA, clave))
        else:
            cur.execute("""select c.id, c.nombre, c.carga_pel_vto, c.carga_pel_archivo from choferes c join transportistas t on t.id = c.transportista_id
                           where t.cuit = %s and %s in (regexp_replace(coalesce(c.dni, ''), '\\D', '', 'g'), regexp_replace(coalesce(c.carnet_nro, ''), '\\D', '', 'g'))
                           order by c.activo desc, c.id desc limit 1""", (SASA, clave))
        fila = cur.fetchone()
        if not fila: problemas.append(f"{f.name}: no está en el sistema ({'camión' if tabla == 'camiones' else 'chofer con DNI'} {clave} de SERCO AMBIENTAL SA)"); continue
        id_, nombre, vto, ya = fila
        if ya and ya.startswith('drive:') and not reemplazar:
            print(f'  ya está: {nombre} ({f.name})'); continue
        nombre_carpeta = clave if tabla == 'camiones' else next(c for _, d, c in CHOFERES if d == clave)
        destino = f'habilitaciones/{tabla}/{carpeta_segura(nombre_carpeta)}'
        nombre_archivo = f'Cargas peligrosas {carpeta_segura(nombre_carpeta)}{f" vence {vto}" if vto else ""}{f.suffix.lower()}'
        plan.append((tabla, id_, nombre, f, destino, nombre_archivo))
        print(f"  {'camión' if tabla == 'camiones' else 'chofer':6} {nombre:30} ← {f.name}  →  {destino}/{nombre_archivo}")

    for p in problemas: print('  ATENCIÓN:', p)
    if not plan: print('No hay nada para subir.'); return
    if not a_drive:
        print(f'\nModo revisión: {len(plan)} documentos para subir. Agregá --drive para subirlos al Drive de Serco.'); return

    cur.execute("select to_regclass('public.drive_carpetas')")
    if not cur.fetchone()[0]: sys.exit('Falta correr en Supabase puesta-en-marcha/actualizaciones/2026-10-26-archivos-drive.sql')
    from drive_google import Carpetas, Drive, leer_claves
    claves = leer_claves(os.environ.get('DRIVE_CLAVES') or str(AQUI / '.env.drive'))
    d = Drive(claves)
    carpetas = Carpetas(d, db, claves['DRIVE_CARPETA'])
    hechos = 0
    for tabla, id_, nombre, f, destino, nombre_archivo in plan:
        mime = mimetypes.guess_type(str(f))[0] or 'application/octet-stream'
        try:
            guardado = 'drive:' + d.subir(nombre_archivo, carpetas.id(destino), str(f), mime)
        except Exception as e:
            print(f'  ERROR con {f.name}: {e}'); continue
        cur.execute(f'update {tabla} set carga_pel_archivo = %s where id = %s', (guardado, id_))
        db.commit(); hechos += 1
        print(f'  subido: {nombre}')
    print(f'\nListo: {hechos} de {len(plan)} documentos en el Drive y en su ficha.')


if __name__ == '__main__':
    main()
