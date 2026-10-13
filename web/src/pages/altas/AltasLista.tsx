import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { traerTodo } from '../../lib/paginar'
import { supabase, mensajeError } from '../../lib/supabase'
import { ENTIDADES, entidad, estadoFicha, ETIQUETA_ESTADO, type EstadoDoc } from '../../lib/altas'
import { useAuth } from '../../auth/AuthProvider'

type Fila = Record<string, unknown> & { id: number }

export function MenuAltas() {
  return (
    <nav className="bar" aria-label="Altas" style={{ marginBottom: 18 }} data-ayuda="altas-secciones">
      {ENTIDADES.map((e) => <NavLink key={e.clave} to={`/altas/${e.clave}`} className="subnav">{e.titulo}</NavLink>)}
    </nav>
  )
}

export default function AltasLista() {
  const { entidad: clave } = useParams()
  const e = entidad(clave)
  const nav = useNavigate()
  const { puedeEditar } = useAuth()
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') ?? ''
  const verBajas = sp.get('bajas') === '1'
  const filtro = (sp.get('estado') ?? '') as EstadoDoc | 'problemas' | ''
  const [filas, setFilas] = useState<Fila[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  const cambiar = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }) }

  useEffect(() => {
    if (!e) return
    setCargando(true)
    const armar = () => {
      let c = supabase.from(e.tabla).select(e.select ?? '*')
      if (!verBajas) c = c.eq(e.activo, true)
      if (q) c = c.ilike(e.nombre, `%${q}%`)
      return c.order(e.nombre).order('id')
    }
    traerTodo<Fila>(armar).then(({ data, error }) => {
      setError(mensajeError(error)); setFilas(data); setCargando(false)
    })
  }, [e, q, verBajas])

  if (!e) return <p>No existe esta sección. <Link to="/altas/camiones">Ir a Altas</Link></p>

  const conEstado = filas.map((f) => ({ f, est: estadoFicha(e, f) }))
  const visibles = conEstado.filter(({ est }) => !filtro || (filtro === 'problemas' ? est && est !== 'vigente' : est === filtro))
  const cuenta = (s: EstadoDoc) => conEstado.filter((x) => x.est === s).length

  return (
    <>
      <MenuAltas />
      <div className="bar" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <h1>{e.titulo}</h1>
        {puedeEditar && <Link to={`/altas/${e.clave}/nuevo`} data-ayuda="altas-agregar"><button className="pri">Agregar {e.singular}</button></Link>}
      </div>
      <p className="sub">{e.ayuda}</p>
      <div className="bar">
        <input type="search" data-ayuda="altas-buscar" placeholder={`Buscar ${e.singular}`} defaultValue={q} onChange={(ev) => cambiar('q', ev.target.value.trim())} style={{ flex: 1, minWidth: 200 }} aria-label="Buscar" />
        {e.documentos.length > 0 && (
          <select value={filtro} onChange={(ev) => cambiar('estado', ev.target.value)} aria-label="Estado de los documentos">
            <option value="">Todos ({conEstado.length})</option>
            <option value="problemas">Con algo para regularizar ({conEstado.length - cuenta('vigente')})</option>
            <option value="vencido">Con documentos vencidos ({cuenta('vencido')})</option>
            <option value="sin_cargar">Con documentos sin cargar ({cuenta('sin_cargar')})</option>
            <option value="por_vencer">Por vencer ({cuenta('por_vencer')})</option>
            <option value="vigente">Al día ({cuenta('vigente')})</option>
          </select>)}
        <label className="small"><input type="checkbox" checked={verBajas} onChange={(ev) => cambiar('bajas', ev.target.checked ? '1' : '')} /> Ver dados de baja</label>
      </div>
      <div className="card">
        {error && <div className="aviso bad">{error}</div>}
        {cargando ? <p className="cargando">Cargando…</p> : visibles.length === 0 ? (
          <p className="vacio">No hay {e.titulo.toLowerCase()} con ese criterio.{puedeEditar && <> <Link to={`/altas/${e.clave}/nuevo`}>Agregar {e.singular}</Link></>}</p>
        ) : (
          <div className="tw"><table>
            <thead><tr><th>{e.campos[0].label}</th>{e.columnas?.map((c) => <th key={c.k}>{c.label}</th>)}{e.documentos.length > 0 && <th>Documentos</th>}</tr></thead>
            <tbody>{visibles.map(({ f, est }) => (
              <tr key={f.id} className="fila" tabIndex={0} onClick={() => nav(`/altas/${e.clave}/${f.id}`)} onKeyDown={(ev) => ev.key === 'Enter' && nav(`/altas/${e.clave}/${f.id}`)}>
                <td><b>{String(f[e.nombre] ?? '')}</b>{f[e.activo] === false && <span className="pill" style={{ marginLeft: 6 }}>Dado de baja</span>}</td>
                {e.columnas?.map((c) => {
                  const v = f[c.k] as Record<string, unknown> | string | null
                  return <td key={c.k}>{c.ref ? String((v as Record<string, unknown> | null)?.[c.ref] ?? '—') : String(v ?? '—')}</td>
                })}
                {est && <td><span className={`pill ${ETIQUETA_ESTADO[est][1]}`}>{ETIQUETA_ESTADO[est][0]}</span></td>}
              </tr>))}
            </tbody>
          </table></div>)}
      </div>
    </>
  )
}
