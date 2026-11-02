import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, mensajeError } from '../lib/supabase'
import { ETAPAS, etapaManifiesto, fd, fnum, hoy, num, umL } from '../lib/formato'
import { traerTodo } from '../lib/paginar'
import { exportarExcel } from '../lib/excel'
import type { Manifiesto } from '../lib/tipos'
import { MiniEtapa, PillEtapa } from '../components/Etapa'

const POR_PAGINA = 50

interface Op { id: number; nombre: string }
const FILTROS = ['etapa', 'desde', 'hasta', 'planta', 'transp', 'gen', 'corr', 'tipo', 'anulados']

export default function Manifiestos() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const g = (k: string) => sp.get(k) ?? ''
  const q = g('q'), etapa = g('etapa'), desde = g('desde'), hasta = g('hasta')
  const planta = g('planta'), transp = g('transp'), gen = g('gen'), corr = g('corr'), tipo = g('tipo')
  const anulados = sp.get('anulados') === '1', pagina = Number(sp.get('p') ?? 0)
  const [lista, setLista] = useState<Manifiesto[]>([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [exportando, setExportando] = useState(false)
  const [error, setError] = useState('')
  const [texto, setTexto] = useState(q)
  const [plantas, setPlantas] = useState<Op[]>([])
  const [transportistas, setTransportistas] = useState<Op[]>([])
  const [generadores, setGeneradores] = useState<Op[]>([])
  const [corrientes, setCorrientes] = useState<{ id: number; codigo: string }[]>([])
  const [genTexto, setGenTexto] = useState('')

  // react-router puede dar un "sp" viejo: se parte siempre de la dirección actual
  const cambiar = (k: string, v: string) => { const n = new URLSearchParams(window.location.search); if (v) n.set(k, v); else n.delete(k); n.delete('p'); setSp(n) }
  const activos = FILTROS.some((k) => sp.get(k))
  const limpiar = () => { const n = new URLSearchParams(); if (q) n.set('q', q); setSp(n); setGenTexto('') }

  useEffect(() => { const t = setTimeout(() => { if (texto !== q) cambiar('q', texto.trim()) }, 350); return () => clearTimeout(t) })
  useEffect(() => {
    supabase.from('generadores_principales').select('id, nombre').order('nombre').then(({ data }) => setPlantas(data ?? []))
    supabase.from('transportistas').select('id, nombre').order('nombre').then(({ data }) => setTransportistas(data ?? []))
    supabase.from('corrientes').select('id, codigo').order('codigo').then(({ data }) => setCorrientes(data ?? []))
    traerTodo<Op>(() => supabase.from('generadores').select('id, nombre').order('nombre').order('id')).then(({ data }) => setGeneradores(data))
  }, [])
  const genNombre = generadores.find((x) => String(x.id) === gen)?.nombre ?? ''
  useEffect(() => { setGenTexto(genNombre) }, [genNombre])

  /** La misma búsqueda para la pantalla y para el Excel */
  function armar(conDetalle: boolean) {
    // Número, código de corriente (Y48, Y9…) o nombre del generador
    const soloNumero = /^[\d\s-]+$/.test(q)
    const corriente = /^y\d/i.test(q)
    const sel = `id, numero, fecha, tipo, anulado, viaje_id, etapa, generadores${q && !soloNumero && !corriente ? '!inner' : ''}(nombre),
      manifiesto_items(estado, cantidad, um, corrientes(codigo))${corriente ? ', filtro:manifiesto_items!inner(corrientes!inner(codigo))' : ''}${corr ? ', fc:manifiesto_items!inner(corriente_id)' : ''}${etapa ? ', et:manifiesto_etapas!inner(etapa)' : ''}${conDetalle ? ', generadores_principales(nombre), transportistas(nombre), choferes(nombre), camiones(patente), direccion_retiro' : ''}`
    let c = supabase.from('manifiestos').select(sel, { count: 'exact' })
    if (q) c = soloNumero ? c.ilike('numero', `%${q.replace(/\D/g, '')}%`)
      : corriente ? c.ilike('filtro.corrientes.codigo', `${q.replace(/\s/g, '')}%`)
      : c.ilike('generadores.nombre', `%${q}%`)
    if (etapa) c = c.eq('et.etapa', Number(etapa))   // la etapa guardada (indexada), no la calculada
    if (corr) c = c.eq('fc.corriente_id', Number(corr))
    if (desde) c = c.gte('fecha', desde)
    if (hasta) c = c.lte('fecha', hasta)
    if (planta) c = c.eq('generador_principal_id', Number(planta))
    if (transp) c = c.eq('transportista_id', Number(transp))
    if (gen) c = c.eq('generador_id', Number(gen))
    if (tipo) c = c.eq('tipo', tipo)
    if (!anulados) c = c.eq('anulado', false)
    return c.order('fecha', { ascending: false }).order('numero', { ascending: false })
  }

  useEffect(() => {
    setCargando(true)
    armar(false).range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1)
      .then(({ data, count, error }) => {
        setError(mensajeError(error)); setLista((data ?? []) as unknown as Manifiesto[]); setTotal(count ?? 0); setCargando(false)
      })
  }, [q, etapa, desde, hasta, planta, transp, gen, corr, tipo, anulados, pagina]) // eslint-disable-line react-hooks/exhaustive-deps

  async function excel() {
    setExportando(true)
    const { data, error } = await traerTodo<Manifiesto & { direccion_retiro: string | null }>(() => armar(true).order('id'), 20000)
    setExportando(false)
    if (error) { setError(mensajeError(error)); return }
    const et = (m: Manifiesto) => m.anulado ? 'Anulado' : m.viaje_id ? 'Formulario del viaje' : ETAPAS[m.etapa ?? etapaManifiesto((m.manifiesto_items ?? []).map((i) => i.estado))]
    const suma = (m: Manifiesto, u: string) => (m.manifiesto_items ?? []).filter((i) => i.um === u).reduce((a, i) => a + Number(i.cantidad), 0) || ''
    exportarExcel<Manifiesto & { direccion_retiro: string | null }>(`Manifiestos ${hoy()}`, [
      { t: 'Manifiesto', v: (m) => fnum(m.numero) }, { t: 'Fecha', v: (m) => m.fecha }, { t: 'Formulario', v: (m) => m.tipo },
      { t: 'Generador', v: (m) => m.generadores?.nombre }, { t: 'Dirección de retiro', v: (m) => m.direccion_retiro },
      { t: 'Planta', v: (m) => m.generadores_principales?.nombre }, { t: 'Transportista', v: (m) => m.transportistas?.nombre },
      { t: 'Dominio', v: (m) => m.camiones?.patente }, { t: 'Chofer', v: (m) => m.choferes?.nombre },
      { t: 'Corrientes', v: (m) => (m.manifiesto_items ?? []).map((i) => i.corrientes?.codigo).join(', ') },
      { t: 'Kilos', v: (m) => suma(m, 'KGS') }, { t: 'Litros', v: (m) => suma(m, 'LTS') }, { t: 'Etapa', v: et },
    ], data)
  }

  const paginas = Math.ceil(total / POR_PAGINA)
  const ir = (p: number) => { const n = new URLSearchParams(window.location.search); n.set('p', String(p)); setSp(n) }

  return (
    <>
      <div className="bar" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <h1>Manifiestos</h1>
        <Link to="/manifiestos/nuevo" data-ayuda="man-nuevo"><button className="pri">Nuevo manifiesto</button></Link>
      </div>
      <p className="sub">Tocá un manifiesto para ver su recorrido completo.</p>
      <div className="bar">
        <input type="search" data-ayuda="man-buscar" placeholder="Buscar por número, generador o corriente" value={texto} onChange={(e) => setTexto(e.target.value)} style={{ flex: 1, minWidth: 220 }} aria-label="Buscar" />
        <button onClick={excel} disabled={exportando || total === 0} data-ayuda="man-excel">{exportando ? 'Preparando…' : 'Exportar a Excel'}</button>
      </div>
      <div className="card filtros" data-ayuda="man-filtros">
        <label className="campo">Desde<input type="date" value={desde} max={hasta || undefined} onChange={(e) => cambiar('desde', e.target.value)} /></label>
        <label className="campo">Hasta<input type="date" value={hasta} min={desde || undefined} onChange={(e) => cambiar('hasta', e.target.value)} /></label>
        <label className="campo">Planta
          <select value={planta} onChange={(e) => cambiar('planta', e.target.value)}><option value="">Todas</option>{plantas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
        <label className="campo">Transportista
          <select value={transp} onChange={(e) => cambiar('transp', e.target.value)}><option value="">Todos</option>{transportistas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
        <label className="campo ancho">Generador
          <input list="man-generadores" value={genTexto} placeholder="Todos"
            onChange={(e) => { setGenTexto(e.target.value); const x = generadores.find((o) => o.nombre === e.target.value); if (x) cambiar('gen', String(x.id)); else if (!e.target.value) cambiar('gen', '') }} />
          <datalist id="man-generadores">{generadores.map((o) => <option key={o.id} value={o.nombre} />)}</datalist></label>
        <label className="campo">Corriente
          <select value={corr} onChange={(e) => cambiar('corr', e.target.value)}><option value="">Todas</option>{corrientes.map((c) => <option key={c.id} value={c.id}>{c.codigo}</option>)}</select></label>
        <label className="campo">Formulario
          <select value={tipo} onChange={(e) => cambiar('tipo', e.target.value)}><option value="">Todos</option><option value="azul">Azul (Serco)</option><option value="rosa">Rosa (otros)</option></select></label>
        <label className="campo">Etapa
          <select value={etapa} onChange={(e) => cambiar('etapa', e.target.value)} aria-label="Etapa">
            <option value="">Todas</option>
            <option value="0">Iniciado (falta la sección 3)</option>
            <option value="1">Almacenado</option>
            <option value="2">En tránsito</option>
            <option value="3">Dispuesto</option>
            <option value="4">Certificado entregado</option>
          </select></label>
        <label className="campo check"><span><input type="checkbox" checked={anulados} onChange={(e) => cambiar('anulados', e.target.checked ? '1' : '')} /> Ver anulados</span></label>
        {activos && <button type="button" className="link limpiar" onClick={limpiar}>Limpiar filtros</button>}
      </div>
      <div className="card">
        {error && <div className="aviso bad">{error}</div>}
        {cargando ? <p className="cargando">Buscando manifiestos…</p> : lista.length === 0 ? <p className="vacio">No hay manifiestos con ese criterio.</p> : (
          <div className="tw"><table>
            <thead><tr><th>Manifiesto</th><th>Fecha</th><th>Generador</th><th>Corrientes</th><th>Cantidad</th><th>Etapa</th></tr></thead>
            <tbody>{lista.map((m) => {
              const it = m.manifiesto_items ?? []
              return (
                <tr key={m.id} className="fila" tabIndex={0} onClick={() => nav(`/manifiestos/${m.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/manifiestos/${m.id}`)}>
                  <td className="nw"><b>{fnum(m.numero)}</b>{m.tipo === 'rosa' && <span className="muted small"> rosa</span>}</td>
                  <td className="nw">{fd(m.fecha)}</td>
                  <td>{m.generadores?.nombre}</td>
                  <td>{it.map((i, n) => <span key={n} className="pill" style={{ margin: '2px 4px 2px 0' }}>{i.corrientes?.codigo}</span>)}</td>
                  <td className="nw">{it.map((i) => `${num(i.cantidad)} ${umL(i.um)}`).join(' + ')}</td>
                  <td>{m.anulado ? <span className="pill bad">Anulado</span> : m.viaje_id ? <span className="pill" title="El Access cargaba el viaje también como manifiesto: no cuenta como retiro">Formulario del viaje</span> : <span className="etapa-celda"><MiniEtapa etapa={m.etapa ?? etapaManifiesto(it.map((i) => i.estado))} /><PillEtapa etapa={m.etapa ?? etapaManifiesto(it.map((i) => i.estado))} /></span>}</td>
                </tr>)
            })}</tbody>
          </table></div>)}
        {!cargando && total > 0 && paginas <= 1 && <p className="muted small" style={{ marginBottom: 0 }}>{num(total)} {total === 1 ? 'manifiesto' : 'manifiestos'}</p>}
        {paginas > 1 && (
          <div className="paginas">
            <span className="muted small">{num(total)} manifiestos · página {pagina + 1} de {num(paginas)}</span>
            <button disabled={pagina === 0} onClick={() => ir(pagina - 1)}>Anterior</button>
            <button disabled={pagina + 1 >= paginas} onClick={() => ir(pagina + 1)}>Siguiente</button>
          </div>)}
      </div>
    </>
  )
}
