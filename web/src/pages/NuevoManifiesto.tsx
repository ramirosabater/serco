import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { traerTodo } from '../lib/paginar'
import { supabase, mensajeError } from '../lib/supabase'
import { fd, fnum, hoy } from '../lib/formato'
import type { UM } from '../lib/tipos'
import { useAuth } from '../auth/AuthProvider'

interface Transp { id: number; nombre: string; emite_manifiestos: boolean }
interface Gen { id: number; nombre: string; cuit: string | null; generador_principal_id: number | null }
interface Flota { id: number; nombre: string; activo: boolean; vtos: (string | null)[] }
interface Corriente { id: number; codigo: string; descripcion: string | null; um: UM | null }
interface Renglon { corriente_id: string; contenedor: string; cantidad: string; um: UM }

const CONTENEDORES = ['BATEA', 'TAMBORES', 'TANQUE', 'PILETA', 'BOLSAS', 'MAXIBIDON', 'BOLSONES', 'LATAS', 'GRANEL']
const renglonVacio = (): Renglon => ({ corriente_id: '', contenedor: '', cantidad: '', um: 'KGS' })

/** "al día", "vencido" o "sin cargar" según los vencimientos de un chofer o camión */
function estadoFlota(f: Flota, fecha: string) {
  if (!f.activo) return 'dado de baja'
  if (f.vtos.some((v) => !v)) return 'falta cargar un vencimiento'
  if (f.vtos.some((v) => v! < fecha)) return 'vencido'
  return ''
}

export default function NuevoManifiesto() {
  const nav = useNavigate()
  const { perfil, puedeEditar } = useAuth()
  const esAdmin = perfil?.rol === 'admin'

  const [transportistas, setTransportistas] = useState<Transp[]>([])
  const [generadores, setGeneradores] = useState<Gen[]>([])
  const [plantas, setPlantas] = useState<{ id: number; nombre: string }[]>([])
  const [corrientes, setCorrientes] = useState<Corriente[]>([])
  const [choferes, setChoferes] = useState<Flota[]>([])
  const [camiones, setCamiones] = useState<Flota[]>([])
  const [direcciones, setDirecciones] = useState<string[]>([])

  const [transportista, setTransportista] = useState('')
  const [numero, setNumero] = useState('')
  const [sugerido, setSugerido] = useState('')
  const [fecha, setFecha] = useState(hoy())
  const [genTexto, setGenTexto] = useState('')
  const [planta, setPlanta] = useState('')
  const [direccion, setDireccion] = useState('')
  const [chofer, setChofer] = useState('')
  const [camion, setCamion] = useState('')
  const [nota, setNota] = useState('')
  const [renglones, setRenglones] = useState<Renglon[]>([renglonVacio()])
  const [problemas, setProblemas] = useState<string[]>([])
  const [forzar, setForzar] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  const generador = useMemo(() => generadores.find((g) => g.nombre === genTexto) ?? null, [generadores, genTexto])
  const transp = transportistas.find((t) => String(t.id) === transportista)
  const esAzul = !!transp?.emite_manifiestos

  // Listas fijas
  useEffect(() => {
    supabase.from('transportistas').select('id, nombre, emite_manifiestos').eq('activo', true).order('nombre')
      .then(({ data }) => {
        const l = (data ?? []) as Transp[]
        setTransportistas(l)
        const serco = l.find((t) => t.nombre === 'SERCO AMBIENTAL SA') ?? l.find((t) => t.emite_manifiestos)
        if (serco) setTransportista(String(serco.id))
      })
    traerTodo<Gen>(() => supabase.from('generadores').select('id, nombre, cuit, generador_principal_id').eq('activo', true).order('nombre'))
      .then(({ data }) => setGeneradores(data))
    supabase.from('generadores_principales').select('id, nombre').eq('activo', true).order('nombre')
      .then(({ data }) => setPlantas(data ?? []))
    supabase.from('corrientes').select('id, codigo, descripcion, um').eq('activa', true).order('codigo')
      .then(({ data }) => setCorrientes((data ?? []) as Corriente[]))
  }, [])

  // Al cambiar de transportista: número sugerido, choferes y camiones
  useEffect(() => {
    if (!transportista) return
    const t = Number(transportista)
    supabase.rpc('sugerir_numero', { p_transportista: t }).then(({ data }) => { setSugerido((data as string) ?? ''); setNumero((data as string) ?? '') })
    supabase.from('choferes').select('id, nombre, activo, carnet_vto, carga_pel_vto, sep_vto').eq('transportista_id', t).order('activo', { ascending: false }).order('nombre')
      .then(({ data }) => setChoferes((data ?? []).map((c) => ({ id: c.id, nombre: c.nombre, activo: c.activo, vtos: [c.carnet_vto, c.carga_pel_vto, c.sep_vto] }))))
    supabase.from('camiones').select('id, patente, activo, vtv_vto, carga_pel_vto, ruta_vto').eq('transportista_id', t).order('activo', { ascending: false }).order('patente')
      .then(({ data }) => setCamiones((data ?? []).map((c) => ({ id: c.id, nombre: c.patente, activo: c.activo, vtos: [c.vtv_vto, c.carga_pel_vto, c.ruta_vto] }))))
    setChofer(''); setCamion('')
  }, [transportista])

  // Al elegir generador: su planta y sus direcciones de retiro
  useEffect(() => {
    if (!generador) { setDirecciones([]); return }
    if (generador.generador_principal_id) setPlanta(String(generador.generador_principal_id))
    supabase.from('generador_direcciones').select('direccion').eq('generador_id', generador.id).order('direccion')
      .then(({ data }) => { const l = (data ?? []).map((d) => d.direccion as string); setDirecciones(l); setDireccion(l[0] ?? '') })
  }, [generador])

  // Validación en vivo con la misma regla que aplica la base al emitir
  useEffect(() => {
    if (!esAzul || !transportista || !generador || !chofer || !camion) { setProblemas([]); return }
    supabase.rpc('problemas_manifiesto', {
      p_transportista: Number(transportista), p_camion: Number(camion), p_chofer: Number(chofer), p_generador: generador.id, p_fecha: fecha,
    }).then(({ data }) => setProblemas((data as string[]) ?? []))
  }, [esAzul, transportista, generador, chofer, camion, fecha])

  const setRenglon = (k: number, cambio: Partial<Renglon>) => setRenglones((rs) => rs.map((r, i) => (i === k ? { ...r, ...cambio } : r)))
  const bloqueado = problemas.length > 0 && !(esAdmin && forzar && motivo.trim())

  async function emitir(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!generador) { setError('Elegí el generador de la lista.'); return }
    const items = renglones.filter((r) => r.corriente_id && r.cantidad)
    if (!items.length) { setError('Cargá al menos un residuo con su cantidad.'); return }
    setEnviando(true)
    const { data, error } = await supabase.rpc('emitir_manifiesto', {
      p: {
        numero: numero.replace(/\D/g, ''), transportista_id: Number(transportista), fecha, generador_id: generador.id,
        generador_principal_id: planta ? Number(planta) : null, direccion_retiro: direccion || null,
        chofer_id: chofer ? Number(chofer) : null, camion_id: camion ? Number(camion) : null, nota: nota || null,
        validacion_omitida: problemas.length && forzar ? motivo.trim() : null,
        items: items.map((r) => ({ corriente_id: Number(r.corriente_id), contenedor: r.contenedor || null, cantidad: Number(r.cantidad.replace(',', '.')), um: r.um })),
      },
    })
    setEnviando(false)
    if (error) { setError(mensajeError(error)); window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    const r = data as { id: number; aviso: string | null }
    nav(`/manifiestos/${r.id}`, { state: { emitido: true, aviso: r.aviso } })
  }

  if (!puedeEditar) return <p className="aviso haz">Tu usuario es de consulta: no puede emitir manifiestos.</p>

  return (
    <form onSubmit={emitir}>
      <p><Link to="/manifiestos">Volver a manifiestos</Link></p>
      <h1>Nuevo manifiesto</h1>
      <p className="sub">{esAzul ? 'Se imprime sobre el formulario azul. A mano queda solo la firma.' : 'Manifiesto de otro transportista (formulario rosa): se registra con el número de su formulario.'}</p>
      {error && <div className="aviso bad" role="alert" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Formulario y retiro</h2>
        <div className="campos">
          <label className="campo">Transportista
            <select value={transportista} onChange={(e) => setTransportista(e.target.value)} required>
              {transportistas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </label>
          <label className="campo">Número del formulario
            <input value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="numeric" required pattern="[\d\s-]{9,12}" placeholder="837007470" />
            <span className="ayuda">{sugerido ? `El siguiente es ${fnum(sugerido)}. Revisá que coincida con el papel.` : 'Copialo del formulario.'}</span>
          </label>
          <label className="campo">Fecha del retiro
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required max={hoy()} />
          </label>
        </div>
        <div className="campos">
          <label className="campo">Generador
            <input list="lista-generadores" value={genTexto} onChange={(e) => setGenTexto(e.target.value)} required placeholder="Empezá a escribir el nombre" />
            <datalist id="lista-generadores">{generadores.map((g) => <option key={g.id} value={g.nombre}>{g.cuit ?? ''}</option>)}</datalist>
            {generador && <span className="ayuda">CUIT {generador.cuit ?? 'sin cargar'}</span>}
          </label>
          <label className="campo">Dirección de retiro
            <input list="lista-direcciones" value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder={generador ? 'Elegí o escribí la dirección' : 'Primero elegí el generador'} />
            <datalist id="lista-direcciones">{direcciones.map((d) => <option key={d} value={d} />)}</datalist>
          </label>
          <label className="campo">Planta que recibe
            <select value={planta} onChange={(e) => setPlanta(e.target.value)}>
              <option value="">Sin planta</option>
              {plantas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="card stack mt">
        <h2 style={{ margin: 0 }}>Camión y chofer</h2>
        <div className="campos">
          <label className="campo">Camión
            <select value={camion} onChange={(e) => setCamion(e.target.value)} required={esAzul}>
              <option value="">Elegí el camión</option>
              {camiones.map((c) => { const s = estadoFlota(c, fecha); return <option key={c.id} value={c.id}>{c.nombre}{s ? ` · ${s}` : ''}</option> })}
            </select>
          </label>
          <label className="campo">Chofer
            <select value={chofer} onChange={(e) => setChofer(e.target.value)} required={esAzul}>
              <option value="">Elegí el chofer</option>
              {choferes.map((c) => { const s = estadoFlota(c, fecha); return <option key={c.id} value={c.id}>{c.nombre}{s ? ` · ${s}` : ''}</option> })}
            </select>
          </label>
        </div>
        {problemas.length > 0 && (
          <div className="aviso bad" role="alert">
            <b>No se puede emitir:</b>
            <ul>{problemas.map((p) => <li key={p}>{p}</li>)}</ul>
            {esAdmin && (
              <div className="stack" style={{ marginTop: 10, gap: 8 }}>
                <label><input type="checkbox" checked={forzar} onChange={(e) => setForzar(e.target.checked)} /> Emitir igual (queda registrado con tu usuario)</label>
                {forzar && <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo, por ejemplo: carnet renovado, falta cargar la fecha" aria-label="Motivo" />}
              </div>)}
          </div>)}
        {esAzul && chofer && camion && generador && problemas.length === 0 && <div className="aviso ok" role="status">Camión, chofer, transportista y generador al día para el {fd(fecha)}.</div>}
      </div>

      <div className="card stack mt">
        <h2 style={{ margin: 0 }}>Residuos</h2>
        {renglones.map((r, k) => (
          <div key={k} className="campos" style={{ alignItems: 'end' }}>
            <label className="campo">Corriente
              <select value={r.corriente_id} onChange={(e) => {
                const c = corrientes.find((x) => String(x.id) === e.target.value)
                setRenglon(k, { corriente_id: e.target.value, um: c?.um ?? r.um })
              }} required={k === 0}>
                <option value="">Elegí la corriente</option>
                {corrientes.map((c) => <option key={c.id} value={c.id}>{c.codigo}{c.descripcion ? ` · ${c.descripcion.slice(0, 60)}` : ''}</option>)}
              </select>
            </label>
            <label className="campo">Contenedor
              <input list="lista-contenedores" value={r.contenedor} onChange={(e) => setRenglon(k, { contenedor: e.target.value.toUpperCase() })} />
            </label>
            <label className="campo">Cantidad
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={r.cantidad} onChange={(e) => setRenglon(k, { cantidad: e.target.value })} inputMode="decimal" required={k === 0} style={{ flex: 1 }} />
                <select value={r.um} onChange={(e) => setRenglon(k, { um: e.target.value as UM })} aria-label="Unidad">
                  <option value="KGS">kg</option><option value="LTS">litros</option><option value="MS3">m³</option>
                </select>
              </div>
            </label>
            <div>{renglones.length > 1 && <button type="button" onClick={() => setRenglones((rs) => rs.filter((_, i) => i !== k))}>Quitar</button>}</div>
          </div>))}
        <datalist id="lista-contenedores">{CONTENEDORES.map((c) => <option key={c} value={c} />)}</datalist>
        <div><button type="button" onClick={() => setRenglones((rs) => [...rs, renglonVacio()])} disabled={renglones.length >= 7}>Agregar otro residuo</button>
          {renglones.length >= 7 && <span className="muted small"> El formulario tiene 7 renglones.</span>}</div>
        <label className="campo">Nota (opcional)
          <textarea value={nota} onChange={(e) => setNota(e.target.value)} />
        </label>
      </div>

      <div className="bar mt" style={{ justifyContent: 'flex-end' }}>
        <Link to="/manifiestos"><button type="button">Cancelar</button></Link>
        <button className="pri" disabled={enviando || bloqueado}>{enviando ? 'Emitiendo…' : 'Emitir manifiesto'}</button>
      </div>
    </form>
  )
}
