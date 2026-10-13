import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { supabase, mensajeError } from '../lib/supabase'
import { traerTodo } from '../lib/paginar'
import { exportarExcel, type Columna } from '../lib/excel'
import { fd, fnum, hoy, num, umL } from '../lib/formato'
import type { UM } from '../lib/tipos'

const REPORTES: Record<string, [string, string]> = {
  producto: ['Cantidad por producto', 'Kilos y litros por corriente, por semana, quincena o mes.'],
  provincial: ['Libro provincial', 'Movimientos de cada planta en el período, listo para rubricar.'],
  nacional: ['Libro nacional', 'Manifiestos Nación con sus residuos y certificados.'],
  transporte: ['Libro de transporte', 'Retiros hechos por cada transportista.'],
  estadisticas: ['Estadísticas', 'Corrientes, generadores y destinos con más volumen.'],
}

const inicioMes = () => hoy().slice(0, 8) + '01'
const inicioAnio = () => hoy().slice(0, 5) + '01-01'
interface Op { id: number; nombre: string }

/** Barra común: período, filtros propios de cada reporte y botones */
function Barra({ desde, hasta, set, extra, onExcel, total }: {
  desde: string; hasta: string; set: (d: string, h: string) => void; extra?: ReactNode; onExcel?: () => void; total?: string
}) {
  return (
    <div className="bar no-imprimir">
      <label className="small">Desde <input type="date" value={desde} onChange={(e) => set(e.target.value, hasta)} /></label>
      <label className="small">Hasta <input type="date" value={hasta} onChange={(e) => set(desde, e.target.value)} /></label>
      {extra}
      <span style={{ flex: 1 }} />
      {total && <span className="muted small">{total}</span>}
      {onExcel && <button onClick={onExcel}>Exportar a Excel</button>}
      <button onClick={() => window.print()}>Imprimir</button>
    </div>
  )
}

function usePlantas() {
  const [l, setL] = useState<Op[]>([])
  useEffect(() => { supabase.from('generadores_principales').select('id, nombre').order('nombre').then(({ data }) => setL(data ?? [])) }, [])
  return l
}

// ---------------------------------------------------------------- Cantidad por producto
interface FilaProd { periodo: string; corriente: string; descripcion: string | null; um: UM; cantidad: number; residuos: number }

function PorProducto() {
  const plantas = usePlantas()
  const [d, setD] = useState(inicioAnio()), [h, setH] = useState(hoy())
  const [agrupar, setAgrupar] = useState<'semana' | 'quincena' | 'mes'>('mes')
  const [planta, setPlanta] = useState('')
  const [um, setUm] = useState<UM>('KGS')
  const [filas, setFilas] = useState<FilaProd[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.rpc('reporte_por_producto', { p_desde: d, p_hasta: h, p_agrupar: agrupar, p_planta: planta ? Number(planta) : null })
      .then(({ data, error }) => { setError(mensajeError(error)); setFilas((data ?? []) as FilaProd[]) })
  }, [d, h, agrupar, planta])

  const enUm = filas.filter((f) => f.um === um)
  const periodos = [...new Set(enUm.map((f) => f.periodo))].sort()
  const corrientes = [...new Set(enUm.map((f) => f.corriente))].sort()
  const valor = (c: string, p: string) => enUm.find((f) => f.corriente === c && f.periodo === p)?.cantidad ?? 0
  const etiqueta = (p: string) => agrupar === 'mes' ? `${p.slice(5, 7)}/${p.slice(0, 4)}`
    : agrupar === 'quincena' ? `${p.slice(8, 10) === '01' ? '1ª' : '2ª'} ${p.slice(5, 7)}/${p.slice(2, 4)}` : `Sem. ${fd(p).slice(0, 5)}`
  const totalC = (c: string) => periodos.reduce((a, p) => a + valor(c, p), 0)
  const totalP = (p: string) => corrientes.reduce((a, c) => a + valor(c, p), 0)

  function excel() {
    exportarExcel<string>(`Cantidad por producto ${d} a ${h}`, [
      { t: 'Corriente', v: (c) => c },
      { t: 'Descripción', v: (c) => enUm.find((f) => f.corriente === c)?.descripcion },
      ...periodos.map((p) => ({ t: etiqueta(p), v: (c: string) => valor(c, p) })),
      { t: `Total (${umL(um)})`, v: (c) => totalC(c) },
    ], corrientes)
  }

  return (
    <>
      <Barra desde={d} hasta={h} set={(a, b) => { setD(a); setH(b) }} onExcel={excel} extra={<>
        <select value={agrupar} onChange={(e) => setAgrupar(e.target.value as typeof agrupar)} aria-label="Agrupar"><option value="semana">Por semana</option><option value="quincena">Por quincena</option><option value="mes">Por mes</option></select>
        <select value={um} onChange={(e) => setUm(e.target.value as UM)} aria-label="Unidad"><option value="KGS">Kilos</option><option value="LTS">Litros</option><option value="MS3">m³</option></select>
        <select value={planta} onChange={(e) => setPlanta(e.target.value)} aria-label="Planta"><option value="">Todas las plantas</option>{plantas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
      </>} />
      {error && <div className="aviso bad">{error}</div>}
      <div className="card libro">
        <h2 className="solo-imprimir">Cantidad transportada por producto ({umL(um)}) · {fd(d)} al {fd(h)}</h2>
        {corrientes.length === 0 ? <p className="vacio">No hay movimientos en {umL(um)} en el período.</p> : (
          <div className="tw"><table className="compacta">
            <thead><tr><th>Corriente</th>{periodos.map((p) => <th key={p} style={{ textAlign: 'right' }}>{etiqueta(p)}</th>)}<th style={{ textAlign: 'right' }}>Total</th></tr></thead>
            <tbody>{corrientes.map((c) => (
              <tr key={c}><td><b>{c}</b></td>{periodos.map((p) => <td key={p} className="n">{valor(c, p) ? num(Math.round(valor(c, p))) : ''}</td>)}<td className="n"><b>{num(Math.round(totalC(c)))}</b></td></tr>))}
              <tr><td><b>Total</b></td>{periodos.map((p) => <td key={p} className="n"><b>{num(Math.round(totalP(p)))}</b></td>)}<td className="n"><b>{num(Math.round(periodos.reduce((a, p) => a + totalP(p), 0)))}</b></td></tr>
            </tbody>
          </table></div>)}
        <p className="small muted no-imprimir" style={{ marginBottom: 0 }}>Por fecha de retiro. Cuando Serco pase su planilla actual, se ajustan las columnas para que salga igual.</p>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Libros provincial y de transporte
interface Mov {
  id: number; numero: string; fecha: string; transportista: string; planta: string | null; generador: string; generador_cuit: string | null
  direccion_retiro: string | null; patente: string | null; chofer: string | null; corriente: string; contenedor: string | null
  cantidad: number; um: UM; estado: string; nacion: string | null; certificado: string | null; certificado_fecha: string | null; operador: string | null
}
const SIN_CORTE = new Set(['Fecha', 'Manifiesto', 'CUIT', 'Manif. Nación', 'Certificado', 'Dominio', 'UM', 'Corriente', 'Estado'])
const ESTADO: Record<string, string> = { almacenado: 'Almacenado', en_transito: 'En tránsito', disposicion_final: 'Dispuesto' }
const cuitF = (c: string | null) => (c && /^\d{11}$/.test(c) ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c ?? '')

function LibroMovimientos({ tipo }: { tipo: 'provincial' | 'transporte' }) {
  const plantas = usePlantas()
  const [transportistas, setTransportistas] = useState<Op[]>([])
  const [d, setD] = useState(inicioMes()), [h, setH] = useState(hoy())
  const [filtro, setFiltro] = useState('')
  const [filas, setFilas] = useState<Mov[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const opciones = tipo === 'provincial' ? plantas : transportistas

  useEffect(() => {
    if (tipo === 'transporte') supabase.from('transportistas').select('id, nombre').order('nombre').then(({ data }) => setTransportistas(data ?? []))
  }, [tipo])
  useEffect(() => {
    if (filtro || !opciones.length) return
    setFiltro(String((opciones.find((o) => o.nombre === 'SERCO AMBIENTAL SA') ?? opciones[0]).id))
  }, [opciones, filtro])

  useEffect(() => {
    if (!filtro) return
    setCargando(true)
    const col = tipo === 'provincial' ? 'generador_principal_id' : 'transportista_id'
    traerTodo<Mov>(() => supabase.from('libro_movimientos').select('*').eq(col, Number(filtro)).gte('fecha', d).lte('fecha', h)
      .order('fecha').order('numero').order('id'))
      .then(({ data, error }) => { setError(mensajeError(error)); setFilas(data); setCargando(false) })
  }, [tipo, filtro, d, h])

  const nombre = opciones.find((o) => String(o.id) === filtro)?.nombre ?? ''
  const cols: Columna<Mov>[] = tipo === 'provincial' ? [
    { t: 'Fecha', v: (f) => f.fecha }, { t: 'Manifiesto', v: (f) => fnum(f.numero) }, { t: 'Generador', v: (f) => f.generador },
    { t: 'CUIT', v: (f) => cuitF(f.generador_cuit) }, { t: 'Transportista', v: (f) => f.transportista }, { t: 'Corriente', v: (f) => f.corriente },
    { t: 'Cantidad', v: (f) => f.cantidad }, { t: 'UM', v: (f) => umL(f.um) }, { t: 'Estado', v: (f) => ESTADO[f.estado] },
    { t: 'Manif. Nación', v: (f) => (f.nacion ? fnum(f.nacion) : '') }, { t: 'Operador', v: (f) => f.operador }, { t: 'Certificado', v: (f) => f.certificado },
  ] : [
    { t: 'Fecha', v: (f) => f.fecha }, { t: 'Manifiesto', v: (f) => fnum(f.numero) }, { t: 'Generador', v: (f) => f.generador },
    { t: 'Dirección de retiro', v: (f) => f.direccion_retiro }, { t: 'Dominio', v: (f) => f.patente }, { t: 'Chofer', v: (f) => f.chofer },
    { t: 'Corriente', v: (f) => f.corriente }, { t: 'Contenedor', v: (f) => f.contenedor }, { t: 'Cantidad', v: (f) => f.cantidad },
    { t: 'UM', v: (f) => umL(f.um) }, { t: 'Planta', v: (f) => f.planta },
  ]
  const totales = (['KGS', 'LTS', 'MS3'] as UM[]).map((u) => [u, filas.filter((f) => f.um === u).reduce((a, f) => a + f.cantidad, 0)] as const).filter(([, v]) => v)

  return (
    <>
      <Barra desde={d} hasta={h} set={(a, b) => { setD(a); setH(b) }} total={`${num(filas.length)} residuos`}
        onExcel={() => exportarExcel(`${REPORTES[tipo][0]} ${nombre} ${d} a ${h}`, cols, filas)}
        extra={<select value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label={tipo === 'provincial' ? 'Planta' : 'Transportista'}>
          {opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>} />
      {error && <div className="aviso bad">{error}</div>}
      <div className="card libro">
        <h2>{REPORTES[tipo][0]} · {nombre} · {fd(d)} al {fd(h)}</h2>
        {cargando ? <p className="cargando">Cargando…</p> : filas.length === 0 ? <p className="vacio">Sin movimientos en el período.</p> : (
          <div className="tw"><table className="compacta">
            <thead><tr>{cols.map((c) => <th key={c.t} style={c.t === 'Cantidad' ? { textAlign: 'right' } : undefined}>{c.t}</th>)}</tr></thead>
            <tbody>{filas.map((f) => <tr key={f.id}>{cols.map((c) => {
              const v = c.v(f)
              return <td key={c.t} className={c.t === 'Cantidad' ? 'n' : SIN_CORTE.has(c.t) ? 'nw' : undefined}>{c.t === 'Fecha' ? fd(String(v)) : typeof v === 'number' ? num(v) : v}</td>
            })}</tr>)}</tbody>
          </table></div>)}
        {totales.length > 0 && <p style={{ marginBottom: 0 }}><b>Total:</b> {totales.map(([u, v]) => `${num(Math.round(v))} ${umL(u)}`).join(' · ')}</p>}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Libro nacional
interface Nac { id: number; numero: string; fecha: string; operador: string | null; transportista: string | null; planta: string | null
  residuos: number; corrientes: string | null; kgs: number | null; lts: number | null; certificados: string | null; certificado_fecha: string | null; cerrado: boolean | null }

function LibroNacional() {
  const [d, setD] = useState(inicioMes()), [h, setH] = useState(hoy())
  const [filas, setFilas] = useState<Nac[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    setCargando(true)
    traerTodo<Nac>(() => supabase.from('libro_nacional').select('*').gte('fecha', d).lte('fecha', h).order('fecha').order('numero'))
      .then(({ data, error }) => { setError(mensajeError(error)); setFilas(data); setCargando(false) })
  }, [d, h])
  const cols: Columna<Nac>[] = [
    { t: 'Fecha', v: (f) => f.fecha }, { t: 'Manif. Nación', v: (f) => fnum(f.numero) }, { t: 'Operador', v: (f) => f.operador },
    { t: 'Transportista', v: (f) => f.transportista }, { t: 'Planta', v: (f) => f.planta }, { t: 'Corrientes', v: (f) => f.corrientes },
    { t: 'Kilos', v: (f) => f.kgs }, { t: 'Litros', v: (f) => f.lts }, { t: 'Certificado', v: (f) => f.certificados }, { t: 'Fecha certificado', v: (f) => f.certificado_fecha },
  ]
  return (
    <>
      <Barra desde={d} hasta={h} set={(a, b) => { setD(a); setH(b) }} total={`${num(filas.length)} Manifiestos Nación`}
        onExcel={() => exportarExcel(`Libro nacional ${d} a ${h}`, cols, filas)} />
      {error && <div className="aviso bad">{error}</div>}
      <div className="card libro">
        <h2>Libro nacional · {fd(d)} al {fd(h)}</h2>
        {cargando ? <p className="cargando">Cargando…</p> : filas.length === 0 ? <p className="vacio">Sin Manifiestos Nación en el período.</p> : (
          <div className="tw"><table className="compacta">
            <thead><tr><th>Fecha</th><th>Manif. Nación</th><th>Operador</th><th>Transportista</th><th>Corrientes</th>
              <th style={{ textAlign: 'right' }}>Kilos</th><th style={{ textAlign: 'right' }}>Litros</th><th>Certificado</th></tr></thead>
            <tbody>{filas.map((f) => (
              <tr key={f.id}><td className="nw">{fd(f.fecha)}</td><td className="nw"><b>{fnum(f.numero)}</b></td><td>{f.operador ?? '—'}</td><td>{f.transportista ?? '—'}</td>
                <td>{f.corrientes}</td><td className="n">{f.kgs ? num(f.kgs) : ''}</td><td className="n">{f.lts ? num(f.lts) : ''}</td>
                <td className="nw">{f.certificados ? `${f.certificados} · ${fd(f.certificado_fecha)}` : <span className="pill haz">Pendiente</span>}</td></tr>))}
            </tbody>
          </table></div>)}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Estadísticas
interface Rank { nombre: string; um: UM; total: number }
interface Est { manifiestos: number; generadores: number; residuos: number; totales: Partial<Record<UM, number>>
  corrientes: Rank[]; generadores_top: Rank[]; destinos: Rank[]; por_mes: { mes: string; kgs: number | null; lts: number | null }[] }

/** Ranking con barras horizontales: una sola serie, un solo color, el valor escrito al lado */
function Ranking({ titulo, l }: { titulo: string; l: Rank[] }) {
  const max = Math.max(1, ...l.map((x) => x.total))
  return (
    <div className="card">
      <h2>{titulo}</h2>
      {l.length === 0 ? <p className="muted">Sin datos en el período.</p> : (
        <div className="ranking">{l.map((x) => (
          <div key={x.nombre + x.um} className="rk" title={`${x.nombre}: ${num(Math.round(x.total))} ${umL(x.um)}`}>
            <span className="rk-n">{x.nombre}</span>
            <span className="rk-b"><i style={{ width: `${Math.max(2, (x.total / max) * 100)}%` }} /></span>
            <span className="rk-v">{num(Math.round(x.total))} {umL(x.um)}</span>
          </div>))}
        </div>)}
    </div>
  )
}

function Estadisticas() {
  const [d, setD] = useState(inicioAnio()), [h, setH] = useState(hoy())
  const [e, setE] = useState<Est | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    supabase.rpc('estadisticas', { p_desde: d, p_hasta: h }).then(({ data, error }) => { setError(mensajeError(error)); setE(data as Est) })
  }, [d, h])
  const meses = e?.por_mes ?? []
  const maxMes = useMemo(() => Math.max(1, ...meses.map((m) => m.kgs ?? 0)), [meses])
  return (
    <>
      <Barra desde={d} hasta={h} set={(a, b) => { setD(a); setH(b) }} />
      {error && <div className="aviso bad">{error}</div>}
      {e && <>
        <div className="grid k4">
          <div className="card kpi"><div className="v">{num(e.manifiestos)}</div><div className="l">manifiestos</div></div>
          <div className="card kpi"><div className="v">{num(e.generadores)}</div><div className="l">generadores atendidos</div></div>
          <div className="card kpi"><div className="v">{num(Math.round((e.totales.KGS ?? 0) / 1000))} t</div><div className="l">de residuos sólidos y semisólidos</div></div>
          <div className="card kpi"><div className="v">{num(Math.round(e.totales.LTS ?? 0))}</div><div className="l">litros de residuos líquidos</div></div>
        </div>
        {meses.length > 1 && (
          <div className="card mt">
            <h2>Kilos retirados por mes</h2>
            <div className="meses">{meses.map((m) => (
              <div key={m.mes} className="mes" title={`${m.mes.slice(5)}/${m.mes.slice(0, 4)}: ${num(Math.round(m.kgs ?? 0))} kg`}>
                <span className="mv">{num(Math.round((m.kgs ?? 0) / 1000))} t</span>
                <span className="mb"><i style={{ height: `${Math.max(1, ((m.kgs ?? 0) / maxMes) * 100)}%` }} /></span>
                <span className="ml">{m.mes.slice(5)}/{m.mes.slice(2, 4)}</span>
              </div>))}
            </div>
          </div>)}
        <div className="grid c3 mt">
          <Ranking titulo="Corrientes con más volumen" l={e.corrientes} />
          <Ranking titulo="Generadores con más volumen" l={e.generadores_top} />
          <Ranking titulo="Destinos de disposición final" l={e.destinos} />
        </div>
      </>}
    </>
  )
}

export default function Reportes() {
  const { tipo } = useParams()
  const t = tipo && REPORTES[tipo] ? tipo : 'producto'
  useEffect(() => { document.body.classList.add('modo-libro'); return () => document.body.classList.remove('modo-libro') }, [])
  return (
    <>
      <div className="no-imprimir">
        <h1>Reportes</h1>
        <p className="sub">{REPORTES[t][1]}</p>
        <nav className="bar" aria-label="Reportes" style={{ marginBottom: 18 }}>
          {Object.entries(REPORTES).map(([k, [n]]) => <NavLink key={k} to={`/reportes/${k}`} className={`subnav ${k === t ? 'active' : ''}`}>{n}</NavLink>)}
        </nav>
      </div>
      {t === 'producto' && <PorProducto />}
      {t === 'provincial' && <LibroMovimientos key="p" tipo="provincial" />}
      {t === 'transporte' && <LibroMovimientos key="t" tipo="transporte" />}
      {t === 'nacional' && <LibroNacional />}
      {t === 'estadisticas' && <Estadisticas />}
    </>
  )
}
