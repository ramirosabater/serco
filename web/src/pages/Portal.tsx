import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { traerTodo } from '../lib/paginar'
import { supabase, mensajeError } from '../lib/supabase'
import { ETAPAS, etapaManifiesto, fd, fnum, num, umL } from '../lib/formato'
import type { Manifiesto } from '../lib/tipos'
import { colorEtapa, MiniEtapa, PillEtapa } from '../components/Etapa'

/** Portal del cliente: ve solo los retiros y certificados de sus generadores (lo garantizan los permisos de la base) */
export function MenuPortal() {
  const { base, g } = useVista()
  const q = g ? `?g=${g}` : ''
  return (
    <nav className="bar" aria-label="Portal" style={{ marginBottom: 18 }}>
      <NavLink to={`${base}${q}`} end className="subnav">Mis retiros</NavLink>
      <NavLink to={`${base}/certificados${q}`} className="subnav" data-ayuda="portal-tab-cert">Certificados</NavLink>
    </nav>
  )
}

/** La gente de Serco puede ver el portal "como" un generador: /vista-cliente?g=ID */
function useVista() {
  const { pathname } = useLocation()
  const [sp] = useSearchParams()
  const interno = pathname.startsWith('/vista-cliente')
  return { interno, base: interno ? '/vista-cliente' : '/portal', g: interno ? Number(sp.get('g')) || null : null }
}

/** Barra de la vista del cliente: elegir qué generador mirar (por defecto, el que más retiros tuvo en el año) */
function VerComo() {
  const { interno, g } = useVista()
  const [sp, setSp] = useSearchParams()
  const [gens, setGens] = useState<{ id: number; nombre: string; n: number }[]>([])
  useEffect(() => {
    if (!interno) return
    const desde = new Date(); desde.setFullYear(desde.getFullYear() - 1)
    traerTodo<{ generador_id: number; generadores: { nombre: string } | null }>(() => supabase.from('manifiestos')
      .select('generador_id, generadores(nombre)').eq('anulado', false).gte('fecha', desde.toISOString().slice(0, 10)).order('id'))
      .then(({ data }) => {
        const m = new Map<number, { id: number; nombre: string; n: number }>()
        for (const x of data) { const e = m.get(x.generador_id) ?? { id: x.generador_id, nombre: x.generadores?.nombre ?? '?', n: 0 }; e.n++; m.set(x.generador_id, e) }
        const l = [...m.values()].sort((a, b) => b.n - a.n)
        setGens(l)
        if (!sp.get('g') && l[0]) setSp({ g: String(l[0].id) }, { replace: true })
      })
  }, [interno]) // eslint-disable-line react-hooks/exhaustive-deps
  const ordenados = useMemo(() => [...gens].sort((a, b) => a.nombre.localeCompare(b.nombre)), [gens])
  if (!interno) return null
  return (
    <div className="aviso st bar" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
      <span>Así ve el portal un generador cuando entra con su usuario: solo sus propios retiros y certificados.</span>
      <label className="small">Ver como <select value={g ?? ''} onChange={(e) => setSp({ g: e.target.value })} style={{ maxWidth: 320 }}>
        {ordenados.map((x) => <option key={x.id} value={x.id}>{x.nombre} ({x.n})</option>)}
      </select></label>
    </div>
  )
}

export function PortalRetiros() {
  const nav = useNavigate()
  const { interno, g } = useVista()
  const [lista, setLista] = useState<Manifiesto[]>([])
  const [anio, setAnio] = useState(String(new Date().getFullYear()))
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [etapa, setEtapa] = useState<number | null>(null)

  useEffect(() => {
    if (interno && !g) return
    setCargando(true); setEtapa(null)
    let c = supabase.from('manifiestos')
      .select('id, numero, fecha, tipo, anulado, etapa, generadores(nombre), manifiesto_items(estado, cantidad, um, corrientes(codigo))')
      .eq('anulado', false).gte('fecha', `${anio}-01-01`).lte('fecha', `${anio}-12-31`)
    if (g) c = c.eq('generador_id', g)
    c.order('fecha', { ascending: false }).limit(1000)
      .then(({ data, error }) => { setError(mensajeError(error)); setLista((data ?? []) as unknown as Manifiesto[]); setCargando(false) })
  }, [anio, interno, g])

  const anios = Array.from({ length: new Date().getFullYear() - 2009 }, (_, i) => String(new Date().getFullYear() - i))
  const nombres = [...new Set(lista.map((m) => m.generadores?.nombre).filter(Boolean))] as string[]
  const varios = nombres.length > 1
  const etapas = lista.map((m) => m.etapa ?? etapaManifiesto((m.manifiesto_items ?? []).map((i) => i.estado)))
  const visibles = etapa === null ? lista : lista.filter((_, k) => etapas[k] === etapa)
  const items = lista.flatMap((m) => m.manifiesto_items ?? [])
  const suma = (u: string) => items.filter((i) => i.um === u).reduce((a, i) => a + i.cantidad, 0)
  const ultimo = lista[0]?.fecha

  return (
    <>
      <VerComo />
      <h1>{nombres.length === 1 ? nombres[0] : 'Mis retiros'}</h1>
      <p className="sub">Sus residuos retirados por Serco Ambiental en {anio}, con el recorrido de cada uno hasta el certificado.</p>
      <MenuPortal />
      <div className="bar"><label className="small">Año <select value={anio} onChange={(e) => setAnio(e.target.value)}>{anios.map((a) => <option key={a}>{a}</option>)}</select></label></div>
      {!cargando && lista.length > 0 && <>
        <div className="grid k4">
          <div className="card kpi"><div className="v">{num(lista.length)}</div><div className="l">retiros en {anio}</div></div>
          <div className="card kpi"><div className="v">{num(Math.round(suma('KGS')))}</div><div className="l">kilos</div></div>
          {suma('LTS') > 0 ? <div className="card kpi"><div className="v">{num(Math.round(suma('LTS')))}</div><div className="l">litros</div></div>
            : <div className="card kpi"><div className="v">{new Set(items.map((i) => i.corrientes?.codigo)).size}</div><div className="l">tipos de residuo</div></div>}
          <div className="card kpi"><div className="v">{ultimo ? fd(ultimo).slice(0, 5) : '—'}</div><div className="l">último retiro</div></div>
        </div>
        <div className="grid k5 mt etapas-portal" data-ayuda="vc-etapas">{[0, 1, 2, 3, 4].map((k) => (
          <button key={k} className={`card kpi ${etapa === k ? 'sel' : ''}`} style={colorEtapa(k)} aria-pressed={etapa === k} onClick={() => setEtapa(etapa === k ? null : k)}>
            <div className="v">{num(etapas.filter((e) => e === k).length)}</div><div className="l">{ETAPAS[k]}</div>
          </button>))}
        </div>
      </>}
      <div className="bar mt" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{etapa === null ? 'Todos los retiros' : `Retiros: ${ETAPAS[etapa].toLowerCase()}`}</h2>
        {etapa !== null && <button onClick={() => setEtapa(null)}>Ver todos</button>}
      </div>
      <div className="card" data-ayuda="portal-retiros">
        {error && <div className="aviso bad">{error}</div>}
        {cargando ? <p className="cargando">Cargando…</p> : lista.length === 0 ? <p className="vacio">No hay retiros en {anio}.</p> : (
          <div className="tw"><table>
            <thead><tr><th>Manifiesto</th><th>Fecha</th>{varios && <th>Empresa</th>}<th>Corrientes</th><th>Cantidad</th><th>Etapa</th></tr></thead>
            <tbody>{visibles.map((m) => {
              const it = m.manifiesto_items ?? []
              return (
                <tr key={m.id} className="fila" tabIndex={0} onClick={() => nav(`/manifiestos/${m.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/manifiestos/${m.id}`)}>
                  <td className="nw"><b>{fnum(m.numero)}</b></td><td className="nw">{fd(m.fecha)}</td>{varios && <td>{m.generadores?.nombre}</td>}
                  <td>{it.map((i, n) => <span key={n} className="pill" style={{ margin: '2px 4px 2px 0' }}>{i.corrientes?.codigo}</span>)}</td>
                  <td className="nw">{it.map((i) => `${num(i.cantidad)} ${umL(i.um)}`).join(' + ')}</td>
                  <td><span className="etapa-celda"><MiniEtapa etapa={m.etapa ?? 0} /><PillEtapa etapa={m.etapa ?? 0} /></span></td>
                </tr>)
            })}</tbody>
          </table></div>)}
      </div>
    </>
  )
}

interface Cert { id: number; numero: string; fecha: string; archivo: string | null; tipo_tratamiento: string | null; kgs: number | null; lts: number | null; operadores: { nombre: string } | null }

export function PortalCertificados() {
  const { interno, g } = useVista()
  const [lista, setLista] = useState<Cert[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (interno && !g) return
    setCargando(true)
    traerTodo<Cert>(() => g
      ? supabase.from('certificados').select('id, numero, fecha, archivo, tipo_tratamiento, kgs, lts, operadores(nombre), manifiesto_items!inner(manifiestos!inner(generador_id))')
        .eq('manifiesto_items.manifiestos.generador_id', g).order('fecha', { ascending: false }).order('id')
      : supabase.from('certificados').select('id, numero, fecha, archivo, tipo_tratamiento, kgs, lts, operadores(nombre)')
        .order('fecha', { ascending: false }).order('id'))
      .then(({ data, error }) => { setError(mensajeError(error)); setLista(data); setCargando(false) })
  }, [interno, g])

  async function descargar(c: Cert) {
    setError('')
    if (!c.archivo || c.archivo.startsWith('\\')) { setError(`El PDF del certificado ${c.numero} todavía no está disponible. Pedilo a Serco.`); return }
    const { data, error } = await supabase.storage.from('documentos').createSignedUrl(c.archivo, 300, { download: `Certificado ${c.numero}.pdf` })
    if (error || !data) setError('No se pudo descargar: ' + mensajeError(error)); else window.location.href = data.signedUrl
  }

  return (
    <>
      <VerComo />
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
                <td style={{ textAlign: 'right' }}><button onClick={() => descargar(c)} data-ayuda="portal-descargar">Descargar PDF</button></td>
              </tr>))}
            </tbody>
          </table></div>)}
      </div>
    </>
  )
}
