import { useEffect, useState, type FormEvent } from 'react'
import { supabase, mensajeError } from '../lib/supabase'
import type { Rol } from '../lib/tipos'
import { useAuth } from '../auth/AuthProvider'

interface PerfilFila { id: string; nombre: string; email: string | null; rol: Rol; activo: boolean; perfil_generadores: { generador_id: number; generadores: { nombre: string } | null }[] }
interface Gen { id: number; nombre: string; cuit: string | null }
interface Log { id: number; fecha: string; tipo: string; destinatario: string | null; asunto: string | null; ok: boolean; detalle: string | null }
interface Param { clave: string; valor: string; descripcion: string | null }

const ROLES: { v: Rol; l: string; d: string }[] = [
  { v: 'admin', l: 'Administrador', d: 'Todo, incluso usuarios y emitir con vencimientos' },
  { v: 'operador', l: 'Operador', d: 'Emite, arma cargas y actualiza datos' },
  { v: 'consulta', l: 'Consulta', d: 'Solo mira' },
  { v: 'cliente', l: 'Cliente (portal)', d: 'Ve solo sus retiros y certificados' },
]

const PUEDE: Record<Rol, string> = {
  admin: 'Todo lo del operador, más usuarios, parámetros, avisos por mail y emitir con vencimientos sin regularizar (queda registrado el motivo).',
  operador: 'Emitir e imprimir manifiestos y etiquetas, armar viajes a disposición final, registrar certificados, cargar altas y vencimientos.',
  consulta: 'Ver todo y sacar reportes y libros. No cambia nada.',
  cliente: 'Entra al portal: ve sus propios retiros, en qué etapa están y descarga sus certificados.',
}

/** Llama a una función de Supabase y devuelve el mensaje de error legible que manda la función */
async function invocar(nombre: string, body: Record<string, unknown>): Promise<{ data: unknown; error: string | null }> {
  const { data, error } = await supabase.functions.invoke(nombre, { body })
  if (!error) return { data, error: null }
  let detalle = ''
  try { detalle = (await (error as { context?: Response }).context?.json())?.error ?? '' } catch { /* sin detalle */ }
  if (!detalle && /Failed to send|fetch/i.test(error.message)) detalle = 'La función todavía no está publicada en Supabase.'
  return { data: null, error: detalle || mensajeError(error) }
}

/** Busca generadores por nombre o CUIT y los agrega a una lista */
function ElegirGeneradores({ elegidos, setElegidos }: { elegidos: Gen[]; setElegidos: (g: Gen[]) => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Gen[]>([])
  useEffect(() => {
    if (q.trim().length < 3) { setRes([]); return }
    const t = setTimeout(() => {
      const d = q.replace(/\D/g, '')
      const c = supabase.from('generadores').select('id, nombre, cuit').eq('activo', true).limit(8)
      ;(d.length >= 5 ? c.ilike('cuit', `%${d}%`) : c.ilike('nombre', `%${q.trim()}%`)).then(({ data }) => setRes((data ?? []) as Gen[]))
    }, 250)
    return () => clearTimeout(t)
  }, [q])
  return (
    <div className="stack" style={{ gap: 6 }}>
      <input placeholder="Buscar generador por nombre o CUIT" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar generador" />
      {res.length > 0 && <div className="bar" style={{ margin: 0 }}>{res.filter((g) => !elegidos.some((x) => x.id === g.id)).map((g) => (
        <button type="button" key={g.id} onClick={() => { setElegidos([...elegidos, g]); setQ('') }}>+ {g.nombre}</button>))}</div>}
      {elegidos.length > 0 && <div className="bar" style={{ margin: 0 }}>{elegidos.map((g) => (
        <span key={g.id} className="pill ok">{g.nombre} <button type="button" className="link" onClick={() => setElegidos(elegidos.filter((x) => x.id !== g.id))} aria-label={`Quitar ${g.nombre}`}>×</button></span>))}</div>}
    </div>
  )
}

function Usuarios() {
  const { perfil: yo } = useAuth()
  const [lista, setLista] = useState<PerfilFila[]>([])
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [form, setForm] = useState({ email: '', nombre: '', rol: 'operador' as Rol })
  const [gens, setGens] = useState<Gen[]>([])
  const [enviando, setEnviando] = useState(false)
  const [editando, setEditando] = useState<string | null>(null)
  const [gensEdit, setGensEdit] = useState<Gen[]>([])
  const [ingresos, setIngresos] = useState<Record<string, string | null>>({})

  const cargar = () => supabase.from('perfiles').select('id, nombre, email, rol, activo, perfil_generadores(generador_id, generadores(nombre))').order('nombre')
    .then(({ data, error }) => { setError(mensajeError(error)); setLista((data ?? []) as unknown as PerfilFila[]) })
  useEffect(() => {
    cargar()
    supabase.rpc('ultimos_ingresos').then(({ data }) => setIngresos(Object.fromEntries(((data ?? []) as { id: string; ultimo: string | null }[]).map((x) => [x.id, x.ultimo]))))
  }, [])

  async function restablecer(p: PerfilFila) {
    if (!p.email) return
    setError(''); setOk('')
    const { error } = await supabase.auth.resetPasswordForEmail(p.email, { redirectTo: window.location.origin + '/elegir-clave' })
    if (error) setError(mensajeError(error)); else setOk(`Le mandamos a ${p.email} un mail para elegir una contraseña nueva.`)
  }

  async function invitar(e: FormEvent) {
    e.preventDefault(); setError(''); setOk(''); setEnviando(true)
    const { data, error } = await supabase.functions.invoke('usuarios', { body: { ...form, generadores: gens.map((g) => g.id) } })
    setEnviando(false)
    const msg = (data as { error?: string; mensaje?: string } | null)
    if (error || msg?.error) {
      let detalle = msg?.error ?? ''
      try { detalle ||= (await (error as { context?: Response }).context?.json())?.error } catch { /* sin detalle */ }
      setError(detalle || mensajeError(error)); return
    }
    setOk(msg?.mensaje ?? 'Invitación enviada.'); setForm({ email: '', nombre: '', rol: 'operador' }); setGens([]); cargar()
  }

  async function cambiar(p: PerfilFila, datos: Partial<PerfilFila>) {
    setError(''); setOk('')
    if (p.id === yo?.id && (datos.activo === false || (datos.rol && datos.rol !== 'admin'))) { setError('No podés quitarte a vos mismo el rol de administrador.'); return }
    const { error } = await supabase.from('perfiles').update(datos).eq('id', p.id)
    if (error) setError(mensajeError(error)); else cargar()
  }

  async function guardarGeneradores(p: PerfilFila) {
    const antes = new Set(p.perfil_generadores.map((x) => x.generador_id)), ahora = new Set(gensEdit.map((g) => g.id))
    const altas = [...ahora].filter((x) => !antes.has(x)), bajas = [...antes].filter((x) => !ahora.has(x))
    if (altas.length) { const { error } = await supabase.from('perfil_generadores').insert(altas.map((g) => ({ perfil_id: p.id, generador_id: g }))); if (error) { setError(mensajeError(error)); return } }
    if (bajas.length) { const { error } = await supabase.from('perfil_generadores').delete().eq('perfil_id', p.id).in('generador_id', bajas); if (error) { setError(mensajeError(error)); return } }
    setEditando(null); cargar()
  }

  return (
    <div className="card">
      <h2>Usuarios</h2>
      {error && <div className="aviso bad" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
      {ok && <div className="aviso ok" role="status" style={{ marginBottom: 12 }}>{ok}</div>}
      <div className="tw"><table>
        <thead><tr><th>Nombre</th><th>Mail</th><th>Rol</th><th>Generadores (portal)</th><th>Último ingreso</th><th>Estado</th></tr></thead>
        <tbody>{lista.map((p) => (
          <tr key={p.id}>
            <td><b>{p.nombre}</b></td><td>{p.email ?? '—'}</td>
            <td><select value={p.rol} onChange={(e) => cambiar(p, { rol: e.target.value as Rol })} aria-label={`Rol de ${p.nombre}`}>{ROLES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}</select></td>
            <td>{p.rol !== 'cliente' ? <span className="muted">—</span> : editando === p.id ? (
              <div className="stack" style={{ gap: 6 }}><ElegirGeneradores elegidos={gensEdit} setElegidos={setGensEdit} />
                <div className="bar" style={{ margin: 0 }}><button type="button" className="pri" onClick={() => guardarGeneradores(p)}>Guardar</button><button type="button" onClick={() => setEditando(null)}>Cancelar</button></div></div>
            ) : (
              <>{p.perfil_generadores.map((x) => x.generadores?.nombre).join(', ') || <span className="muted">ninguno</span>}{' '}
                <button type="button" className="link" onClick={() => { setEditando(p.id); setGensEdit(p.perfil_generadores.map((x) => ({ id: x.generador_id, nombre: x.generadores?.nombre ?? '', cuit: null }))) }}>Cambiar</button></>)}
            </td>
            <td className="nw small">{ingresos[p.id] ? new Date(ingresos[p.id]!).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : <span className="muted">Nunca</span>}</td>
            <td className="nw">{p.activo ? <>{p.email && <button type="button" className="link" onClick={() => restablecer(p)} style={{ marginRight: 10 }}>Restablecer contraseña</button>}<button type="button" onClick={() => cambiar(p, { activo: false })}>Dar de baja</button></>
              : <><span className="pill bad">Sin acceso</span> <button type="button" className="link" onClick={() => cambiar(p, { activo: true })}>Reactivar</button></>}</td>
          </tr>))}
        </tbody>
      </table></div>

      <details className="mt roles">
        <summary>Qué puede hacer cada rol</summary>
        <div className="tw"><table className="compacta">
          <thead><tr><th>Rol</th><th>Puede</th></tr></thead>
          <tbody>{ROLES.map((r) => <tr key={r.v}><td className="nw"><b>{r.l}</b></td><td>{PUEDE[r.v]}</td></tr>)}</tbody>
        </table></div>
      </details>

      <form className="stack mt" onSubmit={invitar} data-ayuda="cfg-invitar">
        <h2 style={{ margin: 0 }}>Invitar a alguien</h2>
        <div className="campos">
          <label className="campo">Mail<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
          <label className="campo">Nombre<input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required /></label>
          <label className="campo" data-ayuda="cfg-rol">Rol<select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value as Rol })}>{ROLES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}</select>
            <span className="ayuda">{ROLES.find((r) => r.v === form.rol)?.d}</span></label>
        </div>
        {form.rol === 'cliente' && <label className="campo">Generadores que va a ver<ElegirGeneradores elegidos={gens} setElegidos={setGens} /></label>}
        <div><button className="pri" data-ayuda="cfg-enviar" disabled={enviando}>{enviando ? 'Invitando…' : 'Mandar invitación'}</button>
          <span className="muted small"> Le llega un mail para elegir su contraseña.</span></div>
      </form>
    </div>
  )
}

function Avisos() {
  const [log, setLog] = useState<Log[]>([])
  const [pendientes, setPendientes] = useState({ total: 0, sinMail: 0 })
  const [resultado, setResultado] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resPrueba, setResPrueba] = useState<{ ok: boolean; t: string } | null>(null)

  async function prueba() {
    setEnviando(true); setResPrueba(null)
    const { data, error } = await invocar('avisos', { solo: 'prueba' })
    setEnviando(false)
    setResPrueba(error ? { ok: false, t: error } : { ok: true, t: (data as { prueba: string }).prueba + '. Revisá la bandeja (y el correo no deseado).' }); cargar()
  }

  const cargar = () => {
    supabase.from('avisos_log').select('*').order('id', { ascending: false }).limit(15).then(({ data }) => setLog((data ?? []) as Log[]))
    supabase.from('certificados_por_avisar').select('generador_id, email').then(({ data }) => {
      const l = data ?? []; setPendientes({ total: new Set(l.map((x) => x.generador_id)).size, sinMail: new Set(l.filter((x) => !x.email).map((x) => x.generador_id)).size })
    })
  }
  useEffect(cargar, [])

  async function enviarAhora() {
    setEnviando(true); setResultado('')
    const { data, error } = await invocar('avisos', { solo: 'certificados' })
    setEnviando(false)
    if (error) { setResultado('No se pudo: ' + error); return }
    const r = data as Record<string, number>
    setResultado(`Avisados ${r.generadores_avisados ?? 0} generadores${r.generadores_sin_mail ? `; ${r.generadores_sin_mail} sin mail cargado` : ''}.`); cargar()
  }

  return (
    <div className="card mt">
      <h2>Avisos por mail</h2>
      <p className="muted" style={{ marginTop: 0 }}>Todos los días a las 7: a cada generador, sus certificados nuevos; a Serco, lo que vence dentro de los días configurados abajo, y los lunes el resumen completo.</p>
      <div className="bar">
        <button type="button" onClick={prueba} disabled={enviando}>Mandarme un mail de prueba</button>
        {resPrueba && <span className={`small ${resPrueba.ok ? '' : 'err'}`}>{resPrueba.t}</span>}
      </div>
      <div className="bar">
        <span>{pendientes.total ? <><b>{pendientes.total}</b> generadores con certificados por avisar{pendientes.sinMail ? <>, <b>{pendientes.sinMail}</b> sin mail cargado</> : ''}</> : 'No hay certificados pendientes de aviso.'}</span>
        <button type="button" onClick={enviarAhora} disabled={enviando || !pendientes.total}>{enviando ? 'Enviando…' : 'Avisar ahora'}</button>
      </div>
      {pendientes.sinMail > 0 && <div className="aviso haz" style={{ marginBottom: 12 }}>Sin mail no hay aviso: cargalo en Altas → Generadores.</div>}
      {resultado && <div className="aviso ok" style={{ marginBottom: 12 }}>{resultado}</div>}
      {log.length > 0 && <div className="tw"><table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Para</th><th>Asunto</th><th>Resultado</th></tr></thead>
        <tbody>{log.map((l) => (
          <tr key={l.id}><td className="nw">{new Date(l.fecha).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</td><td>{l.tipo}</td>
            <td className="small">{l.destinatario}</td><td>{l.asunto}</td>
            <td>{l.ok ? <span className="pill ok">Enviado</span> : <span className="pill bad" title={l.detalle ?? ''}>Falló</span>}</td></tr>))}
        </tbody>
      </table></div>}
    </div>
  )
}

const PARAMS: Record<string, { l: string; tipo: 'texto' | 'numero' | 'sino'; op?: [string, string] }> = {
  mails_vencimientos: { l: 'Mails que reciben los vencimientos', tipo: 'texto' },
  dias_alerta_vencimientos: { l: 'Avisar cuando falten (días)', tipo: 'texto' },
  dias_aviso_vencimiento: { l: 'Días de anticipación para "por vencer"', tipo: 'numero' },
  plazo_planta_dias: { l: 'Plazo máximo en planta (días)', tipo: 'numero' },
  bloquear_generador: { l: 'Bloquear si la habilitación del generador está vencida', tipo: 'sino', op: ['Sí, no deja emitir', 'No, solo avisa'] },
  form_inhalacion: { l: 'Formulario: toxicidad por inhalación', tipo: 'texto' },
  form_dermica: { l: 'Formulario: toxicidad dérmica', tipo: 'texto' },
  form_oral: { l: 'Formulario: toxicidad oral', tipo: 'texto' },
  form_instructivos: { l: 'Formulario: instructivos adjuntos (SI/NO)', tipo: 'texto' },
  form_peligros: { l: 'Formulario: inflamabilidad, reactividad, toxicidad, especiales (SI/NO)', tipo: 'texto' },
  plan_capacidad_solidos: { l: 'Viajes: kilos por batea (sólidos y barros)', tipo: 'numero' },
  plan_capacidad_liquidos: { l: 'Viajes: litros por cisterna', tipo: 'numero' },
  plan_mezclar_solidos: { l: 'Viajes: mezclar corrientes sólidas', tipo: 'sino', op: ['Sí', 'No, una corriente por viaje'] },
  plan_mezclar_barros: { l: 'Viajes: mezclar corrientes semisólidas', tipo: 'sino', op: ['Sí', 'No, una corriente por viaje'] },
  mails_reporte_producto: { l: 'Mails que reciben cada lunes la cantidad por producto', tipo: 'texto' },
}

function Parametros() {
  const [params, setParams] = useState<Param[]>([])
  const [ok, setOk] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { supabase.from('parametros').select('*').in('clave', Object.keys(PARAMS)).then(({ data }) => setParams((data ?? []) as Param[])) }, [])

  async function guardar(clave: string, valor: string) {
    setOk(''); setError('')
    const { error } = await supabase.from('parametros').update({ valor }).eq('clave', clave)
    if (error) setError(mensajeError(error)); else { setParams((p) => p.map((x) => (x.clave === clave ? { ...x, valor } : x))); setOk('Guardado.') }
  }

  return (
    <div className="card mt">
      <h2>Parámetros</h2>
      {error && <div className="aviso bad" style={{ marginBottom: 12 }}>{error}</div>}
      {ok && <div className="aviso ok" style={{ marginBottom: 12 }}>{ok}</div>}
      <div className="campos">{Object.entries(PARAMS).map(([k, c]) => {
        const p = params.find((x) => x.clave === k)
        if (!p) return null
        return (
          <label key={k} className="campo">{c.l}
            {c.tipo === 'sino'
              ? <select value={p.valor} onChange={(e) => guardar(k, e.target.value)}><option value="si">{c.op?.[0] ?? 'Sí'}</option><option value="no">{c.op?.[1] ?? 'No'}</option></select>
              : <input defaultValue={p.valor} type={c.tipo === 'numero' ? 'number' : 'text'} onBlur={(e) => e.target.value !== p.valor && guardar(k, e.target.value)} />}
            <span className="ayuda">{p.descripcion}</span>
          </label>)
      })}</div>
    </div>
  )
}

export default function Configuracion() {
  const { perfil } = useAuth()
  if (perfil?.rol !== 'admin') return <p className="aviso haz">Esta pantalla es solo para administradores.</p>
  return (
    <>
      <h1>Configuración</h1>
      <p className="sub">Usuarios, avisos por mail y parámetros del sistema.</p>
      <Usuarios />
      <Avisos />
      <Parametros />
    </>
  )
}
