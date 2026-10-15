import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { GUIAS, type Guia } from '../lib/guias'
import Avatar from './Avatar'

// Botón "Ayuda" del encabezado: lista de guías y recorrido paso a paso que resalta
// cada elemento de la pantalla. La página sigue usable mientras la guía está abierta.

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const sinAnimacion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Escribe el texto de a poco, como si Brote lo estuviera diciendo. Un clic lo completa. */
function useEscritura(texto: string) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (sinAnimacion()) { setN(texto.length); return }
    setN(0)
    const t = window.setInterval(() => setN((x) => { if (x >= texto.length) { window.clearInterval(t); return x } return x + 2 }), 22)
    return () => window.clearInterval(t)
  }, [texto])
  return { mostrado: texto.slice(0, n), listo: n >= texto.length, completar: () => setN(texto.length) }
}

export default function Ayuda() {
  const { perfil } = useAuth()
  const { pathname, search } = useLocation()
  const nav = useNavigate()
  const [abierto, setAbierto] = useState(false)
  const [q, setQ] = useState('')
  const [guia, setGuia] = useState<Guia | null>(null)
  const [paso, setPaso] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [auto, setAuto] = useState(false)          // "Mostrame": Brote avanza solo por el circuito
  const [festejo, setFestejo] = useState(false)
  const [angulo, setAngulo] = useState<number | null>(null)
  const avatar = useRef<SVGSVGElement>(null)

  const mias = useMemo(() => GUIAS.filter((g) => perfil && g.roles.includes(perfil.rol)), [perfil])
  const lista = useMemo(() => {
    const t = normal(q.trim())
    const filtradas = t ? mias.filter((g) => normal(`${g.titulo} ${g.grupo} ${g.pasos.map((p) => p.texto).join(' ')}`).includes(t)) : mias
    const aca = filtradas.filter((g) => g.pantalla.test(pathname))
    const grupos = new Map<string, Guia[]>()
    if (aca.length && !t) grupos.set('En esta pantalla', aca)
    for (const g of filtradas) if (t || !aca.includes(g)) grupos.set(g.grupo, [...(grupos.get(g.grupo) ?? []), g])
    return [...grupos]
  }, [mias, q, pathname])

  const p = guia?.pasos[paso]
  const terminar = useCallback(() => { setGuia(null); setPaso(0); setRect(null); setAuto(false); setFestejo(false) }, [])
  const siguiente = useCallback(() => {
    if (!guia) return
    if (paso + 1 < guia.pasos.length) { setPaso(paso + 1); return }
    // Al terminar, Brote festeja un momento
    setAuto(false); setFestejo(true)
    window.setTimeout(terminar, sinAnimacion() ? 0 : 1400)
  }, [guia, paso, terminar])

  const texto = p ? (rect || !p.sel ? p.texto : (p.falta ?? 'Esperando que aparezca en pantalla…')) : ''
  const { mostrado, listo, completar } = useEscritura(texto)
  const esperaAccion = !!p && ((!!p.sel && !rect) || !!p.alTocar)

  // Modo "Mostrame": cuando termina de explicar, pasa solo al siguiente (salvo que haga falta tocar algo)
  useEffect(() => {
    if (!auto || !listo || esperaAccion || festejo) return
    const t = window.setTimeout(siguiente, 1800 + Math.min(texto.length * 25, 3500))
    return () => window.clearTimeout(t)
  }, [auto, listo, esperaAccion, festejo, siguiente, texto])

  // Hacia dónde señala Brote: del avatar al centro del elemento resaltado
  useEffect(() => {
    if (!rect || !avatar.current) { setAngulo(null); return }
    const id = window.requestAnimationFrame(() => {
      const a = avatar.current?.getBoundingClientRect()
      if (!a) return
      const dx = rect.left + rect.width / 2 - (a.left + a.width / 2)
      const dy = rect.top + rect.height / 2 - (a.top + a.height * 0.6)
      setAngulo(Math.round(Math.atan2(dy, dx) * 180 / Math.PI))
    })
    return () => window.cancelAnimationFrame(id)
  }, [rect, paso])

  // Llevar a la pantalla del paso
  useEffect(() => {
    if (!p?.ruta) return
    if (pathname + search !== p.ruta) nav(p.ruta)   // también la pestaña (?v=…), así se ve lo que explica
  }, [p, nav]) // eslint-disable-line react-hooks/exhaustive-deps -- solo al cambiar de paso

  // Buscar el elemento y seguirlo (scroll, cambios de tamaño, pantallas que cargan después)
  useEffect(() => {
    if (!p) return
    let el: Element | null = null
    let primera = true
    const medir = () => {
      const nuevo = p.sel ? document.querySelector(`[data-ayuda="${p.sel}"]`) : null
      if (nuevo !== el) {
        el = nuevo
        if (el && primera) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); primera = false }
      }
      const r = el?.getBoundingClientRect()
      setRect(r && r.width + r.height > 0 ? r : null)
    }
    medir()
    const t = window.setInterval(medir, 250)
    window.addEventListener('scroll', medir, true)
    window.addEventListener('resize', medir)
    return () => { window.clearInterval(t); window.removeEventListener('scroll', medir, true); window.removeEventListener('resize', medir) }
  }, [p])

  // Pasos que avanzan solos al tocar el elemento resaltado
  useEffect(() => {
    if (!p?.alTocar || !p.sel) return
    const alClic = (e: MouseEvent) => {
      if ((e.target as Element).closest?.(`[data-ayuda="${p.sel}"]`)) window.setTimeout(siguiente, 50)
    }
    document.addEventListener('click', alClic, true)
    return () => document.removeEventListener('click', alClic, true)
  }, [p, siguiente])

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (guia) terminar(); else setAbierto(false) } }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [guia, terminar])

  function empezar(g: Guia, mostrar = false) { setAbierto(false); setQ(''); setGuia(g); setPaso(0); setAuto(mostrar); setFestejo(false) }
  const circuito = mias.find((g) => g.id === 'circuito')

  // Posición de la tarjeta: debajo del elemento, o arriba si no entra; en celular, abajo de todo
  const posicion = useMemo((): CSSProperties | undefined => {
    if (!rect || window.innerWidth < 700) return undefined
    const ancho = 340, alto = 230, m = 12, lugarAvatar = 96   // Brote va a la izquierda de la tarjeta
    const left = Math.min(Math.max(m + lugarAvatar, rect.left), window.innerWidth - ancho - m)
    if (rect.bottom + alto + m < window.innerHeight) return { top: rect.bottom + m, left }
    if (rect.top - alto - m > 0) return { top: rect.top - m, left, transform: 'translateY(-100%)' }
    return { bottom: m, left }
  }, [rect])

  if (!perfil || !mias.length) return null

  return (
    <>
      <button className="btn-ayuda" onClick={() => setAbierto(!abierto)} aria-expanded={abierto} aria-haspopup="dialog">
        <span aria-hidden="true">?</span> Ayuda
      </button>

      {abierto && <div className="ay-fondo" onClick={() => setAbierto(false)} />}
      {abierto && (
        <aside className="ay-panel" role="dialog" aria-label="Ayuda">
          <div className="ay-cab">
            <h2 style={{ margin: 0 }}>¿Qué querés hacer?</h2>
            <button className="link" onClick={() => setAbierto(false)}>Cerrar</button>
          </div>
          <div className="ay-hola">
            <Avatar tamano={64} />
            <div>
              <b>¡Hola! Soy Brote.</b>
              <p className="small" style={{ margin: '2px 0 8px' }}>Elegí una guía y te voy mostrando en la pantalla dónde se hace cada cosa.</p>
              {circuito && <button className="pri" onClick={() => empezar(circuito, true)}>▶ Mostrame el circuito completo</button>}
            </div>
          </div>
          <input type="search" placeholder="Buscar: imprimir, certificado, vencimiento…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Buscar en la ayuda" />
          <div className="ay-lista">
            {lista.length === 0 && <p className="muted">No hay guías con esa palabra.</p>}
            {lista.map(([grupo, gs]) => (
              <section key={grupo}>
                <h3>{grupo}</h3>
                {gs.map((g) => (
                  <button key={g.id} className="ay-guia" onClick={() => empezar(g)}>
                    <b>{g.titulo}</b><span className="muted small">{g.pasos.length} {g.pasos.length === 1 ? 'paso' : 'pasos'}</span>
                  </button>))}
              </section>))}
          </div>
          <p className="muted small" style={{ margin: 0 }}>Durante la guía podés seguir usando la pantalla. Esc la cierra.</p>
        </aside>)}

      {guia && p && <>
        {rect && <div className="ay-foco" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} />}
        <div className={`ay-tarjeta${rect ? '' : ' suelta'}`} style={posicion} role="dialog" aria-label={`Guía: ${guia.titulo}`}>
          <div className="ay-avatar"><Avatar ref={avatar} angulo={festejo ? null : angulo} hablando={!listo} festejo={festejo} /></div>
          <div className="ay-meta"><span>{guia.titulo}</span><span>{paso + 1} de {guia.pasos.length}</span></div>
          <div className="ay-progreso" aria-hidden="true"><span style={{ width: `${((paso + 1) / guia.pasos.length) * 100}%` }} /></div>
          <h3>{festejo ? '¡Listo!' : p.titulo}</h3>
          <p onClick={completar} aria-live="polite">
            {festejo ? 'Eso es todo. Cuando quieras, me llamás desde Ayuda.' : mostrado}
            {!festejo && !listo && <span className="ay-cursor" aria-hidden="true">▍</span>}
            {/* el texto completo para lectores de pantalla */}
            {!festejo && <span className="sr-only">{texto.slice(mostrado.length)}</span>}
          </p>
          {auto && listo && esperaAccion && !festejo && <p className="ay-espera small">{p.alTocar && rect ? '👆 Tocá lo resaltado y sigo.' : 'Te espero acá.'}</p>}
          {!festejo && <div className="ay-botones">
            <button className="link" onClick={terminar}>Salir</button>
            <button className="link" onClick={() => setAuto(!auto)} title={auto ? 'Pausar' : 'Que avance solo'}>{auto ? 'Pausar' : '▶ Mostrame'}</button>
            <span style={{ flex: 1 }} />
            {paso > 0 && <button onClick={() => setPaso(paso - 1)}>Anterior</button>}
            <button className="pri" onClick={siguiente}>{paso + 1 >= guia.pasos.length ? 'Listo' : 'Siguiente'}</button>
          </div>}
        </div>
      </>}
    </>
  )
}
