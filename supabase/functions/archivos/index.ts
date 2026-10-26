// Función "archivos": los PDF y fotos del sistema (Google Drive de Serco, o el Storage si Drive no está configurado).
//  - POST (multipart) archivo + ruta  → lo guarda. Solo admin u operador. Devuelve { ruta } para anotar en la base.
//  - POST { accion: "enlace", ruta }  → enlace para verlo, que vence en 5 minutos. Personal de Serco: cualquier
//    archivo; clientes: solo los escaneos y certificados de sus retiros.
//  - GET ?r=…&e=…&s=…                 → el archivo (lo usa ese enlace; no necesita usuario porque va firmado).
import { admin, cors, json, quienLlama } from '../_compartido/comun.ts'
import { controlarEnlace, enlaceFirmado, guardarArchivo, leerArchivo, rutaValida, tipoArchivo } from '../_compartido/archivos.ts'

const MAX_BYTES = 25 * 1024 * 1024

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = admin()
  try {
    // ---------------- ver o bajar, con el enlace firmado
    if (req.method === 'GET') {
      const ok = await controlarEnlace(new URL(req.url).searchParams)
      if (!ok) return new Response('El enlace venció o no es válido. Volvé a tocar "Ver" en el sistema.', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      const a = await leerArchivo(db, ok.guardado)
      const nombre = (ok.descargarComo ?? a.nombre).replace(/[^\p{L}\p{N} ._-]/gu, '_')
      return new Response(a.cuerpo, { headers: {
        'Content-Type': a.mime,
        'Content-Disposition': `${ok.descargarComo ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(nombre)}`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      } })
    }
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

    const quien = await quienLlama(req)
    if (!quien) return json({ error: 'Tenés que entrar al sistema.' }, 401)

    // ---------------- guardar
    if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
      if (quien.tipo === 'usuario' && !['admin', 'operador'].includes(quien.rol)) return json({ error: 'Tu usuario no puede subir archivos.' }, 403)
      const form = await req.formData()
      const f = form.get('archivo'), ruta = String(form.get('ruta') ?? '')
      if (!(f instanceof File) || !f.size) return json({ error: 'No llegó el archivo.' }, 400)
      if (f.size > MAX_BYTES) return json({ error: 'El archivo pesa más de 25 MB.' }, 413)
      if (!rutaValida(ruta)) return json({ error: 'Ruta de archivo inválida.' }, 400)
      const bytes = new Uint8Array(await f.arrayBuffer())
      const tipo = tipoArchivo(bytes)
      if (!tipo) return json({ error: 'Tiene que ser un PDF o una imagen.' }, 415)
      const final = ruta.replace(/\.[A-Za-z0-9]{1,5}$/, '') + '.' + tipo.ext
      return json({ ruta: await guardarArchivo(db, final, bytes, tipo.mime) })
    }

    // ---------------- enlace para ver
    const body = await req.json().catch(() => ({})) as { accion?: string; ruta?: string; descargar?: string }
    if (body.accion === 'enlace') {
      const ruta = String(body.ruta ?? '')
      if (!ruta || ruta.startsWith('\\')) return json({ error: 'Este archivo todavía está en la PC del Access: se sube con la migración de archivos.' }, 404)
      if (quien.tipo === 'usuario') {
        const { data: puede } = await db.rpc('puede_ver_archivo', { p_usuario: quien.id, p_ruta: ruta })
        if (!puede) return json({ error: 'No tenés permiso para ver este archivo.' }, 403)
      }
      return json({ url: await enlaceFirmado(ruta, 300, body.descargar ? String(body.descargar).slice(0, 120) : undefined) })
    }
    return json({ error: 'Acción desconocida' }, 400)
  } catch (e) {
    console.error(e)
    return json({ error: String((e as Error).message ?? e).slice(0, 300) }, 500)
  }
})
