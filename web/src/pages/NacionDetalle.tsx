import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, mensajeError } from '../lib/supabase'
import { fd, fnum, num, umL } from '../lib/formato'
import type { UM } from '../lib/tipos'
import { useAuth } from '../auth/AuthProvider'
import { abrirArchivo } from '../lib/archivos'

// Ficha de un Manifiesto Nación: qué residuos viajaron, el certificado del operador
// y si ya se les avisó a los generadores.

interface Datos {
  id: number; numero: string; fecha: string; escaneo: string | null; validacion_omitida: string | null
  operadores: { nombre: string } | null; transportistas: { nombre: string } | null
  camiones: { patente: string } | null; choferes: { nombre: string } | null; generadores_principales: { nombre: string } | null
  manifiesto_items: {
    id: number; cantidad: number; um: UM; estado: string; corrientes: { codigo: string; descripcion: string | null } | null
    manifiestos: { id: number; numero: string; fecha: string; generadores: { id: number; nombre: string } | null } | null
    certificados: { id: number; numero: string; fecha: string; archivo: string | null; tipo_tratamiento: string | null; enviado_cliente: string | null } | null
  }[]
}
interface Aviso { certificado_id: number; generador_id: number; email: string | null; resultado: string; fecha: string }

const SELECT = `id, numero, fecha, escaneo, validacion_omitida, operadores(nombre), transportistas(nombre), camiones(patente), choferes(nombre),
  generadores_principales(nombre),
  manifiesto_items(id, cantidad, um, estado, corrientes(codigo, descripcion), manifiestos(id, numero, fecha, generadores(id, nombre)),
    certificados(id, numero, fecha, archivo, tipo_tratamiento, enviado_cliente))`

export default function NacionDetalle() {
  const { id } = useParams()
  const nav = useNavigate()
  const { perfil } = useAuth()
  const [n, setN] = useState<Datos | null>(null)
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [enviando, setEnviando] = useState(false)

  const cargar = () => {
    supabase.from('manifiestos_nacion').select(SELECT).eq('id', Number(id)).maybeSingle().then(({ data, error }) => {
      if (error || !data) { setError(error ? mensajeError(error) : 'No existe este Manifiesto Nación.'); return }
      const d = data as unknown as Datos
      setN(d)
      const certs = [...new Set(d.manifiesto_items.map((i) => i.certificados?.id).filter(Boolean))] as number[]
      if (certs.length) supabase.from('avisos_certificados').select('*').in('certificado_id', certs).then(({ data }) => setAvisos((data ?? []) as Aviso[]))
    })
  }
  useEffect(cargar, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const certs = useMemo(() => [...new Map((n?.manifiesto_items ?? []).filter((i) => i.certificados).map((i) => [i.certificados!.id, i.certificados!])).values()], [n])
  const generadores = useMemo(() => {
    const m = new Map<number, { nombre: string; certs: Set<number> }>()
    for (const i of n?.manifiesto_items ?? []) {
      const g = i.manifiestos?.generadores; if (!g) continue
      const x = m.get(g.id) ?? { nombre: g.nombre, certs: new Set<number>() }
      if (i.certificados) x.certs.add(i.certificados.id)
      m.set(g.id, x)
    }
    return [...m].sort((a, b) => a[1].nombre.localeCompare(b[1].nombre))
  }, [n])

  if (!n) return <p className={error ? 'aviso bad' : 'cargando'}>{error || 'Cargando…'}</p>
  const items = n.manifiesto_items
  const pendiente = items.some((i) => i.estado === 'en_transito')
  const tot = (['KGS', 'LTS', 'MS3'] as UM[]).map((u) => [u, items.filter((i) => i.um === u).reduce((a, i) => a + i.cantidad, 0)] as const).filter(([, v]) => v > 0)
  const avisoDe = (g: number) => {
    const l = avisos.filter((a) => a.generador_id === g)
    const env = l.find((a) => a.resultado === 'enviado')
    if (env) return <span className="pill ok">Avisado {fd(env.fecha.slice(0, 10))}{env.email ? ` · ${env.email}` : ''}</span>
    if (certs.length && certs.every((c) => c.enviado_cliente)) return <span className="pill ok">Avisado {fd(certs[0].enviado_cliente!.slice(0, 10))}</span>
    if (l.some((a) => a.resultado === 'sin_mail')) return <span className="pill bad">Sin mail cargado</span>
    return <span className="pill haz">{pendiente ? 'Espera el certificado' : 'Falta avisar'}</span>
  }
  const faltaAvisar = !pendiente && generadores.some(([g]) => !avisos.some((a) => a.generador_id === g && a.resultado === 'enviado') && !certs.every((c) => c.enviado_cliente))

  async function avisar() {
    setEnviando(true); setError(''); setOk('')
    const { data, error } = await supabase.functions.invoke('avisos', { body: { solo: 'certificados' } })
    setEnviando(false)
    if (error) { setError('No se pudo enviar: ' + mensajeError(error) + ' (los avisos por mail todavía no están activados)'); return }
    const r = data as Record<string, number>
    setOk(`Avisados ${r.generadores_avisados ?? 0} generadores${r.generadores_sin_mail ? `; ${r.generadores_sin_mail} sin mail cargado` : ''}.`); cargar()
  }

  return (
    <>
      <p><Link to="/planta?v=nacion">Volver a Manifiestos Nación</Link></p>
      <div className="bar" style={{ justifyContent: 'space-between', marginBottom: 2 }}>
        <h1>Manifiesto Nación {fnum(n.numero)}</h1>
        {pendiente ? <span className="pill haz">Esperando certificado</span> : <span className="pill ok">Certificado</span>}
      </div>
      <p className="sub">{fd(n.fecha)} · destino {n.operadores?.nombre ?? '—'} · {tot.map(([u, v]) => `${num(v)} ${umL(u)}`).join(' + ')}</p>
      {error && <div className="aviso bad" style={{ marginBottom: 12 }}>{error}</div>}
      {ok && <div className="aviso ok" style={{ marginBottom: 12 }}>{ok}</div>}
      {n.validacion_omitida && <div className="aviso haz" style={{ marginBottom: 12 }}>Se armó con vencimientos sin regularizar. Motivo: {n.validacion_omitida}</div>}

      <div className="grid c21">
        <div className="card">
          <h2>Residuos que viajaron ({items.length})</h2>
          <div className="tw"><table className="compacta">
            <thead><tr><th>Manifiesto</th><th>Generador</th><th>Corriente</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Certificado</th></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id} className="fila" tabIndex={0} onClick={() => i.manifiestos && nav(`/manifiestos/${i.manifiestos.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && i.manifiestos && nav(`/manifiestos/${i.manifiestos.id}`)}>
                <td className="nw"><b>{i.manifiestos ? fnum(i.manifiestos.numero) : '—'}</b><div className="muted small">{fd(i.manifiestos?.fecha)}</div></td>
                <td>{i.manifiestos?.generadores?.nombre}</td>
                <td><span className="pill">{i.corrientes?.codigo}</span></td>
                <td className="n">{num(i.cantidad)} {umL(i.um)}</td>
                <td className="nw">{i.certificados?.numero ?? <span className="muted">Pendiente</span>}</td>
              </tr>))}
            </tbody>
          </table></div>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <div className="card">
            <h2>Viaje</h2>
            <dl className="kv">
              <dt>Planta</dt><dd>{n.generadores_principales?.nombre ?? '—'}</dd>
              <dt>Transportista</dt><dd>{n.transportistas?.nombre ?? '—'}</dd>
              <dt>Camión</dt><dd>{n.camiones?.patente ?? '—'}</dd>
              <dt>Chofer</dt><dd>{n.choferes?.nombre ?? '—'}</dd>
            </dl>
            <div className="bar mt" style={{ marginBottom: 0 }}>
              {n.escaneo && <button onClick={() => abrirArchivo(n.escaneo, setError)}>Ver formulario firmado</button>}
              <button disabled title="Falta el formulario verde en blanco para medir dónde va cada dato">Imprimir en el formulario verde</button>
            </div>
          </div>

          <div className="card">
            <h2>{certs.length > 1 ? 'Certificados' : 'Certificado'}</h2>
            {certs.length === 0 ? <>
              <p className="muted" style={{ marginTop: 0 }}>Todavía no llegó el certificado del operador.</p>
              {perfil?.rol !== 'consulta' && <Link to="/planta?v=transito"><button className="pri">Registrar certificado</button></Link>}
            </> : certs.map((c) => (
              <div key={c.id} style={{ marginBottom: 10 }}>
                <dl className="kv">
                  <dt>Número</dt><dd><b>{c.numero}</b></dd>
                  <dt>Fecha</dt><dd>{fd(c.fecha)}</dd>
                  {c.tipo_tratamiento && <><dt>Tratamiento</dt><dd>{c.tipo_tratamiento}</dd></>}
                </dl>
                {c.archivo && <button className="mt" onClick={() => abrirArchivo(c.archivo, setError)}>Ver PDF del certificado</button>}
              </div>))}
            {pendiente && certs.length > 0 && <p className="muted small">Hay residuos de este viaje que todavía esperan certificado.</p>}
          </div>

          <div className="card">
            <h2>Aviso a los generadores</h2>
            <div className="stack" style={{ gap: 8 }}>{generadores.map(([g, x]) => (
              <div key={g} className="bar" style={{ justifyContent: 'space-between', margin: 0, flexWrap: 'nowrap' }}>
                <Link to={`/altas/generadores/${g}`} style={{ color: 'inherit' }}>{x.nombre}</Link>{avisoDe(g)}
              </div>))}
            </div>
            {faltaAvisar && perfil?.rol === 'admin' && (
              <div className="bar mt" style={{ marginBottom: 0 }}>
                <button className="pri" onClick={avisar} disabled={enviando}>{enviando ? 'Enviando…' : 'Avisar ahora por mail'}</button>
                <span className="muted small">Si no, sale solo mañana a las 7.</span>
              </div>)}
          </div>
        </div>
      </div>
    </>
  )
}
