import { Link, useLocation } from 'react-router-dom'

/** Pestañas de Configuración (solo administradores) */
export default function SubmenuConfiguracion() {
  const { pathname } = useLocation()
  return (
    <div className="bar" style={{ marginBottom: 12 }}>
      <Link to="/configuracion" className={`subnav ${pathname === '/configuracion' ? 'active' : ''}`}>Usuarios, avisos y parámetros</Link>
      <Link to="/configuracion/logs" className={`subnav ${pathname === '/configuracion/logs' ? 'active' : ''}`}>Logs del sistema</Link>
    </div>
  )
}
