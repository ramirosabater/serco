// Función "avisos": la llama la tarea programada una vez por día (o un admin con "Enviar ahora").
//  1. A cada generador, el aviso de sus certificados de disposición final nuevos.
//  2. A Serco, los vencimientos: resumen completo el día configurado; además, todos los días,
//     lo que vence justo dentro de los días configurados (por defecto 30, 15 y 5).
//  3. Los lunes, la cantidad transportada por producto de la semana anterior (parámetro mails_reporte_producto).
import { admin, cors, enviarMail, env, esc, fd, fnum, json, plantilla, quienLlama } from '../_compartido/comun.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

interface Pendiente {
  certificado_id: number; numero: string; fecha: string; operador: string | null
  generador_id: number; generador: string; email: string | null; manifiestos: string
}

async function avisarCertificados(db: SupabaseClient) {
  const { data, error } = await db.from('certificados_por_avisar').select('*').limit(2000)
  if (error) throw error
  const porGenerador = new Map<number, Pendiente[]>()
  for (const p of (data ?? []) as Pendiente[]) porGenerador.set(p.generador_id, [...(porGenerador.get(p.generador_id) ?? []), p])

  let enviados = 0, sinMail = 0, fallidos = 0
  for (const [generadorId, certs] of porGenerador) {
    const para = (certs[0].email ?? '').split(/[;,\s]+/).filter((x) => x.includes('@'))
    if (!para.length) {
      await db.from('avisos_certificados').insert(certs.map((c) => ({ certificado_id: c.certificado_id, generador_id: generadorId, resultado: 'sin_mail' })))
      sinMail++; continue
    }
    const filas = certs.map((c) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #DDE7DA"><b>${esc(c.numero)}</b></td>
      <td style="padding:6px 8px;border-bottom:1px solid #DDE7DA">${fd(c.fecha)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #DDE7DA">${esc(c.operador ?? '')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #DDE7DA">${esc(c.manifiestos.split(', ').map(fnum).join(', '))}</td></tr>`).join('')
    const url = env('APP_URL', 'https://serco.netlify.app') + '/portal/certificados'
    const cuerpo = `<p>Hola, ${esc(certs[0].generador)}:</p>
      <p>${certs.length === 1 ? 'Ya está disponible el certificado de disposición final' : `Ya están disponibles ${certs.length} certificados de disposición final`} de residuos que retiramos de su empresa.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse;margin:8px 0 16px">
      <tr style="color:#5F6F62;text-align:left"><th style="padding:6px 8px">Certificado</th><th style="padding:6px 8px">Fecha</th><th style="padding:6px 8px">Operador</th><th style="padding:6px 8px">Manifiestos</th></tr>${filas}</table>
      <p><a href="${url}" style="display:inline-block;background:#0B8A22;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:bold">Descargar desde el portal</a></p>`
    const asunto = certs.length === 1 ? `Certificado de disposición final ${certs[0].numero}` : `${certs.length} certificados de disposición final disponibles`
    if (await enviarMail(db, 'certificados', para, asunto, plantilla(asunto, cuerpo))) {
      await db.from('avisos_certificados').insert(certs.map((c) => ({ certificado_id: c.certificado_id, generador_id: generadorId, email: para.join(', '), resultado: 'enviado' })))
      enviados++
    } else fallidos++   // queda pendiente: se reintenta en la próxima corrida
  }
  const { data: cerrados } = await db.rpc('cerrar_certificados_avisados')
  return { generadores_avisados: enviados, generadores_sin_mail: sinMail, envios_fallidos: fallidos, certificados_cerrados: cerrados ?? 0 }
}

interface Alerta { tipo: string; nombre: string; documento: string; vto: string | null; dias: number | null; estado: string }
const TIPOS: Record<string, string> = { camion: 'Camión', chofer: 'Chofer', transportista: 'Transportista', planta: 'Planta', operador: 'Operador' }
const ESTADO: Record<string, [string, string]> = { vencido: ['Vencido', '#C0392B'], sin_cargar: ['Sin cargar', '#C0392B'], por_vencer: ['Por vencer', '#C27A0E'] }

async function avisarVencimientos(db: SupabaseClient, forzarResumen: boolean) {
  const { data: params } = await db.from('parametros').select('clave, valor').in('clave', ['mails_vencimientos', 'dia_resumen_vencimientos', 'dias_alerta_vencimientos'])
  const p = Object.fromEntries((params ?? []).map((x) => [x.clave, x.valor]))
  const para = String(p.mails_vencimientos ?? '').split(/[;,\s]+/).filter((x) => x.includes('@'))
  if (!para.length) return { vencimientos: 'sin destinatarios: cargar el parámetro mails_vencimientos' }

  const diaArg = new Date(Date.now() - 3 * 3600_000).getUTCDay() || 7      // 1 = lunes … 7 = domingo, hora de Argentina
  const alertas = [...new Set(String(p.dias_alerta_vencimientos ?? '30,15,5').split(/[,;\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => b - a)
  const resumen = forzarResumen || String(diaArg) === String(p.dia_resumen_vencimientos ?? '1')
  let q = db.from('alertas_vencimiento').select('tipo, nombre, documento, vto, dias, estado').in('tipo', Object.keys(TIPOS))
  q = resumen ? q.in('estado', ['vencido', 'sin_cargar', 'por_vencer']) : q.in('dias', alertas)
  const { data, error } = await q.order('vto', { ascending: true, nullsFirst: true })
  if (error) throw error
  const todos = (data ?? []) as Alerta[]
  if (!todos.length) return { vencimientos: resumen ? 'todo al día' : `nada vence dentro de ${alertas.join(', ')} días` }
  // En el resumen, lo "sin cargar" va como cantidad (puede ser mucho); se detalla lo vencido y lo por vencer
  const sinCargar = resumen ? todos.filter((a) => a.estado === 'sin_cargar').length : 0
  const MAX = 80
  // Primero lo que está por vencer (lo más próximo arriba), después lo vencido más reciente
  const detalle = todos.filter((a) => !resumen || a.estado !== 'sin_cargar').sort((a, b) =>
    a.estado === b.estado ? (a.estado === 'por_vencer' ? 1 : -1) * String(a.vto).localeCompare(String(b.vto)) : a.estado === 'por_vencer' ? -1 : 1)
  const lista = detalle.slice(0, MAX)

  const filas = lista.map((a) => `<tr><td style="padding:5px 8px;border-bottom:1px solid #DDE7DA">${TIPOS[a.tipo]}</td>
    <td style="padding:5px 8px;border-bottom:1px solid #DDE7DA"><b>${esc(a.nombre)}</b></td>
    <td style="padding:5px 8px;border-bottom:1px solid #DDE7DA">${esc(a.documento)}</td>
    <td style="padding:5px 8px;border-bottom:1px solid #DDE7DA">${fd(a.vto)}</td>
    <td style="padding:5px 8px;border-bottom:1px solid #DDE7DA;color:${(ESTADO[a.estado] ?? ['', '#1C2B1F'])[1]}">${a.dias === 0 ? 'Vence hoy' : a.estado === 'por_vencer' && a.dias != null ? `Vence en ${a.dias} días` : (ESTADO[a.estado] ?? [a.estado])[0]}</td></tr>`).join('')
  const vencidos = todos.filter((a) => a.estado !== 'por_vencer').length
  const cuando = [...new Set(lista.map((a) => a.dias))].sort((a, b) => Number(a) - Number(b)).map((d) => (d === 0 ? 'hoy' : `en ${d} días`)).join(', ')
  const asunto = resumen ? `Vencimientos de la semana: ${vencidos} para regularizar` : `Vencimientos: ${lista.length} ${lista.length === 1 ? 'documento vence' : 'documentos vencen'} ${cuando}`
  const extra = [detalle.length > MAX ? `y ${detalle.length - MAX} más` : '', sinCargar ? `${sinCargar} documentos sin cargar` : ''].filter(Boolean).join(' · ')
  const cuerpo = `<p>${resumen ? 'Resumen semanal de habilitaciones y documentos.' : `Aviso anticipado: estos documentos vencen ${cuando}.`}
    Con un documento vencido o sin cargar, el sistema no deja emitir con ese camión, chofer o transportista.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;border-collapse:collapse;margin:8px 0 16px">
    <tr style="color:#5F6F62;text-align:left"><th style="padding:5px 8px">Qué</th><th style="padding:5px 8px">Nombre</th><th style="padding:5px 8px">Documento</th><th style="padding:5px 8px">Vence</th><th style="padding:5px 8px">Estado</th></tr>${filas}</table>
    ${extra ? `<p style="color:#5F6F62">Además: ${extra}. Están todos en la pantalla de vencimientos.</p>` : ''}
    <p><a href="${env('APP_URL', 'https://serco.netlify.app')}/vencimientos" style="color:#0B8A22;font-weight:bold">Actualizar en el sistema</a></p>`
  const ok = await enviarMail(db, 'vencimientos', para, asunto, plantilla(asunto, cuerpo))
  return { vencimientos: ok ? `enviado (${lista.length} detallados${sinCargar ? `, ${sinCargar} sin cargar` : ''})` : 'falló el envío' }
}

/** 3. Los lunes, la cantidad transportada por producto de la semana anterior (lunes a domingo) */
async function reporteProducto(db: SupabaseClient, forzar: boolean) {
  const { data: prm } = await db.from('parametros').select('valor').eq('clave', 'mails_reporte_producto').maybeSingle()
  const para = String(prm?.valor ?? '').split(/[;,\s]+/).filter((x) => x.includes('@'))
  if (!para.length) return { reporte_producto: 'sin destinatarios' }
  const ahora = new Date(Date.now() - 3 * 3600_000)                 // hora de Argentina
  const diaArg = ahora.getUTCDay() || 7
  if (!forzar && diaArg !== 1) return { reporte_producto: 'solo los lunes' }
  const lunes = new Date(ahora); lunes.setUTCDate(ahora.getUTCDate() - (diaArg - 1) - 7)
  const domingo = new Date(lunes); domingo.setUTCDate(lunes.getUTCDate() + 6)
  const desde = lunes.toISOString().slice(0, 10), hasta = domingo.toISOString().slice(0, 10)
  const { data, error } = await db.rpc('reporte_por_producto', { p_desde: desde, p_hasta: hasta, p_agrupar: 'mes' })
  if (error) throw error
  const filas = (data ?? []) as { corriente: string; descripcion: string | null; um: string; cantidad: number; residuos: number }[]
  const porCorriente = new Map<string, { d: string; KGS: number; LTS: number; n: number }>()
  for (const f of filas) {
    const x = porCorriente.get(f.corriente) ?? { d: f.descripcion ?? '', KGS: 0, LTS: 0, n: 0 }
    if (f.um === 'KGS' || f.um === 'LTS') x[f.um] += Number(f.cantidad)
    x.n += Number(f.residuos); porCorriente.set(f.corriente, x)
  }
  const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
  const td = 'padding:6px 8px;border-bottom:1px solid #DDE7DA'
  const lista = [...porCorriente].sort((a, b) => b[1].KGS + b[1].LTS - a[1].KGS - a[1].LTS)
  const tot = lista.reduce((a, [, x]) => ({ KGS: a.KGS + x.KGS, LTS: a.LTS + x.LTS }), { KGS: 0, LTS: 0 })
  const cuerpo = lista.length ? `<p>Cantidad transportada por producto del ${fd(desde)} al ${fd(hasta)}.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse;margin:8px 0 16px">
    <tr style="color:#5F6F62;text-align:left"><th style="padding:6px 8px">Corriente</th><th style="padding:6px 8px;text-align:right">Kilos</th><th style="padding:6px 8px;text-align:right">Litros</th><th style="padding:6px 8px;text-align:right">Retiros</th></tr>
    ${lista.map(([c, x]) => `<tr><td style="${td}"><b>${esc(c)}</b> <span style="color:#5F6F62">${esc(x.d.slice(0, 50))}</span></td><td style="${td};text-align:right">${x.KGS ? nf.format(x.KGS) : ''}</td><td style="${td};text-align:right">${x.LTS ? nf.format(x.LTS) : ''}</td><td style="${td};text-align:right">${x.n}</td></tr>`).join('')}
    <tr><td style="${td}"><b>Total</b></td><td style="${td};text-align:right"><b>${nf.format(tot.KGS)}</b></td><td style="${td};text-align:right"><b>${tot.LTS ? nf.format(tot.LTS) : ''}</b></td><td style="${td}"></td></tr></table>
    <p><a href="${env('APP_URL', 'https://serco.netlify.app')}/reportes/producto">Ver el reporte completo</a></p>`
    : `<p>No hubo retiros entre el ${fd(desde)} y el ${fd(hasta)}.</p>`
  const asunto = `Cantidad transportada por producto · semana del ${fd(desde)}`
  const ok = await enviarMail(db, 'reporte_producto', para, asunto, plantilla(asunto, cuerpo))
  return { reporte_producto: ok ? `enviado a ${para.join(', ')}` : 'falló el envío' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const quien = await quienLlama(req)
  if (!quien || (quien.tipo === 'usuario' && quien.rol !== 'admin')) return json({ error: 'No autorizado' }, 401)
  const body = await req.json().catch(() => ({})) as { solo?: 'certificados' | 'vencimientos' | 'producto'; resumen?: boolean }
  const db = admin()
  try {
    const r: Record<string, unknown> = {}
    if (!body.solo || body.solo === 'certificados') Object.assign(r, await avisarCertificados(db))
    if (!body.solo || body.solo === 'vencimientos') Object.assign(r, await avisarVencimientos(db, !!body.resumen))
    if (!body.solo || body.solo === 'producto') Object.assign(r, await reporteProducto(db, body.solo === 'producto'))
    return json(r)
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500)
  }
})
