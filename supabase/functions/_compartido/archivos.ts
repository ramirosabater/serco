// Archivos del sistema: se guardan en el Google Drive de Serco (si están cargadas sus claves) o, si no,
// en el Storage de Supabase. En la base queda "drive:<id>" o la ruta del Storage.
// Para verlos, el servidor da un enlace firmado que vence en minutos (como los del Storage).
//
// Secretos (Supabase → Edge Functions → Secrets), los deja listos puesta-en-marcha/drive/autorizar.py:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, DRIVE_CARPETA (id de la carpeta raíz)
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { env } from './comun.ts'

const API = () => env('GOOGLE_API', 'https://www.googleapis.com')
const TOKEN_URL = () => env('GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token')

export const driveConfigurado = () =>
  !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET') && env('GOOGLE_REFRESH_TOKEN') && env('DRIVE_CARPETA'))

/** Qué es el archivo según sus primeros bytes (no se confía en el nombre ni en lo que diga el navegador) */
export function tipoArchivo(b: Uint8Array): { ext: string; mime: string } | null {
  const ini = (s: string, o = 0) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0))
  if (ini('%PDF')) return { ext: 'pdf', mime: 'application/pdf' }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' }
  if (b[0] === 0x89 && ini('PNG', 1)) return { ext: 'png', mime: 'image/png' }
  if (ini('RIFF') && ini('WEBP', 8)) return { ext: 'webp', mime: 'image/webp' }
  if (ini('ftyp', 4) && /hei|mif|avif/.test(String.fromCharCode(...b.slice(8, 12)))) return { ext: 'heic', mime: 'image/heic' }
  if (ini('II*\0') || ini('MM\0*')) return { ext: 'tif', mime: 'image/tiff' }
  if (ini('GIF8')) return { ext: 'gif', mime: 'image/gif' }
  if (ini('BM')) return { ext: 'bmp', mime: 'image/bmp' }
  return null
}

/** Rutas permitidas: manifiestos/…, manifiestos-nacion/…, certificados/…, habilitaciones/… (sin "..") */
export function rutaValida(ruta: string) {
  return /^(manifiestos|manifiestos-nacion|certificados|habilitaciones)\/[A-Za-z0-9 ._\/-]{1,200}$/.test(ruta) && !ruta.includes('..') && !ruta.includes('//')
}

// ------------------------------------------------------------------ Google Drive
let token: { valor: string; vence: number } | null = null
async function tokenDrive(): Promise<string> {
  if (token && token.vence > Date.now() + 60_000) return token.valor
  const r = await fetch(TOKEN_URL(), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'),
      refresh_token: env('GOOGLE_REFRESH_TOKEN'), grant_type: 'refresh_token' }),
  })
  if (!r.ok) throw new Error(`Google no dio acceso al Drive (${r.status}). Puede que haya que volver a autorizar la cuenta.`)
  const j = await r.json() as { access_token: string; expires_in: number }
  token = { valor: j.access_token, vence: Date.now() + j.expires_in * 1000 }
  return token.valor
}

async function drive(ruta: string, init: RequestInit = {}) {
  const r = await fetch(API() + ruta, { ...init, headers: { Authorization: `Bearer ${await tokenDrive()}`, ...(init.headers ?? {}) } })
  if (!r.ok) throw new Error(`Drive respondió ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r
}

/** Id de la carpeta (la crea si no existe), por ejemplo "habilitaciones/choferes/39" */
async function carpeta(db: SupabaseClient, ruta: string): Promise<string> {
  if (!ruta) return env('DRIVE_CARPETA')
  const { data } = await db.from('drive_carpetas').select('id').eq('ruta', ruta).maybeSingle()
  if (data?.id) return data.id
  const i = ruta.lastIndexOf('/')
  const padre = await carpeta(db, i < 0 ? '' : ruta.slice(0, i))
  const nombre = ruta.slice(i + 1)
  const q = `name = '${nombre.replace(/'/g, "\\'")}' and '${padre}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  const lista = await (await drive(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`)).json() as { files: { id: string }[] }
  let id = lista.files[0]?.id
  if (!id) {
    id = (await (await drive('/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nombre, mimeType: 'application/vnd.google-apps.folder', parents: [padre] }) })).json() as { id: string }).id
  }
  await db.from('drive_carpetas').upsert({ ruta, id })
  return id
}

async function subirDrive(db: SupabaseClient, ruta: string, bytes: Uint8Array, mime: string): Promise<string> {
  const i = ruta.lastIndexOf('/')
  const padre = await carpeta(db, ruta.slice(0, i))
  // Subida "reanudable": sirve para cualquier tamaño
  const inicio = await drive('/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime },
    body: JSON.stringify({ name: ruta.slice(i + 1), parents: [padre] }),
  })
  const destino = inicio.headers.get('Location')
  if (!destino) throw new Error('Drive no devolvió dónde subir el archivo')
  const r = await fetch(destino, { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes })
  if (!r.ok) throw new Error(`Drive no aceptó el archivo (${r.status})`)
  return 'drive:' + (await r.json() as { id: string }).id
}

/** Guarda un archivo. Devuelve lo que se anota en la base: "drive:<id>" o la ruta del Storage. */
export async function guardarArchivo(db: SupabaseClient, ruta: string, bytes: Uint8Array, mime: string): Promise<string> {
  if (driveConfigurado()) return await subirDrive(db, ruta, bytes, mime)
  const { error } = await db.storage.from('documentos').upload(ruta, bytes, { contentType: mime, upsert: true })
  if (error) throw new Error('No se pudo guardar el archivo: ' + error.message)
  return ruta
}

/** El contenido de un archivo guardado (de Drive o del Storage) */
export async function leerArchivo(db: SupabaseClient, guardado: string): Promise<{ cuerpo: ReadableStream<Uint8Array> | Blob; mime: string; nombre: string }> {
  if (guardado.startsWith('drive:')) {
    const id = guardado.slice(6)
    if (!/^[A-Za-z0-9_-]{10,100}$/.test(id)) throw new Error('Archivo inválido')
    const meta = await (await drive(`/drive/v3/files/${id}?fields=name,mimeType`)).json() as { name: string; mimeType: string }
    const r = await drive(`/drive/v3/files/${id}?alt=media`)
    return { cuerpo: r.body!, mime: meta.mimeType || 'application/octet-stream', nombre: meta.name }
  }
  const { data, error } = await db.storage.from('documentos').download(guardado)
  if (error || !data) throw new Error('No se encontró el archivo')
  return { cuerpo: data, mime: data.type || 'application/octet-stream', nombre: guardado.split('/').pop() ?? 'archivo' }
}

// ------------------------------------------------------------------ enlaces firmados
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const deB64url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))
async function hmac(texto: string) {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(env('ARCHIVOS_FIRMA') || env('SUPABASE_SERVICE_ROLE_KEY')),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(texto)))
}

/** Enlace para ver o bajar un archivo durante `segundos` */
export async function enlaceFirmado(guardado: string, segundos = 300, descargarComo?: string) {
  const r = b64url(new TextEncoder().encode(guardado)), e = String(Math.floor(Date.now() / 1000) + segundos), n = descargarComo ? b64url(new TextEncoder().encode(descargarComo)) : ''
  const s = await hmac(`${r}.${e}.${n}`)
  const q = new URLSearchParams({ r, e, s, ...(n ? { n } : {}) })
  return `${env('URL_PUBLICA_FUNCIONES', env('SUPABASE_URL') + '/functions/v1')}/archivos?${q}`
}

/** Controla un enlace firmado. Devuelve el archivo guardado y el nombre de descarga, o null si no vale. */
export async function controlarEnlace(q: URLSearchParams): Promise<{ guardado: string; descargarComo: string | null } | null> {
  const r = q.get('r') ?? '', e = q.get('e') ?? '', s = q.get('s') ?? '', n = q.get('n') ?? ''
  if (!r || !e || !s || Number(e) < Date.now() / 1000) return null
  const esperada = await hmac(`${r}.${e}.${n}`)
  if (esperada.length !== s.length) return null
  let dif = 0
  for (let i = 0; i < s.length; i++) dif |= esperada.charCodeAt(i) ^ s.charCodeAt(i)
  if (dif) return null
  return { guardado: deB64url(r), descargarComo: n ? deB64url(n) : null }
}
