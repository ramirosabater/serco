import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { traerTodo } from '../lib/paginar'
import { supabase, mensajeError } from '../lib/supabase'
import { etapaManifiesto, fd, fnum, num, umL } from '../lib/formato'
import type { Manifiesto } from '../lib/tipos'
import { PillEtapa } from '../components/Etapa'

/** Portal del cliente: ve solo los retiros y certificados de sus generadores (lo garantizan los permisos de la base) */
export function MenuPortal() {
  return (
    <nav className="bar" aria-label="Portal" style={{ marginBottom: 18 }}>
      <NavLink to="/portal" end className="subnav">Mis retiros</NavLink>
      <NavLink to="/portal/certificados" className="subnav">Certificados</NavLink>
    </nav>
  )
}

export function PortalRetiros() {
  const nav = useNavigate()
  const [lista, setLista] = useState<Manifiesto[]>([])
  const [anio, setAnio] = useState(String(new Date().getFullYear()))
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setCargando(true)
    supabase.from('manifiestos')
      .select('id, numero, fecha, tipo, anulado, generadores(nombre), manifiesto_items(estado, cantidad, um, corrientes(codigo))')
      .eq('anulado', false).gte('fecha', `${anio}-01-01`).lte('fecha', `${anio}-12-31`)
      .order('fecha', { ascending: false }).limit(1000)
      .then(({ data, error }) => { setError(mensajeError(error)); setLista((data ?? []) as unknown as Manifiesto[]); setCargando(false) })
  }, [anio])

  const anios = Array.from({ length: new Date().getFullYear() - 2009 }, (_, i) => String(new Date().getFullYear() - i))
  const varios = new Set(lista.map((m) => m.generadores?.nombre)).size > 1

  return (
    <>
      <h1>Mis retiros</h1>
      <p className="sub">Cada retiro con su recorrido: almacenado en planta, en viaje a disposición final y certificado.</p>
      <MenuPortal />
      <div className="bar"><label className="small">Año <select value={anio} onChange={(e) => setAnio(e.target.value)}>{anios.map((a) => <option key={a}>{a}</option>)}</select></label>
        <span className="muted small">{lista.length} retiros</span></div>
      <div className="card">
        {error && <div className="aviso bad">{error}</div>}
        {cargando ? <p className="cargando">Cargando…</p> : lista.length === 0 ? <p className="vacio">No hay retiros en {anio}.</p> : (
          <div className="tw"><table>
            <thead><tr><th>Manifiesto</th><th>Fecha</th>{varios && <th>Empresa</th>}<th>Residuos</th><th>Etapa</th></tr></thead>
            <tbody>{lista.map((m) => {
              const it = m.manifiesto_items ?? []
              return (
                <tr key={m.id} className="fila" tabIndex={0} onClick={() => nav(`/manifiestos/${m.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/manifiestos/${m.id}`)}>
                  <td className="nw"><b>{fnum(m.numero)}</b></td><td className="nw">{fd(m.fecha)}</td>{varios && <td>{m.generadores?.nombre}</td>}
                  <td>{it.map((i, n) => <span key={n} className="pill" style={{ margin: '2px 4px 2px 0' }}>{i.corrientes?.codigo} · {num(i.cantidad)} {umL(i.um)}</span>)}</td>
                  <td><PillEtapa etapa={etapaManifiesto(it.map((i) => i.estado))} /></td>
                </tr>)
            })}</tbody>
          </table></div>)}
      </div>
    </>
  )
}

interface Cert { id: number; numero: string; fecha: string; archivo: string | null; tipo_tratamiento: string | null; kgs: number | null; lts: number | null; operadores: { nombre: string } | null }

export function PortalCertificados() {
  const [lista, setLista] = useState<Cert[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    traerTodo<Cert>(() => supabase.from('certificados').select('id, numero, fecha, archivo, tipo_tratamiento, kgs, lts, operadores(nombre)')
      .order('fecha', { ascending: false }).order('id'))
      .then(({ data, error }) => { setError(mensajeError(error)); setLista(data); setCargando(false) })
  }, [])

  async function descargar(c: Cert) {
    setError('')
    if (!c.archivo || c.archivo.startsWith('\\')) { setError(`El PDF del certificado ${c.numero} todavía no está disponible. Pedilo a Serco.`); return }
    const { data, error } = await supabase.storage.from('documentos').createSignedUrl(c.archivo, 300, { download: `Certificado ${c.numero}.pdf` })
    if (error || !data) setError('No se pudo descargar: ' + mensajeError(error)); else window.location.href = data.signedUrl
  }

  return (
    <>
      <h1>Certificados de disposición final</h1>
      <p className="sub">Descargá el certificado de cada residuo tratado. Cuando hay uno nuevo, te avisamos por mail.</p>
      <MenuPortal />
      {error && <div className="aviso bad" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="card">
        {cargando ? <p className="cargando">Cargando…</p> : lista.length === 0 ? <p className="vacio">Todavía no hay certificados.</p> : (
          <div className="tw"><table>
            <thead><tr><th>Certificado</th><th>Fecha</th><th>Operador</th><th>Tratamiento</th><th style={{ textAlign: 'right' }}>Cantidad</th><th></th></tr></thead>
            <tbody>{lista.map((c) => (
              <tr key={c.id}>
                <td className="nw"><b>{c.numero}</b></td><td className="nw">{fd(c.fecha)}</td><td>{c.operadores?.nombre ?? '—'}</td><td>{c.tipo_tratamiento ?? '—'}</td>
                <td className="n">{[c.kgs ? `${num(c.kgs)} kg` : '', c.lts ? `${num(c.lts)} l` : ''].filter(Boolean).join(' + ') || '—'}</td>
                <td style={{ textAlign: 'right' }}><button onClick={() => descargar(c)}>Descargar PDF</button></td>
              </tr>))}
            </tbody>
          </table></div>)}
      </div>
    </>
  )
}
