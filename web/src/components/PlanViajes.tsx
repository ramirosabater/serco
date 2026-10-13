import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fd, fnum, hoy, num, umL } from '../lib/formato'
import type { UM } from '../lib/tipos'

// Planificador de viajes a disposición final: reparte lo almacenado en viajes según
// vencimiento del plazo en planta, capacidad (batea o cisterna), estado físico y
// residuos que no pueden viajar juntos. Propone el destino habitual de cada corriente.

export interface Residuo {
  id: number; numero: string; fecha: string; dias_restantes: number; generador: string
  corriente_id: number; corriente: string; grupo_incompat: string | null; cantidad: number; um: UM
}
interface Op { id: number; nombre: string }
interface Viaje { id: number; grupo: string; items: number[]; destino: string }
interface Config { capS: number; capL: number; mezclaS: boolean; mezclaM: boolean }

type Estado = 'liq' | 'semi' | 'sol'
const ESTADO_NOMBRE: Record<Estado, string> = { liq: 'Líquido', semi: 'Semisólido', sol: 'Sólido' }
const estadoDe = (e: string | undefined): Estado => { const x = (e ?? '').toLowerCase(); return x.startsWith('l') ? 'liq' : x.startsWith('semi') ? 'semi' : 'sol' }
const sumar = (s: string, d: number) => { const x = new Date(s + 'T12:00:00'); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10) }

export default function PlanViajes({ filas, operadores, habilitadas, puedeEditar, onUsar }: {
  filas: Residuo[]; operadores: Op[]; habilitadas: Record<number, Set<number>>; puedeEditar: boolean
  onUsar: (ids: number[], operador: string) => void
}) {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [estados, setEstados] = useState<Record<number, Estado>>({})
  const [habituales, setHabituales] = useState<Record<number, number[]>>({})
  const [viajes, setViajes] = useState<Viaje[]>([])
  const [fuera, setFuera] = useState<number[]>([])
  const [version, setVersion] = useState(0)

  useEffect(() => {
    supabase.from('parametros').select('clave, valor').like('clave', 'plan_%').then(({ data }) => {
      const p = Object.fromEntries((data ?? []).map((x) => [x.clave, x.valor]))
      setCfg({ capS: Number(p.plan_capacidad_solidos) || 12000, capL: Number(p.plan_capacidad_liquidos) || 25000,
        mezclaS: (p.plan_mezclar_solidos ?? 'si') === 'si', mezclaM: (p.plan_mezclar_barros ?? 'no') === 'si' })
    })
    supabase.from('corrientes').select('id, estado_fisico').then(({ data }) =>
      setEstados(Object.fromEntries((data ?? []).map((c) => [c.id, estadoDe(c.estado_fisico)]))))
    supabase.rpc('destinos_habituales').then(({ data }) => {
      const m: Record<number, { op: number; n: number }[]> = {}
      for (const x of (data ?? []) as { corriente_id: number; operador_id: number; residuos: number }[]) (m[x.corriente_id] ??= []).push({ op: x.operador_id, n: x.residuos })
      setHabituales(Object.fromEntries(Object.entries(m).map(([k, l]) => [k, l.sort((a, b) => b.n - a.n).map((x) => x.op)])))
    })
  }, [])

  const porId = useMemo(() => new Map(filas.map((f) => [f.id, f])), [filas])
  const grupoDe = (f: Residuo, c: Config) => {
    const e = estados[f.corriente_id] ?? 'sol'
    if (f.grupo_incompat) return `X:${f.grupo_incompat}:${f.um}`
    if (e === 'liq') return `L:${f.corriente}:${f.um}`
    if (e === 'semi') return c.mezclaM ? `M:${f.um}` : `M:${f.corriente}:${f.um}`
    return c.mezclaS ? `S:${f.um}` : `S:${f.corriente}:${f.um}`
  }
  const capDe = (g: string, c: Config) => (g.startsWith('L:') ? c.capL : c.capS)
  /** Operador habilitado para todas las corrientes (si no tiene corrientes cargadas, no se controla) */
  const acepta = (op: number, corrientes: number[]) => !habilitadas[op] || corrientes.every((c) => habilitadas[op].has(c))
  const destinoPara = (corrientes: number[]) => {
    const habit = habituales[corrientes[0]] ?? []
    const candidatos = [...habit, ...operadores.filter((o) => habilitadas[o.id]).map((o) => o.id)]
    return String(candidatos.find((op) => habilitadas[op] && acepta(op, corrientes)) ?? candidatos.find((op) => acepta(op, corrientes)) ?? '')
  }

  // Armar el plan: lo que vence primero va primero; cada residuo entra en el primer viaje de su grupo con lugar
  useEffect(() => {
    if (!cfg || !Object.keys(estados).length) return
    const orden = [...filas].sort((a, b) => a.dias_restantes - b.dias_restantes || b.cantidad - a.cantidad)
    const l: (Viaje & { carga: number })[] = []
    let n = 1
    // Cada viaje va a un solo operador: primero se elige el destino de cada residuo y se agrupa por destino
    const destinos = new Map<number, string>()
    for (const f of orden) {
      if (!destinos.has(f.corriente_id)) destinos.set(f.corriente_id, destinoPara([f.corriente_id]))
      const destino = destinos.get(f.corriente_id)!
      const g = `${grupoDe(f, cfg)}|${destino}`, cap = capDe(g, cfg)
      let v = l.find((x) => x.grupo === g && x.carga + f.cantidad <= cap)
      if (!v) { v = { id: n++, grupo: g, items: [], destino, carga: 0 }; l.push(v) }
      v.items.push(f.id); v.carga += f.cantidad
    }
    setViajes(l.map(({ carga: _c, ...v }) => v)); setFuera([])
  }, [filas, cfg, estados, habituales, operadores, habilitadas, version]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!cfg) return <p className="cargando">Calculando los viajes…</p>
  if (!filas.length) return <p className="vacio">No hay residuos almacenados para planificar.</p>

  const hoyS = hoy()
  const datos = viajes.map((v) => {
    const its = v.items.map((i) => porId.get(i)!).filter(Boolean)
    const carga = its.reduce((a, x) => a + x.cantidad, 0)
    const minDias = Math.min(...its.map((x) => x.dias_restantes))
    const cap = capDe(v.grupo, cfg)
    const corrientes = [...new Set(its.map((x) => x.corriente_id))]
    return { v, its, carga, cap, minDias, corrientes }
  }).filter((x) => x.its.length).sort((a, b) => a.minDias - b.minDias)
  const ahora = datos.filter((x) => x.minDias <= 30 || x.carga / x.cap >= 0.85)
  const vencidos = datos.filter((x) => x.minDias < 0).length

  const mover = (desde: number, item: number, a: string) => {
    if (a === 'fuera') setFuera((f) => [...f, item])
    setViajes((vs) => {
      let l = vs.map((v) => (v.id === desde ? { ...v, items: v.items.filter((i) => i !== item) } : v))
      if (a === 'fuera') { /* queda fuera del plan */ }
      else if (a === 'nuevo') { const o = vs.find((v) => v.id === desde)!; l.push({ id: Math.max(...vs.map((v) => v.id)) + 1, grupo: o.grupo, items: [item], destino: o.destino }) }
      else l = l.map((v) => (v.id === Number(a) ? { ...v, items: [...v.items, item] } : v))
      return l.filter((v) => v.items.length)
    })
  }
  const tipo = (gg: string) => {
    const g = gg.split('|')[0]
    const [k, a] = g.split(':')
    if (k === 'L') return `Líquido · solo ${a}`
    if (k === 'X') return `Viaja aparte · grupo ${a}`
    const e: Estado = k === 'M' ? 'semi' : 'sol'
    return g.split(':').length === 2 ? `${ESTADO_NOMBRE[e]}s mezclados` : `${ESTADO_NOMBRE[e]} · ${a}`
  }

  return (
    <>
      <div className="plan-cfg">
        <label className="campo">Batea (sólidos y barros)<span className="con-unidad"><input type="number" step={500} value={cfg.capS} onChange={(e) => setCfg({ ...cfg, capS: Number(e.target.value) || 1 })} /> kg</span></label>
        <label className="campo">Cisterna (líquidos)<span className="con-unidad"><input type="number" step={500} value={cfg.capL} onChange={(e) => setCfg({ ...cfg, capL: Number(e.target.value) || 1 })} /> kg o l</span></label>
        <div className="tildes" style={{ alignSelf: 'end' }}>
          <label className="tilde"><input type="checkbox" checked={cfg.mezclaS} onChange={(e) => setCfg({ ...cfg, mezclaS: e.target.checked })} /> Mezclar sólidos entre sí</label>
          <label className="tilde"><input type="checkbox" checked={cfg.mezclaM} onChange={(e) => setCfg({ ...cfg, mezclaM: e.target.checked })} /> Mezclar barros entre sí</label>
        </div>
      </div>
      <p className="muted small" style={{ margin: '6px 0 0' }}>Los líquidos viajan de a una corriente; los residuos de grupos incompatibles (baterías, ácidos, bases…) viajan aparte. Los valores por defecto se cambian en Configuración.</p>

      <div className="aviso ok bar" style={{ justifyContent: 'space-between', margin: '14px 0' }}>
        <span><b>Te conviene enviar {ahora.length} de {datos.length} viajes ahora</b>: tienen residuos que vencen en 30 días o menos, o están casi llenos.
          {vencidos > 0 && ` ${vencidos === 1 ? 'Uno ya tiene' : `${vencidos} ya tienen`} residuos fuera de plazo.`} El resto puede esperar a completarse.</span>
        <button type="button" onClick={() => setVersion((x) => x + 1)}>Volver a calcular</button>
      </div>

      <div className="viajes">{datos.map((x, k) => {
        const pct = Math.round((x.carga / x.cap) * 100)
        const destino = Number(x.v.destino)
        const noAcepta = destino && habilitadas[destino] ? [...new Set(x.its.filter((i) => !habilitadas[destino].has(i.corriente_id)).map((i) => i.corriente))] : []
        const unidad = x.its[0] ? umL(x.its[0].um) : 'kg'
        const otros = datos.filter((y) => y.v.grupo === x.v.grupo && y.v.id !== x.v.id)
        return (
          <div key={x.v.id} className={`card viaje ${x.carga > x.cap ? 'excede' : ''}`}>
            <div className="bar" style={{ justifyContent: 'space-between', margin: 0 }}>
              <div><h2 style={{ margin: 0 }}>Viaje {k + 1}</h2><div className="muted small">{tipo(x.v.grupo)}</div></div>
              <span className={`pill ${x.minDias < 0 ? 'bad' : x.minDias <= 30 ? 'haz' : 'ok'}`}>{x.minDias < 0 ? `Fuera de plazo hace ${-x.minDias} días` : `Vence en ${x.minDias} días`}</span>
            </div>
            <div className="capacidad"><div style={{ width: `${Math.min(100, pct)}%` }} /></div>
            <div className={`small ${x.carga > x.cap ? 'err' : 'muted'}`} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{num(Math.round(x.carga))} de {num(x.cap)} {unidad}</span>
              <span>{x.carga > x.cap ? 'Un solo residuo supera la capacidad: va en varios viajes del operador' : `${pct} % de la capacidad`}</span>
            </div>
            <div className="tw viaje-lista"><table className="compacta"><tbody>{x.its.map((i) => (
              <tr key={i.id}>
                <td className="nw"><b>{fnum(i.numero)}</b><div className="muted small">{i.generador}</div></td>
                <td><span className="pill">{i.corriente}</span><div className={`small ${i.dias_restantes < 0 ? 'err' : i.dias_restantes <= 30 ? 'haz-t' : 'muted'}`}>{i.dias_restantes < 0 ? 'fuera de plazo' : `vence ${fd(sumar(hoyS, i.dias_restantes))}`}</div></td>
                <td className="n">{num(i.cantidad)} {umL(i.um)}</td>
                <td style={{ width: 1 }}><select className="mover" value="" onChange={(e) => e.target.value && mover(x.v.id, i.id, e.target.value)} aria-label={`Mover ${i.corriente} del ${fnum(i.numero)}`}>
                  <option value="">Mover…</option>
                  {otros.map((y) => <option key={y.v.id} value={y.v.id}>Al viaje {datos.indexOf(y) + 1}</option>)}
                  <option value="nuevo">A un viaje nuevo</option>
                  <option value="fuera">Dejar en planta</option>
                </select></td>
              </tr>))}
            </tbody></table></div>
            {noAcepta.length > 0 && <div className="aviso bad small">El operador elegido no está habilitado para {noAcepta.join(', ')}.</div>}
            <div className="bar" style={{ margin: '10px 0 0' }}>
              <label className="small">Destino <select value={x.v.destino} onChange={(e) => setViajes((vs) => vs.map((v) => (v.id === x.v.id ? { ...v, destino: e.target.value } : v)))}>
                <option value="">Elegí el operador</option>
                {operadores.map((o) => <option key={o.id} value={o.id}>{o.nombre}{acepta(o.id, x.corrientes) ? '' : ' · no acepta todo'}</option>)}
              </select></label>
              {puedeEditar && <button type="button" className="pri" data-ayuda="pl-usar" disabled={!x.v.destino || noAcepta.length > 0}
                onClick={() => onUsar(x.its.map((i) => i.id), x.v.destino)}>Armar este viaje</button>}
            </div>
          </div>)
      })}
      </div>
      {fuera.length > 0 && <div className="card mt">
        <h2>Quedan en planta ({fuera.length})</h2>
        <p className="small muted">Los sacaste del plan. "Volver a calcular" los reincorpora.</p>
        {fuera.map((i) => porId.get(i)).filter(Boolean).map((f) => <span key={f!.id} className="pill" style={{ margin: 2 }}>{fnum(f!.numero)} · {f!.corriente}</span>)}
      </div>}
    </>
  )
}
