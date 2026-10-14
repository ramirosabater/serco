import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { supabase, mensajeError } from '../lib/supabase'
import { fd, fnum, num, umL } from '../lib/formato'
import type { UM } from '../lib/tipos'

// Etiquetas para los contenedores de un manifiesto: una por bolsa, tambor o batea.
// El QR abre el recorrido del manifiesto en el sistema (pide usuario).

interface Datos {
  id: number; numero: string; fecha: string; anulado: boolean
  generadores: { nombre: string } | null
  manifiesto_items: { id: number; contenedor: string | null; cantidad: number; um: UM
    corrientes: { codigo: string; descripcion: string | null; estado_fisico: string | null } | null }[]
}

const SELECT = `id, numero, fecha, anulado, generadores(nombre),
  manifiesto_items(id, contenedor, cantidad, um, corrientes(codigo, descripcion, estado_fisico))`

export default function Etiquetas() {
  const { id } = useParams()
  const [m, setM] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  const [copias, setCopias] = useState<Record<number, number>>({})
  const [qr, setQr] = useState('')

  useEffect(() => {
    supabase.from('manifiestos').select(SELECT).eq('id', Number(id)).maybeSingle().then(({ data, error }) => {
      if (error || !data) { setError(error ? mensajeError(error) : 'No existe este manifiesto.'); return }
      setM(data as unknown as Datos)
    })
    QRCode.toDataURL(`${window.location.origin}/manifiestos/${id}`, { margin: 0, width: 300, errorCorrectionLevel: 'M' }).then(setQr)
  }, [id])

  useEffect(() => { document.body.classList.add('modo-etiquetas'); return () => document.body.classList.remove('modo-etiquetas') }, [])

  if (error) return <p className="aviso bad">{error}</p>
  if (!m) return <p className="cargando">Preparando las etiquetas…</p>
  if (!m.manifiesto_items.length) return <>
    <p><Link to={`/manifiestos/${m.id}`}>Volver al manifiesto</Link></p>
    <div className="aviso haz">El manifiesto {fnum(m.numero)} todavía no tiene residuos: las etiquetas se imprimen después de cargar la sección 3, cuando la carga entra a planta.</div>
  </>

  const etiquetas = m.manifiesto_items.flatMap((i) => {
    const n = copias[i.id] ?? 1
    return Array.from({ length: n }, (_, k) => ({ i, k: k + 1, n }))
  })

  return (
    <>
      <div className="no-imprimir">
        <p><Link to={`/manifiestos/${m.id}`}>Volver al manifiesto</Link></p>
        <h1>Etiquetas del manifiesto {fnum(m.numero)}</h1>
        <p className="sub">Una etiqueta por contenedor. El código QR abre el recorrido del residuo en el sistema.</p>
        {m.anulado && <div className="aviso bad" style={{ marginBottom: 12 }}>El manifiesto está anulado.</div>}
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>¿Cuántos contenedores tiene cada residuo?</h2>
          <div className="campos">{m.manifiesto_items.map((i) => (
            <label key={i.id} className="campo" data-ayuda="etiq-cantidad">
              {i.corrientes?.codigo} · {num(i.cantidad)} {umL(i.um)}{i.contenedor ? ` en ${i.contenedor.toLowerCase()}` : ''}
              <input type="number" min={1} max={50} value={copias[i.id] ?? 1}
                onChange={(e) => setCopias({ ...copias, [i.id]: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} />
            </label>))}
          </div>
          <div className="bar mt" style={{ marginBottom: 0 }}>
            <button className="pri" onClick={() => window.print()} data-ayuda="etiq-imprimir">Imprimir {etiquetas.length} {etiquetas.length === 1 ? 'etiqueta' : 'etiquetas'}</button>
            <span className="muted small">Hoja A4, 8 etiquetas por hoja (10 × 7 cm). Sirve papel común o autoadhesivo.</span>
          </div>
        </div>
      </div>
      <div className="etiquetas">{etiquetas.map(({ i, k, n }) => (
        <div className="etq" key={`${i.id}-${k}`}>
          <div className="etq-h">RESIDUO PELIGROSO <span>Ley 24.051 · Ley XI Nº 35</span></div>
          <div className="etq-b">
            <div className="etq-t">
              <div className="etq-y">{i.corrientes?.codigo}</div>
              <div className="etq-d">{i.corrientes?.descripcion}</div>
              <div className="etq-k"><span><small>Estado</small>{i.corrientes?.estado_fisico ?? '—'}</span><span><small>Cantidad</small>{num(i.cantidad)} {umL(i.um)}</span></div>
              <div className="etq-k"><span><small>Generador</small>{m.generadores?.nombre}</span></div>
              <div className="etq-k"><span><small>Manifiesto</small>{fnum(m.numero)}</span><span><small>Fecha</small>{fd(m.fecha)}</span></div>
            </div>
            <div className="etq-q">
              {qr && <img src={qr} alt={`QR del manifiesto ${fnum(m.numero)}`} />}
              <b>{i.contenedor ? `${i.contenedor.charAt(0)}${i.contenedor.slice(1).toLowerCase()} ` : 'Contenedor '}{k} de {n}</b>
            </div>
          </div>
          <div className="etq-f"><img src="/serco-logo.png" alt="Serco Ambiental" /><span>Serco Ambiental S.A. · Comodoro Rivadavia, Chubut</span></div>
        </div>))}
      </div>
    </>
  )
}
