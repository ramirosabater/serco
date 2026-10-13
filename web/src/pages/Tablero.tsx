import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { etapaManifiesto, fd, fnum, hoy, num, umL } from '../lib/formato'
import type { Alerta, Manifiesto } from '../lib/tipos'
import { PillEtapa } from '../components/Etapa'

const cuenta = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0

export default function Tablero() {
  const nav = useNavigate()
  const [k, setK] = useState({ mes: 0, planta: 0, fueraPlazo: 0, transito: 0, flota: 0 })
  const [ultimos, setUltimos] = useState<Manifiesto[]>([])
  const [alertas, setAlertas] = useState<Alerta[]>([])

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

      <div className="grid c21 mt">
        <div className="card">
          <div className="bar" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Últimos manifiestos</h2>
            <Link to="/manifiestos/nuevo"><button className="pri">Nuevo manifiesto</button></Link>
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
