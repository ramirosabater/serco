import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { supabase, mensajeError } from '../lib/supabase'
import { etapaDe, etapaManifiesto, ETAPAS, fd, fnum, num, umL } from '../lib/formato'
import type { Item, Manifiesto } from '../lib/tipos'
import { useAuth } from '../auth/AuthProvider'
import { colorEtapa, PillEtapa } from '../components/Etapa'
import { abrirArchivo } from '../lib/archivos'

const SELECT = `*, generadores(id, nombre, cuit), generadores_principales(nombre), transportistas(id, nombre),
  choferes(nombre), camiones(patente),
  manifiesto_items(id, corriente_id, contenedor, cantidad, um, estado, fecha_entrega_df, corrientes(codigo, descripcion),
    manifiestos_nacion(id, numero, fecha, escaneo, operadores(nombre)), certificados(id, numero, fecha, archivo, enviado_cliente, operadores(nombre)))`

export default function ManifiestoDetalle() {
  const { id } = useParams()
  const { state } = useLocation() as { state?: { aviso?: string | null; emitido?: boolean } }
  const { puedeEditar, perfil } = useAuth()
  const [m, setM] = useState<Manifiesto | null>(null)
  const [error, setError] = useState('')
  const [anulando, setAnulando] = useState(false)
  const [motivo, setMotivo] = useState('')

  const cargar = () => supabase.from('manifiestos').select(SELECT).eq('id', Number(id)).maybeSingle()
    .then(({ data, error }) => {
      if (error) setError(mensajeError(error))
      else if (!data) setError('No existe este manifiesto o no tenés acceso a él.')
      setM(data as unknown as Manifiesto)
    })
  useEffect(() => { cargar() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function anular(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.rpc('anular_manifiesto', { p_manifiesto: Number(id), p_motivo: motivo })
    if (error) setError(mensajeError(error)); else { setAnulando(false); cargar() }
  }

  if (!m) return <p className="cargando">{error || 'Cargando manifiesto…'}</p>
  const items = m.manifiesto_items ?? []
  const nacion = items.find((i) => i.manifiestos_nacion)?.manifiestos_nacion
  const cert = items.find((i) => i.certificados)?.certificados
  // "Certificado" (la última etapa) es cuando todos los certificados ya se le enviaron al cliente
  const enviado = items.length > 0 && items.every((i) => i.certificados?.enviado_cliente)
  const etapa = enviado ? 3 : etapaManifiesto(items.map((i) => i.estado))
  const detalle = [
    `Retiro ${fd(m.fecha)}${m.generadores_principales ? ' · ' + m.generadores_principales.nombre : ''}`,
    nacion ? `Manifiesto Nación ${fnum(nacion.numero)} · ${fd(nacion.fecha)}` : 'Sin Manifiesto Nación',
    cert ? `${cert.operadores?.nombre ?? ''} · ${fd(cert.fecha)}` : nacion?.operadores ? `Destino ${nacion.operadores.nombre}` : 'Pendiente',
    enviado ? `Enviado al cliente ${fd(cert?.enviado_cliente?.slice(0, 10))}` : cert ? `Certificado ${cert.numero}, sin enviar` : 'Pendiente',
  ]
  const anulable = puedeEditar && !m.anulado && items.every((i) => i.estado === 'almacenado')

  return (
    <>
      <p>{perfil?.rol === 'cliente' ? <Link to="/portal">Volver a mis retiros</Link> : <Link to="/manifiestos">Volver a manifiestos</Link>}</p>
      {state?.emitido && <div className="aviso ok bar" role="status" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
        <span>Manifiesto emitido.{state.aviso && <> <b>Atención:</b> {state.aviso}</>}</span>
        {m.tipo === 'azul' && <Link to={`/manifiestos/${m.id}/imprimir`}><button className="pri">Imprimir en el formulario</button></Link>}</div>}
      <div className="bar" style={{ justifyContent: 'space-between', marginBottom: 2 }}>
        <h1>Manifiesto {fnum(m.numero)}</h1>
        {m.anulado ? <span className="pill bad">Anulado</span> : <PillEtapa etapa={etapa} />}
      </div>
      <p className="sub">{m.generadores?.nombre} · transporta {m.transportistas?.nombre} · formulario {m.tipo}</p>
      {error && <div className="aviso bad" style={{ marginBottom: 12 }}>{error}</div>}
      {m.anulado && <div className="aviso bad" style={{ marginBottom: 12 }}>Anulado. Motivo: {m.anulado_motivo}</div>}
      {m.validacion_omitida && <div className="aviso haz" style={{ marginBottom: 12 }}>Emitido con vencimientos sin regularizar. Motivo: {m.validacion_omitida}</div>}

      {!m.anulado && <div className="card" data-ayuda="det-recorrido"><h2>Recorrido del residuo</h2>
        <div className="recorrido">{ETAPAS.map((t, k) => (
          <div key={t} className={`paso ${k <= etapa ? 'hecho' : ''}`} style={colorEtapa(k)}>
            <div className="t">{t}</div><div className="m">{k <= etapa || k === 1 ? detalle[k] : 'Pendiente'}</div>
          </div>))}
        </div></div>}

      {!m.anulado && <Documentos m={m} cliente={perfil?.rol === 'cliente'} abrir={(r) => abrirArchivo(r, setError)} />}
      {perfil?.rol !== 'cliente' && <Historial m={m} />}

      <div className="grid c21 mt">
        <div className="card">
          <h2>Residuos</h2>
          <div className="tw"><table>
            <thead><tr><th>Corriente</th><th>Contenedor</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Etapa</th><th>Manif. Nación</th><th>Certificado</th></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id}>
                <td><b>{i.corrientes?.codigo}</b><div className="muted small">{i.corrientes?.descripcion}</div></td>
                <td>{i.contenedor ?? '—'}</td>
                <td className="n">{num(i.cantidad)} {umL(i.um)}</td>
                <td><PillEtapa etapa={etapaDe(i.estado)} /></td>
                <td className="nw">{i.manifiestos_nacion ? (perfil?.rol === 'cliente' ? fnum(i.manifiestos_nacion.numero) : <Link to={`/nacion/${i.manifiestos_nacion.id}`}>{fnum(i.manifiestos_nacion.numero)}</Link>) : '—'}</td>
                <td className="nw">{i.certificados
                  ? <button className="link" onClick={() => abrirArchivo(i.certificados!.archivo, setError)}>{i.certificados.numero}</button> : '—'}</td>
              </tr>))}
            </tbody>
          </table></div>
        </div>
        <div className="card">
          <h2>Datos del retiro</h2>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px' }}>
            <dt className="muted">Generador</dt><dd style={{ margin: 0 }}>{m.generadores?.nombre}<div className="muted small">CUIT {m.generadores?.cuit ?? '—'}</div></dd>
            <dt className="muted">Dirección</dt><dd style={{ margin: 0 }}>{m.direccion_retiro ?? '—'}</dd>
            <dt className="muted">Planta</dt><dd style={{ margin: 0 }}>{m.generadores_principales?.nombre ?? '—'}</dd>
            <dt className="muted">Chofer</dt><dd style={{ margin: 0 }}>{m.choferes?.nombre ?? '—'}</dd>
            <dt className="muted">Camión</dt><dd style={{ margin: 0 }}>{m.camiones?.patente ?? '—'}</dd>
            {m.nota && <><dt className="muted">Nota</dt><dd style={{ margin: 0 }}>{m.nota}</dd></>}
          </dl>
          <div className="bar mt">
            {puedeEditar && m.tipo === 'azul' && !m.anulado && <Link to={`/manifiestos/${m.id}/imprimir`} data-ayuda="det-imprimir"><button>Imprimir en el formulario</button></Link>}
            {puedeEditar && !m.anulado && <Link to={`/manifiestos/${m.id}/etiquetas`} data-ayuda="det-etiquetas"><button>Etiquetas</button></Link>}
            {m.escaneo && <button onClick={() => abrirArchivo(m.escaneo, setError)}>Ver escaneo firmado</button>}
            {anulable && !anulando && <button className="peligro" onClick={() => setAnulando(true)}>Anular manifiesto</button>}
          </div>
          {anulando && (
            <form className="stack" onSubmit={anular}>
              <label className="campo">Motivo de la anulación
                <input required value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: formulario mal completado" autoFocus />
              </label>
              <div className="bar"><button className="peligro">Confirmar anulación</button><button type="button" onClick={() => setAnulando(false)}>Cancelar</button></div>
            </form>)}
        </div>
      </div>
    </>
  )
}

/** Los papeles de cada etapa: manifiesto firmado, Manifiesto Nación, certificado y aviso al cliente */
function Documentos({ m, abrir, cliente }: { m: Manifiesto; abrir: (ruta: string | null) => void; cliente: boolean }) {
  const items = m.manifiesto_items ?? []
  const unicos = <T extends { id: number }>(l: (T | null | undefined)[]) => [...new Map(l.filter((x): x is T => !!x).map((x) => [x.id, x])).values()]
  const naciones = unicos(items.map((i) => i.manifiestos_nacion))
  const certs = unicos(items.map((i) => i.certificados))
  const filas: { etapa: number; titulo: string; detalle: string; ruta?: string | null; hecho: boolean }[] = [
    { etapa: 0, titulo: 'Manifiesto de retiro firmado', detalle: fd(m.fecha), ruta: m.escaneo, hecho: true },
    ...(naciones.length ? naciones.map((n) => ({ etapa: 1, titulo: `Manifiesto Nación ${fnum(n.numero)}`, detalle: `${fd(n.fecha)}${n.operadores ? ' · ' + n.operadores.nombre : ''}`, ruta: cliente ? null : n.escaneo, hecho: true }))
      : [{ etapa: 1, titulo: 'Manifiesto Nación', detalle: 'Pendiente', hecho: false }]),
    ...(certs.length ? certs.map((c) => ({ etapa: 2, titulo: `Certificado de disposición final ${c.numero}`, detalle: `${fd(c.fecha)}${c.operadores ? ' · ' + c.operadores.nombre : ''}`, ruta: c.archivo, hecho: true }))
      : [{ etapa: 2, titulo: 'Certificado de disposición final', detalle: 'Pendiente', hecho: false }]),
    ...(certs.length ? certs.map((c) => ({ etapa: 3, titulo: 'Aviso al cliente', detalle: c.enviado_cliente ? `Enviado por mail el ${fd(c.enviado_cliente.slice(0, 10))}` : 'Todavía no se le avisó', hecho: !!c.enviado_cliente }))
      : [{ etapa: 3, titulo: 'Aviso al cliente', detalle: 'Pendiente', hecho: false }]),
  ]
  return (
    <div className="card mt">
      <h2>Documentos del recorrido</h2>
      <div className="docs">{filas.map((f, k) => (
        <div key={k} className={`doc ${f.hecho ? '' : 'off'}`} style={colorEtapa(f.etapa)}>
          <span className="punto" />
          <div><b>{f.titulo}</b><div className="muted small">{ETAPAS[f.etapa]} · {f.detalle}</div></div>
          {f.ruta ? <button onClick={() => abrir(f.ruta!)}>Ver</button>
            : f.hecho && f.etapa < 3 && !(cliente && f.etapa === 1) ? <span className="muted small">Sin escaneo</span> : null}
        </div>))}
      </div>
    </div>
  )
}

interface Evento { fecha: string; usuario: string; tabla: string; registro: string; accion: string; cambios: Record<string, unknown> | null; antes: Record<string, unknown> | null }
const CAMPOS: Record<string, string> = {
  fecha: 'fecha', generador_id: 'generador', direccion_retiro: 'dirección', chofer_id: 'chofer', camion_id: 'camión', nota: 'nota',
  generador_principal_id: 'planta', instrucciones: 'instrucciones', cantidad: 'cantidad', contenedor: 'contenedor', corriente_id: 'corriente', um: 'unidad',
}
const ESTADOS: Record<string, string> = { almacenado: 'volvió a almacenado', en_transito: 'pasó a en tránsito', disposicion_final: 'quedó dispuesto' }

/** Fecha y hora local; lo que vino del Access sin hora (medianoche UTC) va solo con la fecha */
function cuando(f: string) {
  if (f.length <= 10 || /T00:00:00(\.0+)?(\+00(:00)?|Z)$/.test(f)) return fd(f.slice(0, 10))
  const d = new Date(f)
  const dia = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  return `${dia} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Qué pasó con el manifiesto, quién y cuándo. Para lo migrado del Access se arma con las fechas que hay. */
function Historial({ m }: { m: Manifiesto }) {
  const [eventos, setEventos] = useState<Evento[] | null>(null)
  useEffect(() => {
    supabase.rpc('historial_manifiesto', { p_id: m.id }).then(({ data }) => setEventos((data ?? []) as Evento[]))
  }, [m.id, m.anulado])
  if (!eventos) return null

  const items = m.manifiesto_items ?? []
  const itemDe = (id: string): Item | undefined => items.find((i) => String(i.id) === id)
  const filas: { fecha: string; texto: string; quien: string }[] = []
  const alta = eventos.find((e) => e.tabla === 'manifiestos' && e.accion === 'alta')
  filas.push(alta ? { fecha: alta.fecha, texto: 'Manifiesto emitido', quien: alta.usuario }
    : { fecha: m.fecha, texto: 'Retiro registrado en el Access', quien: 'Dato migrado' })
  for (const e of eventos) {
    if (e === alta || (e.tabla === 'manifiesto_items' && e.accion === 'alta' && alta && e.fecha.slice(0, 16) === alta.fecha.slice(0, 16))) continue
    const c = e.cambios ?? {}
    if (e.tabla === 'manifiestos') {
      if (e.accion !== 'cambio') continue
      if ('anulado' in c) filas.push({ fecha: e.fecha, texto: c.anulado ? `Anulado${c.anulado_motivo ? ': ' + c.anulado_motivo : ''}` : 'Se quitó la anulación', quien: e.usuario })
      else if ('escaneo' in c) filas.push({ fecha: e.fecha, texto: 'Se adjuntó el escaneo firmado', quien: e.usuario })
      else {
        const nombres = Object.keys(c).map((k) => CAMPOS[k]).filter(Boolean)
        if (nombres.length) filas.push({ fecha: e.fecha, texto: `Se corrigió: ${nombres.join(', ')}`, quien: e.usuario })
      }
    } else {
      const it = itemDe(e.registro)
      const cod = it?.corrientes?.codigo ?? (e.antes?.corriente_id ? 'un residuo' : 'residuo')
      if (e.accion === 'alta') filas.push({ fecha: e.fecha, texto: `Se agregó ${cod}`, quien: e.usuario })
      else if (e.accion === 'baja') filas.push({ fecha: e.fecha, texto: 'Se quitó un residuo', quien: e.usuario })
      else if ('estado' in c) {
        const extra = c.estado === 'en_transito' && it?.manifiestos_nacion ? ` (Manifiesto Nación ${fnum(it.manifiestos_nacion.numero)})`
          : c.estado === 'disposicion_final' && it?.certificados ? ` (certificado ${it.certificados.numero})` : ''
        filas.push({ fecha: e.fecha, texto: `${cod} ${ESTADOS[String(c.estado)] ?? 'cambió de etapa'}${extra}`, quien: e.usuario })
      } else {
        const nombres = Object.keys(c).map((k) => CAMPOS[k]).filter(Boolean)
        if (nombres.length) filas.push({ fecha: e.fecha, texto: `${cod}: se corrigió ${nombres.join(', ')}`, quien: e.usuario })
      }
    }
  }
  // Etapas del Access (sin historial): se reconstruyen con las fechas de cada documento
  const conEstado = new Set(eventos.filter((e) => e.cambios && 'estado' in e.cambios).map((e) => e.registro))
  const vistos = new Set<string>()
  for (const i of items) {
    if (conEstado.has(String(i.id))) continue
    const n = i.manifiestos_nacion, c = i.certificados
    if (n && !vistos.has('n' + n.id)) { vistos.add('n' + n.id); filas.push({ fecha: n.fecha, texto: `Incluido en el Manifiesto Nación ${fnum(n.numero)}`, quien: 'Dato migrado' }) }
    if (c && !vistos.has('c' + c.id)) { vistos.add('c' + c.id); filas.push({ fecha: c.fecha, texto: `Certificado ${c.numero} registrado`, quien: 'Dato migrado' }) }
  }
  for (const c of new Map(items.filter((i) => i.certificados?.enviado_cliente).map((i) => [i.certificados!.id, i.certificados!])).values())
    filas.push({ fecha: c.enviado_cliente!, texto: `Certificado ${c.numero} enviado al cliente por mail`, quien: 'Sistema' })
  filas.sort((a, b) => a.fecha.localeCompare(b.fecha))

  return (
    <div className="card mt">
      <h2>Historial</h2>
      <div className="historial">{filas.map((f, k) => (
        <div key={k} className="he">
          <span className="muted small nw">{cuando(f.fecha)}</span>
          <span>{f.texto}</span>
          <span className={`pill ${f.quien === 'Sistema' ? 'st' : f.quien === 'Dato migrado' ? '' : 'ok'}`}>{f.quien}</span>
        </div>))}
      </div>
    </div>
  )
}
