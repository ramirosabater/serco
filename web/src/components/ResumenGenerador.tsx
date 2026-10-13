import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, mensajeError } from '../lib/supabase'
import { fd, num, umL } from '../lib/formato'
import type { UM } from '../lib/tipos'
import { useAuth } from '../auth/AuthProvider'

// Ficha del generador: cuánto retira Serco, de qué corrientes y quién entra al portal.

interface Resumen {
  retiros: number; retiros_12m: number; primero: string | null; ultimo: string | null
  corrientes: { codigo: string; descripcion: string | null; um: UM; total: number; total_12m: number }[]
  usuarios: { id: string; nombre: string; email: string | null; activo: boolean }[]
}

export default function ResumenGenerador({ id, nombre }: { id: number; nombre: string }) {
  const { perfil } = useAuth()
  const [r, setR] = useState<Resumen | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [todo, setTodo] = useState(false)

  useEffect(() => { supabase.rpc('generador_resumen', { p_id: id }).then(({ data }) => setR(data as Resumen)) }, [id])
  if (!r) return null

  const lista = r.corrientes.filter((c) => (todo ? c.total : c.total_12m) > 0).sort((a, b) => (todo ? b.total - a.total : b.total_12m - a.total_12m))
  const max = Math.max(1, ...lista.map((c) => (todo ? c.total : c.total_12m)))

  async function restablecer(email: string) {
    setMsg(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/elegir-clave' })
    setMsg(error ? { ok: false, t: 'No se pudo: ' + mensajeError(error) } : { ok: true, t: `Le mandamos a ${email} un mail para elegir una contraseña nueva.` })
  }

  return (
    <div className="grid c21" style={{ marginBottom: 16 }}>
      <div className="card">
        <div className="bar" style={{ justifyContent: 'space-between', margin: '0 0 8px' }}>
          <h2 style={{ margin: 0 }}>Qué retira</h2>
          <span className="bar" style={{ margin: 0 }}>
            <a href="#" className={`subnav ${!todo ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setTodo(false) }}>Último año</a>
            <a href="#" className={`subnav ${todo ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setTodo(true) }}>Desde {r.primero ? r.primero.slice(0, 4) : 'siempre'}</a>
          </span>
        </div>
        {lista.length === 0 ? <p className="muted">Sin retiros {todo ? '' : 'en el último año'}.</p> :
          <div className="ranking">{lista.slice(0, 8).map((c) => {
            const v = todo ? c.total : c.total_12m
            return (
              <div key={c.codigo + c.um} className="rk">
                <span className="rk-n" title={c.descripcion ?? ''}><b>{c.codigo}</b> <span className="muted small">{c.descripcion}</span></span>
                <span className="rk-b"><i style={{ width: `${Math.max(3, (v / max) * 100)}%` }} /></span>
                <span className="rk-v">{num(Math.round(v))} {umL(c.um)}</span>
              </div>)
          })}</div>}
      </div>
      <div className="card">
        <h2>Retiros</h2>
        <dl className="kv">
          <dt>Último año</dt><dd><b>{num(r.retiros_12m)}</b> manifiestos</dd>
          <dt>Desde el inicio</dt><dd>{num(r.retiros)} manifiestos</dd>
          <dt>Primer retiro</dt><dd>{fd(r.primero)}</dd>
          <dt>Último retiro</dt><dd>{fd(r.ultimo)}</dd>
        </dl>
        <p style={{ margin: '10px 0 0' }}><Link to={`/manifiestos?q=${encodeURIComponent(nombre)}`}>Ver sus manifiestos</Link></p>
        <h2 className="mt">Usuarios del portal</h2>
        {r.usuarios.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Nadie de esta empresa entra al portal.{perfil?.rol === 'admin' && <> Se invita desde <Link to="/configuracion">Configuración</Link>.</>}</p> :
          <div className="stack" style={{ gap: 8 }}>{r.usuarios.map((u) => (
            <div key={u.id} className="bar" style={{ justifyContent: 'space-between', margin: 0 }}>
              <span>{u.nombre}<span className="muted small" style={{ display: 'block' }}>{u.email ?? 'sin mail'}</span></span>
              {u.activo ? (perfil?.rol === 'admin' && u.email
                ? <button type="button" onClick={() => restablecer(u.email!)}>Restablecer contraseña</button>
                : <span className="pill ok">Activo</span>) : <span className="pill bad">Sin acceso</span>}
            </div>))}
          </div>}
        {msg && <div className={`aviso ${msg.ok ? 'ok' : 'bad'} mt small`}>{msg.t}</div>}
      </div>
    </div>
  )
}
