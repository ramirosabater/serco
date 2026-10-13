// Utilidades compartidas por las funciones de Supabase del SGRP 2.0
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const env = (k: string, def = '') => Deno.env.get(k) ?? def

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Cliente con permisos completos (service role): solo dentro de las funciones, nunca en el navegador */
export const admin = (): SupabaseClient =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

/** Quién llama: 'servicio' (la tarea programada), el perfil del usuario, o null si no está autorizado */
export async function quienLlama(req: Request): Promise<{ tipo: 'servicio' } | { tipo: 'usuario'; id: string; rol: string } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  if (token === env('SUPABASE_SERVICE_ROLE_KEY')) return { tipo: 'servicio' }
  const db = admin()
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return null
  const { data: p } = await db.from('perfiles').select('rol, activo').eq('id', data.user.id).maybeSingle()
  if (!p || !p.activo) return null
  return { tipo: 'usuario', id: data.user.id, rol: p.rol }
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
export { esc }

/** Mail simple, con la identidad de Serco y que se lee bien en cualquier cliente de correo */
export function plantilla(titulo: string, cuerpo: string) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F3F7F1;font-family:Arial,Helvetica,sans-serif;color:#1C2B1F">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #DDE7DA;border-radius:12px">
<tr><td style="padding:18px 24px;border-bottom:4px solid #0B8A22"><b style="color:#0B8A22;font-size:18px">SERCO AMBIENTAL</b></td></tr>
<tr><td style="padding:22px 24px"><h1 style="font-size:20px;margin:0 0 12px">${esc(titulo)}</h1>${cuerpo}</td></tr>
<tr><td style="padding:14px 24px;color:#5F6F62;font-size:12px;border-top:1px solid #DDE7DA">Mail automático del sistema de gestión de residuos de Serco Ambiental S.A. No hace falta responder.</td></tr>
</table></td></tr></table></body></html>`
}

/** Envía un mail con Resend y lo deja registrado en avisos_log */
export async function enviarMail(db: SupabaseClient, tipo: string, para: string[], asunto: string, html: string): Promise<boolean> {
  let ok = false, detalle = ''
  try {
    const r = await fetch(env('RESEND_URL', 'https://api.resend.com') + '/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env('MAIL_DE', 'Serco Ambiental <avisos@serco.com.ar>'), to: para, subject: asunto, html }),
    })
    ok = r.ok
    detalle = ok ? '' : `${r.status} ${(await r.text()).slice(0, 300)}`
  } catch (e) {
    detalle = String(e).slice(0, 300)
  }
  await db.from('avisos_log').insert({ tipo, destinatario: para.join(', '), asunto, ok, detalle: detalle || null })
  return ok
}

export const fd = (s?: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—')
export const fnum = (n: string) => (/^\d{9}$/.test(n) ? `${n.slice(0, 3)}-${n.slice(3).padStart(7, '0')}` : n)
