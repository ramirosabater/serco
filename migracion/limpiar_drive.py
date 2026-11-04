"""
Archivos repetidos en el Google Drive de Serco: los encuentra y los manda a la papelera.

Si una subida se cortó (o la ventana quedó pausada) antes de anotar en la base lo que subió, al volver a correrla el
mismo documento se sube dos veces. Este script junta los archivos con el mismo nombre en la misma carpeta y deja uno:
el que usa el sistema (o, si ninguno está en uso, el más viejo). Los demás van a la papelera del Drive.
No borra nada para siempre: desde la papelera se pueden recuperar. Para liberar el espacio hay que vaciarla a mano
en drive.google.com (o esperar los 30 días en que Google la vacía sola).

No correrlo mientras está corriendo migrar_archivos.py.

Uso (en PowerShell, en C:\\Apps\\sgrp2\\migracion, con $env:SGRP_DB cargado):
  python limpiar_drive.py              revisa y muestra cuántos repetidos hay y cuántos GB ocupan
  python limpiar_drive.py --papelera   los manda a la papelera
"""
import os, sys
from collections import defaultdict
from pathlib import Path

import psycopg2

AQUI = Path(__file__).resolve().parent


def pedir_direccion():
    import getpass
    d = os.environ.get('SGRP_DB') or os.environ.get('DATABASE_URL')
    if d: return d
    print('Pegá la dirección de la base (Supabase → Connect → Session pooler, con tu contraseña). No se muestra mientras la pegás.')
    d = getpass.getpass('Dirección: ').strip()
    if not d.startswith(('postgresql://', 'postgres://')): sys.exit('Eso no parece una dirección de Supabase: tiene que empezar con postgresql://')
    return d


def en_uso(cur):
    """Ids de Drive que usa el sistema: cualquier columna de texto de la base que guarde "drive:<id>" """
    cur.execute("""select c.table_name, c.column_name from information_schema.columns c
                   join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
                   where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.data_type = 'text'""")
    ids = set()
    for tabla, col in cur.fetchall():
        cur.execute(f'select distinct substr("{col}", 7) from "{tabla}" where "{col}" like %s', ('drive:%',))
        ids.update(r[0] for r in cur.fetchall())
    return ids


def main():
    papelera = '--papelera' in sys.argv
    db = psycopg2.connect(pedir_direccion(), connect_timeout=20, keepalives=1, keepalives_idle=30); cur = db.cursor()
    print('Leyendo qué archivos usa el sistema…')
    usados = en_uso(cur)
    db.close()
    print(f'  {len(usados)} archivos del Drive enlazados en el sistema')

    from drive_google import Drive, leer_claves
    d = Drive(leer_claves(os.environ.get('DRIVE_CLAVES') or str(AQUI / '.env.drive')))
    print('Leyendo los archivos que subió el sistema al Drive (puede tardar unos minutos)…')
    todos = d.listar_archivos()
    total = sum(int(f.get('size') or 0) for f in todos)
    print(f'  {len(todos)} archivos · {total / 1e9:.1f} GB')

    grupos = defaultdict(list)
    for f in todos:
        grupos[((f.get('parents') or [''])[0], f['name'])].append(f)
    sobran = []
    for fs in grupos.values():
        if len(fs) < 2: continue
        # se queda el que usa el sistema; si ninguno, el más viejo
        fs.sort(key=lambda f: (f['id'] not in usados, f.get('createdTime') or ''))
        sobran += [f for f in fs[1:] if f['id'] not in usados]
    gb = sum(int(f.get('size') or 0) for f in sobran) / 1e9
    sueltos = sum(1 for fs in grupos.values() if len(fs) == 1 and fs[0]['id'] not in usados)

    print(f'\nRepetidos: {len(sobran)} archivos · {gb:.1f} GB')
    print(f'Sin repetir pero todavía sin enlazar: {sueltos} (los enlaza la próxima corrida de migrar_archivos.py, sin volver a subirlos)')
    if not sobran: print('No hay nada para limpiar.'); return
    if not papelera:
        print('\nModo revisión: no se tocó nada. Agregá --papelera para mandar los repetidos a la papelera del Drive.'); return

    hechos = 0
    for n, f in enumerate(sobran, 1):
        try:
            d.a_la_papelera(f['id']); hechos += 1
        except Exception as e:
            print(f'  no se pudo con {f["name"]}: {e}')
        if n % 200 == 0: print(f'  {n}/{len(sobran)}', flush=True)
    print(f'\nListo: {hechos} archivos repetidos en la papelera ({gb:.1f} GB).')
    print('Para liberar el espacio ya: drive.google.com → Papelera → "Vaciar papelera" (con la cuenta de Serco).')


if __name__ == '__main__':
    main()
