import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, mensajeError } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { fd, hoy, num } from '../lib/formato'
import { numCertSerco } from './ImprimirCertificadoSerco'

// Certificados de disposición final que Serco le da a cada generador (RPGyOSP numerados).
// Para emitir: lo que ya tiene el certificado del operador y todavía no tiene el de Serco.

interface Pendiente { generador_id: number; generador: string; certificado_id: number; certificado: string; certificado_fecha: string; operador: string | null
  tipo: string | null; residuos: number; manifiestos: number; kgs: number | null; lts: number | null; corrientes: string | null }
interface Emitido { numero: number; rpg: number; generador: string; certificado: string | null; operador: string | null; fecha: string | null; residuos: number; kgs: number | null; lts: number | null }

const haceMeses = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10) }
const cant = (k: number | null, l: number | null) => [k ? `${num(Number(k))} kg` : '', l ? `${num(Number(l))} l` : ''].filter(Boolean).join(' + ')

export default function CertificadosSerco() {
  const [sp, setSp] = useSearchParams()
  const v = sp.get('v') === 'emitidos' ? 'emitidos' : 'emitir'
  const nav = useNavigate()
  const { perfil } = useAuth()
  const puede = perfil?.rol === 'admin' || perfil?.rol === 'operador'
  const [desde, setDesde] = useState(haceMeses(6))
  const [q, setQ] = useState('')
  const [pend, setPend] = useState<Pendiente[]>([])
  const [emit, setEmit] = useState<Emitido[]>([])
  const [proximo, setProximo] = useState<string>('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [confirmarTodos, setConfirmarTodos] = useState(false)
  const cert = sp.get('cert')

  function cargar() {
    setCargando(true)
    if (v === 'emitir') {
      let c = supabase.from('certificados_serco_pendientes').select('*')
      c = cert ? c.eq('certificado_id', Number(cert)) : c.gte('certificado_fecha', desde)
      if (q.trim()) c = c.ilike('generador', `%${q.trim()}%`)
      c.order('certificado_fecha').order('generador').limit(500)
        .then(({ data, error }) => { setError(mensajeError(error)); setPend((data ?? []) as Pendiente[]); setCargando(false) })
      supabase.from('parametros').select('valor').eq('clave', 'proximo_cert_rp').maybeSingle()
        .then(({ data }) => setProximo(data?.valor ? String(Number(data.valor) + 1) : ''))
    } else {
      let c = supabase.from('certificados_serco').select('*')
      const t = q.trim()
      if (/^\d+$/.test(t)) c = c.eq('numero', Number(t))
      else if (t) c = c.ilike('generador', `%${t}%`)
      c.order('numero', { ascending: false }).limit(200)
        .then(({ data, error }) => { setError(mensajeError(error)); setEmit((data ?? []) as Emitido[]); setCargando(false) })
    }
  }
  useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t) }, [v, desde, q, cert]) // eslint-disable-line react-hooks/exhaustive-deps

  async function emitir(l: Pendiente[]) {
    setTrabajando(true); setError(''); setOk(''); setConfirmarTodos(false)
    const hechos: number[] = []
    for (const p of l) {
      const { data, error } = await supabase.rpc('emitir_certificado_serco', { p_certificado: p.certificado_id, p_generador: p.generador_id })
      if (error) { setError(`${p.generador}: ${mensajeError(error)}`); break }
      hechos.push(data as number)
    }
    setTrabajando(false)
    if (hechos.length === 1 && l.length === 1) { nav(`/certificados-serco/${hechos[0]}`); return }
    if (hechos.length) setOk(`Se emitieron ${hechos.length} certificados: del ${hechos[0]} al ${hechos[hechos.length - 1]}. Están en "Emitidos" para imprimir.`)
    cargar()
  }

  const cambiar = (nv: string) => { const n = new URLSearchParams(); if (nv === 'emitidos') n.set('v', 'emitidos'); setSp(n); setQ(''); setOk('') }

  return (
    <>
      <h1>Certificados de Serco</h1>
      <p className="sub">El certificado de disposición final que Serco le da a cada generador cuando vuelve el del operador: numerado con el RPGyOSP de Serco, original y duplicado.</p>
      <div className="pestanas" role="tablist" style={{ marginBottom: 12 }}>
        <button className={v === 'emitir' ? 'on' : ''} onClick={() => cambiar('emitir')} role="tab" aria-selected={v === 'emitir'}>Para emitir</button>
        <button className={v === 'emitidos' ? 'on' : ''} onClick={() => cambiar('emitidos')} role="tab" aria-selected={v === 'emitidos'}>Emitidos</button>
      </div>
      <div className="bar">
        <input type="search" placeholder={v === 'emitir' ? 'Buscar generador' : 'Buscar por número o generador'} value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200, maxWidth: 360 }} aria-label="Buscar" />
        {v === 'emitir' && !cert && <label className="small">Certificados del operador desde <input type="date" value={desde} max={hoy()} onChange={(e) => setDesde(e.target.value)} /></label>}
        {cert && <span className="small">Solo un certificado del operador · <Link to="/certificados-serco">ver todos</Link></span>}
        <span style={{ flex: 1 }} />
        {v === 'emitir' && proximo && <span className="muted small">El próximo número es {proximo}</span>}
      </div>
      {error && <div className="aviso bad" style={{ marginBottom: 12 }}>{error}</div>}
      {ok && <div className="aviso ok" role="status" style={{ marginBottom: 12 }}>{ok}</div>}
      <div className="card">
        {cargando ? <p className="cargando">Cargando…</p> : v === 'emitir' ? (pend.length === 0 ? <p className="vacio">No hay certificados para emitir{cert ? ' de este certificado del operador' : ' en ese período'}.</p> : <>
          <div className="tw"><table>
            <thead><tr><th>Generador</th><th>Certificado del operador</th><th>Operador</th><th>Corrientes</th><th style={{ textAlign: 'right' }}>Cantidad</th><th /></tr></thead>
            <tbody>{pend.map((p) => (
              <tr key={`${p.generador_id}-${p.certificado_id}`}>
                <td><b>{p.generador}</b><div className="muted small">{p.manifiestos} {p.manifiestos === 1 ? 'manifiesto' : 'manifiestos'}</div></td>
                <td className="nw">{p.certificado} · {fd(p.certificado_fecha)}{p.tipo === 'N' && <span className="muted small"> · nación</span>}</td>
                <td>{p.operador ?? '—'}</td><td>{p.corrientes}</td><td className="n nw">{cant(p.kgs, p.lts)}</td>
                <td>{puede && <button disabled={trabajando} onClick={() => emitir([p])}>Emitir</button>}</td>
              </tr>))}</tbody>
          </table></div>
          {puede && pend.length > 1 && (confirmarTodos
            ? <div className="aviso haz" style={{ marginTop: 12 }}>Se van a emitir {pend.length} certificados, con números correlativos desde el {proximo}. Los números no se pueden volver atrás.
                <div className="bar" style={{ marginTop: 8 }}><button className="pri" disabled={trabajando} onClick={() => emitir(pend)}>Sí, emitir {pend.length}</button><button onClick={() => setConfirmarTodos(false)}>Cancelar</button></div></div>
            : <p style={{ marginBottom: 0 }}><button disabled={trabajando} onClick={() => setConfirmarTodos(true)}>Emitir los {pend.length} de la lista</button></p>)}
        </>) : (emit.length === 0 ? <p className="vacio">No hay certificados con esa búsqueda.</p> : (
          <div className="tw"><table>
            <thead><tr><th>Número</th><th>Generador</th><th>Certificado del operador</th><th>Fecha</th><th style={{ textAlign: 'right' }}>Cantidad</th></tr></thead>
            <tbody>{emit.map((e) => (
              <tr key={`${e.numero}-${e.generador}`} className="fila" tabIndex={0} onClick={() => nav(`/certificados-serco/${e.numero}`)} onKeyDown={(x) => x.key === 'Enter' && nav(`/certificados-serco/${e.numero}`)}>
                <td className="nw"><b>{numCertSerco(e.rpg, e.numero)}</b></td><td>{e.generador}</td>
                <td>{e.certificado ? `${e.certificado} · ${e.operador ?? ''}` : '—'}</td><td className="nw">{e.fecha ? fd(e.fecha) : ''}</td><td className="n nw">{cant(e.kgs, e.lts)}</td>
              </tr>))}</tbody>
          </table></div>))}
      </div>
      {v === 'emitir' && <p className="small muted">Uno por generador y por certificado del operador, como hacía el Access. El número sale solo y es correlativo; la fecha del pie es la del listado del certificado del operador.</p>}
    </>
  )
}
