import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import Ayuda from './Ayuda'

// Menú: primero el circuito de un residuo, numerado (Paso 1, Paso 2…), cada paso un botón directo.
// Después los grupos que abren una lista con una línea de explicación.
// Los números en amarillo marcan lo que espera acción (por ingresar, viajes sin certificado, flota vencida).

interface Opcion { to: string; b: string; s?: string; n?: number; admin?: boolean }
interface Grupo { t: string; to?: string; base?: string[]; n?: number; items?: Opcion[] }
/** Un paso del circuito: número, nombre corto, adónde lleva y qué explica al pasar el mouse */
interface Paso { n: number; t: string; to: string; s: string; espera?: number; activo: (path: string, v: string | null) => boolean }

function Desplegable({ g, abierto, setAbierto, activo }: { g: Grupo; abierto: boolean; setAbierto: (v: boolean) => void; activo: boolean }) {
  return (
    <div className={`dd ${abierto ? 'open' : ''}`}>
      <button type="button" className={`dt ${activo ? 'active' : ''}`} aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        {g.t}{g.n ? <span className="badge">{g.n}</span> : null}<span className="flecha" aria-hidden="true">▾</span>
      </button>
      {abierto && (
        <div className="dm">{g.items!.map((o) => (
          <Link key={o.to} to={o.to} onClick={() => setAbierto(false)}>
            <b>{o.b}{o.n ? <span className="badge">{o.n}</span> : null}</b>{o.s && <small>{o.s}</small>}
          </Link>))}
        </div>)}
    </div>
  )
}

export default function Layout() {
  const { perfil, salir } = useAuth()
  const [vencidos, setVencidos] = useState(0)
  const [esperando, setEsperando] = useState(0)
  const [porIngresar, setPorIngresar] = useState(0)
  const [certCliente, setCertCliente] = useState(0)
  const [abierto, setAbierto] = useState<string | null>(null)
  const { pathname, search } = useLocation()
  const nav = useRef<HTMLElement>(null)

  useEffect(() => {
    setAbierto(null)
    if (perfil?.rol === 'cliente') return
    // se actualiza al cambiar de pantalla (por ejemplo, después de cargar un vencimiento)
    supabase.from('alertas_vencimiento').select('id', { count: 'exact', head: true })
      .in('tipo', ['camion', 'chofer']).eq('estado', 'vencido')
      .then(({ count }) => setVencidos(count ?? 0))
    supabase.from('manifiestos_nacion').select('id, manifiesto_items!inner(id)', { count: 'exact', head: true })
      .eq('manifiesto_items.estado', 'en_transito')
      .then(({ count }) => setEsperando(count ?? 0))
    const d = new Date(); d.setDate(d.getDate() - 60)
    supabase.from('manifiestos').select('id, et:manifiesto_etapas!inner(etapa)', { count: 'exact', head: true })
      .eq('et.etapa', 0).eq('anulado', false).is('viaje_id', null).gte('fecha', d.toISOString().slice(0, 10))
      .then(({ count }) => setPorIngresar(count ?? 0))
    supabase.from('certificados_serco_pendientes').select('generador_id', { count: 'exact', head: true })
      .then(({ count }) => setCertCliente(count ?? 0))
  }, [pathname, search, perfil?.rol])

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => { if (!nav.current?.contains(e.target as Node)) setAbierto(null) }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(null) }
    document.addEventListener('click', fuera); document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('click', fuera); document.removeEventListener('keydown', tecla) }
  }, [abierto])

  // El circuito de un residuo, en orden
  const pasos: Paso[] = [
    { n: 1, t: 'Emitir', to: '/manifiestos/nuevo', s: 'Paso 1 · Emitir e imprimir el manifiesto en el formulario azul',
      activo: (p) => p === '/manifiestos/nuevo' },
    { n: 2, t: 'Ingreso a planta', to: '/planta?v=ingresar', s: 'Paso 2 · Cuando llega la carga: cargar los residuos (sección 3)', espera: porIngresar,
      activo: (p, v) => p === '/planta' && v === 'ingresar' },
    { n: 3, t: 'Armar viaje', to: '/planta', s: 'Paso 3 · Armar el viaje a disposición final (Manifiesto Nación) e imprimirlo',
      activo: (p, v) => p === '/planta' && (!v || v === 'armar') },
    { n: 4, t: 'Certificado del operador', to: '/planta?v=transito', s: 'Paso 4 · Cuando vuelve el certificado del operador: registrarlo', espera: esperando,
      activo: (p, v) => p === '/planta' && v === 'transito' },
    { n: 5, t: 'Certificado al cliente', to: '/certificados-serco', s: 'Paso 5 · Emitir e imprimir el certificado de Serco para cada generador', espera: certCliente,
      activo: (p) => p.startsWith('/certificados-serco') },
  ]
  const v = new URLSearchParams(search).get('v')
  const grupos: Grupo[] = [
    { t: 'Tablero', to: '/' },
    { t: 'Manifiestos', base: ['/manifiestos', '/agenda', '/nacion'], items: [
      { to: '/manifiestos', b: 'Buscar manifiestos', s: 'Recorrido de cada residuo' },
      { to: '/planta?v=nacion', b: 'Manifiestos Nación', s: 'Todos los viajes y sus certificados' },
      { to: '/agenda', b: 'Agenda', s: 'Retiros y vencimientos del mes' },
    ] },
    { t: 'Reportes', base: ['/reportes'], items: [
      { to: '/reportes/producto', b: 'Cantidad por producto', s: 'Semanal, quincenal o mensual' },
      { to: '/reportes/provincial', b: 'Libro provincial', s: 'Por planta, listo para rubricar' },
      { to: '/reportes/nacional', b: 'Libro nacional', s: 'Manifiestos Nación y certificados' },
      { to: '/reportes/transporte', b: 'Libro de transporte', s: 'Retiros por transportista' },
      { to: '/reportes/estadisticas', b: 'Estadísticas', s: 'Corrientes, generadores y destinos' },
    ] },
    { t: 'Altas', base: ['/altas', '/vencimientos', '/configuracion'], n: vencidos, items: [
      { to: '/vencimientos', b: 'Vencimientos', s: 'Habilitaciones vencidas o por vencer', n: vencidos },
      { to: '/altas/generadores', b: 'Generadores', s: 'Clientes, direcciones y habilitaciones' },
      { to: '/altas/camiones', b: 'Camiones y choferes', s: 'Flota y sus vencimientos' },
      { to: '/altas/transportistas', b: 'Transportistas y operadores', s: 'Empresas habilitadas y sus corrientes' },
      { to: '/altas/corrientes', b: 'Corrientes y plantas', s: 'Códigos Y, estado físico, plantas' },
      { to: '/configuracion', b: 'Configuración', s: 'Usuarios, avisos por mail y parámetros', admin: true },
      { to: '/configuracion/logs', b: 'Logs del sistema', s: 'Quién cambió qué y cuándo', admin: true },
    ] },
  ]
  const enPaso = pasos.some((p) => p.activo(pathname, v))
  const activo = (g: Grupo) => (g.to ? pathname === g.to
    : !enPaso && ((g.base ?? []).some((b) => pathname.startsWith(b)) || (g.t === 'Manifiestos' && pathname === '/planta' && v === 'nacion')))

  return (
    <>
      <header className="top">
        <NavLink to={perfil?.rol === 'cliente' ? '/portal' : '/'} className="brand" aria-label="Inicio"><img src="/serco-logo.png" alt="Serco Ambiental" /></NavLink>
        <nav className="menu" aria-label="Secciones" ref={nav}>
          {perfil?.rol === 'cliente' ? <>
            <NavLink to="/portal" end>Mis retiros</NavLink>
            <NavLink to="/portal/certificados">Certificados</NavLink>
          </> : <>
          {grupos.slice(0, 1).map((g) => <NavLink key={g.t} to={g.to!} end>{g.t}</NavLink>)}
          <span className="circuito" role="group" aria-label="Circuito de un residuo, paso a paso">
            {pasos.map((p) => (
              <Link key={p.n} to={p.to} className={`paso ${p.activo(pathname, v) ? 'active' : ''}`} title={p.s} aria-label={p.s}>
                <span className="num" aria-hidden="true">{p.n}</span>{p.t}{p.espera ? <span className="badge">{p.espera}</span> : null}
              </Link>))}
          </span>
          {grupos.slice(1).map((g) => g.to
            ? <NavLink key={g.t} to={g.to} end>{g.t}</NavLink>
            : <Desplegable key={g.t} g={{ ...g, items: g.items!.filter((o) => !o.admin || perfil?.rol === 'admin') }} activo={activo(g)}
                abierto={abierto === g.t} setAbierto={(v) => setAbierto(v ? g.t : null)} />)}
          </>}
          {perfil?.rol !== 'cliente' && <NavLink to="/vista-cliente" className="vista-cliente" title="Lo que ve un generador en su portal">Vista del cliente</NavLink>}
        </nav>
        <div className="usuario">
          <span>{perfil?.nombre}</span>
          <button onClick={salir}>Salir</button>
        </div>
      </header>
      <main><Outlet /></main>
      <Ayuda />
    </>
  )
}
