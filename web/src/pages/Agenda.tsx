import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, mensajeError } from '../lib/supabase'
import { traerTodo } from '../lib/paginar'
import { fd, fnum, hoy } from '../lib/formato'

// Agenda del mes: retiros hechos (manifiestos), vencimientos de habilitaciones
// y residuos que cumplen el plazo máximo en planta.

type Tipo = 'retiro' | 'vto' | 'planta'
interface Evento { dia: string; tipo: Tipo; titulo: string; detalle: string; link: string; mal?: boolean }

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const NOMBRE: Record<Tipo, [string, string]> = { retiro: ['retiro', 'retiros'], vto: ['vencimiento', 'vencimientos'], planta: ['plazo en planta', 'plazos en planta'] }
const CELDA: Record<Tipo, [string, string]> = { retiro: ['retiro', 'retiros'], vto: ['vence', 'vencen'], planta: ['plazo', 'plazos'] }
const ORDEN: Record<Tipo, number> = { retiro: 0, vto: 1, planta: 2 }
const TIPO_VTO: Record<string, [string, string]> = {
  camion: ['Camión', 'camiones'], chofer: ['Chofer', 'choferes'], generador: ['Generador', 'generadores'],
  transportista: ['Transportista', 'transportistas'], operador: ['Operador', 'operadores'], planta: ['Planta', 'plantas'],
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const desdeIso = (s: string) => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d) }
const sumar = (s: string, dias: number) => { const d = desdeIso(s); d.setDate(d.getDate() + dias); return iso(d) }
const diferencia = (a: string, b: string) => Math.round((desdeIso(a).getTime() - desdeIso(b).getTime()) / 86400000)

export default function Agenda() {
  const hoyS = hoy()
  const [mes, setMes] = useState(() => hoyS.slice(0, 7)) // AAAA-MM
  const [dia, setDia] = useState(hoyS)
  const [eventos, setEventos] = useState<Evento[] | null>(null)
  const [error, setError] = useState('')
  const [ver, setVer] = useState<Record<Tipo, boolean>>({ retiro: true, vto: true, planta: true })

  const desde = `${mes}-01`
  const hasta = useMemo(() => { const d = desdeIso(desde); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }, [desde])

  useEffect(() => {
    let vigente = true
    setEventos(null); setError('')
    Promise.all([
      traerTodo<{ id: number; numero: string; fecha: string; generadores: { nombre: string } | null }>(() =>
        supabase.from('manifiestos').select('id, numero, fecha, generadores(nombre)').eq('anulado', false).is('viaje_id', null)
          .gte('fecha', desde).lte('fecha', hasta).order('fecha').order('id')),
      supabase.from('alertas_vencimiento').select('tipo, id, nombre, documento, vto').gte('vto', desde).lte('vto', hasta),
      traerTodo<{ manifiesto_id: number; numero: string; generador: string; corriente: string; dias_restantes: number }>(() =>
        supabase.from('residuos_en_planta').select('manifiesto_id, numero, generador, corriente, dias_restantes')
          .gte('dias_restantes', diferencia(desde, hoyS)).lte('dias_restantes', diferencia(hasta, hoyS)).order('manifiesto_id')),
    ]).then(([ret, vto, pla]) => {
      if (!vigente) return
      const err = ret.error || vto.error || pla.error
      if (err) { setError(mensajeError(err)); return }
      const ev: Evento[] = []
      for (const m of ret.data) ev.push({ dia: m.fecha, tipo: 'retiro', titulo: `Manifiesto ${fnum(m.numero)}`, detalle: m.generadores?.nombre ?? '', link: `/manifiestos/${m.id}` })
      for (const v of vto.data ?? []) {
        const [t, ent] = TIPO_VTO[v.tipo] ?? [v.tipo, v.tipo]
        ev.push({ dia: v.vto, tipo: 'vto', titulo: `${t}: ${v.nombre}`, detalle: `Vence ${v.documento}`, link: `/altas/${ent}/${v.id}`, mal: v.vto < hoyS })
      }
      // Un aviso por manifiesto (puede tener varios residuos en planta)
      const porManifiesto = new Map<number, { numero: string; generador: string; corrientes: Set<string>; dias: number }>()
      for (const r of pla.data) {
        const x = porManifiesto.get(r.manifiesto_id) ?? { numero: r.numero, generador: r.generador, corrientes: new Set<string>(), dias: r.dias_restantes }
        x.corrientes.add(r.corriente); x.dias = Math.min(x.dias, r.dias_restantes)
        porManifiesto.set(r.manifiesto_id, x)
      }
      for (const [id, x] of porManifiesto) ev.push({
        dia: sumar(hoyS, x.dias), tipo: 'planta', titulo: `Plazo en planta · ${fnum(x.numero)}`,
        detalle: `${x.generador} · ${[...x.corrientes].join(', ')}`, link: `/manifiestos/${id}`, mal: x.dias < 0,
      })
      setEventos(ev)
    })
    return () => { vigente = false }
  }, [desde, hasta, hoyS])

  const porDia = useMemo(() => {
    const m = new Map<string, Evento[]>()
    for (const e of eventos ?? []) if (ver[e.tipo]) m.set(e.dia, [...(m.get(e.dia) ?? []), e])
    return m
  }, [eventos, ver])

  const totales = useMemo(() => {
    const t: Record<Tipo, number> = { retiro: 0, vto: 0, planta: 0 }
    for (const e of eventos ?? []) t[e.tipo]++
    return t
  }, [eventos])

  // Celdas del calendario, empezando el lunes
  const celdas = useMemo(() => {
    const primero = desdeIso(desde)
    const blanco = (primero.getDay() + 6) % 7
    const n = desdeIso(hasta).getDate()
    return [...Array(blanco).fill(null), ...Array.from({ length: n }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`)]
  }, [desde, hasta, mes])

  const mover = (k: number) => {
    const d = desdeIso(desde); d.setMonth(d.getMonth() + k)
    const nuevo = iso(d).slice(0, 7)
    setMes(nuevo); setDia(nuevo === hoyS.slice(0, 7) ? hoyS : `${nuevo}-01`)
  }
  const irHoy = () => { setMes(hoyS.slice(0, 7)); setDia(hoyS) }

  const [a, m] = mes.split('-').map(Number)
  const delDia = (porDia.get(dia) ?? []).slice().sort((x, y) => ORDEN[x.tipo] - ORDEN[y.tipo])

  return (
    <>
      <h1>Agenda</h1>
      <p className="sub">Retiros, vencimientos de habilitaciones y residuos que cumplen el plazo en planta, día por día.</p>
      <div className="bar">
        <button onClick={() => mover(-1)} aria-label="Mes anterior">‹</button>
        <strong className="ag-mes">{MESES[m - 1]} {a}</strong>
        <button onClick={() => mover(1)} aria-label="Mes siguiente">›</button>
        <button onClick={irHoy}>Hoy</button>
        <span className="ag-filtros" data-ayuda="agenda-filtros">
          {(Object.keys(NOMBRE) as Tipo[]).map((t) => (
            <label key={t} className={`ag-f ag-${t}`}>
              <input type="checkbox" checked={ver[t]} onChange={(e) => setVer({ ...ver, [t]: e.target.checked })} />
              {eventos ? `${totales[t]} ` : ''}{NOMBRE[t][totales[t] === 1 ? 0 : 1]}
            </label>))}
        </span>
      </div>
      {error && <p className="aviso bad">{error}</p>}
      <div className="agenda">
        <div className="card ag-cal" data-ayuda="agenda-calendario">
          <div className="ag-grid">
            {DIAS.map((d) => <div key={d} className="ag-dn">{d}</div>)}
            {celdas.map((c, i) => {
              if (!c) return <div key={`b${i}`} />
              const ev = porDia.get(c) ?? []
              const cuenta = (t: Tipo) => ev.filter((e) => e.tipo === t).length
              return (
                <button key={c} className={`ag-d${c === dia ? ' sel' : ''}${c === hoyS ? ' hoy' : ''}`} onClick={() => setDia(c)}
                  aria-label={`${Number(c.slice(8))} de ${MESES[m - 1]}: ${ev.length} eventos`}>
                  <span className="ag-n">{Number(c.slice(8))}</span>
                  {eventos && (Object.keys(NOMBRE) as Tipo[]).map((t) => cuenta(t) > 0 &&
                    <span key={t} title={`${cuenta(t)} ${NOMBRE[t][cuenta(t) === 1 ? 0 : 1]}`} className={`ag-c ag-${t}${t !== 'retiro' && ev.some((e) => e.tipo === t && e.mal) ? ' mal' : ''}`}>{cuenta(t)}<i> {CELDA[t][cuenta(t) === 1 ? 0 : 1]}</i></span>)}
                </button>)
            })}
          </div>
          {!eventos && !error && <p className="cargando">Cargando el mes…</p>}
        </div>
        <div className="card ag-det">
          <h2>{fd(dia)}{dia === hoyS ? ' · hoy' : ''}</h2>
          {!eventos ? <p className="muted">Cargando…</p> : delDia.length === 0 ? <p className="muted">Nada para este día.</p> :
            <ul className="ag-lista">{delDia.map((e, i) => (
              <li key={i} className={`ag-${e.tipo}${e.mal ? ' mal' : ''}`}>
                <Link to={e.link}>{e.titulo}</Link>
                <span className="muted small">{e.detalle}{e.mal ? (e.tipo === 'vto' ? ' · ya vencido' : ' · plazo cumplido') : ''}</span>
              </li>))}
            </ul>}
        </div>
      </div>
    </>
  )
}
