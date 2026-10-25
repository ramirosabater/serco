import { BrowserRouter, Route, Routes, Link, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import Ingreso from './auth/Ingreso'
import Layout from './components/Layout'
import Tablero from './pages/Tablero'
import Manifiestos from './pages/Manifiestos'
import ManifiestoDetalle from './pages/ManifiestoDetalle'
import NuevoManifiesto from './pages/NuevoManifiesto'
import Vencimientos from './pages/Vencimientos'
import Planta from './pages/Planta'
import Reportes from './pages/Reportes'
import ImprimirManifiesto from './pages/ImprimirManifiesto'
import Etiquetas from './pages/Etiquetas'
import Agenda from './pages/Agenda'
import NacionDetalle from './pages/NacionDetalle'
import Configuracion from './pages/Configuracion'
import { PortalRetiros, PortalCertificados } from './pages/Portal'
import ElegirClave from './auth/ElegirClave'
import SubirCertificado from './pages/SubirCertificado'
import AltasLista from './pages/altas/AltasLista'
import AltasFicha from './pages/altas/AltasFicha'
import { devJwt } from './lib/supabase'

function Rutas() {
  const { cargando, perfil, sinPerfil, salir } = useAuth()
  // Desde el mail de invitación o de "olvidé mi contraseña"
  if (window.location.pathname === '/elegir-clave') return <ElegirClave />
  // Desde el mail que le llega al chofer: página pública, sin usuario
  if (window.location.pathname.startsWith('/subir/')) return <SubirCertificado />
  if (cargando) return <p className="cargando" style={{ padding: 28 }}>Cargando…</p>
  if (sinPerfil) return (
    <div className="ingreso"><div className="card stack">
      <h1>Sin acceso</h1>
      <p>Tu usuario todavía no tiene permisos en el sistema. Pedile al administrador que te dé de alta.</p>
      {!devJwt && <button onClick={salir}>Salir</button>}
    </div></div>)
  if (!perfil) return <Ingreso />
  if (perfil.rol === 'cliente') return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="portal" element={<PortalRetiros />} />
        <Route path="portal/certificados" element={<PortalCertificados />} />
        <Route path="manifiestos/:id" element={<ManifiestoDetalle />} />
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Route>
    </Routes>
  )
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Tablero />} />
        <Route path="manifiestos" element={<Manifiestos />} />
        <Route path="manifiestos/nuevo" element={<NuevoManifiesto />} />
        <Route path="manifiestos/:id" element={<ManifiestoDetalle />} />
        <Route path="manifiestos/:id/imprimir" element={<ImprimirManifiesto />} />
        <Route path="manifiestos/:id/etiquetas" element={<Etiquetas />} />
        <Route path="planta" element={<Planta />} />
        <Route path="agenda" element={<Agenda />} />
        <Route path="nacion/:id" element={<NacionDetalle />} />
        <Route path="vista-cliente" element={<PortalRetiros />} />
        <Route path="vista-cliente/certificados" element={<PortalCertificados />} />
        <Route path="reportes" element={<Navigate to="/reportes/producto" replace />} />
        <Route path="reportes/:tipo" element={<Reportes />} />
        <Route path="vencimientos" element={<Vencimientos />} />
        <Route path="altas" element={<Navigate to="/altas/camiones" replace />} />
        <Route path="altas/:entidad" element={<AltasLista />} />
        <Route path="altas/:entidad/:id" element={<AltasFicha />} />
        <Route path="configuracion" element={<Configuracion />} />
        <Route path="*" element={<p>No existe esta página. <Link to="/">Ir al tablero</Link></p>} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return <AuthProvider><BrowserRouter><Rutas /></BrowserRouter></AuthProvider>
}
