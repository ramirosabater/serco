import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { supabase, mensajeError } from '../lib/supabase'
import { fd, fnum, num, umL } from '../lib/formato'
import type { Instrucciones, UM } from '../lib/tipos'
import { instruccionesPorDefecto } from '../lib/instrucciones'

// Impresión sobre el formulario azul preimpreso de la Provincia (manifiesto de retiro).
// Posiciones en milímetros, medidas sobre el formulario original escaneado (Manifiesto_Serco_Escaneado.pdf).
// Lo preimpreso (número, transportista Serco Ambiental, títulos) NO se imprime.

interface Datos {
  id: number; numero: string; fecha: string; tipo: 'azul' | 'rosa'; anulado: boolean; direccion_retiro: string | null; instrucciones: Instrucciones | null
  generadores: { nombre: string; cuit: string | null; ciudad: string | null; hab_mun_nro: string | null; hab_mun_vto: string | null } | null
  generadores_principales: { nombre: string; cuit: string | null; hab_pro_nro: string | null; hab_pro_vto: string | null } | null
  transportistas: { nombre: string; hab_pro_vto: string | null } | null
  camiones: { patente: string; tipo: string | null; carga_pel_nro: string | null; carga_pel_vto: string | null } | null
  choferes: { nombre: string; carnet_nro: string | null; carga_pel_vto: string | null } | null
  manifiesto_items: { id: number; contenedor: string | null; cant_estimada: number | null; cantidad: number; um: UM
    corrientes: { codigo: string; descripcion: string | null; estado_fisico: string | null } | null }[]
}

const SELECT = `id, numero, fecha, tipo, anulado, direccion_retiro, instrucciones,
  generadores(nombre, cuit, ciudad, hab_mun_nro, hab_mun_vto),
  generadores_principales(nombre, cuit, hab_pro_nro, hab_pro_vto),
  transportistas(nombre, hab_pro_vto),
  camiones(patente, tipo, carga_pel_nro, carga_pel_vto),
  choferes(nombre, carnet_nro, carga_pel_vto),
  manifiesto_items(id, contenedor, cant_estimada, cantidad, um, corrientes(codigo, descripcion, estado_fisico))`

const RENGLONES = 7
const cuitF = (c?: string | null) => (c && /^\d{11}$/.test(c) ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c ?? '')

/** Corta un texto en renglones de hasta n caracteres, sin partir palabras */
function cortar(s: string, n: number): string[] {
  const out: string[] = []; let linea = ''
  for (const p of s.split(/\s+/).filter(Boolean)) {
    if ((linea + ' ' + p).trim().length > n && linea) { out.push(linea); linea = p } else linea = (linea + ' ' + p).trim()
  }
  if (linea) out.push(linea)
  return out.length ? out : ['']
}

/** Un dato en el formulario: x e y (centro del renglón) en mm, ancho en mm */
function F({ x, y, w, t, c }: { x: number; y: number; w: number; t?: ReactNode; c?: 'sm' | 'xs' | 'x' | 'dos' }) {
  if (t == null || t === '') return null
  const dos = c === 'dos'   // texto largo: letra más chica, hasta dos renglones dentro de la misma celda
  return <div className={`fd ${c ?? ''}`} style={{ left: `${x}mm`, top: `${y - (dos ? 2.2 : 1.8)}mm`, width: `${w}mm` }}>{t}</div>
}
/** Ajusta la letra al largo del texto para que entre en la celda */
const ajuste = (t: string | null | undefined, max: number) => (t && t.length > max ? 'dos' : 'xs') as 'dos' | 'xs'

interface Calib { x: number; y: number }
const leerCalib = (): Calib => { try { return JSON.parse(localStorage.getItem('sgrp-calib-azul') ?? '') } catch { return { x: 0, y: 0 } } }

export default function ImprimirManifiesto() {
  const { id } = useParams()
  const [m, setM] = useState<Datos | null>(null)
  const [p, setP] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [calib, setCalib] = useState<Calib>(leerCalib)
  const [guia, setGuia] = useState(true)
  const [escala, setEscala] = useState(1)
  const marco = useRef<HTMLDivElement>(null)
  const [sp] = useSearchParams()
  // Qué secciones salen: al emitir la 1, 2, 4 y 5 (más fechas); al entrar a planta, la 3 (residuos)
  const [que, setQue] = useState<'sin3' | '3' | 'todo' | ''>(sp.get('que') === '3' ? '3' : '')

  useEffect(() => {
    supabase.from('manifiestos').select(SELECT).eq('id', Number(id)).maybeSingle()
      .then(({ data, error }) => { if (error || !data) setError(error ? mensajeError(error) : 'No existe este manifiesto.'); else setM(data as unknown as Datos) })
    supabase.from('parametros').select('clave, valor').like('clave', 'form_%')
      .then(({ data }) => setP(Object.fromEntries((data ?? []).map((x) => [x.clave, x.valor]))))
  }, [id])

  useEffect(() => { try { localStorage.setItem('sgrp-calib-azul', JSON.stringify(calib)) } catch { /* sin almacenamiento */ } }, [calib])
  useEffect(() => { document.body.classList.add('modo-formulario'); return () => document.body.classList.remove('modo-formulario') }, [])

  // La hoja se achica para entrar en pantalla; al imprimir sale a tamaño real
  useLayoutEffect(() => {
    const ajustar = () => { if (marco.current) setEscala(Math.min(1, (marco.current.clientWidth - 24) / (210 * 96 / 25.4))) }
    ajustar(); addEventListener('resize', ajustar); return () => removeEventListener('resize', ajustar)
  }, [m])

  if (error) return <p className="aviso bad">{error}</p>
  if (!m) return <p className="cargando">Preparando la impresión…</p>
  const volver = <p><Link to={`/manifiestos/${m.id}`}>Volver al manifiesto</Link></p>
  if (m.tipo !== 'azul') return <>{volver}<div className="aviso haz">Este manifiesto es de otro transportista (formulario rosa): lo completa el transportista y no se imprime desde el sistema.</div></>
  if (m.anulado) return <>{volver}<div className="aviso bad">El manifiesto está anulado.</div></>

  const g = m.generadores, op = m.generadores_principales, ca = m.camiones, ch = m.choferes
  const d = fd(m.fecha)
  const items = m.manifiesto_items
  const lineas = items.map((i) => cortar(i.corrientes?.descripcion ?? '', 18))
  const unaLinea = lineas.reduce((a, l) => a + l.length, 0) > RENGLONES
  // Bloque 4: las del manifiesto; si no tiene (los del Access), las de Configuración → Parámetros
  const ins = m.instrucciones ?? instruccionesPorDefecto(p)
  const parte = que || (items.length ? 'todo' : 'sin3')
  const con3 = parte !== 'sin3', conResto = parte !== '3'

  const filas: ReactNode[] = []
  let r = 0
  items.forEach((i, k) => {
    const desc = unaLinea ? [i.corrientes?.descripcion ?? ''] : lineas[k]
    desc.forEach((ln, kk) => {
      if (r >= RENGLONES) return
      const y = 117.8 + r * 4.2
      if (kk === 0) filas.push(
        <F key={`t${k}`} x={18} y={y} w={15.5} t={i.contenedor ?? (i.um === 'LTS' ? 'Cisterna' : '')} c="sm" />,
        <F key={`e${k}`} x={36} y={y} w={25} t={i.cant_estimada != null ? num(i.cant_estimada) : ''} />,
        <F key={`q${k}`} x={64.5} y={y} w={19.5} t={num(i.cantidad)} />,
        <F key={`u${k}`} x={112.5} y={y} w={22} t={umL(i.um)} />,
        <F key={`f${k}`} x={136} y={y} w={26} t={i.corrientes?.estado_fisico ?? ''} c="sm" />,
        <F key={`c${k}`} x={163.5} y={y} w={29} t={i.corrientes?.codigo} />)
      filas.push(<F key={`d${k}-${kk}`} x={85.5} y={y} w={26} t={ln} c={unaLinea ? 'xs' : 'sm'} />)
      r++
    })
  })

  const datos = (
    <>
      {conResto && <>
      {/* 1. Datos identificatorios */}
      <F x={85.5} y={60.6} w={25.5} t={g?.nombre} c={ajuste(g?.nombre, 20)} />
      <F x={112} y={60.9} w={26} t={cuitF(g?.cuit)} />
      <F x={139.5} y={60.9} w={26} t={g?.hab_mun_nro ?? ''} />
      <F x={167} y={60.9} w={26} t={g?.hab_mun_vto ? fd(g.hab_mun_vto) : ''} />
      <F x={167} y={65.4} w={26} t={m.transportistas?.hab_pro_vto ? fd(m.transportistas.hab_pro_vto) : ''} />
      <F x={85.5} y={69.7} w={25.5} t={op?.nombre} c={ajuste(op?.nombre, 20)} />
      <F x={112} y={70} w={26} t={cuitF(op?.cuit)} />
      <F x={139.5} y={70} w={26} t={op?.hab_pro_nro ?? ''} />
      <F x={167} y={70} w={26} t={op?.hab_pro_vto ? fd(op.hab_pro_vto) : ''} />
      {/* 2. Transportista */}
      <F x={67} y={87.6} w={45} t={ca?.tipo ?? 'Camión'} />
      <F x={114} y={87.6} w={22} t={ca?.patente} />
      <F x={138.5} y={87.6} w={26} t={ca?.carga_pel_nro ?? ''} />
      <F x={167} y={87.6} w={26} t={ca?.carga_pel_vto ? fd(ca.carga_pel_vto) : ''} />
      <F x={41} y={98.2} w={53} t={ch?.nombre} />
      <F x={115} y={100.2} w={26} t={ch?.carnet_nro ?? ''} />
      <F x={160} y={98.2} w={32} t={ch?.carga_pel_vto ? fd(ch.carga_pel_vto) : ''} />
      </>}
      {/* 3. Residuos */}
      {con3 && filas}
      {conResto && <>
      {/* 4. Instrucciones de manipulación */}
      <F x={67} y={158} w={40} t={ins.inhalacion} />
      <F x={67} y={162.5} w={40} t={ins.dermica} />
      <F x={67} y={166.8} w={40} t={ins.oral} />
      {/* Sistema de identificación de peligrosidad: inflamabilidad, reactividad, toxicidad, instrucciones especiales */}
      {([[136.6, 157.2], [168.5, 156.9], [128.4, 161.5], [182.3, 161.3]] as const).map(([x, y], k) => ins.peligros[k] && <F key={`p${k}`} x={x} y={y} w={4} t="X" c="x" />)}
      {/* 5. Instructivos: X en SI (adjunta) o en NO */}
      {[178.7, 186.5, 194.3, 202.2, 210.1].map((y, k) => (
        <F key={y} x={ins.instructivos[k] ? 148.5 : 176.5} y={y} w={4} t="X" c="x" />))}
      {/* 6. Certificaciones */}
      <F x={152} y={228.8} w={40} t={d} />
      <F x={110} y={236.4} w={38} t="Chofer" />
      <F x={152} y={236.4} w={40} t={d} />
      {/* 7. Declaración jurada */}
      <F x={19} y={268.8} w={64} t={d} />
      <F x={19} y={272.8} w={66} t={[m.direccion_retiro, g?.ciudad].filter(Boolean).join(' · ')} c={ajuste([m.direccion_retiro, g?.ciudad].filter(Boolean).join(' · '), 44)} />
      <F x={87} y={273} w={60} t={d} />
      </>}
    </>
  )

  const hoja: CSSProperties = { transform: `scale(${escala})`, transformOrigin: 'top left' }
  const avisos = [
    con3 && !items.length && 'Todavía no se cargaron los residuos (sección 3): esa parte sale en blanco.',
    con3 && items.length > RENGLONES && `El manifiesto tiene ${items.length} residuos y el formulario tiene ${RENGLONES} renglones: se imprimen los primeros ${RENGLONES}. El resto va en un segundo formulario.`,
    !g?.cuit && 'El generador no tiene CUIT cargado.',
    !ca?.carga_pel_nro && 'El camión no tiene número de registro de carga peligrosa.',
    !ch?.carnet_nro && 'El chofer no tiene número de licencia cargado.',
  ].filter(Boolean) as string[]

  return (
    <>
      <div className="no-imprimir">
        {volver}
        <h1>Imprimir manifiesto {fnum(m.numero)}</h1>
        <p className="sub">Sobre el formulario azul preimpreso. A mano quedan solo las firmas.</p>
      </div>
      <div className="impresion">
        <div className="marco no-imprimir-fondo" ref={marco}>
          <div className="hoja-escala" style={{ height: `calc(297mm * ${escala})` }}>
            <div className={`hoja ${guia ? 'con-guia' : ''}`} style={hoja}>
              {guia && <img className="guia" src="/formulario-azul.jpg" alt="" />}
              <div className="capa" style={{ transform: `translate(${calib.x}mm, ${calib.y}mm)` }}>{datos}</div>
            </div>
          </div>
        </div>
        {/* Copia solo para la impresora: fuera de la app, a tamaño real y sin el fondo */}
        {createPortal(<div className="hoja-print"><div className="capa" style={{ transform: `translate(${calib.x}mm, ${calib.y}mm)` }}>{datos}</div></div>, document.body)}
        <div className="card stack no-imprimir" style={{ alignSelf: 'start' }} data-ayuda="imp-panel">
          <h2 style={{ margin: 0 }}>Antes de imprimir</h2>
          <p className="small muted" style={{ margin: 0 }}>Poné el formulario azul en la bandeja. Imprimí en A4, a escala 100 % y sin márgenes.</p>
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 4 }} data-ayuda="imp-que">
            <legend className="small muted" style={{ marginBottom: 4 }}>Qué imprimir</legend>
            <label className="small"><input type="radio" name="que" checked={parte === 'sin3'} onChange={() => setQue('sin3')} /> Al emitir: secciones 1, 2, 4 y 5</label>
            <label className="small"><input type="radio" name="que" checked={parte === '3'} onChange={() => setQue('3')} disabled={!items.length} /> Al entrar a planta: solo la sección 3 (residuos)</label>
            <label className="small"><input type="radio" name="que" checked={parte === 'todo'} onChange={() => setQue('todo')} /> Todo el formulario</label>
          </fieldset>
          {avisos.length > 0 && <div className="aviso haz small"><ul style={{ margin: 0, paddingLeft: 18 }}>{avisos.map((a) => <li key={a}>{a}</li>)}</ul></div>}
          <label className="campo" data-ayuda="imp-calib">Mover a la derecha (mm)
            <input type="number" step="0.5" value={calib.x} onChange={(e) => setCalib({ ...calib, x: Number(e.target.value) || 0 })} /></label>
          <label className="campo">Mover hacia abajo (mm)
            <input type="number" step="0.5" value={calib.y} onChange={(e) => setCalib({ ...calib, y: Number(e.target.value) || 0 })} /></label>
          <span className="ayuda small muted">Si los datos salen corridos, ajustá y volvé a probar. Queda guardado en esta PC.</span>
          <label className="small" data-ayuda="imp-guia"><input type="checkbox" checked={guia} onChange={(e) => setGuia(e.target.checked)} /> Ver el formulario de fondo</label>
          <button className="pri" onClick={() => window.print()} data-ayuda="imp-imprimir">Imprimir</button>
          <span className="small muted">Se imprimen solo los datos, nunca el fondo.</span>
        </div>
      </div>
    </>
  )
}
