import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, mensajeError } from '../lib/supabase'
import { fd, fnum, num, umL } from '../lib/formato'
import type { UM } from '../lib/tipos'

// Anexo del Manifiesto Nación ("ManifTransNacion para Visar" del Access): los manifiestos que van en el viaje,
// agrupados por cliente con sus totales, y los datos y habilitaciones de la planta de donde sale.

const SELECT = `id, numero, fecha,
  generadores_principales(nombre, cuit, direccion, ciudad, provincia, telefono, email, hab_pro_nro, hab_pro_vto, hab_nac_nro, hab_nac_vto, hab_mun_nro, hab_mun_vto),
  transportistas(nombre, hab_nac_nro), operadores(nombre, hab_nac_nro), camiones(patente), choferes(nombre),
  manifiesto_items(id, cantidad, um, contenedor, corrientes(codigo, descripcion),
    manifiestos(id, numero, fecha, viaje_id, generadores(id, nombre, cuit, direccion, ciudad, provincia)))`

interface Gen { id: number; nombre: string; cuit: string | null; direccion: string | null; ciudad: string | null; provincia: string | null }
interface Item { id: number; cantidad: number; um: UM; contenedor: string | null; corrientes: { codigo: string; descripcion: string | null } | null
  manifiestos: { id: number; numero: string; fecha: string; viaje_id: number | null; generadores: Gen | null } | null }
interface Datos {
  id: number; numero: string; fecha: string
  generadores_principales: { nombre: string; cuit: string | null; direccion: string | null; ciudad: string | null; provincia: string | null; telefono: string | null; email: string | null
    hab_pro_nro: string | null; hab_pro_vto: string | null; hab_nac_nro: string | null; hab_nac_vto: string | null; hab_mun_nro: string | null; hab_mun_vto: string | null } | null
  transportistas: { nombre: string; hab_nac_nro: string | null } | null; operadores: { nombre: string; hab_nac_nro: string | null } | null
  camiones: { patente: string } | null; choferes: { nombre: string } | null
  manifiesto_items: Item[]
}

const cuitF = (c: string | null | undefined) => (c && /^\d{11}$/.test(c) ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c ?? '')
const totales = (l: Item[]) => (['KGS', 'LTS', 'MS3'] as UM[]).map((u) => [u, l.filter((i) => i.um === u).reduce((a, i) => a + Number(i.cantidad), 0)] as const).filter(([, v]) => v > 0)
const tot = (l: Item[]) => totales(l).map(([u, v]) => `${num(v)} ${umL(u)}`).join(' + ')
const hab = (n: string | null | undefined, v: string | null | undefined) => (n ? `${n}${v ? ` · Vto: ${fd(v)}` : ''}` : '—')

export default function ImprimirAnexoNacion() {
  const { id } = useParams()
  const [d, setD] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { document.body.classList.add('modo-certificado'); return () => document.body.classList.remove('modo-certificado') }, [])
  useEffect(() => {
    supabase.from('manifiestos_nacion').select(SELECT).eq('id', Number(id)).maybeSingle().then(({ data, error }) => {
      if (error || !data) setError(error ? mensajeError(error) : 'No existe este Manifiesto Nación.')
      else setD(data as unknown as Datos)
    })
  }, [id])

  if (!d) return <p className={error ? 'aviso bad' : 'cargando'}>{error || 'Cargando…'}</p>
  // Sin el renglón del formulario del viaje que cargaba el Access (como hacía el anexo del Access)
  const items = d.manifiesto_items.filter((i) => i.manifiestos?.viaje_id !== d.id)
  const grupos = new Map<number, { g: Gen; items: Item[] }>()
  for (const i of items) {
    const g = i.manifiestos?.generadores; if (!g) continue
    const x = grupos.get(g.id) ?? { g, items: [] }; x.items.push(i); grupos.set(g.id, x)
  }
  const lista = [...grupos.values()].sort((a, b) => a.g.nombre.localeCompare(b.g.nombre))
  const p = d.generadores_principales

  return (
    <>
      <div className="no-imprimir">
        <p><Link to={`/nacion/${d.id}`}>Volver al Manifiesto Nación</Link></p>
        <div className="bar" style={{ justifyContent: 'space-between' }}>
          <h1>Anexo del Manifiesto Nación {fnum(d.numero)}</h1>
          <button className="pri" onClick={() => window.print()}>Imprimir</button>
        </div>
        <p className="sub">El detalle de los manifiestos que van en el viaje, por cliente, para acompañar el formulario. A4 vertical.</p>
      </div>
      <div className="cert-hojas">
        <section className="cert-hoja libre">
          <header className="cert-cab">
            <img src="/serco-logo.png" alt="Serco Ambiental" />
            <div className="cert-tit">
              <div>MANIFIESTO TRANSPORTE DE NACIÓN</div>
              <div className="cert-num">Nº {fnum(d.numero)} · {fd(d.fecha)}</div>
            </div>
            <div />
          </header>

          <div className="cert-bloque">
            <h3>GENERADOR (PLANTA DE ALMACENAMIENTO)</h3>
            {p ? <dl>
              <dt>Razón social:</dt><dd><b>{p.nombre}</b></dd><dt>CUIT:</dt><dd>{cuitF(p.cuit)}</dd>
              <dt>Domicilio:</dt><dd>{p.direccion}</dd><dt>Ciudad:</dt><dd>{[p.ciudad, p.provincia].filter(Boolean).join(' - ')}</dd>
              <dt>Nro. Hab. Prov.:</dt><dd>{hab(p.hab_pro_nro, p.hab_pro_vto)}</dd><dt>Nro. Hab. Nac.:</dt><dd>{hab(p.hab_nac_nro, p.hab_nac_vto)}</dd>
              <dt>Nro. Hab. Mun.:</dt><dd>{hab(p.hab_mun_nro, p.hab_mun_vto)}</dd><dt>Teléfono / mail:</dt><dd>{[p.telefono, p.email].filter(Boolean).join(' · ')}</dd>
            </dl> : <p className="small">Sin planta cargada.</p>}
          </div>
          <div className="cert-bloque">
            <dl>
              <dt>Transporte:</dt><dd>{d.transportistas?.nombre ?? '—'}{d.transportistas?.hab_nac_nro ? ` · CAA ${d.transportistas.hab_nac_nro}` : ''}</dd>
              <dt>Operador:</dt><dd>{d.operadores?.nombre ?? '—'}{d.operadores?.hab_nac_nro ? ` · CAA ${d.operadores.hab_nac_nro}` : ''}</dd>
              <dt>Dominio:</dt><dd>{d.camiones?.patente ?? '—'}</dd><dt>Chofer:</dt><dd>{d.choferes?.nombre ?? '—'}</dd>
            </dl>
          </div>

          <table className="cert-tabla">
            <colgroup><col style={{ width: '16%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /><col style={{ width: '30%' }} /><col style={{ width: '14%' }} /><col style={{ width: '16%' }} /></colgroup>
            <thead><tr><th>Manifiesto</th><th>Fecha</th><th>Tipo (Yx)</th><th>Descripción</th><th>Recipiente</th><th className="n">Cantidad</th></tr></thead>
            {lista.map(({ g, items: l }) => (
              <tbody key={g.id}>
                <tr className="cert-grupo"><td colSpan={6}>{g.nombre} · CUIT {cuitF(g.cuit)}{g.direccion ? ` · ${g.direccion}` : ''}{g.ciudad ? ` · ${g.ciudad}` : ''}</td></tr>
                {[...l].sort((a, b) => (a.manifiestos?.numero ?? '').localeCompare(b.manifiestos?.numero ?? '')).map((i) => (
                  <tr key={i.id}><td>{fnum(i.manifiestos?.numero ?? '')}</td><td>{fd(i.manifiestos?.fecha ?? '')}</td><td>{i.corrientes?.codigo}</td>
                    <td>{i.corrientes?.descripcion ?? ''}</td><td>{i.contenedor ?? ''}</td><td className="n">{num(Number(i.cantidad))} {umL(i.um)}</td></tr>))}
                <tr className="cert-sub"><td colSpan={5}>Total {g.nombre}</td><td className="n"><b>{tot(l)}</b></td></tr>
              </tbody>))}
            <tbody><tr className="cert-total"><td colSpan={5}><b>Total Manifiesto Nº {fnum(d.numero)} ({lista.length} {lista.length === 1 ? 'cliente' : 'clientes'}, {new Set(items.map((i) => i.manifiestos?.id)).size} manifiestos)</b></td><td className="n"><b>{tot(items)}</b></td></tr></tbody>
          </table>

          <div className="cert-pie" style={{ marginTop: 0, paddingTop: '22mm' }}>
            <div className="cert-firmas"><span>Firma generador</span><span>Firma transportista</span></div>
          </div>
        </section>
      </div>
    </>
  )
}
