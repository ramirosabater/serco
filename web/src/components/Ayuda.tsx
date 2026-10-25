import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { areaDe, CIRCUITOS, NOMBRE_AREA, type Circuito } from '../lib/guias'
import Tito from './Tito'

// Tito, el ayudante: botón flotante abajo a la derecha, circuitos guiados por área, voz.
// Nunca guarda, borra ni envía nada: solo navega (pantallas y pestañas), resalta y explica.

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const sinAnimacion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const leer = (k: string, def: string) => { try { return localStorage.getItem(k) ?? def } catch { return def } }
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* sin almacenamiento */ } }
const hayVoz = typeof window !== 'undefined' && 'speechSynthesis' in window
const SIN_PERMISO = 'No lo encuentro en pantalla: puede que tu perfil no tenga permiso para esto.'

// ------------------------------------------------------------------ voz
// Voz de varón en castellano: primero rioplatense, después latina, después España; se evitan voces de mujer
const MUJER = /(helena|elena|laura|sabina|paulina|m[oó]nica|dalia|elvira|lupe|paloma|camila|valentina|catalina|isabela|luciana|sof[ií]a|lucia|ximena|female|mujer)/i
const VARON = /(pablo|jorge|diego|ra[uú]l|tom[aá]s|juan|carlos|enrique|alvaro|gonzalo|jos[eé]|miguel|andr[eé]s|\bmale\b|hombre)/i
function elegirVoz(): SpeechSynthesisVoice | undefined {
  const pref = ['es-ar', 'es-uy', 'es-419', 'es-us', 'es-mx', 'es-cl', 'es-co', 'es-es']
  const puntaje = (v: SpeechSynthesisVoice) => {
    const i = pref.indexOf(v.lang.toLowerCase().replace('_', '-'))
    return (i < 0 ? 50 : i * 5) + (MUJER.test(v.name) ? 100 : 0) - (VARON.test(v.name) ? 3 : 0) - (/natural|online|neural/i.test(v.name) ? 2 : 0)
  }
  return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('es')).sort((a, b) => puntaje(a) - puntaje(b))[0]
}
const paraDecir = (t: string) => t.replace(/<[^>]+>/g, ' ').replace(/[·•]/g, ',').replace(/[^\p{L}\p{N}\s.,;:¿?¡!()'"-]/gu, ' ')

/** Lee un texto en voz alta. Devuelve si está hablando y si terminó. */
function useVoz(texto: string, activa: boolean, lenta: boolean) {
  const [hablando, setHablando] = useState(false)
  const [termino, setTermino] = useState(true)
  const [dicho, setDicho] = useState('')        // el último texto que terminó de decir
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
    const u = new SpeechSynthesisUtterance(paraDecir(texto))
    const v = elegirVoz()
    if (v) u.voice = v
    u.lang = v?.lang ?? 'es-AR'
    u.rate = lenta ? 0.8 : 1; u.pitch = 0.95
    u.onstart = () => setHablando(true)
    u.onend = u.onerror = () => { setHablando(false); setTermino(true); setDicho(texto) }
    setTermino(false)
    const t = window.setTimeout(() => window.speechSynthesis.speak(u), 120)   // Chrome corta si se habla justo después de cancelar
    // por si la compu no tiene voz o no avisa cuando termina: que no se trabe el circuito
    const resguardo = window.setTimeout(() => { setHablando(false); setTermino(true) }, 2500 + texto.length * (lenta ? 110 : 90))
    return () => { window.clearTimeout(t); window.clearTimeout(resguardo); window.speechSynthesis.cancel() }
  }, [texto, activa, lenta])
  const callar = useCallback(() => { if (hayVoz) window.speechSynthesis.cancel(); setHablando(false); setTermino(true) }, [])
  return { hablando, termino, dicho, callar }
}

/** El texto aparece de a poco, al ritmo en que habla. Un clic lo completa. */
function useEscritura(texto: string, msPorLetra: number) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (sinAnimacion()) { setN(texto.length); return }
    setN(0)
    const t = window.setInterval(() => setN((x) => { if (x >= texto.length) { window.clearInterval(t); return x } return x + 1 }), msPorLetra)
    return () => window.clearInterval(t)
  }, [texto, msPorLetra])
  const completar = useCallback(() => setN(texto.length), [texto])
  return { mostrado: texto.slice(0, n), listo: n >= texto.length, completar }
}

// ------------------------------------------------------------------ dónde está lo que se explica
function buscarFoco(foco: string): Element | null {
  if (foco.startsWith('texto:')) {
    const t = normal(foco.slice(6))
    const cands = document.querySelectorAll('main button, main a, main h1, main h2, main h3, main label, main legend, main .subnav')
    return [...cands].find((e) => normal(e.textContent ?? '').includes(t) && (e as HTMLElement).offsetParent !== null) ?? null
  }
  const porNombre = document.querySelector(`[data-ayuda="${foco}"]`)
  if (porNombre) return porNombre
  try { return document.querySelector(foco) } catch { return null }
}

/** Atajos de "ir" que buscan un ejemplo real en la base (solo lectura) */
async function resolverIr(ir: string): Promise<string | null> {
  if (!ir.startsWith(':')) return ir
  const [atajo, resto] = ir.slice(1).split('/')
  if (atajo === 'manifiesto' || atajo === 'iniciado') {
    let q = supabase.from('manifiestos').select('id, et:manifiesto_etapas!inner(etapa)').eq('anulado', false)
    q = atajo === 'iniciado' ? q.eq('et.etapa', 0) : q.gte('et.etapa', 1)
    if (resto === 'imprimir') q = q.eq('tipo', 'azul')
    const { data } = await q.order('fecha', { ascending: false }).limit(1)
    const id = data?.[0]?.id
    return id ? `/manifiestos/${id}${resto ? `/${resto}` : ''}` : null
  }
  if (atajo === 'vencimiento') {
    const { data } = await supabase.from('alertas_vencimiento').select('tipo, id').in('tipo', ['camion', 'chofer'])
      .in('estado', ['por_vencer', 'vencido']).order('vto').limit(1)
    const a = data?.[0]
    return a ? `/altas/${a.tipo === 'camion' ? 'camiones' : 'choferes'}/${a.id}` : null
  }
  return null
}

declare global {
  interface Window {
    AyudaApp?: { abrir: (id?: string) => void; hablar: (texto: string, fin?: () => void) => void; callar: () => void; circuitos: Circuito[] }
  }
}

export default function Ayuda() {
  const { perfil } = useAuth()
  const { pathname } = useLocation()
  const nav = useNavigate()
  const area = areaDe(pathname)

  const [abierto, setAbierto] = useState(false)          // globo con la lista de circuitos
  const [q, setQ] = useState('')
  const [circuito, setCircuito] = useState<Circuito | null>(null)
  const [paso, setPaso] = useState(0)
  const [auto, setAuto] = useState(false)
  const [festejo, setFestejo] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [buscando, setBuscando] = useState(false)        // navegando o esperando que aparezca el elemento
  const [noEsta, setNoEsta] = useState(false)
  const [angulo, setAngulo] = useState<number | null>(null)
  const [voz, setVoz] = useState(() => leer('ayuda-voz', 'si') === 'si')
  const [lenta, setLenta] = useState(() => leer('ayuda-lenta', 'no') === 'si')
  const [hayModal, setHayModal] = useState(false)
  const [suelto, setSuelto] = useState<string | null>(null)   // lo que dice por AyudaApp.hablar
  const finSuelto = useRef<(() => void) | null>(null)
  const yo = useRef<SVGSVGElement>(null)

  const mios = useMemo(() => CIRCUITOS.filter((c) => perfil && c.roles.includes(perfil.rol)), [perfil])
  const p = circuito?.pasos[paso]

  // El área de la pantalla queda marcada en el body (la usa el traje de Tito)
  useEffect(() => { document.body.dataset.area = area }, [area])

  // Si hay una ventana abierta, Tito se achica para no tapar sus botones
  useEffect(() => {
    const t = window.setInterval(() => setHayModal(!!document.querySelector('.modal-fondo, [aria-modal="true"]')), 500)
    return () => window.clearInterval(t)
  }, [])

  const terminar = useCallback(() => { setCircuito(null); setPaso(0); setRect(null); setAuto(false); setFestejo(false); setNoEsta(false) }, [])
  const ir = useCallback((i: number, manual = true) => { if (manual) setAuto(false); setFestejo(false); setPaso(i) }, [])
  const siguiente = useCallback((manual = true) => {
    if (!circuito) return
    if (paso + 1 < circuito.pasos.length) { ir(paso + 1, manual); return }
    setAuto(false); setFestejo(true)
    window.setTimeout(terminar, sinAnimacion() ? 0 : 3200)
  }, [circuito, paso, ir, terminar])

  // ---------------- llevar a la pantalla del paso y buscar lo que se explica
  useEffect(() => {
    if (!p) return
    let vivo = true, el: Element | null = null, intervalo = 0, primera = true
    setRect(null); setNoEsta(false); setBuscando(!!p.foco)
    const medir = () => {
      const nuevo = p.foco ? buscarFoco(p.foco) : null
      if (nuevo !== el) { el = nuevo; if (el && primera) { el.scrollIntoView({ block: 'center', behavior: sinAnimacion() ? 'auto' : 'smooth' }); primera = false } }
      const r = el?.getBoundingClientRect()
      setRect(r && r.width + r.height > 0 ? r : null)
      if (r) setBuscando(false)
    }
    ;(async () => {
      if (p.ir) {
        const destino = await resolverIr(p.ir)
        if (!vivo) return
        if (!destino) { setBuscando(false); setNoEsta(true); return }
        if (window.location.pathname + window.location.search !== destino) nav(destino)
      }
      if (!p.foco) return
      // al cambiar de pantalla, se espera un poco antes de resaltar
      window.setTimeout(() => {
        if (!vivo) return
        medir()
        intervalo = window.setInterval(medir, 250)
        window.setTimeout(() => { if (vivo && !el) { setBuscando(false); setNoEsta(true) } }, 2500)
      }, 700)
    })()
    const alMover = () => el && medir()
    window.addEventListener('scroll', alMover, true); window.addEventListener('resize', alMover)
    return () => { vivo = false; window.clearInterval(intervalo); window.removeEventListener('scroll', alMover, true); window.removeEventListener('resize', alMover) }
  }, [p, nav])

  // ---------------- qué dice
  const texto = festejo ? '¡Listo! Eso es todo. Cuando quieras, tocame y seguimos.'
    : suelto ?? (p ? (noEsta && p.foco ? `${p.falta ?? SIN_PERMISO}` : p.texto) : '')
  const conVoz = voz && hayVoz && !!texto && !buscando
  const { hablando, termino, dicho, callar } = useVoz(conVoz ? texto : '', conVoz, lenta)
  const { mostrado, listo, completar } = useEscritura(buscando ? '' : texto, conVoz ? (lenta ? 80 : 62) : 30)
  // Si terminó de hablar antes de terminar de escribir, el texto se completa
  useEffect(() => { if (conVoz && dicho === texto && !listo) completar() }, [conVoz, dicho, texto, listo, completar])

  useEffect(() => { if (suelto && termino && listo && !buscando) { const f = finSuelto.current; finSuelto.current = null; setSuelto(null); f?.() } }, [suelto, termino, listo, buscando])

  // ---------------- modo automático: cuando termina de hablar, espera 1,4 s y sigue (sin voz, según el largo)
  useEffect(() => {
    if (!auto || !circuito || festejo || buscando || !listo || (conVoz && !termino)) return
    const espera = conVoz ? 1400 : Math.max(4500, texto.length * 55)
    const t = window.setTimeout(() => siguiente(false), espera)
    return () => window.clearTimeout(t)
  }, [auto, circuito, festejo, buscando, listo, conVoz, termino, texto, siguiente])

  // ---------------- hacia dónde señala
  useEffect(() => {
    if (!rect || !yo.current) { setAngulo(null); return }
    const id = window.requestAnimationFrame(() => {
      const a = yo.current?.getBoundingClientRect()
      if (!a) return
      setAngulo(Math.round(Math.atan2(rect.top + rect.height / 2 - (a.top + a.height * 0.5), rect.left + rect.width / 2 - (a.left + a.width / 2)) * 180 / Math.PI))
    })
    return () => window.cancelAnimationFrame(id)
  }, [rect])

  // ---------------- Esc: primero calla, después cierra
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (hablando) { callar(); setAuto(false); return }
      if (circuito) terminar(); else setAbierto(false)
    }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [hablando, callar, circuito, terminar])

  // Al cambiar de pantalla por cuenta propia (no por el circuito), se calla
  const ultimaRuta = useRef(pathname)
  useEffect(() => { if (ultimaRuta.current !== pathname && !circuito) callar(); ultimaRuta.current = pathname }, [pathname, circuito, callar])

  const empezar = useCallback((c: Circuito) => { setAbierto(false); setQ(''); setCircuito(c); setPaso(0); setAuto(true); setFestejo(false) }, [])

  // ---------------- API para el resto de la app
  useEffect(() => {
    window.AyudaApp = {
      abrir: (id) => { const c = id && mios.find((x) => x.id === id); if (c) empezar(c); else setAbierto(true) },
      hablar: (t, fin) => { finSuelto.current = fin ?? null; setSuelto(t) },
      callar: () => { callar(); setSuelto(null) },
      circuitos: CIRCUITOS,
    }
    return () => { delete window.AyudaApp }
  }, [mios, empezar, callar])

  const lista = useMemo(() => {
    const t = normal(q.trim())
    const filtrados = t ? mios.filter((c) => normal(`${c.titulo} ${c.pasos.map((x) => x.texto).join(' ')}`).includes(t)) : mios
    const aca = filtrados.filter((c) => c.area === area)
    const otros = filtrados.filter((c) => c.area !== area)
    return { aca, otros }
  }, [mios, q, area])

  if (!perfil || !mios.length) return null

  // Si lo resaltado cae abajo a la derecha, Tito se pasa a la izquierda para no taparlo
  const izquierda = !!rect && rect.right > window.innerWidth - 460 && rect.bottom > window.innerHeight - 320
  const enCircuito = !!circuito && !!p
  const globo = abierto || enCircuito || !!suelto

  function alternarVoz() { const v = !voz; setVoz(v); guardar('ayuda-voz', v ? 'si' : 'no'); if (!v) callar() }
  function alternarLenta() { const v = !lenta; setLenta(v); guardar('ayuda-lenta', v ? 'si' : 'no') }

  return (
    <>
      {enCircuito && rect && <div className="bt-foco" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} />}

      <div className={`bt-ayudante${izquierda ? ' izq' : ''}${hayModal && !globo ? ' chico' : ''}${globo ? ' con-globo' : ''}`} data-area={area}>
        {globo && (
          <div className="bt-globo" role="dialog" aria-label={enCircuito ? `Ayuda: ${circuito!.titulo}` : 'Ayuda'}>
            {enCircuito ? <>
              <div className="bt-meta"><span>{circuito!.titulo}</span><span>{paso + 1} de {circuito!.pasos.length}</span></div>
              <div className="bt-progreso" aria-hidden="true"><span style={{ width: `${((paso + 1) / circuito!.pasos.length) * 100}%` }} /></div>
              {!festejo && p!.titulo && <h3>{p!.titulo}</h3>}
              <p className="bt-texto" onClick={completar}>
                {buscando ? <span className="muted">Un segundo, ya te muestro…</span> : mostrado}
                {!buscando && !listo && <span className="bt-cursor" aria-hidden="true">▍</span>}
              </p>
              <span className="sr-only" aria-live="polite">{buscando ? '' : texto}</span>
              {!festejo && <>
                <div className="bt-botones">
                  <button onClick={() => ir(paso - 1)} disabled={paso === 0} aria-label="Paso anterior">‹ Anterior</button>
                  {paso + 1 < circuito!.pasos.length
                    ? <button className="pri" onClick={() => siguiente(true)}>Siguiente</button>
                    : <button className="pri" onClick={() => siguiente(true)}>¡Listo!</button>}
                </div>
                <div className="bt-controles">
                  <button className="link" onClick={() => { terminar(); setAbierto(true) }}>☰ Circuitos</button>
                  <button className="link" onClick={() => setAuto(!auto)}>{auto ? '⏸ Pausa' : '▶ Seguir'}</button>
                  {hablando && <button className="link" onClick={() => { callar(); setAuto(false) }}>⏹ Detener</button>}
                  {hayVoz && <button className="link" onClick={alternarVoz} aria-pressed={voz}>{voz ? '🔊 Voz' : '🔇 Sin voz'}</button>}
                  {hayVoz && voz && <button className="link" onClick={alternarLenta} aria-pressed={lenta}>{lenta ? '🐢 Despacio' : '🐇 Normal'}</button>}
                  <button className="link" onClick={terminar} aria-label="Cerrar la ayuda">✕</button>
                </div>
              </>}
            </> : suelto ? (
              <p className="bt-texto">{mostrado}</p>
            ) : <>
              <div className="bt-cab">
                <b>¡Hola! Soy Tito.</b>
                <button className="link" onClick={() => setAbierto(false)} aria-label="Cerrar">✕</button>
              </div>
              <p className="small" style={{ margin: '2px 0 8px' }}>Elegí qué querés aprender y te lo voy mostrando en la pantalla.</p>
              <input type="search" placeholder="Buscar: imprimir, certificado, vencimiento…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar en la ayuda" autoFocus />
              <div className="bt-lista">
                {lista.aca.length > 0 && <section><h4>En {NOMBRE_AREA[area]}</h4>
                  {lista.aca.map((c) => <button key={c.id} className="bt-circuito" onClick={() => empezar(c)}><b>{c.titulo}</b><span>{c.pasos.length} pasos</span></button>)}
                </section>}
                {lista.otros.length > 0 && <section><h4>{lista.aca.length ? 'Otros circuitos' : 'Circuitos'}</h4>
                  {lista.otros.map((c) => <button key={c.id} className="bt-circuito" onClick={() => empezar(c)}><b>{c.titulo}</b><span>{NOMBRE_AREA[c.area]}</span></button>)}
                </section>}
                {!lista.aca.length && !lista.otros.length && <p className="muted small">No encontré nada con esa palabra.</p>}
              </div>
            </>}
          </div>)}

        <button className="bt-boton" onClick={() => { if (enCircuito) return; setAbierto(!abierto) }} aria-label="Ayuda" aria-expanded={globo}
          title={enCircuito ? undefined : 'Ayuda'}>
          <Tito ref={yo} traje={area} angulo={enCircuito && !festejo ? angulo : null} hablando={hablando || (!listo && !buscando && globo)}
            festejo={festejo} saluda={abierto && !enCircuito} tamano={hayModal && !globo ? 58 : 92} />
          {!globo && <span className="bt-etiqueta">Ayuda</span>}
        </button>
      </div>
    </>
  )
}
