import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'

export default function Layout() {
  const { perfil, salir } = useAuth()
  const [vencidos, setVencidos] = useState(0)
  const { pathname } = useLocation()

  useEffect(() => {
    if (perfil?.rol === 'cliente') return
    supabase.from('alertas_vencimiento').select('id', { count: 'exact', head: true })
      .in('tipo', ['camion', 'chofer']).eq('estado', 'vencido')
      .then(({ count }) => setVencidos(count ?? 0))
  }, [pathname, perfil?.rol]) // se actualiza al cambiar de pantalla (por ejemplo, después de cargar un vencimiento)

  return (
    <>
      <header className="top">
        <NavLink to={perfil?.rol === 'cliente' ? '/portal' : '/'} className="brand" aria-label="Inicio"><img src="/serco-logo.png" alt="Serco Ambiental" /></NavLink>
        <nav className="menu" aria-label="Secciones">
          {perfil?.rol === 'cliente' ? <>
            <NavLink to="/portal" end>Mis retiros</NavLink>
            <NavLink to="/portal/certificados">Certificados</NavLink>
          </> : <>
            <NavLink to="/" end>Tablero</NavLink>
            <NavLink to="/manifiestos">Manifiestos</NavLink>
            <NavLink to="/planta">Planta</NavLink>
            <NavLink to="/reportes">Reportes</NavLink>
            <NavLink to="/vencimientos">Vencimientos {vencidos > 0 && <span className="badge" title="Camiones y choferes vencidos">{vencidos}</span>}</NavLink>
            <NavLink to="/altas">Altas</NavLink>
            {perfil?.rol === 'admin' && <NavLink to="/configuracion">Configuración</NavLink>}
          </>}
        </nav>
        <div className="usuario">
          <span>{perfil?.nombre}</span>
          <button onClick={salir}>Salir</button>
        </div>
      </header>
      <main><Outlet /></main>
    </>
  )
}
