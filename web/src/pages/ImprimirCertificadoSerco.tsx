import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, mensajeError } from '../lib/supabase'
import { fd, fnum, num, umL } from '../lib/formato'
import type { UM } from '../lib/tipos'

// Certificado de disposición final de Serco para el generador (RPGyOSP numerado), original y duplicado.
// Mismos datos y columnas que el del Access ("CERTIFICADOS DE DISPOSICION FINAL · RESIDUOS PELIGROSOS Nº").

interface Residuo { corriente: string; estado_fisico: string | null; cantidad: number; um: UM; manifiesto: string; fecha: string; transportista: string | null; transportista_rpg: string | null }
interface Planta { nombre: string; cuit: string | null; direccion: string | null; ciudad: string | null; provincia: string | null; telefono: string | null; email: string | null
  hab_pro_nro: string | null; hab_pro_vto: string | null; hab_nac_nro: string | null; hab_nac_vto: string | null; hab_mun_nro: string | null; hab_mun_vto: string | null }
interface Cert { numero: string; fecha: string; fecha_listado: string | null; tipo_tratamiento: string | null; operador: { nombre: string; ubicacion: string | null }; planta: Planta | null; residuos: Residuo[] }
interface Datos {
  numero: number; rpg: number
  generador: { nombre: string; cuit: string | null; direccion: string | null; ciudad: string | null; provincia: string | null; hab_mun_nro: string | null }
  certificados: Cert[]
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const cuitF = (c: string | null | undefined) => (c && /^\d{11}$/.test(c) ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c ?? '')
const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\p{L}/gu, (x) => x.toUpperCase())
const telF = (t: string | null | undefined) => (t && /^0\d{10}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4)}` : t ?? '')
export const numCertSerco = (rpg: number | string, n: number) => `${rpg} - ${String(n).padStart(7, '0')}`

function totales(l: Residuo[]) {
  return (['KGS', 'LTS', 'MS3'] as UM[]).map((u) => [u, l.filter((r) => r.um === u).reduce((a, r) => a + Number(r.cantidad), 0)] as const).filter(([, v]) => v > 0)
}

function Hoja({ d, copia }: { d: Datos; copia: 'ORIGINAL' | 'DUPLICADO' }) {
  const p = d.certificados.find((c) => c.planta)?.planta
  const g = d.generador
  const fl = d.certificados.map((c) => c.fecha_listado ?? c.fecha).filter(Boolean).sort().pop()
  const todos = d.certificados.flatMap((c) => c.residuos ?? [])
  return (
    <section className="cert-hoja">
      <header className="cert-cab">
        <img src="/serco-logo.png" alt="Serco Ambiental" />
        <div className="cert-tit">
          <div>CERTIFICADO DE DISPOSICIÓN FINAL</div>
          <div className="cert-num">RESIDUOS PELIGROSOS Nº {numCertSerco(d.rpg, d.numero)}</div>
        </div>
        <div className="cert-copia">{copia}</div>
      </header>

      <div className="cert-bloque">
        <h3>GENERADOR</h3>
        <dl>
          <dt>Razón social:</dt><dd><b>{g.nombre}</b></dd><dt>CUIT:</dt><dd>{cuitF(g.cuit)}</dd>
          <dt>Domicilio:</dt><dd>{g.direccion}</dd><dt>Ciudad:</dt><dd>{[g.ciudad, g.provincia].filter(Boolean).join(' - ')}</dd>
          <dt>RPGyOSP Nº:</dt><dd>{g.hab_mun_nro ?? ''}</dd>
        </dl>
      </div>

      {p && <div className="cert-bloque">
        <h3>DATOS DEL OPERADOR POR ALMACENAMIENTO</h3>
        <dl>
          <dt>Razón social:</dt><dd><b>{p.nombre}</b></dd><dt>CUIT:</dt><dd>{cuitF(p.cuit)}</dd>
          <dt>Domicilio:</dt><dd>{p.direccion}</dd><dt>Provincia:</dt><dd>{[p.ciudad, p.provincia].filter(Boolean).join(' - ')}</dd>
          <dt>RPGyOSP Nº:</dt><dd>{p.hab_pro_nro ?? ''}{p.hab_pro_vto ? ` · Vto: ${fd(p.hab_pro_vto)}` : ''}</dd>
          <dt>Hab. Nac.:</dt><dd>{p.hab_nac_nro ?? ''}{p.hab_nac_vto ? ` · Vto: ${fd(p.hab_nac_vto)}` : ''}</dd>
          <dt>Hab. Mun.:</dt><dd>{p.hab_mun_nro ?? ''}{p.hab_mun_vto ? ` · Vto: ${fd(p.hab_mun_vto)}` : ''}</dd>
        </dl>
      </div>}

      <table className="cert-tabla">
        <colgroup><col style={{ width: '9%' }} /><col style={{ width: '9%' }} /><col style={{ width: '10%' }} /><col style={{ width: '14%' }} /><col style={{ width: '11%' }} />
          <col style={{ width: '9%' }} /><col style={{ width: '14%' }} /><col style={{ width: '16%' }} /><col style={{ width: '8%' }} /></colgroup>
        <thead><tr><th>Tipo</th><th>Estado físico</th><th className="n">Cantidad</th><th>Transporte RPGyOSP Nº</th><th>Manifiesto Transp. Nº</th><th>Fecha</th>
          <th>Operadora Disp. Final</th><th>Ubicación</th><th>Tipo</th></tr></thead>
        {d.certificados.map((c) => (
          <tbody key={c.numero}>
            <tr className="cert-grupo"><td colSpan={9}>Certificado Nº {c.numero} · {fd(c.fecha)}</td></tr>
            {(c.residuos ?? []).map((r, i) => (
              <tr key={i}>
                <td>{r.corriente}</td><td>{r.estado_fisico ?? ''}</td><td className="n">{num(Number(r.cantidad))} {umL(r.um)}</td>
                <td>{r.transportista ?? ''}{r.transportista_rpg ? ` · ${r.transportista_rpg}` : ''}</td><td>{fnum(r.manifiesto)}</td><td>{fd(r.fecha)}</td>
                <td>{c.operador?.nombre}</td><td>{c.operador?.ubicacion ?? ''}</td><td>{c.tipo_tratamiento ?? ''}</td>
              </tr>))}
            {d.certificados.length > 1 && <tr className="cert-sub"><td colSpan={2}>Subtotal</td><td className="n">{totales(c.residuos ?? []).map(([u, v]) => `${num(v)} ${umL(u)}`).join(' + ')}</td><td colSpan={6} /></tr>}
          </tbody>))}
        <tfoot><tr><td colSpan={2}><b>Total general:</b></td><td className="n"><b>{totales(todos).map(([u, v]) => `${num(v)} ${umL(u)}`).join(' + ')}</b></td><td colSpan={6} /></tr></tfoot>
      </table>

      <div className="cert-pie">
        <p className="cert-lugar">{titulo(p?.ciudad ?? 'Comodoro Rivadavia')}, {fl ? `${MESES[+fl.slice(5, 7) - 1]} de ${fl.slice(0, 4)}` : ''}</p>
        <div className="cert-firmas"><span>Firma (R.T.A.)</span><span>Firma (R.T.A.)</span></div>
        {p && <div className="cert-datos"><span>{p.direccion}<br />{[p.ciudad, p.provincia].filter(Boolean).join(' - ')}</span>
          <span>Teléfono: {telF(p.telefono)}<br />mail: {p.email ?? ''}</span></div>}
      </div>
    </section>
  )
}

export default function ImprimirCertificadoSerco() {
  const { numero } = useParams()
  const [d, setD] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { document.body.classList.add('modo-certificado'); return () => document.body.classList.remove('modo-certificado') }, [])
  useEffect(() => {
    supabase.rpc('certificado_serco', { p_numero: Number(numero) }).then(({ data, error }) => {
      if (error || !data) setError(error ? mensajeError(error) : 'No existe ese certificado de Serco.')
      else setD(data as Datos)
    })
  }, [numero])

  if (!d) return <p className={error ? 'aviso bad' : 'cargando'}>{error || 'Cargando…'}</p>
  const sinPlanta = !d.certificados.some((c) => c.planta)
  return (
    <>
      <div className="no-imprimir">
        <p><Link to="/certificados-serco?v=emitidos">Volver a los certificados de Serco</Link></p>
        <div className="bar" style={{ justifyContent: 'space-between' }}>
          <h1>Certificado {numCertSerco(d.rpg, d.numero)}</h1>
          <button className="pri" onClick={() => window.print()}>Imprimir original y duplicado</button>
        </div>
        <p className="sub">{d.generador.nombre} · A4 vertical, a escala 100 %. Salen dos hojas: original y duplicado.</p>
        {sinPlanta && <div className="aviso haz" style={{ marginBottom: 12 }}>El certificado del operador no tiene la planta de Serco cargada: falta el bloque del operador por almacenamiento.</div>}
        {!d.generador.hab_mun_nro && <div className="aviso haz" style={{ marginBottom: 12 }}>El generador no tiene número de RPGyOSP (habilitación municipal) cargado en su ficha.</div>}
      </div>
      <div className="cert-hojas">
        <Hoja d={d} copia="ORIGINAL" />
        <Hoja d={d} copia="DUPLICADO" />
      </div>
    </>
  )
}
