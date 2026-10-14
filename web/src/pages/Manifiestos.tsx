import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, mensajeError } from '../lib/supabase'
import { etapaManifiesto, fd, fnum, num, umL } from '../lib/formato'
import type { Manifiesto } from '../lib/tipos'
import { MiniEtapa, PillEtapa } from '../components/Etapa'

const POR_PAGINA = 50

export default function Manifiestos() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') ?? '', etapa = sp.get('etapa') ?? '', desde = sp.get('desde') ?? '', hasta = sp.get('hasta') ?? ''
  const anulados = sp.get('anulados') === '1', pagina = Number(sp.get('p') ?? 0)
  const [lista, setLista] = useState<Manifiesto[]>([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [texto, setTexto] = useState(q)

  const cambiar = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); n.delete('p'); setSp(n) }

  useEffect(() => { const t = setTimeout(() => { if (texto !== q) cambiar('q', texto.trim()) }, 350); return () => clearTimeout(t) })

  useEffect(() => {
    setCargando(true)
    // Número, código de corriente (Y48, Y9…) o nombre del generador
    const soloNumero = /^[\d\s-]+$/.test(q)
    const corriente = /^y\d/i.test(q)
    const sel = `id, numero, fecha, tipo, anulado, etapa, generadores${q && !soloNumero && !corriente ? '!inner' : ''}(nombre),
      manifiesto_items(estado, cantidad, um, corrientes(codigo))${corriente ? ', filtro:manifiesto_items!inner(corrientes!inner(codigo))' : ''}${etapa ? ', et:manifiesto_etapas!inner(etapa)' : ''}`
    let c = supabase.from('manifiestos').select(sel, { count: 'exact' })
    if (q) c = soloNumero ? c.ilike('numero', `%${q.replace(/\D/g, '')}%`)
      : corriente ? c.ilike('filtro.corrientes.codigo', `${q.replace(/\s/g, '')}%`)
      : c.ilike('generadores.nombre', `%${q}%`)
    if (etapa) c = c.eq('et.etapa', Number(etapa))   // la etapa guardada (indexada), no la calculada
    if (desde) c = c.gte('fecha', desde)
    if (hasta) c = c.lte('fecha', hasta)
    if (!anulados) c = c.eq('anulado', false)
    c.order('fecha', { ascending: false }).order('numero', { ascending: false })
      .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1)
      .then(({ data, count, error }) => {
        setError(mensajeError(error)); setLista((data ?? []) as unknown as Manifiesto[]); setTotal(count ?? 0); setCargando(false)
      })
  }, [q, etapa, desde, hasta, anulados, pagina])

  const paginas = Math.ceil(total / POR_PAGINA)
  const ir = (p: number) => { const n = new URLSearchParams(sp); n.set('p', String(p)); setSp(n) }

  return (
    <>
      <div className="bar" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <h1>Manifiestos</h1>
        <Link to="/manifiestos/nuevo" data-ayuda="man-nuevo"><button className="pri">Nuevo manifiesto</button></Link>
      </div>
      <p className="sub">Tocá un manifiesto para ver su recorrido completo.</p>
      <div className="bar">
        <input type="search" data-ayuda="man-buscar" placeholder="Buscar por número, generador o corriente" value={texto} onChange={(e) => setTexto(e.target.value)} style={{ flex: 1, minWidth: 220 }} aria-label="Buscar" />
        <select value={etapa} onChange={(e) => cambiar('etapa', e.target.value)} aria-label="Etapa">
          <option value="">Todas las etapas</option>
          <option value="0">Iniciado (falta la sección 3)</option>
          <option value="1">Almacenado</option>
          <option value="2">En tránsito</option>
          <option value="3">Dispuesto</option>
          <option value="4">Certificado entregado</option>
        </select>
        <label className="small">Desde <input type="date" value={desde} onChange={(e) => cambiar('desde', e.target.value)} /></label>
        <label className="small">Hasta <input type="date" value={hasta} onChange={(e) => cambiar('hasta', e.target.value)} /></label>
        <label className="small"><input type="checkbox" checked={anulados} onChange={(e) => cambiar('anulados', e.target.checked ? '1' : '')} /> Ver anulados</label>
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
                  <td>{m.anulado ? <span className="pill bad">Anulado</span> : <span className="etapa-celda"><MiniEtapa etapa={m.etapa ?? etapaManifiesto(it.map((i) => i.estado))} /><PillEtapa etapa={m.etapa ?? etapaManifiesto(it.map((i) => i.estado))} /></span>}</td>
                </tr>)
            })}</tbody>
          </table></div>)}
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
