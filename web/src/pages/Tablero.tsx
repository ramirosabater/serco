import { useEffect, useMemo, useState } from 'react'
import { ETAPAS } from '../lib/formato'
import { colorEtapa } from '../components/Etapa'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { traerTodo } from '../lib/paginar'
import { supabase } from '../lib/supabase'
import { fd, fnum, hoy, num, umL } from '../lib/formato'
import type { Alerta, Manifiesto } from '../lib/tipos'
import { MiniEtapa, PillEtapa } from '../components/Etapa'
import Explica, { ExplicarTodo } from '../components/Explica'
import type { Paso } from '../lib/guias'

interface Resumen {
  etapas: [number, number, number, number, number]
  total: number
  kgs: number
  lts: number
  generadores: number
  meses: { mes: string; kgs: number; lts: number }[]
  regularizar: { id: number; nombre: string; documento: string; vto: string | null; estado: 'vencido' | 'por_vencer' | 'sin_cargar' }[]
  regularizar_total: { vencido: number; por_vencer: number; sin_cargar: number }
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']


// ---------------------------------------------------------------- filtros (quedan en la dirección: se pueden compartir y sobreviven a recargar)
const PERIODOS: [string, string][] = [['anio', 'Este año'], ['mes', 'Este mes'], ['mes_pasado', 'El mes pasado'], ['30', 'Últimos 30 días'],
  ['12m', 'Últimos 12 meses'], ['anio_pasado', 'El año pasado'], ['otro', 'Elegir fechas']]
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function fechasDe(p: string): [string, string] {
  const h = new Date(hoy() + 'T12:00:00'), y = h.getFullYear(), m = h.getMonth()
  switch (p) {
    case 'mes': return [iso(new Date(y, m, 1)), hoy()]
    case 'mes_pasado': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))]
    case '30': return [iso(new Date(y, m, h.getDate() - 29)), hoy()]
    case '12m': return [iso(new Date(y - 1, m, h.getDate() + 1)), hoy()]
    case 'anio_pasado': return [`${y - 1}-01-01`, `${y - 1}-12-31`]
    default: return [`${y}-01-01`, hoy()]
  }
}
interface Op { id: number; nombre: string }

function leerFiltros(sp: URLSearchParams) {
  const periodo = sp.get('p') ?? (sp.get('desde') ? 'otro' : 'anio')
  const [d0, h0] = fechasDe(periodo)
  return {
    periodo, desde: periodo === 'otro' ? sp.get('desde') ?? d0 : d0, hasta: periodo === 'otro' ? sp.get('hasta') ?? h0 : h0,
    planta: sp.get('planta') ?? '', transp: sp.get('transp') ?? '', gen: sp.get('gen') ?? '', tipo: sp.get('tipo') ?? '', etapa: sp.get('etapa') ?? '',
  }
}

function useFiltros() {
  const [sp, setSp] = useSearchParams()
  const f = leerFiltros(sp)
  // Siempre sobre lo último de la dirección (dos cambios seguidos no se pisan)
  const set = (cambios: Partial<typeof f>) => setSp(() => {
    const n = { ...leerFiltros(new URLSearchParams(window.location.search)), ...cambios }
    const q: Record<string, string> = {}
    if (n.periodo !== 'anio') q.p = n.periodo
    if (n.periodo === 'otro') { q.desde = n.desde; q.hasta = n.hasta }
    for (const k of ['planta', 'transp', 'gen', 'tipo', 'etapa'] as const) if (n[k]) q[k] = n[k]
    return new URLSearchParams(q)
  }, { replace: true })
  const activos = !!(f.planta || f.transp || f.gen || f.tipo || f.etapa)
  return { f, set, activos, limpiar: () => setSp({}, { replace: true }) }
}

function Filtros({ fl, plantas, transportistas, generadores }: { fl: ReturnType<typeof useFiltros>; plantas: Op[]; transportistas: Op[]; generadores: Op[] }) {
  const { f, set, activos, limpiar } = fl
  const genNombre = generadores.find((g) => String(g.id) === f.gen)?.nombre ?? ''
  const [genTexto, setGenTexto] = useState(genNombre)
  useEffect(() => { setGenTexto(genNombre) }, [genNombre])
  return (
    <div className="card filtros" data-ayuda="tab-filtros">
      <label className="campo">Período
        <select value={f.periodo} onChange={(e) => { const p = e.target.value; set(p === 'otro' ? { periodo: p, desde: f.desde, hasta: f.hasta } : { periodo: p }) }}>
          {PERIODOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="campo">Desde<input type="date" value={f.desde} max={f.hasta} onChange={(e) => e.target.value && set({ periodo: 'otro', desde: e.target.value })} /></label>
      <label className="campo">Hasta<input type="date" value={f.hasta} min={f.desde} onChange={(e) => e.target.value && set({ periodo: 'otro', hasta: e.target.value })} /></label>
      <label className="campo">Planta
        <select value={f.planta} onChange={(e) => set({ planta: e.target.value })}><option value="">Todas</option>{plantas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
      <label className="campo">Transportista
        <select value={f.transp} onChange={(e) => set({ transp: e.target.value })}><option value="">Todos</option>{transportistas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
      <label className="campo ancho">Generador
        <input list="tab-generadores" value={genTexto} placeholder="Todos"
          onChange={(e) => { setGenTexto(e.target.value); const g = generadores.find((x) => x.nombre === e.target.value); if (g) set({ gen: String(g.id) }); else if (!e.target.value) set({ gen: '' }) }} />
        <datalist id="tab-generadores">{generadores.map((g) => <option key={g.id} value={g.nombre} />)}</datalist></label>
      <label className="campo">Formulario
        <select value={f.tipo} onChange={(e) => set({ tipo: e.target.value })}><option value="">Todos</option><option value="azul">Azul (Serco)</option><option value="rosa">Rosa (otros)</option></select></label>
      <label className="campo">Etapa
        <select value={f.etapa} onChange={(e) => set({ etapa: e.target.value })}><option value="">Todas</option>{ETAPAS.map((n, k) => <option key={k} value={k}>{n}</option>)}</select></label>
      {(activos || f.periodo !== 'anio') && <button type="button" className="link limpiar" onClick={() => { setGenTexto(''); limpiar() }}>Limpiar filtros</button>}
    </div>
  )
}

export default function Tablero() {
  const nav = useNavigate()
  const [ultimos, setUltimos] = useState<Manifiesto[]>([])
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [res, setRes] = useState<Resumen | null>(null)
  const [plantas, setPlantas] = useState<Op[]>([])
  const [transportistas, setTransportistas] = useState<Op[]>([])
  const [generadores, setGeneradores] = useState<Op[]>([])
  const fl = useFiltros()
  const { desde, hasta, planta, transp, gen, tipo, etapa } = fl.f

  useEffect(() => {
    supabase.from('generadores_principales').select('id, nombre').eq('activo', true).order('nombre').then(({ data }) => setPlantas(data ?? []))
    supabase.from('transportistas').select('id, nombre').order('nombre').then(({ data }) => setTransportistas(data ?? []))
    traerTodo<Op>(() => supabase.from('generadores').select('id, nombre').order('nombre')).then(({ data }) => setGeneradores(data))
  }, [])

  useEffect(() => {
    if (!desde || !hasta) return
    let vivo = true
    supabase.rpc('tablero_resumen', { p_desde: desde, p_hasta: hasta, p_planta: planta ? Number(planta) : null, p_transportista: transp ? Number(transp) : null,
      p_generador: gen ? Number(gen) : null, p_tipo: tipo || null, p_etapa: etapa ? Number(etapa) : null })
      .then(({ data }) => { if (vivo) setRes(data as Resumen) })
    return () => { vivo = false }
  }, [desde, hasta, planta, transp, gen, tipo, etapa])

  // Últimos manifiestos: con los mismos filtros (menos el período: siempre los más nuevos)
  useEffect(() => {
    let q = supabase.from('manifiestos')
      .select(`id, numero, fecha, tipo, anulado, etapa, generadores(nombre), manifiesto_items(estado, cantidad, um, corrientes(codigo))${etapa ? ', et:manifiesto_etapas!inner(etapa)' : ''}`)
      .eq('anulado', false)
    if (planta) q = q.eq('generador_principal_id', Number(planta))
    if (transp) q = q.eq('transportista_id', Number(transp))
    if (gen) q = q.eq('generador_id', Number(gen))
    if (tipo) q = q.eq('tipo', tipo)
    if (etapa) q = q.eq('et.etapa', Number(etapa))
    q.order('fecha', { ascending: false }).order('numero', { ascending: false }).limit(8)
      .then(({ data }) => setUltimos((data ?? []) as unknown as Manifiesto[]))
  }, [planta, transp, gen, tipo, etapa])

  useEffect(() => {
    // Primero lo que está por vencer; después lo vencido más reciente
    Promise.all([
      supabase.from('alertas_vencimiento').select('*').in('tipo', ['camion', 'chofer']).eq('estado', 'por_vencer').order('vto').limit(8),
      supabase.from('alertas_vencimiento').select('*').in('tipo', ['camion', 'chofer']).eq('estado', 'vencido').order('vto', { ascending: false }).limit(8),
    ]).then(([a, b]) => setAlertas([...(a.data ?? []), ...(b.data ?? [])].slice(0, 8) as Alerta[]))
  }, [])

  const sinDisposicion = res ? res.etapas[0] + res.etapas[1] + res.etapas[2] : 0
  const anio = desde.slice(0, 4) === hasta.slice(0, 4) && desde.endsWith('-01-01') && fl.f.periodo !== 'otro' && desde.slice(0, 4) === hoy().slice(0, 4)
    ? `en ${desde.slice(0, 4)}` : `del ${fd(desde)} al ${fd(hasta)}`
  const filtrosTexto = useMemo(() => [
    planta && `planta ${plantas.find((x) => String(x.id) === planta)?.nombre ?? ''}`,
    transp && `transportista ${transportistas.find((x) => String(x.id) === transp)?.nombre ?? ''}`,
    gen && `generador ${generadores.find((x) => String(x.id) === gen)?.nombre ?? ''}`,
    tipo && `formulario ${tipo}`,
    etapa && `etapa ${ETAPAS[Number(etapa)]}`,
  ].filter(Boolean).join(', '), [planta, transp, gen, tipo, etapa, plantas, transportistas, generadores])
  const ex = explicaciones(res, alertas, anio, desde, hasta, filtrosTexto)
  const genNombre = generadores.find((x) => String(x.id) === gen)?.nombre
  const listaUrl = `/manifiestos?desde=${desde}&hasta=${hasta}${etapa ? `&etapa=${etapa}` : ''}${genNombre ? `&q=${encodeURIComponent(genNombre)}` : ''}`
  return (
    <>
      <div className="bar" style={{ justifyContent: 'space-between', margin: 0 }}>
        <h1>Tablero</h1>
        {res && <ExplicarTodo titulo="Qué dice el tablero" pasos={() => Object.values(ex).map((f) => f()).filter((x): x is Paso => !!x)} texto="Explicame el tablero" />}
      </div>
      <p className="sub">Situación al {fd(hoy())}. Manifiestos emitidos {anio}{filtrosTexto ? ` · ${filtrosTexto}` : ''}.</p>
      <Filtros fl={fl} plantas={plantas} transportistas={transportistas} generadores={generadores} />
      <div className="grid k4 mt">
        <div className="card kpi" data-ayuda="kpi-total"><Link to={listaUrl} className="kpi-link"><div className="v">{res ? num(res.total) : '…'}</div><div className="l">manifiestos {anio}</div></Link>
          {res && <Explica titulo="Manifiestos del período" paso={ex.total} />}</div>
        <div className="card kpi" data-ayuda="kpi-toneladas"><div className="v">{res ? `${num(Math.round(res.kgs / 1000))} t` : '…'}</div><div className="l">de residuos sólidos y semisólidos</div>
          {res && <Explica titulo="Toneladas" paso={ex.toneladas} />}</div>
        <div className="card kpi" data-ayuda="kpi-generadores"><div className="v">{res ? num(res.generadores) : '…'}</div><div className="l">generadores atendidos</div>
          {res && <Explica titulo="Generadores atendidos" paso={ex.generadores} />}</div>
        <div className={`card kpi ${sinDisposicion ? 'alerta' : ''}`} data-ayuda="kpi-sin-disposicion"><Link to="/planta" className="kpi-link"><div className="v">{num(sinDisposicion)}</div><div className="l">manifiestos sin disposición final</div></Link>
          {res && <Explica titulo="Sin disposición final" paso={ex.sinDisposicion} />}</div>
      </div>

      <div className="card mt" data-ayuda="tab-etapas">
        <div className="bar" style={{ justifyContent: 'space-between', margin: 0 }}>
          <h2 style={{ margin: 0 }}>Manifiestos por etapa{res && <Explica titulo="Manifiestos por etapa" paso={ex.etapas} />}</h2>
        </div>
        {res && <Etapas valores={res.etapas} elegida={etapa ? Number(etapa) : null} onElegir={(k) => nav(`/manifiestos?etapa=${k}&desde=${desde}&hasta=${hasta}${genNombre ? `&q=${encodeURIComponent(genNombre)}` : ''}`)} desde={desde} hasta={hasta} />}
      </div>

      <div className="grid c21 mt">
        <div className="card" data-ayuda="tab-volumen">
          <h2>Volumen retirado, últimos 12 meses{res && <Explica titulo="Volumen retirado" paso={ex.volumen} />}</h2>
          {filtrosTexto && <p className="small muted" style={{ marginTop: -6 }}>Con los filtros de arriba ({filtrosTexto}); siempre los últimos 12 meses.</p>}
          {res && <Volumen meses={res.meses} />}
        </div>
        <div className="card" data-ayuda="tab-habilitaciones">
          <h2>Habilitaciones a revisar{res && <Explica titulo="Habilitaciones a revisar" paso={ex.habilitaciones} />}</h2>
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
        <div className="card mt" data-ayuda="tab-regularizar">
          <div className="bar" style={{ justifyContent: 'space-between', margin: '0 0 6px' }}>
            <h2 style={{ margin: 0 }}>Generadores a regularizar<Explica titulo="Generadores a regularizar" paso={ex.regularizar} /></h2>
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

/** Lo que dice Tito de cada número del tablero, con los valores que se ven en pantalla */
function explicaciones(res: Resumen | null, alertas: Alerta[], anio: string, desde: string, hasta: string, filtros: string): Record<string, () => Paso | null> {
  if (!res) return {}
  const [e0, e1, e2, e3, e4] = res.etapas
  const todos = e0 + e1 + e2 + e3 + e4
  const total = res.total
  const pc = (v: number) => (todos ? Math.round((v / todos) * 100) : 0)
  const t = (kg: number) => num(Math.round(kg / 1000))
  const mesNombre = (m: string) => `${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][+m.slice(5) - 1]} de ${m.slice(0, 4)}`
  return {
    total: () => ({ titulo: `${num(total)} manifiestos`, foco: 'kpi-total',
      texto: `Son los manifiestos emitidos ${anio}${filtros ? `, con ${filtros}` : ''}, sin contar los anulados${filtros.includes('formulario') ? '' : ': los azules de Serco y los rosas de otros transportistas'}. El período y los demás filtros se cambian arriba de todo, en el cuadro de filtros.`,
      boton: { texto: 'Ver la lista', ir: `/manifiestos?desde=${desde}&hasta=${hasta}` } }),
    toneladas: () => ({ titulo: `${t(res.kgs)} toneladas`, foco: 'kpi-toneladas',
      texto: `Es la suma de todo lo que se cargó en kilos en esos manifiestos: sólidos y barros. Los líquidos van en litros y no entran acá.${e0 ? ` Los ${num(e0)} manifiestos que siguen Iniciados todavía no suman, porque les falta la sección 3.` : ''}` }),
    generadores: () => ({ titulo: `${num(res.generadores)} generadores`, foco: 'kpi-generadores',
      texto: `Son los generadores distintos que tuvieron al menos un retiro ${anio}${res.generadores ? `: en promedio, ${num(Math.round((total / res.generadores) * 10) / 10)} manifiestos cada uno` : ''}.` }),
    sinDisposicion: () => ({ titulo: `${num(e0 + e1 + e2)} sin disposición final`, foco: 'kpi-sin-disposicion',
      texto: `Son los manifiestos del período que todavía no tienen certificado de disposición final: ${num(e0)} Iniciados, a los que les falta la sección 3; ${num(e1)} Almacenados en planta; y ${num(e2)} En tránsito, esperando el certificado del operador.`,
      boton: { texto: 'Ir a Planta', ir: '/planta' } }),
    etapas: () => {
      const nombres = ['Iniciado', 'Almacenado', 'En tránsito', 'Dispuesto', 'Certificado entregado']
      const mayor = res.etapas.indexOf(Math.max(...res.etapas))
      return { titulo: 'Manifiestos por etapa', foco: 'tab-etapas',
        texto: `Cada barra es la etapa en la que está hoy cada manifiesto. Iniciado: emitido, falta cargar los residuos. Almacenado: está en planta. En tránsito: viajó al operador. Dispuesto: tiene certificado. Certificado entregado: el cliente ya lo recibió. La barra más alta es ${nombres[mayor]}, con ${num(res.etapas[mayor])} manifiestos, el ${pc(res.etapas[mayor])} %. Tocá una barra para ver esa lista.` }
    },
    volumen: () => {
      const m = res.meses
      if (!m.length) return null
      const kg = m.reduce((a, x) => a + x.kgs, 0), lt = m.reduce((a, x) => a + x.lts, 0)
      const mejor = m.reduce((a, x) => (x.kgs > a.kgs ? x : a), m[0])
      const pasado = m[m.length - 2], previos = m.slice(0, -1)
      const prom = previos.length ? previos.reduce((a, x) => a + x.kgs, 0) / previos.length : 0
      const dif = prom && pasado ? Math.round(((pasado.kgs - prom) / prom) * 100) : 0
      return { titulo: 'Volumen retirado', foco: 'tab-volumen',
        texto: `En los últimos 12 meses se retiraron ${t(kg)} toneladas${lt ? ` y ${num(Math.round(lt))} litros` : ''}. El mes con más kilos fue ${mesNombre(mejor.mes)}, con ${t(mejor.kgs)} toneladas.${pasado ? ` El mes pasado, ${mesNombre(pasado.mes)}, fueron ${t(pasado.kgs)} toneladas: ${dif === 0 ? 'lo mismo que' : `un ${Math.abs(dif)} % ${dif > 0 ? 'más' : 'menos'} que`} el promedio.` : ''} La última barra es el mes en curso, todavía incompleto.` }
    },
    habilitaciones: () => {
      const pv = alertas.filter((a) => a.estado === 'por_vencer').length, v = alertas.filter((a) => a.estado === 'vencido').length
      return { titulo: 'Habilitaciones a revisar', foco: 'tab-habilitaciones',
        texto: alertas.length ? `Son camiones y choferes con documentos por vencer (${pv} en esta lista) o vencidos (${v}). Con un documento vencido, el sistema no deja emitir con ese camión o chofer. Desde Vencimientos se le puede pedir el certificado nuevo al chofer por mail.`
          : 'No hay camiones ni choferes con documentos por vencer en los próximos días.',
        boton: { texto: 'Ver vencimientos', ir: '/vencimientos' } }
    },
    regularizar: () => res.regularizar.length ? ({ titulo: 'Generadores a regularizar', foco: 'tab-regularizar',
      texto: `Son generadores con retiros en el último año cuya habilitación municipal está vencida (${num(res.regularizar_total.vencido)}), por vencer (${num(res.regularizar_total.por_vencer)}) o sin cargar (${num(res.regularizar_total.sin_cargar)}). Si en Configuración está activado el bloqueo, no se les puede emitir hasta actualizarla.`,
      boton: { texto: 'Ver vencimientos de generadores', ir: '/vencimientos?tipo=generador' } }) : null,
  }
}

function Etapas({ valores, onElegir, desde, hasta, elegida }: { valores: number[]; onElegir: (k: number) => void; desde: string; hasta: string; elegida: number | null }) {
  const total = valores.reduce((a, b) => a + b, 0)
  const max = Math.max(1, ...valores)
  if (!total) return <p className="muted">No hay manifiestos en ese período.</p>
  return (
    <>
      <div className="etapas-barras">{valores.map((v, k) => (
        <button key={k} style={{ ...colorEtapa(k), opacity: elegida == null || elegida === k ? 1 : 0.35 }} onClick={() => onElegir(k)} aria-label={`${ETAPAS[k]}: ${v} manifiestos. Ver la lista`}>
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
