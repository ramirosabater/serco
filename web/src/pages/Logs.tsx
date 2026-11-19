import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, mensajeError } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import SubmenuConfiguracion from '../components/SubmenuConfiguracion'

// Logs del sistema (solo administradores): quién creó, cambió o borró qué y cuándo.
// Sale del historial que guarda la base en cada cambio; lo arma la función logs_sistema.

interface Fila { id: number; fecha: string; usuario: string; tabla: string; accion: 'alta' | 'cambio' | 'baja'; registro: string; que: string; enlace: string | null; cambios: Record<string, [unknown, unknown]> | null }

const QUE: [string, string][] = [
  ['', 'Todo'], ['manifiestos', 'Manifiestos'], ['manifiesto_items', 'Residuos (sección 3)'], ['manifiestos_nacion', 'Manifiestos Nación'],
  ['certificados', 'Certificados del operador'], ['generadores', 'Clientes'], ['generador_direcciones', 'Direcciones de retiro'],
  ['camiones', 'Camiones'], ['choferes', 'Choferes'], ['transportistas', 'Transportistas'], ['operadores', 'Operadores'],
  ['generadores_principales', 'Plantas'], ['corrientes', 'Corrientes'], ['perfiles', 'Usuarios'], ['periodos_presentados', 'Libros presentados'],
]
const ACCION: Record<Fila['accion'], [string, string]> = { alta: ['Alta', 'ok'], cambio: ['Cambio', 'haz'], baja: ['Baja', 'bad'] }

/** Nombre legible de los campos más comunes */
const CAMPO: Record<string, string> = {
  numero: 'Número', fecha: 'Fecha', nota: 'Nota', anulado: 'Anulado', anulado_motivo: 'Motivo de anulación', direccion_retiro: 'Dirección de retiro',
  generador_id: 'Cliente (id)', transportista_id: 'Transportista (id)', chofer_id: 'Chofer (id)', camion_id: 'Camión (id)', generador_principal_id: 'Planta (id)',
  ingreso_planta: 'Ingreso a planta', escaneo: 'Escaneo', cantidad: 'Cantidad', cant_estimada: 'Cant. estimada', um: 'Unidad', contenedor: 'Contenedor',
  corriente_id: 'Corriente (id)', estado: 'Estado', salvado: 'Salvado con *', manifiesto_nacion_id: 'Manifiesto Nación (id)', certificado_id: 'Certificado (id)',
  cert_rp_nro: 'Certificado de Serco Nº', rpg_nro: 'RPGyOSP', fecha_listado: 'Fecha de listado', archivo: 'Archivo', nombre: 'Nombre', cuit: 'CUIT',
  email: 'Mail', rol: 'Rol', activo: 'Activo', patente: 'Patente', hab_mun_nro: 'Hab. de generador Nº', hab_mun_vto: 'Hab. de generador vence',
  convenio_vto: 'Convenio vence', carga_pel_vto: 'Carga peligrosa vence', carga_pel_tramite: 'Carga peligrosa en trámite', carnet_vto: 'Carnet vence',
  sep_vto: 'Psicofísico vence', vtv_vto: 'VTV vence', residuos_previstos: 'Corrientes al emitir', validacion_omitida: 'Emitido con vencimientos (motivo)',
}

function valor(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
  if (typeof v === 'object') { const t = JSON.stringify(v); return t.length > 120 ? t.slice(0, 120) + '…' : t }
  return String(v)
}
const hace = (dias: number) => { const d = new Date(); d.setDate(d.getDate() - dias); return d.toISOString().slice(0, 10) }
const POR_PAGINA = 100

export default function Logs() {
  const { perfil } = useAuth()
  const [desde, setDesde] = useState(hace(7))
  const [hasta, setHasta] = useState(hace(0))
  const [usuario, setUsuario] = useState('')
  const [tabla, setTabla] = useState('')
  const [accion, setAccion] = useState('')
  const [texto, setTexto] = useState('')
  const [conSistema, setConSistema] = useState(false)
  const [usuarios, setUsuarios] = useState<{ id: string; nombre: string }[]>([])
  const [filas, setFilas] = useState<Fila[]>([])
  const [hayMas, setHayMas] = useState(false)
  const [abierta, setAbierta] = useState<number | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('perfiles').select('id, nombre').order('nombre').then(({ data }) => setUsuarios((data ?? []) as { id: string; nombre: string }[]))
  }, [])

  async function buscar(antesDe?: number) {
    setCargando(true); setError('')
    const fin = new Date(hasta + 'T00:00:00'); fin.setDate(fin.getDate() + 1)   // "hasta" incluye todo ese día
    const { data, error } = await supabase.rpc('logs_sistema', {
      p_desde: new Date(desde + 'T00:00:00').toISOString(), p_hasta: fin.toISOString(),
      p_usuario: usuario || null, p_tabla: tabla || null, p_accion: accion || null, p_texto: texto.trim() || null,
      p_con_sistema: conSistema, p_antes_de: antesDe ?? null, p_limite: POR_PAGINA,
    })
    setCargando(false)
    if (error) { setError(mensajeError(error)); return }
    const l = (data ?? []) as Fila[]
    setFilas((f) => (antesDe ? [...f, ...l] : l)); setHayMas(l.length === POR_PAGINA)
    if (!antesDe) setAbierta(null)
  }
  // se vuelve a buscar al cambiar un filtro (el texto, al apretar Buscar o Enter)
  useEffect(() => { if (perfil?.rol === 'admin') buscar() }, [desde, hasta, usuario, tabla, accion, conSistema, perfil?.rol]) // eslint-disable-line react-hooks/exhaustive-deps

  if (perfil?.rol !== 'admin') return <p className="aviso haz">Esta pantalla es solo para administradores.</p>

  return (
    <>
      <h1>Configuración</h1>
      <SubmenuConfiguracion />
      <p className="sub">Quién creó, cambió o borró cada cosa, y cuándo. Tocá un renglón para ver el antes y el después.</p>

      <div className="card">
        <form className="campos" style={{ alignItems: 'end' }} onSubmit={(e) => { e.preventDefault(); buscar() }}>
          <label className="campo">Desde<input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} /></label>
          <label className="campo">Hasta<input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} /></label>
          <label className="campo">Usuario
            <select value={usuario} onChange={(e) => setUsuario(e.target.value)}>
              <option value="">Todos</option>
              {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select></label>
          <label className="campo">Qué
            <select value={tabla} onChange={(e) => setTabla(e.target.value)}>{QUE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="campo">Acción
            <select value={accion} onChange={(e) => setAccion(e.target.value)}>
              <option value="">Todas</option><option value="alta">Altas</option><option value="cambio">Cambios</option><option value="baja">Bajas</option>
            </select></label>
          <label className="campo">Buscar
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Número, nombre, patente…" /></label>
          <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={conSistema} onChange={(e) => setConSistema(e.target.checked)} />Incluir lo que trae el Access</label>
          <button className="pri" disabled={cargando}>{cargando ? 'Buscando…' : 'Buscar'}</button>
        </form>
      </div>

      {error && <div className="aviso bad mt" role="alert">{error}</div>}

      <div className="card mt">
        <p className="muted small" style={{ marginTop: 0 }}>{filas.length ? `${filas.length}${hayMas ? '+' : ''} movimientos, del más nuevo al más viejo.` : cargando ? 'Buscando…' : 'No hay movimientos con estos filtros.'}</p>
        {filas.length > 0 && <div className="tw"><table>
          <thead><tr><th>Cuándo</th><th>Usuario</th><th>Acción</th><th>Qué</th><th>Detalle</th></tr></thead>
          <tbody>{filas.map((f) => {
            const campos = Object.entries(f.cambios ?? {})
            const resumen = f.accion === 'cambio' ? campos.map(([k]) => CAMPO[k] ?? k).join(', ') : f.accion === 'alta' ? 'Creado' : 'Borrado'
            return (
              <Fragment key={f.id}>
                <tr className="fila" tabIndex={0} onClick={() => setAbierta(abierta === f.id ? null : f.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setAbierta(abierta === f.id ? null : f.id) }} aria-expanded={abierta === f.id}>
                  <td className="nw small">{new Date(f.fecha).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td className="nw">{f.usuario}</td>
                  <td><span className={`pill ${ACCION[f.accion][1]}`}>{ACCION[f.accion][0]}</span></td>
                  <td>{f.enlace ? <Link to={f.enlace} onClick={(e) => e.stopPropagation()}>{f.que}</Link> : f.que}</td>
                  <td className="small">{resumen}</td>
                </tr>
                {abierta === f.id && <tr><td colSpan={5} style={{ background: 'var(--acc-soft)' }}>
                  {campos.length ? <table className="small" style={{ width: '100%' }}>
                    <thead><tr><th style={{ width: '28%' }}>Campo</th>{f.accion !== 'alta' && <th>Antes</th>}{f.accion !== 'baja' && <th>Después</th>}</tr></thead>
                    <tbody>{campos.map(([k, [a, d]]) => <tr key={k}><td>{CAMPO[k] ?? k}</td>{f.accion !== 'alta' && <td>{valor(a)}</td>}{f.accion !== 'baja' && <td><b>{valor(d)}</b></td>}</tr>)}</tbody>
                  </table> : <span className="muted small">Sin datos para mostrar.</span>}
                </td></tr>}
              </Fragment>)
          })}</tbody>
        </table></div>}
        {hayMas && <div className="bar mt"><button disabled={cargando} onClick={() => buscar(filas[filas.length - 1].id)}>{cargando ? 'Buscando…' : 'Ver más'}</button></div>}
      </div>
    </>
  )
}
