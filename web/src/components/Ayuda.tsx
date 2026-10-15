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
function useEscritura(texto: string, msPorLetra: number) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (sinAnimacion()) { setN(texto.length); return }
    setN(0)
    const t = window.setInterval(() => setN((x) => { if (x >= texto.length) { window.clearInterval(t); return x } return x + 1 }), msPorLetra)
    return () => window.clearInterval(t)
  }, [texto, msPorLetra])
  return { mostrado: texto.slice(0, n), listo: n >= texto.length, completar: () => setN(texto.length) }
}

const hayVoz = typeof window !== 'undefined' && 'speechSynthesis' in window
const leerPref = () => { try { return localStorage.getItem('brote-voz') !== 'no' } catch { return true } }
const guardarPref = (v: boolean) => { try { localStorage.setItem('brote-voz', v ? 'si' : 'no') } catch { /* sin almacenamiento */ } }

/** La mejor voz en castellano que tenga la computadora: primero rioplatense, después latina, después España */
function elegirVoz(): SpeechSynthesisVoice | undefined {
  const vs = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('es'))
  const pref = ['es-ar', 'es-uy', 'es-419', 'es-us', 'es-mx', 'es-cl', 'es-co', 'es-es']
  return vs.sort((a, b) => {
    const ia = pref.indexOf(a.lang.toLowerCase()), ib = pref.indexOf(b.lang.toLowerCase())
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || Number(b.localService === false) - Number(a.localService === false)
  })[0]
}

/** Brote lee el texto en voz alta. Devuelve si está hablando y si ya terminó. */
function useVoz(texto: string, activa: boolean) {
  const [hablando, setHablando] = useState(false)
  const [termino, setTermino] = useState(true)
  const [, setVoces] = useState(0)
  useEffect(() => {
    if (!hayVoz) return
    const cambio = () => setVoces((n) => n + 1)   // las voces se cargan después de abrir la página
    window.speechSynthesis.addEventListener?.('voiceschanged', cambio)
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', cambio)
  }, [])
  useEffect(() => {
    if (!hayVoz) return
    window.speechSynthesis.cancel()
    if (!activa || !texto) { setHablando(false); setTermino(true); return }
    const u = new SpeechSynthesisUtterance(texto.replace(/[·•]/g, ',').replace(/[^\p{L}\p{N}\s.,;:¿?¡!()'"-]/gu, ' '))
    const v = elegirVoz()
    if (v) u.voice = v
    u.lang = v?.lang ?? 'es-AR'
    u.rate = 0.95; u.pitch = 1.15
    u.onstart = () => setHablando(true)
    u.onend = u.onerror = () => { setHablando(false); setTermino(true) }
    setTermino(false)
    // pequeña pausa: Chrome a veces corta si se habla justo después de cancelar
    const t = window.setTimeout(() => window.speechSynthesis.speak(u), 120)
    // por si la computadora no tiene voz o no avisa cuando termina: no dejar trabada la guía
    const resguardo = window.setTimeout(() => { setHablando(false); setTermino(true) }, 2500 + texto.length * 90)
    return () => { window.clearTimeout(t); window.clearTimeout(resguardo); window.speechSynthesis.cancel() }
  }, [texto, activa])
  return { hablando, termino }
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
    window.setTimeout(terminar, sinAnimacion() ? 0 : 3500)
  }, [guia, paso, terminar])

  // Si el elemento tarda (la pantalla está cargando), no se avisa enseguida que falta: se espera un poco
  const [falta, setFalta] = useState(false)
  const hayRect = !!rect
  useEffect(() => {
    setFalta(false)
    if (!p?.sel || hayRect) return
    const t = window.setTimeout(() => setFalta(true), 2500)
    return () => window.clearTimeout(t)
  }, [p, hayRect])
  const texto = p ? (rect || !p.sel || !falta ? p.texto : (p.falta ?? 'Esperando que aparezca en pantalla…')) : ''
  const [voz, setVoz] = useState(leerPref)
  const conVoz = voz && hayVoz && !!guia
  const decir = festejo ? '¡Listo! Eso es todo.' : texto
  const { hablando, termino } = useVoz(guia ? decir : '', conVoz)
  // Con voz, el texto aparece al ritmo en que Brote habla; sin voz, un poco más rápido
  const { mostrado, listo, completar } = useEscritura(texto, conVoz ? 62 : 38)
  const esperaAccion = !!p && ((!!p.sel && !rect) || !!p.alTocar)   // en modo Mostrame, acá Brote espera

  // Modo "Mostrame": cuando termina de explicar, pasa solo al siguiente (salvo que haga falta tocar algo)
  useEffect(() => {
    if (!auto || !listo || !termino || esperaAccion || festejo) return
    // Con voz: espera a que termine de hablar. Sin voz: le da tiempo a leer.
    const t = window.setTimeout(siguiente, conVoz ? 1500 : 2800 + Math.min(texto.length * 30, 5000))
    return () => window.clearTimeout(t)
  }, [auto, listo, termino, conVoz, esperaAccion, festejo, siguiente, texto])

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
          <div className="ay-avatar"><Avatar ref={avatar} angulo={festejo ? null : angulo} hablando={!listo || hablando} festejo={festejo} /></div>
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
            {hayVoz && <button className="link" onClick={() => { setVoz(!voz); guardarPref(!voz) }} aria-pressed={voz} title="Que Brote lea en voz alta">{voz ? 'Silenciar' : 'Activar voz'}</button>}
            <span style={{ flex: 1 }} />
            {paso > 0 && <button onClick={() => setPaso(paso - 1)}>Anterior</button>}
            <button className="pri" onClick={siguiente}>{paso + 1 >= guia.pasos.length ? 'Listo' : 'Siguiente'}</button>
          </div>}
        </div>
      </>}
    </>
  )
}
