import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, mensajeError, invocar } from '../lib/supabase'
import { fd } from '../lib/formato'
import { abrirArchivo } from '../lib/archivos'
import { useAuth } from '../auth/AuthProvider'

// Certificados de choferes: lo que subieron desde el enlace del mail (para revisar y aceptar)
// y el botón para pedir por mail los que vencen.

export const NOMBRE_DOC: Record<string, string> = { carnet: 'Carnet de conducir', carga_pel: 'Carga peligrosa', sep: 'Psicofísico' }

interface Subido {
  id: number; chofer_id: number; documento: string; subido: string; archivo: string
  vto_leido: string | null; dni_leido: string | null; nombre_leido: string | null; detalle: string | null
  choferes: { nombre: string; dni: string | null; transportistas: { nombre: string } | null } | null
}
interface ParaPedir { chofer_id: number; chofer: string; transportista: string; documento: string; vto: string; dias: number; para: string | null; de_quien: string | null }
interface Abierto { id: number; documento: string; estado: string; enviado: string | null; enviado_a: string | null; creado: string; choferes: { nombre: string } | null }

function FilaSubido({ s, alTerminar }: { s: Subido; alTerminar: (t: string) => void }) {
  const [vto, setVto] = useState(s.vto_leido ?? '')
  const [rechazando, setRechazando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const nombre = s.choferes?.nombre ?? ''
  const dni = (s.choferes?.dni ?? '').replace(/\D/g, '')

  async function aceptar() {
    setOcupado(true); setError('')
    const { error } = await supabase.rpc('aceptar_pedido_documento', { p_id: s.id, p_vto: vto || null })
    setOcupado(false)
    if (error) setError(mensajeError(error)); else alTerminar(`${NOMBRE_DOC[s.documento]} de ${nombre}: quedó cargado con vencimiento ${fd(vto)}.`)
  }
  async function rechazar() {
    setOcupado(true); setError('')
    const { error } = await supabase.rpc('rechazar_pedido_documento', { p_id: s.id, p_motivo: motivo })
    setOcupado(false)
    if (error) setError(mensajeError(error)); else alTerminar(`${NOMBRE_DOC[s.documento]} de ${nombre}: rechazado.`)
  }

  return (
    <div className="pedidos-fila" data-pedido={s.id}>
      <div className="quien">
        <b><Link to={`/altas/choferes/${s.chofer_id}`}>{nombre}</Link></b> · {NOMBRE_DOC[s.documento]}
        <span className="small muted pedido-estado">
          Subido el {fd(s.subido.slice(0, 10))}{s.choferes?.transportistas ? ` · ${s.choferes.transportistas.nombre}` : ''}
          {s.dni_leido ? ` · DNI leído ${s.dni_leido}${dni && dni === s.dni_leido ? ' ✓' : dni ? ' (en la ficha: ' + dni + ')' : ''}` : ''}
          {!s.vto_leido && ' · no se pudo leer el vencimiento: cargalo mirando el archivo'}
        </span>
      </div>
      <button type="button" className="link" onClick={() => abrirArchivo(s.archivo, setError)}>Ver archivo</button>
      <label className="small">Vence <input type="date" value={vto} onChange={(e) => setVto(e.target.value)} aria-label={`Vencimiento de ${NOMBRE_DOC[s.documento]} de ${nombre}`} /></label>
      {rechazando ? <>
        <input placeholder="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo del rechazo" style={{ width: 180 }} />
        <button type="button" className="peligro" onClick={rechazar} disabled={ocupado}>Rechazar</button>
        <button type="button" className="link" onClick={() => setRechazando(false)}>Cancelar</button>
      </> : <>
        <button type="button" className="link" onClick={() => setRechazando(true)} style={{ color: 'var(--mute)' }}>Rechazar…</button>
        <button type="button" className="pri" onClick={aceptar} disabled={ocupado || !vto}>Aceptar</button>
      </>}
      {error && <div className="aviso bad small" role="alert" style={{ flexBasis: '100%' }}>{error}</div>}
    </div>
  )
}

export default function PedidosChoferes() {
  const { puedeEditar } = useAuth()
  const [subidos, setSubidos] = useState<Subido[]>([])
  const [paraPedir, setParaPedir] = useState<ParaPedir[]>([])
  const [abiertos, setAbiertos] = useState<Abierto[]>([])
  const [cargado, setCargado] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState<{ ok: boolean; t: string } | null>(null)

  const cargar = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.from('pedidos_documento').select('id, chofer_id, documento, subido, archivo, vto_leido, dni_leido, nombre_leido, detalle, choferes(nombre, dni, transportistas(nombre))')
        .eq('estado', 'subido').order('subido'),
      supabase.rpc('choferes_para_pedir', { p_dias: null }),
      supabase.from('pedidos_documento').select('id, documento, estado, enviado, enviado_a, creado, choferes(nombre)')
        .in('estado', ['pendiente', 'enviado', 'sin_mail']).gt('vence', new Date().toISOString()).order('creado', { ascending: false }),
    ])
    setSubidos((a.data ?? []) as unknown as Subido[])
    setParaPedir((b.data ?? []) as ParaPedir[])
    setAbiertos((c.data ?? []) as unknown as Abierto[])
    setCargado(true)
  }, [])
  useEffect(() => { cargar() }, [cargar])

  async function pedir() {
    setEnviando(true); setMensaje(null)
    const { data, error } = await invocar<{ enviados: number; sin_mail: number; envios_fallidos: number }>('certificado-chofer', { accion: 'pedir' })
    setEnviando(false); setConfirmar(false)
    if (error || !data) { setMensaje({ ok: false, t: error ?? 'No se pudo pedir.' }); return }
    setMensaje({ ok: !data.envios_fallidos, t: [`${data.enviados} ${data.enviados === 1 ? 'mail enviado' : 'mails enviados'}`,
      data.sin_mail ? `${data.sin_mail} sin mail cargado` : '', data.envios_fallidos ? `${data.envios_fallidos} no salieron (se pueden volver a pedir desde la ficha)` : ''].filter(Boolean).join(' · ') + '.' })
    cargar()
  }

  if (!cargado || (!subidos.length && !paraPedir.length && !abiertos.length)) return null
  const choferes = new Set(paraPedir.map((p) => p.chofer_id)).size
  const conMail = paraPedir.filter((p) => p.para)
  const destinos = [...new Set(conMail.map((p) => p.para!))]

  return (
    <div className="card" style={{ marginBottom: 16 }} data-ayuda="venc-pedidos">
      <h2>Certificados de choferes</h2>
      {mensaje && <div className={`aviso ${mensaje.ok ? 'ok' : 'haz'} small`} role="status" style={{ marginBottom: 10 }}>{mensaje.t}</div>}

      {subidos.length > 0 && <section data-ayuda="venc-revisar">
        <h3 style={{ margin: '4px 0' }}>Para revisar ({subidos.length})</h3>
        <p className="small muted" style={{ margin: 0 }}>Los subieron los choferes desde el enlace del mail. Mirá el archivo, confirmá el vencimiento y aceptalo: recién ahí pasa a la ficha.</p>
        {subidos.map((s) => puedeEditar
          ? <FilaSubido key={s.id} s={s} alTerminar={(t) => { setMensaje({ ok: true, t }); cargar() }} />
          : <div key={s.id} className="pedidos-fila"><b>{s.choferes?.nombre}</b> · {NOMBRE_DOC[s.documento]} · subido el {fd(s.subido.slice(0, 10))}</div>)}
      </section>}

      {paraPedir.length > 0 && <section style={{ marginTop: subidos.length ? 14 : 0 }}>
        <p style={{ margin: '4px 0 8px' }}>
          <b>{paraPedir.length} {paraPedir.length === 1 ? 'documento' : 'documentos'} de {choferes} {choferes === 1 ? 'chofer' : 'choferes'}</b> {paraPedir.length === 1 ? 'vence pronto (o venció hace poco)' : 'vencen pronto (o vencieron hace poco)'} y todavía no se pidió el nuevo.
          {conMail.length < paraPedir.length && <span className="muted"> {paraPedir.length - conMail.length} sin mail del chofer ni del transportista.</span>}
        </p>
        <details style={{ marginBottom: 8 }}><summary className="small">Ver cuáles</summary>
          <ul className="small" style={{ margin: '6px 0' }}>{paraPedir.map((p) => (
            <li key={`${p.chofer_id}${p.documento}`}><Link to={`/altas/choferes/${p.chofer_id}`}>{p.chofer}</Link> · {NOMBRE_DOC[p.documento]} · {p.dias < 0 ? `venció el ${fd(p.vto)}` : `vence el ${fd(p.vto)}`}
              {' · '}{p.para ? <span className="muted">{p.de_quien === 'chofer' ? 'al chofer' : 'al transportista'}: {p.para}</span> : <span style={{ color: 'var(--bad)' }}>sin mail</span>}</li>))}
          </ul></details>
        {puedeEditar && (confirmar
          ? <div className="aviso haz small">Se van a mandar {destinos.length} {destinos.length === 1 ? 'mail' : 'mails'} con el enlace para subir el certificado ({destinos.join(', ')}).
              <div className="bar" style={{ marginTop: 8 }}>
                <button type="button" className="pri" onClick={pedir} disabled={enviando}>{enviando ? 'Enviando…' : 'Sí, mandarlos'}</button>
                <button type="button" onClick={() => setConfirmar(false)} disabled={enviando}>Cancelar</button>
              </div></div>
          : <button type="button" className="pri" data-ayuda="venc-pedir" onClick={() => setConfirmar(true)} disabled={!conMail.length}>Pedir por mail ({conMail.length})</button>)}
      </section>}

      {abiertos.length > 0 && <details style={{ marginTop: 12 }}>
        <summary className="small">{abiertos.length} {abiertos.length === 1 ? 'pedido enviado espera' : 'pedidos enviados esperan'} respuesta</summary>
        <ul className="small" style={{ margin: '6px 0' }}>{abiertos.map((a) => (
          <li key={a.id}>{a.choferes?.nombre} · {NOMBRE_DOC[a.documento]} · {a.estado === 'sin_mail' ? 'sin mail' : a.enviado ? `enviado el ${fd(a.enviado.slice(0, 10))} a ${a.enviado_a}` : 'no salió el mail'}</li>))}
        </ul></details>}
    </div>
  )
}
