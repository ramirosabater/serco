import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { supabase, mensajeError } from '../lib/supabase'
import { etapaDe, etapaManifiesto, ETAPAS, fd, fnum, num, umL } from '../lib/formato'
import type { Manifiesto } from '../lib/tipos'
import { useAuth } from '../auth/AuthProvider'
import { colorEtapa, PillEtapa } from '../components/Etapa'

const SELECT = `*, generadores(id, nombre, cuit), generadores_principales(nombre), transportistas(id, nombre),
  choferes(nombre), camiones(patente),
  manifiesto_items(id, corriente_id, contenedor, cantidad, um, estado, fecha_entrega_df, corrientes(codigo, descripcion),
    manifiestos_nacion(id, numero, fecha, operadores(nombre)), certificados(id, numero, fecha, archivo, operadores(nombre)))`

/** Abre un archivo del Storage con un enlace firmado de 5 minutos */
async function abrirArchivo(ruta: string | null, setError: (s: string) => void) {
  if (!ruta) return
  if (ruta.startsWith('\\')) { setError('El archivo todavía no se migró desde la PC del Access.'); return }
  const { data, error } = await supabase.storage.from('documentos').createSignedUrl(ruta, 300)
  if (error || !data) setError('No se pudo abrir el archivo: ' + mensajeError(error))
  else window.open(data.signedUrl, '_blank', 'noopener')
}

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
  const etapa = etapaManifiesto(items.map((i) => i.estado))
  const nacion = items.find((i) => i.manifiestos_nacion)?.manifiestos_nacion
  const cert = items.find((i) => i.certificados)?.certificados
  const detalle = [
    `Retiro ${fd(m.fecha)}${m.generadores_principales ? ' · ' + m.generadores_principales.nombre : ''}`,
    nacion ? `Manifiesto Nación ${fnum(nacion.numero)} · ${fd(nacion.fecha)}` : 'Sin Manifiesto Nación',
    cert ? `${cert.operadores?.nombre ?? ''} · ${fd(cert.fecha)}` : nacion?.operadores ? `Destino ${nacion.operadores.nombre}` : 'Pendiente',
    cert ? `Certificado ${cert.numero}` : 'Pendiente',
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

      {!m.anulado && <div className="card"><h2>Recorrido del residuo</h2>
        <div className="recorrido">{ETAPAS.map((t, k) => (
          <div key={t} className={`paso ${k <= etapa ? 'hecho' : ''}`} style={colorEtapa(k)}>
            <div className="t">{t}</div><div className="m">{k <= etapa || k === 1 ? detalle[k] : 'Pendiente'}</div>
          </div>))}
        </div></div>}

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
                <td className="nw">{i.manifiestos_nacion ? fnum(i.manifiestos_nacion.numero) : '—'}</td>
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
            {puedeEditar && m.tipo === 'azul' && !m.anulado && <Link to={`/manifiestos/${m.id}/imprimir`}><button>Imprimir en el formulario</button></Link>}
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
