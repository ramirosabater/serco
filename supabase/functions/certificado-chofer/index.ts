// Función "certificado-chofer": el pedido de certificados a los choferes.
//  - accion "pedir": la usa el personal de Serco (admin u operador) con el botón "Pedir por mail".
//  - accion "ver" y "subir": las usa la página pública /subir/<enlace>, sin usuario. La única llave es el
//    enlace de 64 caracteres al azar que le llegó por mail al chofer; vale hasta su fecha y para un solo documento.
// Lo que sube el chofer NO pasa solo a su ficha: queda "para revisar" y alguien de Serco lo acepta con un clic,
// porque el vencimiento lo lee el celular del chofer y se podría falsear.
import { admin, cors, enviarMail, env, esc, fd, json, plantilla, quienLlama } from '../_compartido/comun.ts'
import { DOCUMENTOS, pedirCertificados } from '../_compartido/pedidos.ts'
import { guardarArchivo, tipoArchivo } from '../_compartido/archivos.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const MAX_BYTES = 10 * 1024 * 1024
const MAX_INTENTOS = 6
const ABIERTO = ['pendiente', 'enviado', 'sin_mail', 'subido']

async function buscar(db: SupabaseClient, token: unknown) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null
  const { data } = await db.from('pedidos_documento')
    .select('id, chofer_id, documento, vence, estado, intentos, subido, motivo, choferes(nombre, dni, carnet_nro, carnet_vto, carga_pel_vto, sep_vto, transportistas(nombre))')
    .eq('token', token).maybeSingle()
  return data
}

type Pedido = NonNullable<Awaited<ReturnType<typeof buscar>>>
const chofer = (p: Pedido) => (p.choferes ?? {}) as unknown as { nombre: string; dni: string | null; carnet_nro: string | null; transportistas: { nombre: string } | null } & Record<string, string | null>
const dniDe = (p: Pedido) => String(chofer(p).dni ?? (/^\d{7,8}$/.test(chofer(p).carnet_nro ?? '') ? chofer(p).carnet_nro : '') ?? '').replace(/\D/g, '')

function vista(p: Pedido) {
  const c = chofer(p), d = DOCUMENTOS[p.documento]
  const vencido = Date.parse(p.vence) < Date.now()
  return {
    chofer: c.nombre, transportista: c.transportistas?.nombre ?? null,
    documento: p.documento, label: d.label, ayuda: d.ayuda, lector: d.lector,
    vto_actual: c[`${p.documento}_vto`] ?? null,
    vence: p.vence, estado: vencido && ABIERTO.includes(p.estado) ? 'vencido' : p.estado,
    subido: p.subido, motivo: p.estado === 'rechazado' ? p.motivo : null,
    // Solo los últimos 3 números, para avisar en pantalla si el certificado es de otra persona
    dni_fin: dniDe(p).slice(-3) || null,
    puede_subir: !vencido && ABIERTO.includes(p.estado) && p.intentos < MAX_INTENTOS,
  }
}

async function subir(db: SupabaseClient, req: Request) {
  const form = await req.formData().catch(() => null)
  if (!form) return json({ error: 'No llegó el archivo.' }, 400)
  const p = await buscar(db, form.get('token'))
  if (!p) return json({ error: 'El enlace no es válido. Pedile a Serco que te lo mande de nuevo.' }, 404)
  const v = vista(p)
  if (!v.puede_subir) return json({ error: v.estado === 'vencido' ? 'El enlace venció. Pedile a Serco que te lo mande de nuevo.'
    : p.intentos >= MAX_INTENTOS ? 'Se subieron demasiados archivos con este enlace. Pedile a Serco uno nuevo.' : 'Este pedido ya está cerrado.' }, 409)

  const f = form.get('archivo')
  if (!(f instanceof File) || !f.size) return json({ error: 'No llegó el archivo.' }, 400)
  if (f.size > MAX_BYTES) return json({ error: 'El archivo pesa más de 10 MB. Probá con una captura de pantalla o una foto más chica.' }, 413)
  const bytes = new Uint8Array(await f.arrayBuffer())
  const tipo = tipoArchivo(bytes)
  if (!tipo) return json({ error: 'Tiene que ser un PDF o una foto (JPG, PNG, WEBP o HEIC).' }, 415)

  // Lo que leyó la página del certificado (en el celular): se controla el formato y el DNI
  let l: { tipo?: string; dni?: string; vence?: string; nombre?: string; detalle?: string } = {}
  try { l = JSON.parse(String(form.get('lectura') ?? '{}')) ?? {} } catch { l = {} }
  const dniLeido = /^\d{6,9}$/.test(String(l.dni ?? '')) ? String(l.dni) : null
  const venceLeido = /^\d{4}-\d{2}-\d{2}$/.test(String(l.vence ?? '')) && !isNaN(Date.parse(String(l.vence))) ? String(l.vence) : null
  const lector = DOCUMENTOS[p.documento].lector
  if (lector && l.tipo && l.tipo !== lector) return json({ error: `Este archivo no es ${DOCUMENTOS[p.documento].label.toLowerCase()}.` }, 422)
  const dni = dniDe(p)
  if (dniLeido && dni && dniLeido !== dni) return json({ error: `El certificado es de otra persona (DNI terminado en ${dniLeido.slice(-3)}).` }, 422)

  let ruta = `habilitaciones/choferes/${p.chofer_id}/${p.documento}_archivo-${venceLeido ?? 'sin-fecha'}-pedido${p.id}-${Date.now()}.${tipo.ext}`
  try { ruta = await guardarArchivo(db, ruta, bytes, tipo.mime) }   // Drive de Serco (o el Storage si Drive no está configurado)
  catch (e) { console.error(e); return json({ error: 'No se pudo guardar el archivo. Probá de nuevo en un rato.' }, 500) }
  const { error: e2 } = await db.from('pedidos_documento').update({
    estado: 'subido', archivo: ruta, subido: new Date().toISOString(), intentos: p.intentos + 1,
    vto_leido: venceLeido, dni_leido: dniLeido,
    nombre_leido: l.nombre ? String(l.nombre).slice(0, 120) : null, detalle: l.detalle ? String(l.detalle).slice(0, 300) : null,
  }).eq('id', p.id)
  if (e2) return json({ error: 'No se pudo guardar. Probá de nuevo en un rato.' }, 500)

  // Aviso a Serco (si no sale, no importa: el ayudante y la pantalla de vencimientos lo muestran igual)
  const { data: prm } = await db.from('parametros').select('valor').eq('clave', 'mails_vencimientos').maybeSingle()
  const para = String(prm?.valor ?? '').split(/[;,\s]+/).filter((x) => x.includes('@'))
  if (para.length) {
    const asunto = `${v.chofer} subió: ${DOCUMENTOS[p.documento].label}`
    await enviarMail(db, 'certificado_subido', para, asunto, plantilla(asunto,
      `<p><b>${esc(v.chofer)}</b>${v.transportista ? ` (${esc(v.transportista)})` : ''} subió el certificado desde el enlace del mail.</p>
       <p>${venceLeido ? `Vencimiento leído: <b>${fd(venceLeido)}</b>.` : 'No se pudo leer el vencimiento: hay que cargarlo a mano.'}</p>
       <p><a href="${env('APP_URL', 'https://sercosa.netlify.app')}/vencimientos" style="color:#0B8A22;font-weight:bold">Revisarlo y aceptarlo</a></p>`))
  }
  return json({ ok: true, vto_leido: venceLeido })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  const db = admin()
  try {
    if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) return await subir(db, req)
    const body = await req.json().catch(() => ({})) as { accion?: string; token?: string; chofer_id?: number; documento?: string }

    if (body.accion === 'ver') {
      const p = await buscar(db, body.token)
      return p ? json(vista(p)) : json({ error: 'El enlace no es válido. Pedile a Serco que te lo mande de nuevo.' }, 404)
    }

    if (body.accion === 'pedir') {
      const quien = await quienLlama(req)
      if (!quien || (quien.tipo === 'usuario' && !['admin', 'operador'].includes(quien.rol))) return json({ error: 'No autorizado' }, 401)
      if (!env('RESEND_API_KEY')) return json({ error: 'Falta cargar el secreto RESEND_API_KEY en Supabase: sin eso no salen los mails.' }, 400)
      const r = await pedirCertificados(db, {
        choferId: body.chofer_id ? Number(body.chofer_id) : undefined, documento: body.documento,
        pedidoPor: quien.tipo === 'usuario' ? quien.id : null,
      })
      return json(r, 'error' in r ? 400 : 200)
    }
    return json({ error: 'Acción desconocida' }, 400)
  } catch (e) {
    console.error(e)
    return json({ error: 'Algo falló del lado del servidor. Probá de nuevo en un rato.' }, 500)
  }
})
