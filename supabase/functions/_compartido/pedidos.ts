// Pedido de certificados a los choferes: se crea un enlace único por documento y se manda por mail
// al chofer (o, si no tiene mail, a su transportista). Lo usan la función "certificado-chofer"
// (botón "Pedir por mail") y la tarea diaria "avisos" (si el parámetro pedir_certificados_auto es "si").
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { enviarMail, env, esc, fd, plantilla } from './comun.ts'

export const DOCUMENTOS: Record<string, { label: string; lector: 'mmpp' | 'psicofisico' | null; ayuda: string }> = {
  carnet: { label: 'Carnet de conducir', lector: null, ayuda: 'una foto de los dos lados del carnet' },
  carga_pel: { label: 'Licencia de carga peligrosa (Seguridad Vial)', lector: 'mmpp',
    ayuda: 'el PDF de Seguridad Vial o una captura de pantalla donde se vea el código QR' },
  sep: { label: 'Psicofísico', lector: 'psicofisico', ayuda: 'el PDF del certificado de evaluación psicofísica' },
}

interface ParaPedir { chofer_id: number; chofer: string; transportista: string; documento: string; vto: string | null; dias: number | null; para: string | null; de_quien: string | null }

const mails = (s: string | null) => String(s ?? '').split(/[;,\s]+/).filter((x) => x.includes('@'))
const cuando = (p: ParaPedir) => p.vto == null ? 'No está cargado'
  : p.dias! < 0 ? `Venció el ${fd(p.vto)}` : p.dias === 0 ? 'Vence hoy' : `Vence el ${fd(p.vto)}`

/** Crea los pedidos y manda un mail por chofer. Sin chofer_id: todos los que vencen dentro de los días configurados. */
export async function pedirCertificados(db: SupabaseClient, op: { choferId?: number; documento?: string; pedidoPor?: string | null }) {
  let lista: ParaPedir[]
  if (op.choferId) {
    // Pedido puntual desde la ficha: se pide aunque falte mucho para el vencimiento
    const { data: h, error } = await db.from('choferes').select('id, nombre, email, carnet_vto, carga_pel_vto, sep_vto, transportistas(nombre, email)')
      .eq('id', op.choferId).maybeSingle()
    if (error) throw error
    if (!h) return { error: 'No existe ese chofer.' }
    const docs = op.documento ? [op.documento] : Object.keys(DOCUMENTOS)
    if (docs.some((d) => !DOCUMENTOS[d])) return { error: 'Documento desconocido.' }
    const t = (h.transportistas ?? {}) as { nombre?: string; email?: string | null }
    const para = mails(h.email).length ? h.email : mails(t.email ?? null).length ? t.email! : null
    lista = docs.map((d) => {
      const vto = (h as Record<string, unknown>)[`${d}_vto`] as string | null
      return { chofer_id: h.id, chofer: h.nombre, transportista: t.nombre ?? '', documento: d, vto,
        dias: vto ? Math.round((Date.parse(vto) - Date.parse(new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10))) / 86400_000) : null,
        para, de_quien: mails(h.email).length ? 'chofer' : para ? 'transportista' : null }
    })
    if (!para) return { error: `${h.nombre} no tiene mail cargado, y su transportista tampoco. Cargalo en la ficha y probá de nuevo.` }
    // Si ya hay un pedido abierto de ese documento, se cancela y se manda uno nuevo
    await db.from('pedidos_documento').update({ estado: 'cancelado', motivo: 'Se volvió a pedir' })
      .eq('chofer_id', h.id).in('documento', docs).in('estado', ['pendiente', 'enviado', 'sin_mail'])
  } else {
    const { data, error } = await db.rpc('choferes_para_pedir', { p_dias: null })
    if (error) throw error
    lista = (data ?? []) as ParaPedir[]
  }

  const porChofer = new Map<number, ParaPedir[]>()
  for (const p of lista) porChofer.set(p.chofer_id, [...(porChofer.get(p.chofer_id) ?? []), p])
  const app = env('APP_URL', 'https://sercosa.netlify.app')
  let enviados = 0, sinMail = 0, fallidos = 0
  const detalle: string[] = []

  for (const [choferId, docs] of porChofer) {
    const para = mails(docs[0].para)
    const { data: pedidos, error } = await db.from('pedidos_documento')
      .insert(docs.map((d) => ({ chofer_id: choferId, documento: d.documento, pedido_por: op.pedidoPor ?? null, estado: para.length ? 'pendiente' : 'sin_mail' })))
      .select('id, documento, token, vence')
    if (error) throw error
    if (!para.length) { sinMail++; detalle.push(`${docs[0].chofer}: sin mail`); continue }

    const alChofer = docs[0].de_quien === 'chofer'
    const botones = (pedidos ?? []).map((p) => {
      const d = docs.find((x) => x.documento === p.documento)!
      return `<tr><td style="padding:10px 0;border-bottom:1px solid #DDE7DA"><b>${esc(DOCUMENTOS[p.documento].label)}</b><br>
        <span style="color:#5F6F62">${esc(cuando(d))}. Sirve ${esc(DOCUMENTOS[p.documento].ayuda)}.</span></td>
        <td style="padding:10px 0 10px 12px;border-bottom:1px solid #DDE7DA;text-align:right">
        <a href="${app}/subir/${p.token}" style="display:inline-block;background:#0B8A22;color:#fff;text-decoration:none;padding:9px 16px;border-radius:999px;font-weight:bold;white-space:nowrap">Subir</a></td></tr>`
    }).join('')
    const vence = (pedidos ?? [])[0]?.vence as string | undefined
    const cuerpo = `<p>Hola, ${esc(alChofer ? docs[0].chofer : docs[0].transportista)}:</p>
      <p>${alChofer ? 'Para seguir saliendo con manifiestos de Serco Ambiental necesitamos tu certificado nuevo'
        : `Para que <b>${esc(docs[0].chofer)}</b> pueda seguir saliendo con manifiestos de Serco Ambiental necesitamos su certificado nuevo`}${docs.length > 1 ? ' de estos documentos' : ''}.
      Se sube desde el celular o la computadora con el botón, en un minuto. No hace falta usuario ni contraseña.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse;margin:8px 0 16px">${botones}</table>
      <p style="color:#5F6F62;font-size:13px">El enlace es personal y vale hasta el ${fd(vence?.slice(0, 10))}. Con un documento vencido el sistema no deja emitir el manifiesto.</p>`
    const asunto = docs.length === 1 ? `${DOCUMENTOS[docs[0].documento].label}: falta el certificado nuevo de ${docs[0].chofer}`
      : `Faltan ${docs.length} certificados de ${docs[0].chofer}`
    const ok = await enviarMail(db, 'pedido_certificado', para, asunto, plantilla(asunto, cuerpo))
    const ids = (pedidos ?? []).map((p) => p.id)
    if (ok) {
      await db.from('pedidos_documento').update({ estado: 'enviado', enviado: new Date().toISOString(), enviado_a: para.join(', ') }).in('id', ids)
      enviados++; detalle.push(`${docs[0].chofer}: enviado a ${para.join(', ')}`)
    } else {
      // Queda "pendiente": la tarea diaria no lo repite mientras esté abierto; desde la ficha se puede volver a pedir
      await db.from('pedidos_documento').update({ enviado_a: para.join(', ') }).in('id', ids)
      fallidos++; detalle.push(`${docs[0].chofer}: falló el envío`)
    }
  }
  return { choferes: porChofer.size, documentos: lista.length, enviados, sin_mail: sinMail, envios_fallidos: fallidos, detalle }
}

/** Cierra solos los pedidos que ya no hacen falta (alguien cargó el vencimiento nuevo a mano) o que vencieron */
export async function cerrarPedidosViejos(db: SupabaseClient) {
  const { data } = await db.from('pedidos_documento').select('id, documento, vence, choferes(carnet_vto, carga_pel_vto, sep_vto)')
    .in('estado', ['pendiente', 'enviado', 'sin_mail']).limit(2000)
  const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
  const lejos = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10)
  const cerrar = (data ?? []).filter((p) => {
    const vto = ((p.choferes ?? {}) as unknown as Record<string, string | null>)[`${p.documento}_vto`]
    return Date.parse(p.vence) < Date.now() || (!!vto && vto > lejos && vto > hoy)
  }).map((p) => p.id)
  if (cerrar.length) await db.from('pedidos_documento').update({ estado: 'cancelado', motivo: 'Ya no hacía falta o venció el enlace' }).in('id', cerrar)
  return cerrar.length
}
