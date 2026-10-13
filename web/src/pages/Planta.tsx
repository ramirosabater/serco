import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { traerTodo } from '../lib/paginar'
import { supabase, mensajeError } from '../lib/supabase'
import { fd, fnum, hoy, num, umL } from '../lib/formato'
import type { UM } from '../lib/tipos'
import { useAuth } from '../auth/AuthProvider'

interface EnPlanta {
  id: number; manifiesto_id: number; numero: string; fecha: string; dias_en_planta: number; dias_restantes: number
  generador_principal_id: number | null; planta: string | null; generador: string; corriente_id: number; corriente: string
  grupo_incompat: string | null; contenedor: string | null; cantidad: number; um: UM
}
interface EnTransito {
  id: number; cantidad: number; um: UM; corrientes: { codigo: string } | null
  manifiestos: { id: number; numero: string; generadores: { nombre: string } | null } | null
  manifiestos_nacion: { id: number; numero: string; fecha: string; operador_id: number | null; operadores: { nombre: string } | null } | null
}
interface Op { id: number; nombre: string }
interface Flota { id: number; nombre: string; capacidad?: number | null; capacidad_um?: string | null }

const haceUnAnio = () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10) }
const totales = (l: { cantidad: number; um: UM }[]) =>
  (['KGS', 'LTS', 'MS3'] as UM[]).map((u) => [u, l.filter((x) => x.um === u).reduce((a, x) => a + x.cantidad, 0)] as const).filter(([, v]) => v > 0)

export default function Planta() {
  const [sp, setSp] = useSearchParams()
  const vista = sp.get('v') === 'transito' ? 'transito' : 'armar'
  return (
    <>
      <h1>Planta</h1>
      <p className="sub">Armá la carga a disposición final con lo que está almacenado y registrá el certificado cuando vuelve.</p>
      <nav className="bar" aria-label="Planta" style={{ marginBottom: 18 }}>
        <a href="?v=armar" className={`subnav ${vista === 'armar' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setSp({}) }}>Armar carga</a>
        <a href="?v=transito" className={`subnav ${vista === 'transito' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setSp({ v: 'transito' }) }}>En tránsito y certificados</a>
      </nav>
      {vista === 'armar' ? <ArmarCarga /> : <EnTransitoLista />}
    </>
  )
}

function ArmarCarga() {
  const { puedeEditar } = useAuth()
  const [plantas, setPlantas] = useState<Op[]>([])
  const [planta, setPlanta] = useState('')
  const [desde, setDesde] = useState(haceUnAnio())
  const [filas, setFilas] = useState<EnPlanta[]>([])
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [cargando, setCargando] = useState(true)
  const [operadores, setOperadores] = useState<Op[]>([])
  const [habilitadas, setHabilitadas] = useState<Record<number, Set<number>>>({})
  const [transportistas, setTransportistas] = useState<Op[]>([])
  const [form, setForm] = useState({ numero: '', fecha: hoy(), operador: '', transportista: '', camion: '', chofer: '' })
  const [camiones, setCamiones] = useState<Flota[]>([])
  const [choferes, setChoferes] = useState<Flota[]>([])
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    supabase.from('generadores_principales').select('id, nombre').eq('activo', true).order('nombre').then(({ data }) => {
      const l = (data ?? []) as Op[]; setPlantas(l)
      setPlanta(String(l.find((p) => p.nombre === 'SERCO AMBIENTAL SA')?.id ?? l[0]?.id ?? ''))
    })
    supabase.from('operadores').select('id, nombre').eq('activo', true).order('nombre').then(({ data }) => setOperadores((data ?? []) as Op[]))
    supabase.from('operador_corrientes').select('operador_id, corriente_id').then(({ data }) => {
      const m: Record<number, Set<number>> = {}
      ;(data ?? []).forEach((x: { operador_id: number; corriente_id: number }) => { (m[x.operador_id] ??= new Set()).add(x.corriente_id) })
      setHabilitadas(m)
    })
    supabase.from('transportistas').select('id, nombre, emite_manifiestos').eq('activo', true).order('nombre').then(({ data }) => {
      const l = (data ?? []) as (Op & { emite_manifiestos: boolean })[]; setTransportistas(l)
      const s = l.find((t) => t.nombre === 'SERCO AMBIENTAL SA') ?? l.find((t) => t.emite_manifiestos)
      if (s) setForm((f) => ({ ...f, transportista: String(s.id) }))
    })
  }, [])

  const cargar = () => {
    if (!planta) return
    setCargando(true)
    traerTodo<EnPlanta>(() => supabase.from('residuos_en_planta').select('*').eq('generador_principal_id', Number(planta)).gte('fecha', desde)
      .order('fecha').order('numero').order('id'))
      .then(({ data, error }) => { setError(mensajeError(error)); setFilas(data); setSel(new Set()); setCargando(false) })
  }
  useEffect(cargar, [planta, desde]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!form.transportista) return
    const t = Number(form.transportista)
    supabase.from('camiones').select('id, patente, capacidad, capacidad_um').eq('transportista_id', t).eq('activo', true).order('patente')
      .then(({ data }) => setCamiones((data ?? []).map((c) => ({ id: c.id, nombre: c.patente, capacidad: c.capacidad, capacidad_um: c.capacidad_um }))))
    supabase.from('choferes').select('id, nombre').eq('transportista_id', t).eq('activo', true).order('nombre')
      .then(({ data }) => setChoferes((data ?? []) as Flota[]))
  }, [form.transportista])

  const elegidos = filas.filter((f) => sel.has(f.id))
  const corrientesSel = useMemo(() => [...new Set(elegidos.map((f) => f.corriente_id))], [elegidos])
  const grupos = [...new Set(elegidos.map((f) => f.grupo_incompat).filter(Boolean))]
  const camion = camiones.find((c) => String(c.id) === form.camion)
  const kgs = elegidos.filter((f) => f.um === 'KGS').reduce((a, f) => a + f.cantidad, 0)
  const excede = camion?.capacidad && camion.capacidad_um === 'KGS' && kgs > camion.capacidad
  /** operador habilitado para todo lo elegido (si no tiene corrientes cargadas, no se controla) */
  const opApto = (id: number) => !habilitadas[id] || corrientesSel.every((c) => habilitadas[id].has(c))
  const noHabilitadas = form.operador && habilitadas[Number(form.operador)]
    ? [...new Set(elegidos.filter((f) => !habilitadas[Number(form.operador)].has(f.corriente_id)).map((f) => f.corriente))] : []

  function alternar(id: number) { setOk(''); setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }) }

  /** Sugerencia: lo más antiguo primero, solo corrientes que acepta el operador elegido,
   *  sin mezclar grupos incompatibles y sin pasarse de la capacidad del camión */
  function sugerir() {
    const cap = camion?.capacidad_um === 'KGS' && camion.capacidad ? camion.capacidad : Infinity
    const acepta = form.operador ? habilitadas[Number(form.operador)] : undefined
    const n = new Set<number>(); let suma = 0; let grupo: string | null | undefined
    for (const f of [...filas].sort((a, b) => a.dias_restantes - b.dias_restantes)) {
      if (acepta && !acepta.has(f.corriente_id)) continue
      if (grupo === undefined) grupo = f.grupo_incompat
      if (f.grupo_incompat && grupo && f.grupo_incompat !== grupo) continue
      if (f.um === 'KGS' && suma + f.cantidad > cap) continue
      n.add(f.id); if (f.um === 'KGS') suma += f.cantidad
      grupo = grupo ?? f.grupo_incompat
      if (cap === Infinity && n.size >= 20) break
    }
    setSel(n)
  }

  async function armar(e: FormEvent) {
    e.preventDefault(); setError(''); setOk('')
    if (!elegidos.length) { setError('Elegí al menos un residuo.'); return }
    setEnviando(true)
    const { data, error } = await supabase.rpc('armar_nacion', {
      p_numero: form.numero.replace(/\D/g, ''), p_fecha: form.fecha, p_transportista: Number(form.transportista),
      p_operador: Number(form.operador), p_camion: form.camion ? Number(form.camion) : null, p_chofer: form.chofer ? Number(form.chofer) : null,
      p_items: elegidos.map((f) => f.id),
    })
    setEnviando(false)
    if (error) { setError(mensajeError(error)); return }
    setOk(`Manifiesto Nación ${fnum(form.numero)} armado con ${elegidos.length} residuos. Quedan en tránsito hasta que llegue el certificado.`)
    setForm((f) => ({ ...f, numero: '' })); cargar(); void data
  }

  const fueraPlazo = filas.filter((f) => f.dias_restantes < 0).length

  return (
    <>
      <div className="bar">
        <label className="small">Planta <select value={planta} onChange={(e) => setPlanta(e.target.value)}>{plantas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
        <label className="small">Retirados desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <span className="muted small">{filas.length} residuos almacenados{fueraPlazo ? `, ${fueraPlazo} fuera de plazo` : ''}</span>
      </div>
      {error && <div className="aviso bad" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
      {ok && <div className="aviso ok" role="status" style={{ marginBottom: 12 }}>{ok} <Link to="/planta?v=transito">Ver en tránsito</Link></div>}
      <div className="grid c21">
        <div className="card">
          <div className="bar" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Almacenado</h2>
            <span className="bar" style={{ margin: 0 }}>
              <button type="button" onClick={sugerir} disabled={!filas.length} title="Elegí antes el operador y el camión para que la sugerencia respete sus corrientes y su capacidad">Sugerir carga</button>
              {sel.size > 0 && <button type="button" onClick={() => setSel(new Set())}>Limpiar</button>}
            </span>
          </div>
          {cargando ? <p className="cargando">Cargando…</p> : filas.length === 0 ? <p className="vacio">No hay residuos almacenados de esta planta en el período.</p> : (
            <div className="tw" style={{ maxHeight: '62vh', overflowY: 'auto' }}><table>
              <thead><tr><th></th><th>Manifiesto</th><th>Retiro</th><th>En planta</th><th>Generador</th><th>Corriente</th><th style={{ textAlign: 'right' }}>Cantidad</th></tr></thead>
              <tbody>{filas.map((f) => (
                <tr key={f.id} className="fila" onClick={() => alternar(f.id)}>
                  <td><input type="checkbox" checked={sel.has(f.id)} onChange={() => alternar(f.id)} onClick={(e) => e.stopPropagation()} aria-label={`Elegir ${f.corriente} del ${fnum(f.numero)}`} /></td>
                  <td className="nw">{fnum(f.numero)}</td><td className="nw">{fd(f.fecha)}</td>
                  <td className="nw"><span className={`pill ${f.dias_restantes < 0 ? 'bad' : f.dias_restantes < 30 ? 'haz' : ''}`}>{f.dias_en_planta} días</span></td>
                  <td>{f.generador}</td><td><b>{f.corriente}</b>{f.grupo_incompat && <span className="muted small"> {f.grupo_incompat}</span>}</td>
                  <td className="n">{num(f.cantidad)} {umL(f.um)}</td>
                </tr>))}
              </tbody>
            </table></div>)}
        </div>

        <form className="card stack" onSubmit={armar} style={{ alignSelf: 'start', position: 'sticky', top: 80 }}>
          <h2 style={{ margin: 0 }}>Manifiesto Nación</h2>
          {!elegidos.length && <p className="muted small" style={{ margin: 0 }}>Elegí el operador y el camión y tocá "Sugerir carga": propone lo más antiguo que ese operador acepta, sin pasarse del camión.</p>}
          <div>
            <b>{elegidos.length} residuos</b> · {totales(elegidos).map(([u, v]) => `${num(v)} ${umL(u)}`).join(' + ') || 'nada elegido'}
            {elegidos.length > 0 && <div className="muted small">{corrientesSel.length} corrientes</div>}
          </div>
          {grupos.length > 1 && <div className="aviso bad">Hay residuos de grupos que no pueden viajar juntos: {grupos.join(', ')}.</div>}
          {excede && <div className="aviso haz">Se pasa de la capacidad del camión ({num(camion!.capacidad!)} kg).</div>}
          <label className="campo">Número del Manifiesto Nación
            <input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} required inputMode="numeric" placeholder="Del formulario verde" />
          </label>
          <label className="campo">Fecha<input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} required /></label>
          <label className="campo">Operador de disposición final
            <select value={form.operador} onChange={(e) => setForm({ ...form, operador: e.target.value })} required>
              <option value="">Elegí el operador</option>
              {operadores.map((o) => <option key={o.id} value={o.id}>{o.nombre}{elegidos.length && !opApto(o.id) ? ' · no habilitado para todo' : ''}</option>)}
            </select>
          </label>
          {noHabilitadas.length > 0 && <div className="aviso bad">El operador no está habilitado para: {noHabilitadas.join(', ')}.</div>}
          <label className="campo">Transportista
            <select value={form.transportista} onChange={(e) => setForm({ ...form, transportista: e.target.value, camion: '', chofer: '' })} required>
              {transportistas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </label>
          <label className="campo">Camión
            <select value={form.camion} onChange={(e) => setForm({ ...form, camion: e.target.value })} required>
              <option value="">Elegí el camión</option>
              {camiones.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.capacidad ? ` · ${num(c.capacidad)} ${c.capacidad_um === 'LTS' ? 'l' : 'kg'}` : ''}</option>)}
            </select>
          </label>
          <label className="campo">Chofer
            <select value={form.chofer} onChange={(e) => setForm({ ...form, chofer: e.target.value })} required>
              <option value="">Elegí el chofer</option>
              {choferes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          {puedeEditar
            ? <button className="pri" disabled={enviando || !elegidos.length || grupos.length > 1}>{enviando ? 'Armando…' : 'Armar Manifiesto Nación'}</button>
            : <p className="muted small">Tu usuario es de consulta.</p>}
          <p className="muted small" style={{ margin: 0 }}>Al armarlo se controlan los vencimientos del camión y el chofer y las corrientes del operador.</p>
        </form>
      </div>
    </>
  )
}

function EnTransitoLista() {
  const { puedeEditar } = useAuth()
  const [items, setItems] = useState<EnTransito[]>([])
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState<number | null>(null)
  const [cert, setCert] = useState({ numero: '', fecha: hoy(), tratamiento: '' })
  const [archivo, setArchivo] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [enviando, setEnviando] = useState(false)

  const cargar = () => {
    setCargando(true)
    traerTodo<EnTransito>(() => supabase.from('manifiesto_items')
      .select('id, cantidad, um, corrientes(codigo), manifiestos(id, numero, generadores(nombre)), manifiestos_nacion(id, numero, fecha, operador_id, operadores(nombre))')
      .eq('estado', 'en_transito').order('id'))
      .then(({ data, error }) => { setError(mensajeError(error)); setItems(data); setCargando(false) })
  }
  useEffect(cargar, [])

  const naciones = useMemo(() => {
    const m = new Map<number, { n: NonNullable<EnTransito['manifiestos_nacion']>; items: EnTransito[] }>()
    items.forEach((i) => { if (!i.manifiestos_nacion) return; const g = m.get(i.manifiestos_nacion.id) ?? { n: i.manifiestos_nacion, items: [] }; g.items.push(i); m.set(g.n.id, g) })
    return [...m.values()].sort((a, b) => b.n.fecha.localeCompare(a.n.fecha))
  }, [items])

  async function registrar(e: FormEvent, n: NonNullable<EnTransito['manifiestos_nacion']>) {
    e.preventDefault(); setError(''); setOk(''); setEnviando(true)
    let ruta: string | null = null
    if (archivo) {
      const ext = (archivo.name.split('.').pop() || 'pdf').toLowerCase()
      const { data: r } = await supabase.rpc('ruta_documento', { tipo: 'certificado', numero: cert.numero.trim(), operador_id: n.operador_id, ext })
      ruta = r as string
      const { error } = await supabase.storage.from('documentos').upload(ruta, archivo, { upsert: true, contentType: archivo.type || undefined })
      if (error) { setError('No se pudo subir el PDF del certificado: ' + mensajeError(error)); setEnviando(false); return }
    }
    const { error } = await supabase.rpc('registrar_certificado', {
      p_numero: cert.numero.trim(), p_fecha: cert.fecha, p_nacion: n.id, p_items: null, p_archivo: ruta, p_tipo_tratamiento: cert.tratamiento || null,
    })
    setEnviando(false)
    if (error) { setError(mensajeError(error)); return }
    setOk(`Certificado ${cert.numero} registrado. Queda en la lista para avisar a los generadores.`)
    setAbierto(null); setCert({ numero: '', fecha: hoy(), tratamiento: '' }); setArchivo(null); cargar()
  }

  return (
    <>
      {error && <div className="aviso bad" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
      {ok && <div className="aviso ok" role="status" style={{ marginBottom: 12 }}>{ok}</div>}
      <div className="card">
        <h2>Manifiestos Nación esperando certificado ({naciones.length})</h2>
        {cargando ? <p className="cargando">Cargando…</p> : naciones.length === 0 ? <p className="vacio">No hay residuos en tránsito.</p> : (
          <div className="stack" style={{ gap: 0 }}>{naciones.map(({ n, items }) => (
            <div key={n.id} style={{ borderBottom: '1px solid var(--line)', padding: '12px 0' }}>
              <div className="bar" style={{ justifyContent: 'space-between', margin: 0 }}>
                <span><b>{fnum(n.numero)}</b> · {fd(n.fecha)} · {n.operadores?.nombre ?? 'sin operador'}
                  <span className="muted small"> · {items.length} residuos · {totales(items).map(([u, v]) => `${num(v)} ${umL(u)}`).join(' + ')}</span></span>
                {puedeEditar && abierto !== n.id && <button type="button" onClick={() => { setAbierto(n.id); setOk('') }}>Registrar certificado</button>}
              </div>
              {abierto === n.id && (
                <form className="stack mt" onSubmit={(e) => registrar(e, n)}>
                  <div className="muted small">{items.map((i) => `${i.corrientes?.codigo} ${num(i.cantidad)} ${umL(i.um)} (${i.manifiestos?.generadores?.nombre})`).join(' · ')}</div>
                  <div className="campos">
                    <label className="campo">Número del certificado<input value={cert.numero} onChange={(e) => setCert({ ...cert, numero: e.target.value })} required autoFocus /></label>
                    <label className="campo">Fecha<input type="date" value={cert.fecha} onChange={(e) => setCert({ ...cert, fecha: e.target.value })} required /></label>
                    <label className="campo">Tratamiento<input value={cert.tratamiento} onChange={(e) => setCert({ ...cert, tratamiento: e.target.value })} placeholder="D1, D10, R9…" /></label>
                    <label className="campo">PDF del certificado<input type="file" accept=".pdf,image/*" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} /></label>
                  </div>
                  <div className="bar"><button className="pri" disabled={enviando}>{enviando ? 'Registrando…' : 'Registrar certificado'}</button>
                    <button type="button" onClick={() => setAbierto(null)}>Cancelar</button></div>
                </form>)}
            </div>))}
          </div>)}
      </div>
    </>
  )
}
