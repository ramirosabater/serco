import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import Ayuda from './Ayuda'

// Menú agrupado como en el prototipo: cada grupo abre una lista con una línea de explicación.
// Los números marcan lo que espera acción (viajes sin certificado, flota vencida).

interface Opcion { to: string; b: string; s?: string; n?: number; admin?: boolean }
interface Grupo { t: string; to?: string; base?: string[]; n?: number; items?: Opcion[] }

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
  }, [pathname, search, perfil?.rol])

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => { if (!nav.current?.contains(e.target as Node)) setAbierto(null) }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(null) }
    document.addEventListener('click', fuera); document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('click', fuera); document.removeEventListener('keydown', tecla) }
  }, [abierto])

  const grupos: Grupo[] = [
    { t: 'Tablero', to: '/' },
    { t: 'Manifiestos', base: ['/manifiestos', '/agenda'], items: [
      { to: '/manifiestos/nuevo', b: 'Nuevo manifiesto', s: 'Cargar e imprimir en el formulario' },
      { to: '/manifiestos', b: 'Buscar manifiestos', s: 'Recorrido de cada residuo' },
      { to: '/agenda', b: 'Agenda', s: 'Retiros y vencimientos del mes' },
    ] },
    { t: 'Planta', base: ['/planta', '/nacion'], n: esperando + porIngresar, items: [
      { to: '/planta?v=ingresar', b: 'Por ingresar', s: 'Cargar los residuos que llegan (sección 3)', n: porIngresar },
      { to: '/planta', b: 'Armar viajes', s: 'Lo almacenado, en viajes a disposición final' },
      { to: '/planta?v=transito', b: 'Esperando certificado', s: 'Registrar el certificado del operador', n: esperando },
      { to: '/planta?v=nacion', b: 'Manifiestos Nación', s: 'Todos los envíos y sus certificados' },
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
    ] },
  ]
  const activo = (g: Grupo) => (g.to ? pathname === g.to : (g.base ?? []).some((b) => pathname.startsWith(b)))

  return (
    <>
      <header className="top">
        <NavLink to={perfil?.rol === 'cliente' ? '/portal' : '/'} className="brand" aria-label="Inicio"><img src="/serco-logo.png" alt="Serco Ambiental" /></NavLink>
        <nav className="menu" aria-label="Secciones" ref={nav}>
          {perfil?.rol === 'cliente' ? <>
            <NavLink to="/portal" end>Mis retiros</NavLink>
            <NavLink to="/portal/certificados">Certificados</NavLink>
          </> : grupos.map((g) => g.to
            ? <NavLink key={g.t} to={g.to} end>{g.t}</NavLink>
            : <Desplegable key={g.t} g={{ ...g, items: g.items!.filter((o) => !o.admin || perfil?.rol === 'admin') }} activo={activo(g)}
                abierto={abierto === g.t} setAbierto={(v) => setAbierto(v ? g.t : null)} />)}
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
