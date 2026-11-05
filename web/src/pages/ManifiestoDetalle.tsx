import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase, mensajeError } from '../lib/supabase'
import { etapaDe, etapaManifiesto, ETAPAS, fd, fnum, hoy, num, umL } from '../lib/formato'
import type { Item, Manifiesto, UM } from '../lib/tipos'
import { useAuth } from '../auth/AuthProvider'
import { colorEtapa, PillEtapa } from '../components/Etapa'
import { abrirArchivo, enSistema } from '../lib/archivos'
import { traerTodo } from '../lib/paginar'

const SELECT = `*, generadores(id, nombre, cuit), generadores_principales(nombre), transportistas(id, nombre),
  choferes(nombre), camiones(patente),
  manifiesto_items(id, corriente_id, contenedor, cant_estimada, cantidad, um, estado, fecha_entrega_df, salvado, corrientes(codigo, descripcion),
    manifiestos_nacion(id, numero, fecha, escaneo, operadores(nombre)), certificados(id, numero, fecha, archivo, enviado_cliente, operadores(nombre)))`

export default function ManifiestoDetalle() {
  const { id } = useParams()
  const { state } = useLocation() as { state?: { aviso?: string | null; emitido?: boolean } }
  const { puedeEditar, perfil } = useAuth()
  const [m, setM] = useState<Manifiesto | null>(null)
  const [error, setError] = useState('')
  const [anulando, setAnulando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [bloqueo, setBloqueo] = useState<string | null>(null)
  const [corrigiendoDatos, setCorrigiendoDatos] = useState(false)
  const [salvando, setSalvando] = useState<number | null>(null)

  const cargar = () => supabase.from('manifiestos').select(SELECT).eq('id', Number(id)).maybeSingle()
    .then(({ data, error }) => {
      if (error) setError(mensajeError(error))
      else if (!data) setError('No existe este manifiesto o no tenés acceso a él.')
      setM(data as unknown as Manifiesto)
    })
  useEffect(() => { cargar() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  // Si el libro provincial de ese período ya se presentó, no se corrige ni se anula
  useEffect(() => { supabase.rpc('manifiesto_bloqueo', { p_id: Number(id) }).then(({ data }) => setBloqueo((data as string | null) ?? null)) }, [id])

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
  const etapa = enviado ? 4 : etapaManifiesto(items.map((i) => i.estado))
  const detalle = [
    `Emitido · retiro ${fd(m.fecha)}`,
    items.length ? `Ingresó a ${m.generadores_principales?.nombre ?? 'planta'}${m.ingreso_planta ? ' · ' + fd(m.ingreso_planta) : ''}` : 'Falta cargar la sección 3',
    nacion ? `Manifiesto Nación ${fnum(nacion.numero)} · ${fd(nacion.fecha)}` : 'Sin Manifiesto Nación',
    cert ? `${cert.operadores?.nombre ?? ''} · ${fd(cert.fecha)}` : nacion?.operadores ? `Destino ${nacion.operadores.nombre}` : 'Pendiente',
    enviado ? `Enviado al cliente ${fd(cert?.enviado_cliente?.slice(0, 10))}` : cert ? `Certificado ${cert.numero}, sin enviar` : 'Pendiente',
  ]
  // Reglas de Serco: se anula en cualquier etapa; la sección 3 entera se corrige mientras está en planta;
  // la cantidad se salva con * hasta que llega el certificado; generador y dirección, siempre. Nada si se presentó a provincia.
  const editable = puedeEditar && !m.anulado && !bloqueo && perfil?.rol !== 'cliente'
  const anulable = editable
  const enPlanta = items.every((i) => i.estado === 'almacenado')
  const cargarSec3 = puedeEditar && !m.anulado && (items.length === 0 || (corrigiendo && editable && enPlanta))
  const yaSalio = items.some((i) => i.manifiestos_nacion || i.certificados)

  return (
    <>
      <p>{perfil?.rol === 'cliente' ? <Link to="/portal">Volver a mis retiros</Link> : <Link to="/manifiestos">Volver a manifiestos</Link>}</p>
      {state?.emitido && <div className="aviso ok bar" role="status" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
        <span>Manifiesto emitido{items.length ? '' : ': queda Iniciado hasta que se cargue la sección 3 al entrar a planta'}.{state.aviso && <> <b>Atención:</b> {state.aviso}</>}</span>
        {m.tipo === 'azul' && <Link to={`/manifiestos/${m.id}/imprimir`}><button className="pri">Imprimir en el formulario</button></Link>}</div>}
      <div className="bar" style={{ justifyContent: 'space-between', marginBottom: 2 }}>
        <h1>Manifiesto {fnum(m.numero)}</h1>
        {m.anulado ? <span className="pill bad">Anulado</span> : <PillEtapa etapa={etapa} />}
      </div>
      <p className="sub">{m.generadores?.nombre} · transporta {m.transportistas?.nombre} · formulario {m.tipo}</p>
      {error && <div className="aviso bad" style={{ marginBottom: 12 }}>{error}</div>}
      {m.anulado && <div className="aviso bad" style={{ marginBottom: 12 }}>Anulado. Motivo: {m.anulado_motivo}</div>}
      {bloqueo && !m.anulado && perfil?.rol !== 'cliente' && <div className="aviso" style={{ marginBottom: 12 }}>{bloqueo}</div>}
      {m.viaje_id && <div className="aviso" style={{ marginBottom: 12 }}>Es el formulario del viaje <Link to={`/nacion/${m.viaje_id}`}>Manifiesto Nación {fnum(m.numero)}</Link>, que en el Access se cargaba también como manifiesto, con el total en un renglón. No cuenta como retiro: esos residuos ya están en los manifiestos de los clientes que van en el viaje.</div>}
      {m.validacion_omitida && <div className="aviso haz" style={{ marginBottom: 12 }}>Emitido con vencimientos sin regularizar. Motivo: {m.validacion_omitida}</div>}

      {!m.anulado && <div className="card" data-ayuda="det-recorrido"><h2>Recorrido del residuo</h2>
        <div className="ruta">{ETAPAS.map((t, k) => {
          const doc = [m.escaneo, null, perfil?.rol === 'cliente' ? null : nacion?.escaneo, cert?.archivo, null][k]
          return (
            <div key={t} className={`estacion ${k <= etapa ? 'hecha' : ''} ${k === etapa ? 'actual' : ''}`} style={colorEtapa(k <= etapa ? etapa : k)}>
              <span className="punto" />
              <div className="t">{t}</div>
              <div className="m">{k <= etapa || k === 1 || k === 2 ? detalle[k] : 'Pendiente'}</div>
              {k <= etapa && (enSistema(doc) ? <button className="doc-link" onClick={() => abrirArchivo(doc, setError)}>Ver documento</button>
                : doc ? <div className="muted small" title="El Access lo tenía anotado, pero el archivo no estaba en las carpetas que se migraron">Escaneo sin subir</div> : null)}
            </div>)
        })}
        </div></div>}

      {cargarSec3 && <CargaResiduos m={m} esAdmin={perfil?.rol === 'admin'} corrigiendo={items.length > 0}
        onListo={() => { setCorrigiendo(false); cargar() }} onCancelar={() => setCorrigiendo(false)} />}

      {!m.anulado && <Documentos m={m} cliente={perfil?.rol === 'cliente'} abrir={(r) => abrirArchivo(r, setError)} />}
      {perfil?.rol !== 'cliente' && <Historial m={m} />}

      <div className="grid c21 mt">
        <div className="card">
          <h2>Residuos</h2>
          <div className="tw"><table>
            <thead><tr><th>Corriente</th><th>Contenedor</th><th style={{ textAlign: 'right' }}>Estimada</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Etapa</th><th>Manif. Nación</th><th>Certificado</th></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id} data-item={i.id}>
                <td><b>{i.corrientes?.codigo}</b><div className="muted small">{i.corrientes?.descripcion}</div></td>
                <td>{i.contenedor ?? '—'}</td>
                <td className="n muted">{i.cant_estimada != null ? num(i.cant_estimada) : '—'}</td>
                <td className="n">{num(i.cantidad)} {umL(i.um)}{i.salvado && <span className="salvado" title={`Salvado: ${i.salvado}`}> *</span>}
                  {editable && !corrigiendo && !i.certificados && salvando !== i.id && <div><button className="link small" onClick={() => setSalvando(i.id)} title="Corregir la cantidad (queda salvada con *)">Salvar *</button></div>}</td>
                <td><PillEtapa etapa={i.estado === 'disposicion_final' && i.certificados?.enviado_cliente ? 4 : etapaDe(i.estado)} /></td>
                <td className="nw">{i.manifiestos_nacion ? (perfil?.rol === 'cliente' ? fnum(i.manifiestos_nacion.numero) : <Link to={`/nacion/${i.manifiestos_nacion.id}`}>{fnum(i.manifiestos_nacion.numero)}</Link>) : '—'}</td>
                <td className="nw">{enSistema(i.certificados?.archivo)
                  ? <button className="link" onClick={() => abrirArchivo(i.certificados!.archivo, setError)}>{i.certificados!.numero}</button> : i.certificados ? i.certificados.numero : '—'}</td>
              </tr>))}
            </tbody>
          </table></div>
          {salvando && <SalvarCantidad item={items.find((i) => i.id === salvando)!} onListo={() => { setSalvando(null); cargar() }} onCancelar={() => setSalvando(null)} />}
          {items.some((i) => i.salvado) && <p className="small muted" style={{ marginBottom: 0 }}>* Cantidad salvada: {items.filter((i) => i.salvado).map((i) => `${i.corrientes?.codigo} ${i.salvado}`).join(' · ')}</p>}
          {items.length === 0 && <p className="muted small">Todavía no se cargó la sección 3: se completa cuando la carga entra a planta.</p>}
          {items.length > 0 && editable && enPlanta && !corrigiendo && <div className="bar mt"><button onClick={() => setCorrigiendo(true)}>Corregir residuos</button>
            {m.ingreso_planta && <span className="muted small">Ingresó a planta el {fd(m.ingreso_planta)}</span>}</div>}
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
          {corrigiendoDatos && <CorregirDatos m={m} onListo={() => { setCorrigiendoDatos(false); cargar() }} onCancelar={() => setCorrigiendoDatos(false)} />}
          <div className="bar mt">
            {puedeEditar && m.tipo === 'azul' && !m.anulado && <Link to={`/manifiestos/${m.id}/imprimir`} data-ayuda="det-imprimir"><button>Imprimir en el formulario</button></Link>}
            {puedeEditar && !m.anulado && <Link to={`/manifiestos/${m.id}/etiquetas`} data-ayuda="det-etiquetas"><button>Etiquetas</button></Link>}
            {enSistema(m.escaneo) && <button onClick={() => abrirArchivo(m.escaneo, setError)}>Ver escaneo firmado</button>}
            {editable && !corrigiendoDatos && <button onClick={() => setCorrigiendoDatos(true)} data-ayuda="det-corregir">Corregir generador o dirección</button>}
            {anulable && !anulando && <button className="peligro" onClick={() => setAnulando(true)}>Anular manifiesto</button>}
          </div>
          {anulando && (
            <form className="stack" onSubmit={anular}>
              {yaSalio && <div className="aviso haz">Este manifiesto ya viajó{items.some((i) => i.certificados) ? ' y tiene certificado del operador' : ''}. Al anularlo deja de contar como retiro en reportes y libros; el viaje y el certificado no se modifican.</div>}
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

/** Salvar la cantidad de un residuo con * (como en el papel): queda el valor anterior y el motivo */
function SalvarCantidad({ item, onListo, onCancelar }: { item: Item & { corrientes?: { codigo: string } | null }; onListo: () => void; onCancelar: () => void }) {
  const [cantidad, setCantidad] = useState(String(item.cantidad).replace('.', ','))
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  async function guardar(e: FormEvent) {
    e.preventDefault()
    const n = numero(cantidad)
    if (!n || n <= 0) { setError('Poné una cantidad mayor a cero'); return }
    const { error } = await supabase.rpc('salvar_cantidad', { p_item: item.id, p_cantidad: n, p_motivo: motivo })
    if (error) setError(mensajeError(error)); else onListo()
  }
  return (
    <form className="stack mt" onSubmit={guardar} style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <b>Salvar la cantidad de {item.corrientes?.codigo} con *</b>
      <div className="bar">
        <label className="campo">Cantidad correcta ({umL(item.um)})<input value={cantidad} onChange={(e) => setCantidad(e.target.value)} inputMode="decimal" required autoFocus /></label>
        <label className="campo" style={{ flex: 1 }}>Motivo<input value={motivo} onChange={(e) => setMotivo(e.target.value)} required placeholder="Ej.: pesada de balanza" /></label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Antes: {num(item.cantidad)} {umL(item.um)}. Queda marcado con * y en el historial. Después de que llega el certificado del operador ya no se salva: se anula.</p>
      {error && <div className="aviso bad">{error}</div>}
      <div className="bar"><button className="pri">Guardar</button><button type="button" onClick={onCancelar}>Cancelar</button></div>
    </form>)
}

/** Corregir el generador (se equivocaron de cliente) o la dirección de retiro, en cualquier etapa */
function CorregirDatos({ m, onListo, onCancelar }: { m: Manifiesto; onListo: () => void; onCancelar: () => void }) {
  const [gens, setGens] = useState<{ id: number; nombre: string; cuit: string | null; direccion: string | null }[]>([])
  const [texto, setTexto] = useState(m.generadores?.nombre ?? '')
  const [gen, setGen] = useState<number | null>(m.generadores?.id ?? null)
  const [direccion, setDireccion] = useState(m.direccion_retiro ?? '')
  const [dirs, setDirs] = useState<string[]>([])
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    traerTodo<{ id: number; nombre: string; cuit: string | null; direccion: string | null }>(() =>
      supabase.from('generadores').select('id, nombre, cuit, direccion').eq('activo', true).order('nombre').order('id')).then(({ data }) => setGens(data))
  }, [])
  useEffect(() => {
    if (!gen) { setDirs([]); return }
    supabase.from('generador_direcciones').select('direccion').eq('generador_id', gen).then(({ data }) => setDirs((data ?? []).map((d) => d.direccion)))
  }, [gen])
  const elegido = gens.find((g) => g.id === gen)
  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (!gen) { setError('Elegí el generador de la lista'); return }
    const { error } = await supabase.rpc('corregir_manifiesto', { p_id: m.id, p_generador: gen, p_direccion: direccion, p_motivo: motivo })
    if (error) setError(mensajeError(error)); else onListo()
  }
  return (
    <form className="stack mt" onSubmit={guardar} style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <b>Corregir generador o dirección de retiro</b>
      <label className="campo">Generador (razón social y CUIT)
        <input list="cor-generadores" value={texto} required onChange={(e) => {
          setTexto(e.target.value)
          const g = gens.find((x) => x.nombre === e.target.value)
          setGen(g?.id ?? null)
          if (g && g.id !== m.generadores?.id) setDireccion(g.direccion ?? '')
        }} />
        <datalist id="cor-generadores">{gens.map((g) => <option key={g.id} value={g.nombre}>{g.cuit ?? ''}</option>)}</datalist>
        <span className="ayuda">{elegido ? `CUIT ${elegido.cuit ?? 'sin cargar'}` : 'Elegí un generador de la lista'}</span>
      </label>
      <label className="campo">Dirección de retiro
        <input list="cor-direcciones" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
        <datalist id="cor-direcciones">{[elegido?.direccion, ...dirs].filter(Boolean).map((d) => <option key={d!} value={d!} />)}</datalist>
      </label>
      <label className="campo">Motivo<input value={motivo} onChange={(e) => setMotivo(e.target.value)} required placeholder="Ej.: se cargó el cliente equivocado" /></label>
      <p className="muted small" style={{ margin: 0 }}>Se puede en cualquier etapa, mientras el libro provincial de ese período no se haya presentado. Queda en el historial.</p>
      {error && <div className="aviso bad">{error}</div>}
      <div className="bar"><button className="pri">Guardar corrección</button><button type="button" onClick={onCancelar}>Cancelar</button></div>
    </form>)
}

interface Corriente { id: number; codigo: string; descripcion: string | null; um: UM | null }
interface Renglon { corriente_id: string; contenedor: string; estimada: string; cantidad: string; um: UM }
const CONTENEDORES = ['BATEA', 'TAMBORES', 'TANQUE', 'PILETA', 'BOLSAS', 'MAXIBIDON', 'BOLSONES', 'LATAS', 'GRANEL']
const renglonVacio = (): Renglon => ({ corriente_id: '', contenedor: '', estimada: '', cantidad: '', um: 'KGS' })
const coma = (n: number) => String(n).replace('.', ',')
/** "1.250,5", "1.250" o "1250.5" → número (el punto con grupos de 3 cifras es separador de miles) */
function numero(t: string) {
  const x = t.trim().replace(/\s/g, '')
  if (!x) return null
  if (x.includes(',')) return Number(x.replace(/\./g, '').replace(',', '.'))
  return Number(/^\d{1,3}(\.\d{3})+$/.test(x) ? x.replace(/\./g, '') : x)
}

/** Sección 3 del formulario: lo que entró a planta. Con esto el manifiesto pasa de Iniciado a Almacenado. */
function CargaResiduos({ m, esAdmin, corrigiendo, onListo, onCancelar }: { m: Manifiesto; esAdmin: boolean; corrigiendo: boolean; onListo: () => void; onCancelar: () => void }) {
  const nav = useNavigate()
  const [corrientes, setCorrientes] = useState<Corriente[]>([])
  const [renglones, setRenglones] = useState<Renglon[]>(() => (m.manifiesto_items ?? []).length
    ? m.manifiesto_items!.map((i) => ({ corriente_id: String(i.corriente_id), contenedor: i.contenedor ?? '', estimada: i.cant_estimada != null ? coma(i.cant_estimada) : '', cantidad: coma(i.cantidad), um: i.um }))
    : [renglonVacio()])
  const [ingreso, setIngreso] = useState(m.ingreso_planta ?? hoy())
  const [error, setError] = useState('')
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [listo, setListo] = useState(false)

  useEffect(() => {
    supabase.from('corrientes').select('id, codigo, descripcion, um').eq('activa', true).order('codigo')
      .then(({ data }) => setCorrientes((data ?? []) as Corriente[]))
  }, [])
  const set = (k: number, c: Partial<Renglon>) => setRenglones((rs) => rs.map((r, i) => (i === k ? { ...r, ...c } : r)))

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    const l = renglones.filter((r) => r.corriente_id)
    if (!l.length) { setError('Cargá al menos un residuo.'); return }
    if (l.some((r) => !(numero(r.cantidad)! > 0))) { setError('Falta la cantidad real (pesada en planta) de algún residuo.'); return }
    setEnviando(true)
    const { error } = await supabase.rpc('cargar_residuos', {
      p_manifiesto: m.id, p_ingreso: ingreso, p_validacion_omitida: motivo.trim() || null,
      p_items: l.map((r) => ({ corriente_id: Number(r.corriente_id), contenedor: r.contenedor || null, cant_estimada: numero(r.estimada), cantidad: numero(r.cantidad), um: r.um })),
    })
    setEnviando(false)
    if (error) { setError(mensajeError(error)); return }
    setListo(true)
  }

  if (listo) return (
    <div className="aviso ok mt stack" role="status">
      <h2 style={{ margin: 0 }}>Sección 3 cargada: el manifiesto quedó Almacenado</h2>
      <div className="bar">
        {m.tipo === 'azul' && <button className="pri" onClick={() => nav(`/manifiestos/${m.id}/imprimir?que=3`)}>Imprimir la sección 3</button>}
        <button onClick={() => nav(`/manifiestos/${m.id}/etiquetas`)}>Etiquetas</button>
        <button onClick={onListo}>Listo</button>
      </div>
    </div>)

  return (
    <form className="card stack mt" data-ayuda="det-sec3" onSubmit={guardar}>
      <h2 className="paso-h"><span className="sn">3</span>{corrigiendo ? 'Corregir los residuos (sección 3)' : 'Ingreso a planta · sección 3'}</h2>
      <p className="muted small" style={{ margin: 0 }}>Lo que llegó en el camión: corriente, contenedor, la cantidad que figura en el remito (estimada) y la que se pesó o midió en planta (real). El formulario tiene 7 renglones.</p>
      {error && <div className="aviso bad" role="alert">{error}
        {esAdmin && /corriente|habilit/i.test(error) && <div className="stack" style={{ marginTop: 8, gap: 6 }}>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo para cargarlo igual (queda registrado)" aria-label="Motivo" />
          <span className="small">Escribí el motivo y volvé a tocar Guardar.</span></div>}
      </div>}
      <label className="campo" style={{ maxWidth: 220 }}>Fecha de ingreso a planta
        <input type="date" value={ingreso} onChange={(e) => setIngreso(e.target.value)} min={m.fecha} max={hoy()} required />
      </label>
      {renglones.map((r, k) => (
        <div key={k} className="campos renglon-sec3" style={{ alignItems: 'end' }}>
          <label className="campo">Corriente
            <select value={r.corriente_id} required={k === 0} onChange={(e) => {
              const c = corrientes.find((x) => String(x.id) === e.target.value)
              set(k, { corriente_id: e.target.value, um: c?.um ?? r.um })
            }}>
              <option value="">Elegí la corriente</option>
              {corrientes.map((c) => <option key={c.id} value={c.id}>{c.codigo}{c.descripcion ? ` · ${c.descripcion.slice(0, 60)}` : ''}</option>)}
            </select>
          </label>
          <label className="campo">Contenedor
            <input list="lista-contenedores" value={r.contenedor} onChange={(e) => set(k, { contenedor: e.target.value.toUpperCase() })} />
          </label>
          <label className="campo">Cant. estimada
            <input value={r.estimada} onChange={(e) => set(k, { estimada: e.target.value })} inputMode="decimal" />
          </label>
          <label className="campo">Cant. real
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={r.cantidad} onChange={(e) => set(k, { cantidad: e.target.value })} inputMode="decimal" required={k === 0} style={{ flex: 1, minWidth: 0 }} />
              <select value={r.um} onChange={(e) => set(k, { um: e.target.value as UM })} aria-label="Unidad">
                <option value="KGS">kg</option><option value="LTS">litros</option><option value="MS3">m³</option>
              </select>
            </div>
          </label>
          <div>{renglones.length > 1 && <button type="button" onClick={() => setRenglones((rs) => rs.filter((_, i) => i !== k))}>Quitar</button>}</div>
        </div>))}
      <datalist id="lista-contenedores">{CONTENEDORES.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="bar" style={{ justifyContent: 'space-between' }}>
        <div><button type="button" onClick={() => setRenglones((rs) => [...rs, renglonVacio()])} disabled={renglones.length >= 7}>Agregar otro residuo</button>
          {renglones.length >= 7 && <span className="muted small"> No entran más renglones.</span>}</div>
        <div className="bar">
          {corrigiendo && <button type="button" onClick={onCancelar}>Cancelar</button>}
          <button className="pri" disabled={enviando || !corrientes.length}>{enviando ? 'Guardando…' : corrigiendo ? 'Guardar cambios' : 'Guardar: ingresó a planta'}</button>
        </div>
      </div>
    </form>
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
    ...(naciones.length ? naciones.map((n) => ({ etapa: 2, titulo: `Manifiesto Nación ${fnum(n.numero)}`, detalle: `${fd(n.fecha)}${n.operadores ? ' · ' + n.operadores.nombre : ''}`, ruta: cliente ? null : n.escaneo, hecho: true }))
      : [{ etapa: 2, titulo: 'Manifiesto Nación', detalle: 'Pendiente', hecho: false }]),
    ...(certs.length ? certs.map((c) => ({ etapa: 3, titulo: `Certificado de disposición final ${c.numero}`, detalle: `${fd(c.fecha)}${c.operadores ? ' · ' + c.operadores.nombre : ''}`, ruta: c.archivo, hecho: true }))
      : [{ etapa: 3, titulo: 'Certificado de disposición final', detalle: 'Pendiente', hecho: false }]),
    ...(certs.length ? certs.map((c) => ({ etapa: 4, titulo: 'Aviso al cliente', detalle: c.enviado_cliente ? `Enviado por mail el ${fd(c.enviado_cliente.slice(0, 10))}` : 'Todavía no se le avisó', hecho: !!c.enviado_cliente }))
      : [{ etapa: 4, titulo: 'Aviso al cliente', detalle: 'Pendiente', hecho: false }]),
  ]
  return (
    <div className="card mt">
      <h2>Documentos del recorrido</h2>
      <div className="docs">{filas.map((f, k) => (
        <div key={k} className={`doc ${f.hecho ? '' : 'off'}`} style={colorEtapa(f.etapa)}>
          <span className="punto" />
          <div><b>{f.titulo}</b><div className="muted small">{ETAPAS[f.etapa]} · {f.detalle}</div></div>
          {enSistema(f.ruta) ? <button onClick={() => abrir(f.ruta!)}>Ver</button>
            : f.ruta ? <span className="muted small" title="El Access lo tenía anotado, pero el archivo no estaba en las carpetas que se migraron">Escaneo sin subir</span>
            : f.hecho && f.etapa < 4 && !(cliente && f.etapa === 2) ? <span className="muted small">Sin escaneo</span> : null}
        </div>))}
      </div>
    </div>
  )
}

interface Evento { fecha: string; usuario: string; tabla: string; registro: string; accion: string; cambios: Record<string, unknown> | null; antes: Record<string, unknown> | null }
const CAMPOS: Record<string, string> = {
  fecha: 'fecha', generador_id: 'generador', direccion_retiro: 'dirección', chofer_id: 'chofer', camion_id: 'camión', nota: 'nota',
  generador_principal_id: 'planta', instrucciones: 'instrucciones', cantidad: 'cantidad', contenedor: 'contenedor', corriente_id: 'corriente', um: 'unidad', salvado: 'cantidad salvada (*)', anulado: 'anulado', anulado_motivo: 'motivo de anulación',
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
      <h2>Historial de cambios</h2>
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
