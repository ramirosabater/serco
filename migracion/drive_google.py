"""
Google Drive para Gestión Serco, sin librerías extra (solo la de Python).
Lo usan autorizar_drive.py (una sola vez) y migrar_archivos.py --drive.
Las claves salen de migracion/.env.drive, que arma autorizar_drive.py y no va a GitHub.
"""
import json, os, time, urllib.error, urllib.parse, urllib.request

API = os.environ.get('GOOGLE_API', 'https://www.googleapis.com')
TOKEN_URL = os.environ.get('GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token')
CARPETA_MIME = 'application/vnd.google-apps.folder'
AQUI = os.path.dirname(os.path.abspath(__file__))
ARCHIVO_CLAVES = os.path.join(AQUI, '.env.drive')


def leer_claves(ruta=ARCHIVO_CLAVES):
    if not os.path.exists(ruta):
        raise SystemExit(f'No encuentro {ruta}. Primero corré:  python autorizar_drive.py  (ver puesta-en-marcha/DRIVE.md)')
    claves = {}
    for linea in open(ruta, encoding='utf-8'):
        if '=' in linea and not linea.startswith('#'):
            k, v = linea.strip().split('=', 1)
            claves[k] = v
    return claves


def pedir(url, datos=None, metodo=None, cabeceras=None, intentos=6):
    """Pedido HTTP con reintentos (Google limita la velocidad: se espera y se vuelve a probar)"""
    for n in range(intentos):
        req = urllib.request.Request(url, data=datos, method=metodo, headers=cabeceras or {})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            cuerpo = e.read()
            if e.code in (403, 429, 500, 502, 503, 504) and n < intentos - 1 and (e.code != 403 or b'ateLimit' in cuerpo):
                time.sleep(min(60, 2 ** n + 0.5)); continue
            raise RuntimeError(f'{e.code} {cuerpo[:300].decode("utf-8", "replace")}')
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if n < intentos - 1: time.sleep(min(60, 2 ** n + 0.5)); continue
            raise RuntimeError(f'Sin conexión con Google: {e}')


class Drive:
    def __init__(self, claves):
        self.c = claves
        self._token, self._vence = None, 0

    def token(self):
        if self._token and self._vence > time.time() + 60: return self._token
        _, _, b = pedir(TOKEN_URL, urllib.parse.urlencode({
            'client_id': self.c['GOOGLE_CLIENT_ID'], 'client_secret': self.c['GOOGLE_CLIENT_SECRET'],
            'refresh_token': self.c['GOOGLE_REFRESH_TOKEN'], 'grant_type': 'refresh_token'}).encode(),
            cabeceras={'Content-Type': 'application/x-www-form-urlencoded'})
        j = json.loads(b)
        self._token, self._vence = j['access_token'], time.time() + j['expires_in']
        return self._token

    def api(self, ruta, datos=None, metodo=None, cabeceras=None):
        return pedir(API + ruta, datos, metodo, {'Authorization': f'Bearer {self.token()}', **(cabeceras or {})})

    def buscar_carpeta(self, nombre, padre):
        q = f"name = '{nombre}' and '{padre}' in parents and mimeType = '{CARPETA_MIME}' and trashed = false".replace("\\", "\\\\")
        _, _, b = self.api('/drive/v3/files?' + urllib.parse.urlencode({'q': q, 'fields': 'files(id)', 'pageSize': 1}))
        f = json.loads(b)['files']
        return f[0]['id'] if f else None

    def crear_carpeta(self, nombre, padre=None):
        meta = {'name': nombre, 'mimeType': CARPETA_MIME, **({'parents': [padre]} if padre else {})}
        _, _, b = self.api('/drive/v3/files?fields=id', json.dumps(meta).encode(), 'POST', {'Content-Type': 'application/json'})
        return json.loads(b)['id']

    def subir(self, nombre, padre, local, mime):
        """Subida reanudable: sirve para archivos de cualquier tamaño. Devuelve el id del archivo en Drive."""
        tam = os.path.getsize(local)
        _, h, _ = self.api('/upload/drive/v3/files?uploadType=resumable&fields=id',
                           json.dumps({'name': nombre, 'parents': [padre]}).encode(), 'POST',
                           {'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': str(tam)})
        destino = h.get('Location') or h.get('location')
        with open(local, 'rb') as fh:
            datos = fh.read()
        _, _, b = pedir(destino, datos, 'PUT', {'Content-Type': mime, 'Content-Length': str(tam)})
        return json.loads(b)['id']


class Carpetas:
    """Carpetas del Drive por ruta ("certificados/12"), anotadas en la tabla drive_carpetas de la base
    (la misma que usa el servidor, así no se crean dos veces)."""
    def __init__(self, drive, db, raiz):
        import threading
        self.d, self.db, self.raiz, self.lock, self.cache = drive, db, raiz, threading.Lock(), {}
        cur = db.cursor(); cur.execute('select ruta, id from drive_carpetas'); self.cache.update(dict(cur.fetchall()))

    def id(self, ruta):
        if not ruta: return self.raiz
        with self.lock:
            if ruta in self.cache: return self.cache[ruta]
            padre_ruta, _, nombre = ruta.rpartition('/')
        padre = self.id(padre_ruta)
        with self.lock:
            if ruta in self.cache: return self.cache[ruta]
            cid = self.d.buscar_carpeta(nombre, padre) or self.d.crear_carpeta(nombre, padre)
            cur = self.db.cursor()
            cur.execute('insert into drive_carpetas (ruta, id) values (%s, %s) on conflict (ruta) do update set id = excluded.id', (ruta, cid))
            self.db.commit()
            self.cache[ruta] = cid
            return cid
