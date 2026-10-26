import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { supabase, mensajeError } from '../lib/supabase'
import { traerTodo } from '../lib/paginar'
import { exportarExcel, type Columna } from '../lib/excel'
import { fd, fnum, hoy, num, umL } from '../lib/formato'
import type { UM } from '../lib/tipos'
import Explica, { ExplicarTodo } from '../components/Explica'
import type { Paso } from '../lib/guias'

const REPORTES: Record<string, [string, string]> = {
  producto: ['Cantidad por producto', 'Kilos y litros por corriente, por semana, quincena o mes.'],
  provincial: ['Libro provincial', 'Movimientos de cada planta en el período, listo para rubricar.'],
  nacional: ['Libro nacional', 'Manifiestos Nación con sus residuos y certificados.'],
  transporte: ['Libro de transporte', 'Retiros hechos por cada transportista.'],
  estadisticas: ['Estadísticas', 'Corrientes, generadores y destinos con más volumen.'],
}

/** Qué explica Serquito de cada reporte (el "?" junto al título) */
const QUE_ES: Record<string, string> = {
  producto: 'Suma lo retirado de cada corriente, por semana, quincena o mes, según la fecha del retiro. Se elige la unidad (kilos, litros o metros cúbicos) y se puede filtrar por planta o transportista. No cuentan los manifiestos anulados ni los formularios de viaje que el Access cargaba como retiro. Se exporta a Excel y, si está configurado, llega por mail cada lunes.',
  provincial: 'Es el libro de movimientos de cada planta: un renglón por residuo, con generador, corriente, cantidad y en qué quedó. Se elige la planta y el período, y se imprime para rubricar o se exporta a Excel.',
  nacional: 'Lista los Manifiestos Nación del período, es decir, los viajes al operador de disposición final, con los residuos que llevó cada uno y su certificado cuando ya volvió.',
  transporte: 'Es el libro de cada transportista: todos los retiros que hizo en el período, con el camión, el chofer y lo que llevó.',
  estadisticas: 'Resume el período: cuántos manifiestos y generadores, cuánto se retiró, cómo se reparte entre sólidos, líquidos y barros, y quiénes concentran más volumen.',
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
      <label className="small" data-ayuda="rep-fechas">Desde <input type="date" value={desde} onChange={(e) => set(e.target.value, hasta)} /></label>
      <label className="small">Hasta <input type="date" value={hasta} onChange={(e) => set(desde, e.target.value)} /></label>
      {extra}
      <span style={{ flex: 1 }} />
      {total && <span className="muted small">{total}</span>}
      {onExcel && <button onClick={onExcel} data-ayuda="rep-excel">Exportar a Excel</button>}
      <button onClick={() => window.print()} data-ayuda="rep-imprimir">Imprimir</button>
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
  const [transp, setTransp] = useState('')
  const [transportistas, setTransportistas] = useState<Op[]>([])
  const [mails, setMails] = useState<string | null>(null)
  const [um, setUm] = useState<UM>('KGS')
  const [filas, setFilas] = useState<FilaProd[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('transportistas').select('id, nombre').order('nombre').then(({ data }) => setTransportistas(data ?? []))
    supabase.from('parametros').select('valor').eq('clave', 'mails_reporte_producto').maybeSingle().then(({ data }) => setMails(data?.valor ?? ''))
  }, [])
  useEffect(() => {
    supabase.rpc('reporte_por_producto', { p_desde: d, p_hasta: h, p_agrupar: agrupar, p_planta: planta ? Number(planta) : null, p_transportista: transp ? Number(transp) : null })
      .then(({ data, error }) => { setError(mensajeError(error)); setFilas((data ?? []) as FilaProd[]) })
  }, [d, h, agrupar, planta, transp])

  const enUm = filas.filter((f) => f.um === um)
  const periodos = [...new Set(enUm.map((f) => f.periodo))].sort()
  const corrientes = [...new Set(enUm.map((f) => f.corriente))].sort()
  const valor = (c: string, p: string) => enUm.find((f) => f.corriente === c && f.periodo === p)?.cantidad ?? 0
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const etiqueta = (p: string) => agrupar === 'mes' ? `${MES[+p.slice(5, 7) - 1]} ${p.slice(2, 4)}`
    : agrupar === 'quincena' ? `${p.slice(8, 10) === '01' ? '1ª' : '2ª'} ${MES[+p.slice(5, 7) - 1]}` : `Sem. ${fd(p).slice(0, 5)}`
  const totalC = (c: string) => periodos.reduce((a, p) => a + valor(c, p), 0)
  const totalP = (p: string) => corrientes.reduce((a, c) => a + valor(c, p), 0)
  const maxP = Math.max(1, ...periodos.map(totalP))

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
        <span className="pestanas" role="group" aria-label="Agrupar">{([['semana', 'Semanal'], ['quincena', 'Quincenal'], ['mes', 'Mensual']] as const).map(([v, l]) => (
          <button key={v} type="button" className={agrupar === v ? 'on' : ''} aria-pressed={agrupar === v} onClick={() => setAgrupar(v)}>{l}</button>))}</span>
        <select value={um} onChange={(e) => setUm(e.target.value as UM)} aria-label="Unidad"><option value="KGS">Kilos</option><option value="LTS">Litros</option><option value="MS3">m³</option></select>
        <select value={planta} onChange={(e) => setPlanta(e.target.value)} aria-label="Planta"><option value="">Todas las plantas</option>{plantas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
        <select value={transp} onChange={(e) => setTransp(e.target.value)} aria-label="Transportista"><option value="">Todos los transportistas</option>{transportistas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
      </>} />
      {error && <div className="aviso bad">{error}</div>}
      <div className="card libro">
        <h2 className="solo-imprimir">Cantidad transportada por producto ({umL(um)}) · {fd(d)} al {fd(h)}</h2>
        {corrientes.length === 0 ? <p className="vacio">No hay movimientos en {umL(um)} en el período.</p> : (
          <div className="tw"><table className="compacta piv">
            <thead><tr><th>Corriente</th>{periodos.map((p) => (
              <th key={p} style={{ textAlign: 'right' }}><div className="pbar no-imprimir"><i style={{ height: Math.max(2, (totalP(p) / maxP) * 36) }} title={`${num(Math.round(totalP(p)))} ${umL(um)}`} /></div>{etiqueta(p)}</th>))}
              <th style={{ textAlign: 'right' }}>Total {umL(um)}</th></tr></thead>
            <tbody>{[...corrientes].sort((a, b) => totalC(b) - totalC(a)).map((c) => (
              <tr key={c}><td><b>{c}</b><div className="muted small">{(enUm.find((f) => f.corriente === c)?.descripcion ?? '').slice(0, 40)}</div></td>
                {periodos.map((p) => <td key={p} className="n">{valor(c, p) ? num(Math.round(valor(c, p))) : <span className="muted">·</span>}</td>)}
                <td className="n"><b>{num(Math.round(totalC(c)))}</b></td></tr>))}
              <tr className="tot"><td><b>Total</b></td>{periodos.map((p) => <td key={p} className="n"><b>{num(Math.round(totalP(p)))}</b></td>)}<td className="n"><b>{num(Math.round(periodos.reduce((a, p) => a + totalP(p), 0)))}</b></td></tr>
            </tbody>
          </table></div>)}
        <p className="small muted no-imprimir" style={{ marginBottom: 0 }}>Por fecha de retiro. Cuando Serco pase su planilla actual, se ajustan las columnas para que salga igual.</p>
        {mails !== null && <p className="small no-imprimir" style={{ marginBottom: 0 }}>
          <b>Envío automático:</b> {mails.trim() ? <>cada lunes le llega a {mails} la semana anterior, en kilos y litros.</> : <>no está configurado. Se activa cargando los mails en <NavLink to="/configuracion">Configuración → Parámetros</NavLink> (cuando estén activos los avisos por mail).</>}
        </p>}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Libros provincial y de transporte
interface Mov {
  id: number; numero: string; fecha: string; transportista: string; planta: string | null; generador: string; generador_cuit: string | null
  direccion_retiro: string | null; patente: string | null; chofer: string | null; corriente: string; contenedor: string | null
  cantidad: number; um: UM; estado: string; nacion: string | null; certificado: string | null; certificado_fecha: string | null; operador: string | null
  /** El formulario del viaje que el Access cargaba como retiro: va en el libro (es un formulario usado) pero no suma */
  formulario_viaje?: boolean
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
    { t: 'Fecha', v: (f) => f.fecha }, { t: 'Manifiesto', v: (f) => fnum(f.numero) }, { t: 'Generador', v: (f) => f.formulario_viaje ? `${f.generador} (formulario del viaje)` : f.generador },
    { t: 'CUIT', v: (f) => cuitF(f.generador_cuit) }, { t: 'Transportista', v: (f) => f.transportista }, { t: 'Corriente', v: (f) => f.corriente },
    { t: 'Cantidad', v: (f) => f.cantidad }, { t: 'UM', v: (f) => umL(f.um) }, { t: 'Estado', v: (f) => ESTADO[f.estado] },
    { t: 'Manif. Nación', v: (f) => (f.nacion ? fnum(f.nacion) : '') }, { t: 'Operador', v: (f) => f.operador }, { t: 'Certificado', v: (f) => f.certificado },
  ] : [
    { t: 'Fecha', v: (f) => f.fecha }, { t: 'Manifiesto', v: (f) => fnum(f.numero) }, { t: 'Generador', v: (f) => f.formulario_viaje ? `${f.generador} (formulario del viaje)` : f.generador },
    { t: 'Dirección de retiro', v: (f) => f.direccion_retiro }, { t: 'Dominio', v: (f) => f.patente }, { t: 'Chofer', v: (f) => f.chofer },
    { t: 'Corriente', v: (f) => f.corriente }, { t: 'Contenedor', v: (f) => f.contenedor }, { t: 'Cantidad', v: (f) => f.cantidad },
    { t: 'UM', v: (f) => umL(f.um) }, { t: 'Planta', v: (f) => f.planta },
  ]
  const suman = filas.filter((f) => !f.formulario_viaje), formularios = filas.length - suman.length
  const totales = (['KGS', 'LTS', 'MS3'] as UM[]).map((u) => [u, suman.filter((f) => f.um === u).reduce((a, f) => a + f.cantidad, 0)] as const).filter(([, v]) => v)

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
            <tbody>{filas.map((f) => <tr key={f.id} className={f.formulario_viaje ? 'muted' : undefined}>{cols.map((c) => {
              const v = c.v(f)
              return <td key={c.t} className={c.t === 'Cantidad' ? 'n' : SIN_CORTE.has(c.t) ? 'nw' : undefined}>{c.t === 'Fecha' ? fd(String(v)) : typeof v === 'number' ? num(v) : v}</td>
            })}</tr>)}</tbody>
          </table></div>)}
        {totales.length > 0 && <p style={{ marginBottom: 0 }}><b>Total:</b> {totales.map(([u, v]) => `${num(Math.round(v))} ${umL(u)}`).join(' · ')}{formularios > 0 && <span className="muted small"> · sin los {num(formularios)} renglones de formularios de viaje, que ya están en los manifiestos de los clientes</span>}</p>}
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
  corrientes: Rank[]; generadores_top: Rank[]; destinos: Rank[]; plantas?: Rank[]; estado_fisico?: Rank[]; por_mes: { mes: string; kgs: number | null; lts: number | null }[] }

/** Ranking con barras horizontales: una sola serie, un solo color, el valor escrito al lado */
const cant = (x: Rank) => (x.um === 'KGS' ? `${num(Math.round(x.total / 1000))} toneladas` : `${num(Math.round(x.total))} ${umL(x.um)}`)
function explicaRanking(titulo: string, l: Rank[], foco: string): Paso | null {
  if (!l.length) return null
  const u = l[0].um, mismos = l.filter((x) => x.um === u), tot = mismos.reduce((a, x) => a + x.total, 0) || 1
  const top3 = mismos.slice(0, 3), pc3 = Math.round((top3.reduce((a, x) => a + x.total, 0) / tot) * 100)
  return { titulo, foco, texto: `Ordenado de mayor a menor. Primero está ${l[0].nombre}, con ${cant(l[0])}. Entre los tres primeros (${top3.map((x) => x.nombre).join(', ')}) suman el ${pc3} % de lo que muestra esta lista. Cada barra es proporcional al primero.` }
}

function Ranking({ titulo, l, ayuda }: { titulo: string; l: Rank[]; ayuda: string }) {
  const max = Math.max(1, ...l.map((x) => x.total))
  return (
    <div className="card" data-ayuda={ayuda}>
      <h2>{titulo}{l.length > 0 && <Explica titulo={titulo} paso={() => explicaRanking(titulo, l, ayuda)} />}</h2>
      {l.length === 0 ? <p className="muted">Sin datos en el período.</p> : (
        <div className="ranking">{l.map((x) => (
          <div key={x.nombre + x.um} className="rk" title={`${x.nombre}: ${num(Math.round(x.total))} ${umL(x.um)}`}>
            <span className="rk-n">{x.nombre}</span>
            <span className="rk-b"><i style={{ width: `${Math.max(2, (x.total / max) * 100)}%` }} /></span>
            <span className="rk-v">{x.um === 'KGS' ? `${num(Math.round(x.total / 1000))} t` : `${num(Math.round(x.total))} ${umL(x.um)}`}</span>
          </div>))}
        </div>)}
    </div>
  )
}

/** Sólidos, líquidos y barros: una barra apilada por unidad, con el porcentaje escrito */
function EstadoFisico({ l }: { l: Rank[] }) {
  const COLOR: Record<string, string> = { 'SÓLIDO': 'var(--s3)', 'LÍQUIDO': 'var(--s1)', 'SEMISÓLIDO': 'var(--s0)' }
  const NOMBRE: Record<string, string> = { 'SÓLIDO': 'Sólidos', 'LÍQUIDO': 'Líquidos', 'SEMISÓLIDO': 'Barros (semisólidos)' }
  const unidades = [...new Set(l.map((x) => x.um))]
  return (
    <div className="card mt" data-ayuda="est-estado">
      <h2>Sólidos, líquidos y barros<Explica titulo="Sólidos, líquidos y barros" paso={() => explicaEstado(l)} /></h2>
      {unidades.map((u) => {
        const ORDEN = ['SÓLIDO', 'LÍQUIDO', 'SEMISÓLIDO']
        const filas = l.filter((x) => x.um === u).sort((a, b) => (ORDEN.indexOf(a.nombre) + 9) % 9 - (ORDEN.indexOf(b.nombre) + 9) % 9)
        const tot = filas.reduce((a, x) => a + x.total, 0) || 1
        return (
          <div key={u} style={{ marginBottom: 10 }}>
            {unidades.length > 1 && <div className="muted small" style={{ marginBottom: 4 }}>En {u === 'KGS' ? 'kilos' : u === 'LTS' ? 'litros' : 'm³'}</div>}
            <div className="apilada">{filas.map((x) => <span key={x.nombre} style={{ width: `${(x.total / tot) * 100}%`, background: COLOR[x.nombre] ?? 'var(--mute)' }} title={`${NOMBRE[x.nombre] ?? x.nombre}: ${num(Math.round(x.total))} ${umL(u)}`} />)}</div>
            <div className="leyenda" style={{ flexWrap: 'wrap' }}>{filas.map((x) => (
              <span key={x.nombre}><i className="punto-c" style={{ background: COLOR[x.nombre] ?? 'var(--mute)' }} /><b>{NOMBRE[x.nombre] ?? x.nombre}</b> {num(Math.round(u === 'KGS' ? x.total / 1000 : x.total))} {u === 'KGS' ? 't' : umL(u)} · {Math.round((x.total / tot) * 100)} %</span>))}
            </div>
          </div>)
      })}
      <p className="small muted" style={{ margin: 0 }}>Según el estado físico de cada corriente.</p>
    </div>
  )
}

function explicaEstado(l: Rank[]): Paso {
  const NOMBRE: Record<string, string> = { 'SÓLIDO': 'sólidos', 'LÍQUIDO': 'líquidos', 'SEMISÓLIDO': 'barros' }
  const kg = l.filter((x) => x.um === 'KGS'), tot = kg.reduce((a, x) => a + x.total, 0) || 1
  const partes = [...kg].sort((a, b) => b.total - a.total).map((x) => `${NOMBRE[x.nombre] ?? x.nombre.toLowerCase()} el ${Math.round((x.total / tot) * 100)} %`)
  return { titulo: 'Sólidos, líquidos y barros', foco: 'est-estado',
    texto: `Reparte lo retirado según el estado físico de cada corriente${partes.length ? `. De lo que se mide en kilos: ${partes.join(', ')}` : ''}. Cuando una corriente se mide en litros, va en una barra aparte.` }
}

function pasosEstadisticas(e: Est): Paso[] {
  const meses = e.por_mes ?? []
  const mejor = meses.reduce<Est['por_mes'][number] | null>((a, x) => (!a || (x.kgs ?? 0) > (a.kgs ?? 0) ? x : a), null)
  const l = [
    { titulo: 'Los números del período', foco: 'est-kpis',
      texto: `${num(e.manifiestos)} manifiestos de ${num(e.generadores)} generadores. Se retiraron ${num(Math.round((e.totales.KGS ?? 0) / 1000))} toneladas de sólidos y barros y ${num(Math.round(e.totales.LTS ?? 0))} litros de líquidos. No cuentan los anulados ni los formularios de viaje del Access.` },
    meses.length > 1 && mejor ? { titulo: 'Kilos por mes', foco: 'est-meses',
      texto: `Cada barra es un mes. El de más kilos fue ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][+mejor.mes.slice(5, 7) - 1]} de ${mejor.mes.slice(0, 4)}, con ${num(Math.round((mejor.kgs ?? 0) / 1000))} toneladas.` } : null,
    e.estado_fisico ? explicaEstado(e.estado_fisico) : null,
    explicaRanking('Corrientes con más volumen', e.corrientes, 'est-corrientes'),
    explicaRanking('Generadores con más volumen', e.generadores_top, 'est-generadores'),
    explicaRanking('Destinos de disposición final', e.destinos, 'est-destinos'),
  ]
  return l.filter((x): x is Paso => !!x)
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
      <Barra desde={d} hasta={h} set={(a, b) => { setD(a); setH(b) }} extra={e ? <ExplicarTodo titulo="Qué dicen las estadísticas" pasos={() => pasosEstadisticas(e)} texto="Explicame las estadísticas" /> : undefined} />
      {error && <div className="aviso bad">{error}</div>}
      {e && <>
        <div className="grid k4" data-ayuda="est-kpis">
          <div className="card kpi"><div className="v">{num(e.manifiestos)}</div><div className="l">manifiestos</div></div>
          <div className="card kpi"><div className="v">{num(e.generadores)}</div><div className="l">generadores atendidos</div></div>
          <div className="card kpi"><div className="v">{num(Math.round((e.totales.KGS ?? 0) / 1000))} t</div><div className="l">de residuos sólidos y semisólidos</div></div>
          <div className="card kpi"><div className="v">{num(Math.round(e.totales.LTS ?? 0))}</div><div className="l">litros de residuos líquidos</div></div>
        </div>
        {meses.length > 1 && (
          <div className="card mt" data-ayuda="est-meses">
            <h2>Kilos retirados por mes<Explica titulo="Kilos por mes" paso={() => pasosEstadisticas(e).find((x) => x.foco === 'est-meses') ?? null} /></h2>
            <div className="meses">{meses.map((m) => (
              <div key={m.mes} className="mes" title={`${m.mes.slice(5)}/${m.mes.slice(0, 4)}: ${num(Math.round(m.kgs ?? 0))} kg`}>
                <span className="mv">{num(Math.round((m.kgs ?? 0) / 1000))} t</span>
                <span className="mb"><i style={{ height: `${Math.max(1, ((m.kgs ?? 0) / maxMes) * 100)}%` }} /></span>
                <span className="ml">{m.mes.slice(5)}/{m.mes.slice(2, 4)}</span>
              </div>))}
            </div>
          </div>)}
        {e.estado_fisico && <EstadoFisico l={e.estado_fisico} />}
        <div className="grid c2 mt">
          <Ranking titulo="Corrientes con más volumen" l={e.corrientes} ayuda="est-corrientes" />
          <Ranking titulo="Generadores con más volumen" l={e.generadores_top} ayuda="est-generadores" />
          <Ranking titulo="Destinos de disposición final" l={e.destinos} ayuda="est-destinos" />
          {e.plantas && <Ranking titulo="Planta que recibe" l={e.plantas} ayuda="est-plantas" />}
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
        <h1>{REPORTES[t][0]}</h1>
        <p className="sub titulo-explica">{REPORTES[t][1]}<Explica titulo={REPORTES[t][0]} paso={() => ({ titulo: REPORTES[t][0], texto: QUE_ES[t], foco: 'rep-tipos' })} /></p>
        <nav className="bar" aria-label="Reportes" style={{ marginBottom: 18 }} data-ayuda="rep-tipos">
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
