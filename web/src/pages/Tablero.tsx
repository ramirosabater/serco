import { useEffect, useState } from 'react'
import { ETAPAS } from '../lib/formato'
import { colorEtapa } from '../components/Etapa'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { etapaManifiesto, fd, fnum, hoy, num, umL } from '../lib/formato'
import type { Alerta, Manifiesto } from '../lib/tipos'
import { PillEtapa } from '../components/Etapa'

interface Resumen {
  etapas: [number, number, number]
  meses: { mes: string; kgs: number; lts: number }[]
  regularizar: { id: number; nombre: string; documento: string; vto: string | null; estado: 'vencido' | 'por_vencer' | 'sin_cargar' }[]
  regularizar_total: { vencido: number; por_vencer: number; sin_cargar: number }
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

const cuenta = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0

export default function Tablero() {
  const nav = useNavigate()
  const [k, setK] = useState({ mes: 0, planta: 0, fueraPlazo: 0, transito: 0, flota: 0 })
  const [ultimos, setUltimos] = useState<Manifiesto[]>([])
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [desde, setDesde] = useState(() => `${hoy().slice(0, 4)}-01-01`)
  const [hasta, setHasta] = useState(hoy)
  const [res, setRes] = useState<Resumen | null>(null)

  useEffect(() => {
    if (!desde || !hasta) return
    supabase.rpc('tablero_resumen', { p_desde: desde, p_hasta: hasta }).then(({ data }) => setRes(data as Resumen))
  }, [desde, hasta])

  useEffect(() => {
    const mes = hoy().slice(0, 8) + '01'
    Promise.all([
      cuenta(supabase.from('manifiestos').select('id', { count: 'exact', head: true }).gte('fecha', mes).eq('anulado', false)),
      cuenta(supabase.from('residuos_en_planta').select('id', { count: 'exact', head: true })),
      cuenta(supabase.from('residuos_en_planta').select('id', { count: 'exact', head: true }).lt('dias_restantes', 0)),
      cuenta(supabase.from('manifiesto_items').select('id', { count: 'exact', head: true }).eq('estado', 'en_transito')),
      cuenta(supabase.from('alertas_vencimiento').select('id', { count: 'exact', head: true }).in('tipo', ['camion', 'chofer']).eq('estado', 'vencido')),
    ]).then(([mes, planta, fueraPlazo, transito, flota]) => setK({ mes, planta, fueraPlazo, transito, flota }))

    supabase.from('manifiestos')
      .select('id, numero, fecha, tipo, anulado, generadores(nombre), manifiesto_items(estado, cantidad, um, corrientes(codigo))')
      .eq('anulado', false).order('fecha', { ascending: false }).order('numero', { ascending: false }).limit(8)
      .then(({ data }) => setUltimos((data ?? []) as unknown as Manifiesto[]))

    // Primero lo que está por vencer; después lo vencido más reciente
    Promise.all([
      supabase.from('alertas_vencimiento').select('*').in('tipo', ['camion', 'chofer']).eq('estado', 'por_vencer').order('vto').limit(8),
      supabase.from('alertas_vencimiento').select('*').in('tipo', ['camion', 'chofer']).eq('estado', 'vencido').order('vto', { ascending: false }).limit(8),
    ]).then(([a, b]) => setAlertas([...(a.data ?? []), ...(b.data ?? [])].slice(0, 8) as Alerta[]))
  }, [])

  return (
    <>
      <h1>Tablero</h1>
      <p className="sub">Situación al {fd(hoy())}.</p>
      <div className="grid k4">
        <div className="card kpi"><div className="v">{num(k.mes)}</div><div className="l">manifiestos emitidos este mes</div></div>
        <div className={`card kpi ${k.fueraPlazo ? 'alerta' : ''}`}><div className="v">{num(k.planta)}</div>
          <div className="l">residuos en planta{k.fueraPlazo ? `, ${num(k.fueraPlazo)} fuera de plazo` : ''}</div></div>
        <div className="card kpi"><div className="v">{num(k.transito)}</div><div className="l">residuos en tránsito a disposición final</div></div>
        <Link to="/vencimientos" className={`card kpi ${k.flota ? 'alerta' : ''}`}><div className="v">{num(k.flota)}</div><div className="l">habilitaciones vencidas de camiones y choferes</div></Link>
      </div>

      <div className="card mt" data-ayuda="tab-etapas">
        <div className="bar" style={{ justifyContent: 'space-between', margin: 0 }}>
          <h2 style={{ margin: 0 }}>Manifiestos por etapa</h2>
          <span className="bar" style={{ margin: 0 }}>
            <label className="small">Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
            <label className="small">Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          </span>
        </div>
        {res && <Etapas valores={res.etapas} onElegir={(k) => nav(`/manifiestos?etapa=${k}&desde=${desde}&hasta=${hasta}`)} desde={desde} hasta={hasta} />}
      </div>

      <div className="grid c21 mt">
        <div className="card">
          <h2>Volumen retirado, últimos 12 meses</h2>
          {res && <Volumen meses={res.meses} />}
        </div>
        <div className="card">
          <div className="bar" style={{ justifyContent: 'space-between', margin: '0 0 6px' }}>
            <h2 style={{ margin: 0 }}>Generadores a regularizar</h2>
          </div>
          {res && <>
            <p className="muted small" style={{ marginTop: 0 }}>Con retiros en el último año: {num(res.regularizar_total.vencido)} con habilitación vencida, {num(res.regularizar_total.por_vencer)} por vencer y {num(res.regularizar_total.sin_cargar)} sin cargar.</p>
            {res.regularizar.length === 0 ? <p className="muted">Todos al día.</p> :
              <div className="stack" style={{ gap: 8 }}>{res.regularizar.slice(0, 5).map((g) => (
                <Link key={`${g.id}${g.documento}`} to={`/altas/generadores/${g.id}`} className="fila-link">
                  <span><b>{g.nombre}</b><span className="muted small" style={{ display: 'block' }}>{g.documento}</span></span>
                  <span className={`pill ${g.estado === 'por_vencer' ? 'haz' : 'bad'}`}>{g.estado === 'sin_cargar' ? 'Sin cargar' : `${g.estado === 'vencido' ? 'Venció' : 'Vence'} ${fd(g.vto)}`}</span>
                </Link>))}
                <Link to="/vencimientos?tipo=generador" className="small">Ver todos</Link>
              </div>}
          </>}
        </div>
      </div>

      <div className="grid c21 mt">
        <div className="card">
          <div className="bar" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Últimos manifiestos</h2>
            <Link to="/manifiestos/nuevo" data-ayuda="man-nuevo"><button className="pri">Nuevo manifiesto</button></Link>
          </div>
          <div className="tw"><table>
            <thead><tr><th>Manifiesto</th><th>Fecha</th><th>Generador</th><th>Residuos</th><th>Etapa</th></tr></thead>
            <tbody>{ultimos.map((m) => {
              const it = m.manifiesto_items ?? []
              return (
                <tr key={m.id} className="fila" tabIndex={0} onClick={() => nav(`/manifiestos/${m.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/manifiestos/${m.id}`)}>
                  <td className="nw"><b>{fnum(m.numero)}</b></td><td>{fd(m.fecha)}</td><td>{m.generadores?.nombre}</td>
                  <td>{it.map((i, n) => <span key={n} className="pill" style={{ marginRight: 4 }}>{i.corrientes?.codigo} · {num(i.cantidad)} {umL(i.um)}</span>)}</td>
                  <td><PillEtapa etapa={etapaManifiesto(it.map((i) => i.estado))} /></td>
                </tr>)
            })}</tbody>
          </table></div>
        </div>
        <div className="card">
          <h2>Vencimientos de flota</h2>
          {alertas.length === 0 ? <p className="muted">No hay vencimientos en los próximos días.</p> :
            <div className="stack" style={{ gap: 8 }}>{alertas.map((a) => (
              <div key={`${a.tipo}${a.id}${a.documento}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span><b>{a.nombre}</b> <span className="muted small">{a.documento}</span></span>
                <span className={`pill ${a.estado === 'vencido' ? 'bad' : 'haz'}`} style={{ flexShrink: 0, alignSelf: 'flex-start' }}>{a.estado === 'vencido' ? 'Venció' : 'Vence'} {fd(a.vto)}</span>
              </div>))}
              <Link to="/vencimientos" className="small">Ver todos los vencimientos</Link>
            </div>}
        </div>
      </div>
    </>
  )
}

function Etapas({ valores, onElegir, desde, hasta }: { valores: number[]; onElegir: (k: number) => void; desde: string; hasta: string }) {
  const total = valores.reduce((a, b) => a + b, 0)
  const max = Math.max(1, ...valores)
  if (!total) return <p className="muted">No hay manifiestos en ese período.</p>
  return (
    <>
      <div className="etapas-barras">{valores.map((v, k) => (
        <button key={k} style={colorEtapa(k)} onClick={() => onElegir(k)} aria-label={`${ETAPAS[k]}: ${v} manifiestos. Ver la lista`}>
          <span className="v">{num(v)}</span>
          <span className="p">{Math.round((v / total) * 100)} %</span>
          <span className="col" style={{ height: Math.max(4, Math.round((v / max) * 140)) }} />
          <span className="lab">{ETAPAS[k]}</span>
        </button>))}
      </div>
      <p className="small muted" style={{ margin: '14px 0 0' }}>{num(total)} manifiestos entre el {fd(desde)} y el {fd(hasta)}. Tocá una barra para ver esos manifiestos.</p>
    </>
  )
}

function Volumen({ meses }: { meses: { mes: string; kgs: number; lts: number }[] }) {
  const hayL = meses.some((m) => m.lts > 0)
  const max = Math.max(1, ...meses.map((m) => Math.max(m.kgs, hayL ? m.lts : 0)))
  const W = 640, H = 220, X0 = 38, bw = (W - X0) / meses.length
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="volumen" role="img" aria-label="Kilos y litros retirados por mes">
        {[0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line x1={34} x2={W} y1={H - 20 - f * (H - 34)} y2={H - 20 - f * (H - 34)} className="guia" />
          <text x={0} y={H - 16 - f * (H - 34)} className="eje">{num(Math.round((f * max) / 1000))} {hayL ? 'mil' : 't'}</text></g>)}
        {meses.map((m, i) => {
          const x = X0 + i * bw + 4, alto = (v: number) => (v / max) * (H - 34)
          const w1 = hayL ? bw / 2 - 6 : bw - 12
          return (
            <g key={m.mes}>
              <rect x={x} y={H - 20 - alto(m.kgs)} width={w1} height={alto(m.kgs)} rx={2} className="b-kg"><title>{`${MESES[+m.mes.slice(5) - 1]} ${m.mes.slice(0, 4)}: ${num(Math.round(m.kgs))} kg`}</title></rect>
              {hayL && <rect x={x + bw / 2 - 4} y={H - 20 - alto(m.lts)} width={bw / 2 - 6} height={alto(m.lts)} rx={2} className="b-lt"><title>{`${MESES[+m.mes.slice(5) - 1]} ${m.mes.slice(0, 4)}: ${num(Math.round(m.lts))} l`}</title></rect>}
              <text x={x + (hayL ? bw / 2 - 5 : w1 / 2)} y={H - 5} textAnchor="middle" className="eje">{MESES[+m.mes.slice(5) - 1]}</text>
            </g>)
        })}
      </svg>
      <div className="leyenda"><span className="l-kg">Kilos</span>{hayL && <span className="l-lt">Litros</span>}</div>
    </>
  )
}
