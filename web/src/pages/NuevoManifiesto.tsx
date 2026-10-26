import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { traerTodo } from '../lib/paginar'
import { supabase, mensajeError } from '../lib/supabase'
import { fd, fnum, hoy } from '../lib/formato'
import type { Instrucciones } from '../lib/tipos'
import { INSTRUCTIVOS, instruccionesPorDefecto, NIVELES, PELIGROS } from '../lib/instrucciones'
import { useAuth } from '../auth/AuthProvider'

interface Transp { id: number; nombre: string; emite_manifiestos: boolean }
interface Gen { id: number; nombre: string; cuit: string | null; generador_principal_id: number | null; hab_mun_vto: string | null; actividad: string | null }
interface Flota { id: number; nombre: string; activo: boolean; vtos: (string | null)[] }

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
  const [problemas, setProblemas] = useState<string[]>([])
  const [forzar, setForzar] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [instr, setInstr] = useState<Instrucciones>(() => instruccionesPorDefecto({}))
  const [imprimir, setImprimir] = useState(false)

  // "Como siempre": chofer y camión a aplicar cuando termine de cambiar el transportista
  const aplicar = useRef<{ t: string; chofer?: string; camion?: string } | null>(null)
  const transpRef = useRef('')
  const generador = useMemo(() => generadores.find((g) => g.nombre === genTexto) ?? null, [generadores, genTexto])
  transpRef.current = transportista
  const transp = transportistas.find((t) => String(t.id) === transportista)
  const esAzul = !!transp?.emite_manifiestos

  // Listas fijas
  useEffect(() => {
    supabase.from('transportistas').select('id, nombre, emite_manifiestos').eq('activo', true).order('nombre')
      .then(({ data }) => {
        const l = (data ?? []) as Transp[]
        setTransportistas(l)
        const serco = l.find((t) => t.nombre === 'SERCO AMBIENTAL SA') ?? l.find((t) => t.emite_manifiestos)
        if (serco) setTransportista((t) => t || String(serco.id))   // si ya eligieron otro mientras cargaba, no se pisa
      })
    traerTodo<Gen>(() => supabase.from('generadores').select('id, nombre, cuit, generador_principal_id, hab_mun_vto, actividad').eq('activo', true).order('nombre'))
      .then(({ data }) => {
        setGeneradores(data)
        // Desde una sugerencia de Serquito: /manifiestos/nuevo?generador=123
        const pedido = Number(new URLSearchParams(window.location.search).get('generador'))
        const g = pedido ? data.find((x) => x.id === pedido) : null
        if (g) setGenTexto((t) => t || g.nombre)
      })
    supabase.from('generadores_principales').select('id, nombre').eq('activo', true).order('nombre')
      .then(({ data }) => setPlantas(data ?? []))
    supabase.from('parametros').select('clave, valor').like('clave', 'form_%')
      .then(({ data }) => setInstr(instruccionesPorDefecto(Object.fromEntries((data ?? []).map((x) => [x.clave, x.valor])))))
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
    const pend = aplicar.current
    if (pend && pend.t === transportista) { setChofer(pend.chofer ?? ''); setCamion(pend.camion ?? ''); aplicar.current = null }
    else { setChofer(''); setCamion('') }
  }, [transportista])

  // Al elegir generador: su planta y sus direcciones de retiro
  useEffect(() => {
    if (!generador) { setDirecciones([]); return }
    if (generador.generador_principal_id) setPlanta(String(generador.generador_principal_id))
    supabase.from('generador_direcciones').select('direccion').eq('generador_id', generador.id).order('direccion')
      .then(({ data }) => { const l = (data ?? []).map((d) => d.direccion as string); setDirecciones(l); setDireccion(l[0] ?? '') })
  }, [generador])

  // Serquito propone lo de siempre de este generador (dirección, transportista, chofer y camión); el usuario decide
  useEffect(() => {
    if (!generador) return
    const clave = `como-siempre:${generador.id}`
    let vivo = true
    supabase.rpc('como_siempre', { p_generador: generador.id }).then(({ data }) => {
      const cs = data as { retiros: number; direccion?: string; transportista_id?: number; chofer_id?: number; chofer?: string; camion_id?: number; patente?: string } | null
      if (!vivo || !cs || !window.AyudaApp) return
      const partes = [cs.direccion && `dirección ${cs.direccion}`, cs.chofer && `chofer ${cs.chofer}`, cs.patente && `camión ${cs.patente}`].filter(Boolean)
      if (!partes.length) return
      window.AyudaApp.sugerir({
        tema: 'como-siempre', clave, titulo: 'Como siempre', posponer: 'nada', prioridad: 0, boton: 'Completar',
        texto: `En la mayoría de los ${cs.retiros} retiros de los últimos 6 meses de ${generador.nombre} fue: ${partes.join(', ')}. ¿Lo completo? Después revisalo antes de emitir.`,
        accion: () => {
          if (cs.direccion) setDireccion(cs.direccion)
          const t = cs.transportista_id ? String(cs.transportista_id) : ''
          const ch = cs.chofer ? String(cs.chofer_id) : undefined, ca = cs.patente ? String(cs.camion_id) : undefined
          if (t && t !== transpRef.current) { aplicar.current = { t, chofer: ch, camion: ca }; setTransportista(t) }
          else { if (ch) setChofer(ch); if (ca) setCamion(ca) }
        },
      })
    })
    return () => { vivo = false; window.AyudaApp?.quitarSugerencia(clave) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generador])

  // Validación en vivo con la misma regla que aplica la base al emitir
  useEffect(() => {
    if (!esAzul || !transportista || !generador || !chofer || !camion) { setProblemas([]); return }
    supabase.rpc('problemas_manifiesto', {
      p_transportista: Number(transportista), p_camion: Number(camion), p_chofer: Number(chofer), p_generador: generador.id, p_fecha: fecha,
    }).then(({ data }) => setProblemas((data as string[]) ?? []))
  }, [esAzul, transportista, generador, chofer, camion, fecha])

  const bloqueado = problemas.length > 0 && !(esAdmin && forzar && motivo.trim())

  async function emitir(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!generador) { setError('Elegí el generador de la lista.'); return }
    setEnviando(true)
    const { data, error } = await supabase.rpc('emitir_manifiesto', {
      p: {
        numero: numero.replace(/\D/g, ''), transportista_id: Number(transportista), fecha, generador_id: generador.id,
        generador_principal_id: planta ? Number(planta) : null, direccion_retiro: direccion || null,
        chofer_id: chofer ? Number(chofer) : null, camion_id: camion ? Number(camion) : null, nota: nota || null,
        validacion_omitida: problemas.length && forzar ? motivo.trim() : null,
        instrucciones: esAzul ? instr : null,
        items: [],
      },
    })
    setEnviando(false)
    if (error) { setError(mensajeError(error)); window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    const r = data as { id: number; aviso: string | null }
    nav(imprimir && esAzul ? `/manifiestos/${r.id}/imprimir` : `/manifiestos/${r.id}`, { state: { emitido: true, aviso: r.aviso } })
  }

  if (!puedeEditar) return <p className="aviso haz">Tu usuario es de consulta: no puede emitir manifiestos.</p>

  return (
    <form onSubmit={emitir}>
      <p><Link to="/manifiestos">Volver a manifiestos</Link></p>
      <h1>Nuevo manifiesto</h1>
      <p className="sub">{esAzul ? 'Se cargan las secciones 1, 2, 4 y 5 y se imprimen sobre el formulario azul. La sección 3 (residuos) se carga al entrar a planta.' : 'Manifiesto de otro transportista (formulario rosa): se registra con el número de su formulario. Los residuos se cargan al entrar a planta.'}</p>
      {error && <div className="aviso bad" role="alert" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="card stack" data-ayuda="nm-formulario">
        <h2 className="paso-h"><span className="sn">1</span>Formulario y retiro <small className="muted">· sección 1</small></h2>
        <div className="campos">
          <label className="campo">Transportista
            <select value={transportista} onChange={(e) => setTransportista(e.target.value)} required>
              {transportistas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </label>
          <label className="campo" data-ayuda="nm-numero">Número del formulario
            <input value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="numeric" required pattern="[\d\s-]{9,12}" placeholder="837007470" />
            <span className="ayuda">{sugerido ? `El siguiente es ${fnum(sugerido)}. Revisá que coincida con el papel.` : 'Copialo del formulario.'}</span>
          </label>
          <label className="campo">Fecha del retiro
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required max={hoy()} />
          </label>
        </div>
        <div className="campos">
          <label className="campo" data-ayuda="nm-generador">Generador
            <input list="lista-generadores" value={genTexto} onChange={(e) => setGenTexto(e.target.value)} required placeholder="Empezá a escribir el nombre" />
            <datalist id="lista-generadores">{generadores.map((g) => <option key={g.id} value={g.nombre}>{g.cuit ?? ''}</option>)}</datalist>
            {generador && <span className="ayuda">CUIT {generador.cuit ?? 'sin cargar'}{generador.actividad ? ` · ${generador.actividad}` : ''}</span>}
            {generador && <HabGenerador vto={generador.hab_mun_vto} fecha={fecha} />}
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

      <div className="card stack mt" data-ayuda="nm-flota">
        <h2 className="paso-h"><span className="sn">2</span>Camión y chofer <small className="muted">· sección 2</small></h2>
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

      {esAzul && <div className="card stack mt" data-ayuda="nm-instrucciones">
        <h2 className="paso-h"><span className="sn">3</span>Instrucciones de manipulación <small className="muted">· secciones 4 y 5</small></h2>
        <div className="campos">{(['inhalacion', 'dermica', 'oral'] as const).map((k) => (
          <label key={k} className="campo">Toxicidad {k === 'inhalacion' ? 'por inhalación' : k === 'dermica' ? 'dérmica' : 'oral'}
            <select value={instr[k]} onChange={(e) => setInstr({ ...instr, [k]: e.target.value })}>{NIVELES.map((n) => <option key={n}>{n}</option>)}</select>
          </label>))}
        </div>
        <div><div className="muted small" style={{ marginBottom: 6 }}>Sistema de identificación de peligrosidad</div>
          <div className="tildes">{PELIGROS.map((t, k) => (
            <label key={t} className="tilde"><input type="checkbox" checked={instr.peligros[k]}
              onChange={(e) => { const p = [...instr.peligros] as Instrucciones['peligros']; p[k] = e.target.checked; setInstr({ ...instr, peligros: p }) }} /> {t}</label>))}
          </div></div>
        <div><div className="muted small" style={{ marginBottom: 6 }}>Instructivos que se adjuntan</div>
          <div className="tildes">{INSTRUCTIVOS.map((t, k) => (
            <label key={t} className="tilde"><input type="checkbox" checked={instr.instructivos[k]}
              onChange={(e) => { const p = [...instr.instructivos] as Instrucciones['instructivos']; p[k] = e.target.checked; setInstr({ ...instr, instructivos: p }) }} /> {t}</label>))}
          </div></div>
        <span className="ayuda small muted">Vienen cargadas con los valores de siempre (Configuración → Parámetros). Cambialas solo si este retiro es distinto.</span>
      </div>}

      <div className="card stack mt" data-ayuda="nm-residuos">
        <h2 className="paso-h"><span className="sn">{esAzul ? 4 : 3}</span>Residuos: se cargan al entrar a planta <small className="muted">· sección 3</small></h2>
        <p className="muted small" style={{ margin: 0 }}>El manifiesto queda <b>Iniciado</b>. La sección 3 (corriente, contenedor y cantidad) se completa cuando la carga llega a planta, desde <b>Planta → Por ingresar</b> o desde el mismo manifiesto. Ahí pasa a <b>Almacenado</b>.</p>
        <label className="campo">Nota (opcional)
          <textarea value={nota} onChange={(e) => setNota(e.target.value)} />
        </label>
      </div>

      <div className="bar mt" style={{ justifyContent: 'flex-end' }}>
        <Link to="/manifiestos"><button type="button">Cancelar</button></Link>
        {esAzul && <button disabled={enviando || bloqueado} onClick={() => setImprimir(false)}>Emitir</button>}
        <button className="pri" disabled={enviando || bloqueado} data-ayuda="nm-emitir" onClick={() => setImprimir(esAzul)}>{enviando ? 'Emitiendo…' : esAzul ? 'Emitir e imprimir' : 'Registrar manifiesto'}</button>
      </div>
    </form>
  )
}

/** Habilitación municipal del generador a la fecha del retiro */
function HabGenerador({ vto, fecha }: { vto: string | null; fecha: string }) {
  if (!vto) return <span className="pill bad" style={{ alignSelf: 'flex-start' }}>Habilitación municipal sin cargar</span>
  const dias = Math.round((new Date(vto).getTime() - new Date(fecha).getTime()) / 86400000)
  if (dias < 0) return <span className="pill bad" style={{ alignSelf: 'flex-start' }}>Habilitación municipal vencida el {fd(vto)}</span>
  if (dias <= 45) return <span className="pill haz" style={{ alignSelf: 'flex-start' }}>Habilitación municipal vence el {fd(vto)}</span>
  return <span className="pill ok" style={{ alignSelf: 'flex-start' }}>Habilitación municipal vigente hasta el {fd(vto)}</span>
}
