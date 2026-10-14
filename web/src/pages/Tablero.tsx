import { useEffect, useState } from 'react'
import { ETAPAS } from '../lib/formato'
import { colorEtapa } from '../components/Etapa'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fd, fnum, hoy, num, umL } from '../lib/formato'
import type { Alerta, Manifiesto } from '../lib/tipos'
import { MiniEtapa, PillEtapa } from '../components/Etapa'

interface Resumen {
  etapas: [number, number, number, number]
  kgs: number
  generadores: number
  meses: { mes: string; kgs: number; lts: number }[]
  regularizar: { id: number; nombre: string; documento: string; vto: string | null; estado: 'vencido' | 'por_vencer' | 'sin_cargar' }[]
  regularizar_total: { vencido: number; por_vencer: number; sin_cargar: number }
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']


export default function Tablero() {
  const nav = useNavigate()
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
    supabase.from('manifiestos')
      .select('id, numero, fecha, tipo, anulado, etapa, generadores(nombre), manifiesto_items(estado, cantidad, um, corrientes(codigo))')
      .eq('anulado', false).order('fecha', { ascending: false }).order('numero', { ascending: false }).limit(8)
      .then(({ data }) => setUltimos((data ?? []) as unknown as Manifiesto[]))

    // Primero lo que está por vencer; después lo vencido más reciente
    Promise.all([
      supabase.from('alertas_vencimiento').select('*').in('tipo', ['camion', 'chofer']).eq('estado', 'por_vencer').order('vto').limit(8),
      supabase.from('alertas_vencimiento').select('*').in('tipo', ['camion', 'chofer']).eq('estado', 'vencido').order('vto', { ascending: false }).limit(8),
    ]).then(([a, b]) => setAlertas([...(a.data ?? []), ...(b.data ?? [])].slice(0, 8) as Alerta[]))
  }, [])

  const sinDisposicion = res ? res.etapas[0] + res.etapas[1] : 0
  const anio = desde.slice(0, 4) === hasta.slice(0, 4) && desde.endsWith('-01-01') ? `en ${desde.slice(0, 4)}` : `del ${fd(desde)} al ${fd(hasta)}`
  return (
    <>
      <h1>Tablero</h1>
      <p className="sub">Situación al {fd(hoy())}. Manifiestos emitidos {anio}.</p>
      <div className="grid k4">
        <Link to={`/manifiestos?desde=${desde}&hasta=${hasta}`} className="card kpi"><div className="v">{res ? num(res.etapas.reduce((a, b) => a + b, 0)) : '…'}</div><div className="l">manifiestos {anio}</div></Link>
        <div className="card kpi"><div className="v">{res ? `${num(Math.round(res.kgs / 1000))} t` : '…'}</div><div className="l">de residuos sólidos y semisólidos</div></div>
        <div className="card kpi"><div className="v">{res ? num(res.generadores) : '…'}</div><div className="l">generadores atendidos</div></div>
        <Link to={`/manifiestos?etapa=0&desde=${desde}&hasta=${hasta}`} className={`card kpi ${sinDisposicion ? 'alerta' : ''}`}><div className="v">{num(sinDisposicion)}</div><div className="l">manifiestos sin disposición final</div></Link>
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
          <h2>Habilitaciones a revisar</h2>
          {alertas.length === 0 ? <p className="muted">No hay vencimientos en los próximos días.</p> : <>
            <div className="lista-it">{alertas.slice(0, 6).map((a) => (
              <Link key={`${a.tipo}${a.id}${a.documento}`} to={`/altas/${a.tipo === 'camion' ? 'camiones' : 'choferes'}/${a.id}`} className="it">
                <div><b>{a.nombre}</b><div className="small muted">{a.tipo === 'camion' ? 'Camión' : 'Chofer'} · {a.documento}</div></div>
                <span className={`pill ${a.estado === 'vencido' ? 'bad' : 'haz'}`}>{a.estado === 'vencido' ? 'Vencido' : 'Vence'} {fd(a.vto)}</span>
              </Link>))}
            </div>
            <p className="small" style={{ margin: '10px 0 0' }}><Link to="/vencimientos">Ver flota y choferes</Link></p>
          </>}
        </div>
      </div>

      {res && res.regularizar.length > 0 && (
        <div className="card mt">
          <div className="bar" style={{ justifyContent: 'space-between', margin: '0 0 6px' }}>
            <h2 style={{ margin: 0 }}>Generadores a regularizar</h2>
            <span className="muted small">{num(res.regularizar_total.vencido)} con habilitación vencida · {num(res.regularizar_total.por_vencer)} por vencer · {num(res.regularizar_total.sin_cargar)} sin cargar</span>
          </div>
          <div className="gr-lista">{res.regularizar.slice(0, 8).map((g) => (
            <Link key={`${g.id}${g.documento}`} to={`/altas/generadores/${g.id}`} className="gr-it">
              <b>{g.nombre}</b>
              <span className={`pill ${g.estado === 'por_vencer' ? 'haz' : 'bad'}`}>{g.estado === 'sin_cargar' ? 'Sin cargar' : `${g.estado === 'vencido' ? 'Vencido' : 'Vence'} ${fd(g.vto)}`}</span>
            </Link>))}
          </div>
        </div>)}

      <div className="card mt">
        <div className="bar" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Últimos manifiestos</h2>
          <Link to="/manifiestos/nuevo" data-ayuda="man-nuevo"><button className="pri">Nuevo manifiesto</button></Link>
        </div>
        <div className="tw"><table>
          <thead><tr><th>Manifiesto</th><th>Fecha</th><th>Generador</th><th>Corrientes</th><th>Cantidad</th><th>Etapa</th></tr></thead>
          <tbody>{ultimos.map((m) => {
            const it = m.manifiesto_items ?? []
            return (
              <tr key={m.id} className="fila" tabIndex={0} onClick={() => nav(`/manifiestos/${m.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/manifiestos/${m.id}`)}>
                <td className="nw"><b>{fnum(m.numero)}</b></td><td className="nw">{fd(m.fecha)}</td><td>{m.generadores?.nombre}</td>
                <td>{it.map((i, n) => <span key={n} className="pill" style={{ marginRight: 4 }}>{i.corrientes?.codigo}</span>)}</td>
                <td className="nw">{it.map((i) => `${num(i.cantidad)} ${umL(i.um)}`).join(' + ')}</td>
                <td><span className="etapa-celda"><MiniEtapa etapa={m.etapa ?? 0} /><PillEtapa etapa={m.etapa ?? 0} /></span></td>
              </tr>)
          })}</tbody>
        </table></div>
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
