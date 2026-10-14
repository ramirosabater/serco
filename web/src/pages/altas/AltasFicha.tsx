import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, mensajeError } from '../../lib/supabase'
import { entidad, estadoVto, ETIQUETA_ESTADO, type Campo, type Documento, type Entidad } from '../../lib/altas'
import { cuitValido, soloDigitos } from '../../lib/cuit'
import { fd } from '../../lib/formato'
import { leerCertificado, NOMBRE_TIPO } from '../../lib/leerCertificado'
import { useAuth } from '../../auth/AuthProvider'
import { MenuAltas } from './AltasLista'
import CorrientesHabilitadas from '../../components/CorrientesHabilitadas'
import DireccionesRetiro from '../../components/DireccionesRetiro'
import ResumenGenerador from '../../components/ResumenGenerador'

type Valores = Record<string, unknown>

/** Traduce los errores de la base a algo que se entienda */
function errorAmigable(e: unknown, ent: Entidad): string {
  const err = e as { code?: string; message?: string }
  if (err?.code === '23505') return `Ya existe un ${ent.singular} con ese ${ent.campos[0].label.toLowerCase()}.`
  if (err?.code === '42501') return 'Tu usuario no tiene permiso para hacer cambios.'
  return mensajeError(e)
}

function CampoInput({ c, v, set, refs, soloLectura }: { c: Campo; v: unknown; set: (v: unknown) => void; refs: Record<string, { id: number; nombre: string }[]>; soloLectura: boolean }) {
  const comun = { disabled: soloLectura, required: c.req, id: `c-${c.k}` }
  let input
  switch (c.tipo) {
    case 'bool':
      return (
        <label className="campo" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, gridColumn: 'span 2' }}>
          <input type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked)} disabled={soloLectura} /> {c.label}
        </label>)
    case 'opciones':
      input = <select {...comun} value={(v as string) ?? ''} onChange={(e) => set(e.target.value || null)}>
        <option value="">—</option>{c.opciones!.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
      break
    case 'ref':
      input = <select {...comun} value={(v as number) ?? ''} onChange={(e) => set(e.target.value ? Number(e.target.value) : null)}>
        <option value="">—</option>{(refs[c.k] ?? []).map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
      break
    case 'numero':
      input = <input {...comun} type="number" step="any" value={(v as number) ?? ''} onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))} />
      break
    case 'fecha':
      input = <input {...comun} type="date" value={(v as string) ?? ''} onChange={(e) => set(e.target.value || null)} />
      break
    default:
      input = <input {...comun} type={c.tipo === 'email' ? 'email' : 'text'} value={(v as string) ?? ''}
        onChange={(e) => set(c.tipo === 'cuit' ? soloDigitos(e.target.value) || null : e.target.value || null)}
        inputMode={c.tipo === 'cuit' ? 'numeric' : undefined} />
  }
  const cuitMal = c.tipo === 'cuit' && typeof v === 'string' && v && !cuitValido(v)
  return (
    <label className="campo" htmlFor={`c-${c.k}`} style={c.ancho === 'doble' ? { gridColumn: 'span 2' } : undefined}>
      {c.label}{c.req && ' *'}
      {input}
      {cuitMal ? <span className="ayuda" style={{ color: 'var(--bad)' }}>El CUIT no es válido: revisá los números.</span> : c.ayuda && <span className="ayuda">{c.ayuda}</span>}
    </label>
  )
}

function FilaDocumento({ d, valores, set, tabla, id, soloLectura, onError, onGuardado }: {
  d: Documento; valores: Valores; set: (k: string, v: unknown) => void; tabla: string; id: number | null; soloLectura: boolean; onError: (s: string) => void
  /** Lo que ya quedó grabado en la base al subir el archivo (no queda como "cambio sin guardar") */
  onGuardado: (cambios: Valores) => void
}) {
  const [subiendo, setSubiendo] = useState(false)
  const vto = valores[d.vto] as string | null
  const archivo = d.archivo ? (valores[d.archivo] as string | null) : null
  const est = estadoVto(vto)

  const [lectura, setLectura] = useState<{ ok: boolean; t: string } | null>(null)
  const dniFicha = String(valores.dni ?? valores.carnet_nro ?? '').replace(/\D/g, '')

  async function subir(f: File) {
    if (!id || !d.archivo) { onError('Guardá primero la ficha y después subí el archivo.'); return }
    setLectura(null)
    let vence = vto
    const leido: Valores = {}
    // Certificados que el sistema sabe leer: se controla el DNI y se toma el vencimiento
    if (d.lector) {
      setSubiendo(true)
      const l = await leerCertificado(f)
      setSubiendo(false)
      if (l && l.tipo !== d.lector) {
        setLectura({ ok: false, t: l.tipo === 'curso'
          ? `Es el ${NOMBRE_TIPO.curso}${l.fecha ? ` aprobado el ${fd(l.fecha)}` : ''} y no trae vencimiento. El vencimiento lo da Seguridad Vial: subí su PDF o una captura donde se vea el código QR.`
          : `Este archivo es un ${NOMBRE_TIPO[l.tipo]}: subilo en la fila que corresponde.` })
        return
      }
      if (l?.dni && dniFicha && l.dni !== dniFicha) {
        setLectura({ ok: false, t: `El certificado es de ${l.nombre ?? 'otra persona'} (DNI ${l.dni}) y este chofer tiene DNI ${dniFicha}. No se subió.` })
        return
      }
      if (l?.vence) vence = l.vence
      setLectura(l ? { ok: true, t: `Leído del certificado${l.nombre ? ` de ${l.nombre}` : ''}: ${l.detalle}.${l.vence && l.vence !== vto ? ' Quedó guardado el vencimiento.' : ''}` }
        : { ok: false, t: 'No se pudo leer el certificado: se sube igual, cargá el vencimiento a mano.' })
      if (l?.vence) leido[d.vto] = l.vence
      if (l?.dni && !valores.dni && 'dni' in valores) leido.dni = l.dni
    }
    setSubiendo(true)
    const ext = (f.name.split('.').pop() || 'pdf').toLowerCase()
    const ruta = `habilitaciones/${tabla}/${id}/${d.archivo}-${vence ?? 'sin-fecha'}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('documentos').upload(ruta, f, { upsert: false, contentType: f.type || undefined })
    if (error) { onError('No se pudo subir el archivo: ' + mensajeError(error)); setSubiendo(false); return }
    // El archivo y lo leído del certificado (vencimiento, DNI) se graban juntos
    const cambios: Valores = { [d.archivo]: ruta, ...leido }
    const { error: e2 } = await supabase.from(tabla).update(cambios).eq('id', id)
    setSubiendo(false)
    if (e2) { onError(mensajeError(e2)); setLectura(null) } else onGuardado(cambios)
  }

  /** Al tocar el enlace a la consulta oficial se copia el DNI (el enlace abre la página en otra pestaña por sí solo) */
  function copiarDni() {
    if (dniFicha) navigator.clipboard?.writeText(dniFicha).catch(() => { /* sin portapapeles */ })
    setLectura({ ok: true, t: dniFicha ? `DNI ${dniFicha} copiado: en la página que se abrió, pegalo (Ctrl+V), tildá "No soy un robot", bajá el certificado y subilo acá.` : 'Cargá el DNI del chofer en Datos para que se copie solo.' })
  }

  async function ver() {
    if (!archivo) return
    if (archivo.startsWith('\\') || /^[A-Z]:\\/i.test(archivo)) { onError('Este archivo todavía está en la PC del Access: se copia en la migración de archivos.'); return }
    const { data, error } = await supabase.storage.from('documentos').createSignedUrl(archivo, 300)
    if (error || !data) onError('No se pudo abrir el archivo: ' + mensajeError(error)); else window.open(data.signedUrl, '_blank', 'noopener')
  }

  return (
    <>
    <tr>
      <td><b>{d.label}</b>
        {d.consultas && !soloLectura && <div className="consultas">{d.consultas.map((c) => (
          <a key={c.url} href={c.url} target="_blank" rel="noopener noreferrer" onClick={copiarDni} title="Abre la página oficial en otra pestaña y copia el DNI">Consultar en {c.nombre} ↗</a>))}
        </div>}
      </td>
      <td>{d.nro ? <input value={(valores[d.nro] as string) ?? ''} onChange={(e) => set(d.nro!, e.target.value || null)} disabled={soloLectura} aria-label={`Número de ${d.label}`} style={{ width: '100%', minWidth: 110 }} /> : <span className="muted">—</span>}</td>
      <td><input type="date" value={vto ?? ''} onChange={(e) => set(d.vto, e.target.value || null)} disabled={soloLectura} aria-label={`Vencimiento de ${d.label}`} /></td>
      <td><span className={`pill ${ETIQUETA_ESTADO[est][1]}`}>{est === 'vigente' || est === 'por_vencer' ? `Vence ${fd(vto)}` : ETIQUETA_ESTADO[est][0]}</span></td>
      <td className="nw small">
        {d.archivo && <>
          {archivo && <button type="button" className="link" onClick={ver}>Ver</button>}
          {!soloLectura && <label style={{ marginLeft: archivo ? 10 : 0, cursor: 'pointer' }} className="small">
            <input type="file" accept=".pdf,image/*" hidden onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])} disabled={subiendo} />
            <span className="link" style={{ color: 'var(--acc)', textDecoration: 'underline', fontWeight: 600 }}>{subiendo ? 'Subiendo…' : archivo ? 'Reemplazar' : 'Subir escaneo'}</span>
          </label>}
          {!archivo && soloLectura && <span className="muted">Sin archivo</span>}
        </>}
        {subiendo && d.lector && <div className="muted small">Leyendo el certificado…</div>}
      </td>
    </tr>
    {lectura && <tr className="lectura"><td colSpan={5}><div className={`aviso ${lectura.ok ? 'ok' : 'haz'} small`}>{lectura.t}</div></td></tr>}
    </>
  )
}

export default function AltasFicha() {
  const { entidad: clave, id: idParam } = useParams()
  const e = entidad(clave)!
  const nav = useNavigate()
  const { puedeEditar } = useAuth()
  const esNuevo = idParam === 'nuevo'
  const id = esNuevo ? null : Number(idParam)
  const [original, setOriginal] = useState<Valores>({})
  const [valores, setValores] = useState<Valores>({})
  const [refs, setRefs] = useState<Record<string, { id: number; nombre: string }[]>>({})
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [guardando, setGuardando] = useState(false)
  const soloLectura = !puedeEditar

  useEffect(() => {
    setError(''); setOk('')
    if (esNuevo) { const ini: Valores = { [e.activo]: true }; setOriginal(ini); setValores(ini); return }
    supabase.from(e.tabla).select('*').eq('id', id!).maybeSingle().then(({ data, error }) => {
      if (error || !data) setError(error ? mensajeError(error) : `No existe este ${e.singular}.`)
      else { setOriginal(data); setValores(data) }
    })
  }, [e, id, esNuevo])

  useEffect(() => {
    e.campos.filter((c) => c.tipo === 'ref').forEach((c) => {
      const columnas: string = `id, ${c.ref!.label}`
      supabase.from(c.ref!.tabla).select(columnas).order(c.ref!.label).then(({ data }) => {
        const filas = (data ?? []) as unknown as Record<string, unknown>[]
        setRefs((r) => ({ ...r, [c.k]: filas.map((x) => ({ id: x.id as number, nombre: String(x[c.ref!.label]) })) }))
      })
    })
  }, [e])

  const set = (k: string, v: unknown) => { setOk(''); setValores((x) => ({ ...x, [k]: v })) }
  const cambios = Object.fromEntries(Object.entries(valores).filter(([k, v]) => v !== original[k]))
  const hayCambios = Object.keys(cambios).length > 0

  async function guardar(ev: FormEvent) {
    ev.preventDefault()
    setError(''); setOk(''); setGuardando(true)
    const datos = { ...cambios }
    if (typeof datos.patente === 'string') datos.patente = datos.patente.toUpperCase().trim()
    if (esNuevo) {
      const { data, error } = await supabase.from(e.tabla).insert(datos).select('id').single()
      setGuardando(false)
      if (error) { setError(errorAmigable(error, e)); return }
      nav(`/altas/${e.clave}/${data.id}`, { replace: true })
    } else {
      const { data, error } = await supabase.from(e.tabla).update(datos).eq('id', id!).select('*').single()
      setGuardando(false)
      if (error) { setError(errorAmigable(error, e)); return }
      setOriginal(data); setValores(data); setOk('Cambios guardados.')
    }
  }

  async function cambiarActivo(activo: boolean) {
    const { data, error } = await supabase.from(e.tabla).update({ [e.activo]: activo }).eq('id', id!).select('*').single()
    if (error) setError(errorAmigable(error, e)); else { setOriginal(data); setValores(data); setOk(activo ? 'Dado de alta de nuevo.' : 'Dado de baja: ya no aparece para emitir.') }
  }

  const nombre = String(original[e.nombre] ?? '')
  const activo = valores[e.activo] !== false

  return (
    <>
    <form onSubmit={guardar}>
      <MenuAltas />
      <p><Link to={`/altas/${e.clave}`}>Volver a {e.titulo.toLowerCase()}</Link></p>
      <div className="bar" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <h1>{esNuevo ? `Agregar ${e.singular}` : nombre}</h1>
        {!esNuevo && !activo && <span className="pill">Dado de baja</span>}
      </div>
      <p className="sub">{esNuevo ? 'Completá los datos y guardá. Los escaneos se suben después de guardar.' : e.ayuda}</p>
      {error && <div className="aviso bad" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
      {ok && <div className="aviso ok" role="status" style={{ marginBottom: 12 }}>{ok}</div>}
      {!esNuevo && id && e.clave === 'generadores' && <ResumenGenerador id={Number(id)} nombre={nombre} />}

      <div className="card" data-ayuda="ficha-datos">
        <h2>Datos</h2>
        <div className="campos">{e.campos.map((c) => <CampoInput key={c.k} c={c} v={valores[c.k]} set={(v) => set(c.k, v)} refs={refs} soloLectura={soloLectura} />)}</div>
      </div>

      {e.documentos.length > 0 && (
        <div className="card mt" data-ayuda="ficha-vtos">
          <h2>Documentos y vencimientos</h2>
          <div className="tw"><table>
            <thead><tr><th>Documento</th><th>Número</th><th>Vence</th><th>Estado</th><th>Escaneo</th></tr></thead>
            <tbody>{e.documentos.map((d) => <FilaDocumento key={d.vto} d={d} valores={valores} set={set} tabla={e.tabla} id={id} soloLectura={soloLectura} onError={setError}
              onGuardado={(c) => { setOriginal((o) => ({ ...o, ...c })); setValores((v) => ({ ...v, ...c })) }} />)}</tbody>
          </table></div>
        </div>)}

      {!soloLectura && (
        <div className="bar mt" style={{ justifyContent: 'flex-end', position: 'sticky', bottom: 0, background: 'var(--bg)', padding: '10px 0' }}>
          {!esNuevo && (activo
            ? <button type="button" className="peligro" onClick={() => cambiarActivo(false)}>Dar de baja</button>
            : <button type="button" onClick={() => cambiarActivo(true)}>Dar de alta de nuevo</button>)}
          <span style={{ flex: 1 }} />
          {hayCambios && <span className="muted small">Hay cambios sin guardar</span>}
          <button className="pri" data-ayuda="ficha-guardar" disabled={guardando || !hayCambios}>{guardando ? 'Guardando…' : esNuevo ? `Agregar ${e.singular}` : 'Guardar cambios'}</button>
        </div>)}
    </form>
    {!esNuevo && id && e.extras?.includes('direcciones') && <DireccionesRetiro generadorId={id} soloLectura={soloLectura} />}
    {!esNuevo && id && e.corrientes && <CorrientesHabilitadas config={e.corrientes} id={id} soloLectura={soloLectura} />}
    </>
  )
}
