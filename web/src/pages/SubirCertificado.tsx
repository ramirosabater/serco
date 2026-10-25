import { useEffect, useState } from 'react'
import { invocar } from '../lib/supabase'
import { fd } from '../lib/formato'
import { leerCertificado, NOMBRE_TIPO, type Lectura } from '../lib/leerCertificado'

// Página pública a la que llega el chofer (o su transportista) desde el mail: /subir/<enlace>.
// No pide usuario: la llave es el enlace. Lee el certificado en el propio celular (DNI y vencimiento)
// y lo manda; queda para que alguien de Serco lo revise y lo acepte.

interface Pedido {
  chofer: string; transportista: string | null; documento: string; label: string; ayuda: string
  lector: 'mmpp' | 'psicofisico' | null; vto_actual: string | null; vence: string; estado: string
  subido: string | null; motivo: string | null; dni_fin: string | null; puede_subir: boolean
}

type Control = { ok: boolean; bloquea: boolean; t: string }

function controlar(p: Pedido, l: Lectura | null): Control {
  if (!p.lector) return { ok: true, bloquea: false, t: '' }
  if (!l) return { ok: false, bloquea: false, t: 'No pude leer el certificado. Se puede mandar igual: en Serco cargan la fecha a mano.' }
  if (l.tipo !== p.lector) return { ok: false, bloquea: true, t: l.tipo === 'curso'
    ? `Es el ${NOMBRE_TIPO.curso} y no trae vencimiento. Hace falta el de Seguridad Vial: el PDF o una captura donde se vea el código QR.`
    : `Este archivo es un ${NOMBRE_TIPO[l.tipo]}, no ${p.label.toLowerCase()}.` }
  if (l.dni && p.dni_fin && !l.dni.endsWith(p.dni_fin)) return { ok: false, bloquea: true, t: `El certificado es de ${l.nombre ?? 'otra persona'} (DNI terminado en ${l.dni.slice(-3)}), no de ${p.chofer}.` }
  if (l.vence && l.vence < new Date().toISOString().slice(0, 10)) return { ok: false, bloquea: true, t: `Este certificado ya venció el ${fd(l.vence)}. Hace falta el nuevo.` }
  return { ok: true, bloquea: false, t: `Leído: ${l.nombre ? `${l.nombre}. ` : ''}${l.vence ? `Vence el ${fd(l.vence)}.` : l.detalle}` }
}

export default function SubirCertificado() {
  const token = window.location.pathname.split('/')[2] ?? ''
  const [p, setP] = useState<Pedido | null>(null)
  const [error, setError] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [lectura, setLectura] = useState<Lectura | null>(null)
  const [control, setControl] = useState<Control | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [listo, setListo] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Subir certificado · Serco Ambiental'
    invocar<Pedido>('certificado-chofer', { accion: 'ver', token }).then(({ data, error }) => { if (error) setError(error); else setP(data) })
  }, [token])

  async function elegir(f: File | undefined) {
    if (!f || !p) return
    setArchivo(f); setLectura(null); setControl(null); setError('')
    if (f.size > 10 * 1024 * 1024) { setControl({ ok: false, bloquea: true, t: 'El archivo pesa más de 10 MB. Probá con una captura de pantalla o una foto más chica.' }); return }
    if (!p.lector) return
    setLeyendo(true)
    const l = await leerCertificado(f)
    setLeyendo(false)
    setLectura(l); setControl(controlar(p, l))
  }

  async function enviar() {
    if (!archivo || !p) return
    setEnviando(true); setError('')
    const form = new FormData()
    form.append('token', token)
    form.append('archivo', archivo)
    if (lectura) form.append('lectura', JSON.stringify({ tipo: lectura.tipo, dni: lectura.dni, vence: lectura.vence, nombre: lectura.nombre, detalle: lectura.detalle }))
    const { data, error } = await invocar<{ ok: boolean; vto_leido: string | null }>('certificado-chofer', form)
    setEnviando(false)
    if (error) { setError(error); return }
    setListo(data?.vto_leido ? `Recibimos el certificado con vencimiento ${fd(data.vto_leido)}.` : 'Recibimos el archivo.')
  }

  const estado = !p ? null
    : p.estado === 'aceptado' ? { c: 'ok', t: '¡Listo! El certificado ya quedó cargado. Gracias.' }
    : p.estado === 'rechazado' ? { c: 'bad', t: `En Serco no lo pudieron aceptar${p.motivo ? `: ${p.motivo}` : ''}. Pediles que te manden un enlace nuevo.` }
    : !p.puede_subir ? { c: 'bad', t: p.estado === 'vencido' ? 'Este enlace ya venció. Pedile a Serco que te lo mande de nuevo.' : 'Este enlace ya no está activo. Si te hace falta, pedile a Serco uno nuevo.' }
    : null

  return (
    <div className="subir">
      <div className="card stack">
        <img src="/serco-logo.png" alt="Serco Ambiental" className="subir-logo" />
        {!p && !error && <p className="cargando">Cargando…</p>}
        {!p && error && <div className="aviso bad" role="alert">{error}</div>}
        {p && <>
          <h1>{p.label}</h1>
          <p>Hola. Serco necesita el certificado nuevo de <b>{p.chofer}</b>{p.transportista ? <> ({p.transportista})</> : null}.
            {p.vto_actual && <> El que tenemos {p.vto_actual < new Date().toISOString().slice(0, 10) ? 'venció' : 'vence'} el <b>{fd(p.vto_actual)}</b>.</>}</p>
          {listo ? <div className="aviso ok" role="status"><b>{listo}</b><br />En Serco lo revisan y lo cargan. Ya podés cerrar esta página.</div>
            : estado ? <div className={`aviso ${estado.c}`} role="status">{estado.t}</div>
            : <>
              {p.estado === 'subido' && p.subido && <div className="aviso haz small">Ya mandaste uno el {fd(p.subido.slice(0, 10))}. Si te equivocaste de archivo, podés mandar otro.</div>}
              <p className="muted">Sirve {p.ayuda}.</p>
              <label className={`subir-elegir${archivo ? ' con' : ''}`}>
                <input type="file" accept=".pdf,application/pdf,image/*" onChange={(e) => elegir(e.target.files?.[0])} disabled={enviando} />
                <span className="subir-icono" aria-hidden="true">{archivo ? '📄' : '📷'}</span>
                <span>{archivo ? archivo.name : 'Elegir el archivo o sacar una foto'}</span>
                {archivo && <span className="small muted">Tocá para cambiarlo</span>}
              </label>
              {leyendo && <p className="cargando">Leyendo el certificado…</p>}
              {control?.t && <div className={`aviso ${control.ok ? 'ok' : control.bloquea ? 'bad' : 'haz'}`} role="status">{control.t}</div>}
              {error && <div className="aviso bad" role="alert">{error}</div>}
              <button className="pri grande" onClick={enviar} disabled={!archivo || leyendo || enviando || !!control?.bloquea}>
                {enviando ? 'Enviando…' : 'Enviar a Serco'}</button>
              <p className="small muted">El enlace es personal y vale hasta el {fd(p.vence.slice(0, 10))}.</p>
            </>}
          <p className="small muted" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            Serco Ambiental S.A. usa este certificado solo para controlar la habilitación para transportar residuos peligrosos.
            Podés pedirle a Serco ver, corregir o borrar tus datos (Ley 25.326 de Protección de Datos Personales).</p>
        </>}
      </div>
    </div>
  )
}
