#!/usr/bin/env python3
"""
Gestión Serco · Conectar el Google Drive de Serco (se hace UNA sola vez).

Antes: crear el "cliente OAuth" en Google Cloud con la cuenta de Gmail de Serco y bajar su JSON
(paso a paso en puesta-en-marcha/DRIVE.md). Después, en esta carpeta:

    python autorizar_drive.py client_secret_XXXX.json

Abre el navegador: entrás con la cuenta de Gmail de Serco y tocás "Permitir".
El sistema solo puede ver y tocar los archivos que él mismo sube (permiso "drive.file"), nada más del Drive.

Deja todo en migracion/.env.drive (no va a GitHub) y te muestra el comando para pasárselo a Supabase.
La contraseña de Gmail nunca pasa por acá: la escribís solo en la página de Google.
"""
import base64, hashlib, http.server, json, os, secrets, sys, threading, urllib.parse, webbrowser

from drive_google import ARCHIVO_CLAVES, Drive, pedir, TOKEN_URL

CARPETA_RAIZ = 'Gestión Serco · Documentos'
PERMISO = 'https://www.googleapis.com/auth/drive.file'


def main():
    if len(sys.argv) < 2 or not os.path.exists(sys.argv[1]):
        sys.exit(__doc__)
    cfg = json.load(open(sys.argv[1], encoding='utf-8'))
    cli = cfg.get('installed') or cfg.get('web')
    if not cli:
        sys.exit('Ese JSON no es un cliente OAuth. Bajá el de tipo "App de escritorio" (ver DRIVE.md).')

    # Servidor de un solo uso en esta PC para recibir la respuesta de Google
    resultado = {}
    class Atiende(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            resultado.update({k: v[0] for k, v in q.items()})
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.end_headers()
            ok = 'code' in q
            self.wfile.write(f'<h2 style="font-family:sans-serif">{"Listo: ya podés cerrar esta pestaña y volver a la ventana negra." if ok else "No se autorizó. Volvé a la ventana negra."}</h2>'.encode())
            threading.Thread(target=self.server.shutdown).start()
    srv = http.server.HTTPServer(('127.0.0.1', 0), Atiende)
    redir = f'http://127.0.0.1:{srv.server_port}'

    verif = secrets.token_urlsafe(64)
    estado = secrets.token_urlsafe(16)
    url = 'https://accounts.google.com/o/oauth2/v2/auth?' + urllib.parse.urlencode({
        'client_id': cli['client_id'], 'redirect_uri': redir, 'response_type': 'code', 'scope': PERMISO,
        'access_type': 'offline', 'prompt': 'consent', 'state': estado,
        'code_challenge': base64.urlsafe_b64encode(hashlib.sha256(verif.encode()).digest()).rstrip(b'=').decode(),
        'code_challenge_method': 'S256'})
    print('Se abre el navegador. Entrá con la cuenta de Gmail de Serco y tocá "Permitir".')
    print('Si no se abre solo, copiá esta dirección en el navegador:\n' + url + '\n')
    webbrowser.open(url)
    srv.serve_forever()

    if resultado.get('state') != estado or 'code' not in resultado:
        sys.exit(f'No se autorizó: {resultado.get("error", "sin respuesta")}')
    _, _, b = pedir(TOKEN_URL, urllib.parse.urlencode({
        'code': resultado['code'], 'client_id': cli['client_id'], 'client_secret': cli['client_secret'],
        'redirect_uri': redir, 'grant_type': 'authorization_code', 'code_verifier': verif}).encode(),
        cabeceras={'Content-Type': 'application/x-www-form-urlencoded'})
    tok = json.loads(b)
    if 'refresh_token' not in tok:
        sys.exit('Google no devolvió el permiso permanente. Sacá el acceso en myaccount.google.com → Seguridad → Apps de terceros y volvé a correr esto.')

    claves = {'GOOGLE_CLIENT_ID': cli['client_id'], 'GOOGLE_CLIENT_SECRET': cli['client_secret'], 'GOOGLE_REFRESH_TOKEN': tok['refresh_token']}
    d = Drive(claves)
    raiz = d.buscar_carpeta(CARPETA_RAIZ, 'root') or d.crear_carpeta(CARPETA_RAIZ)
    claves['DRIVE_CARPETA'] = raiz
    with open(ARCHIVO_CLAVES, 'w', encoding='utf-8') as f:
        f.write('# Claves del Google Drive de Serco. NO compartir ni subir a GitHub.\n')
        f.writelines(f'{k}={v}\n' for k, v in claves.items())

    print(f'\nListo. En el Drive quedó la carpeta "{CARPETA_RAIZ}" y las claves en {ARCHIVO_CLAVES}.')
    print('\nAhora pasáselas a Supabase (REF es la parte xxxx de https://xxxx.supabase.co), desde C:\\Apps\\sgrp2:')
    print('    npx supabase secrets set --env-file migracion\\.env.drive --project-ref REF')
    print('    npx supabase functions deploy archivos certificado-chofer --project-ref REF --use-api --no-verify-jwt')


if __name__ == '__main__':
    main()
