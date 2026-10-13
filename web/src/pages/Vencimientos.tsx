import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { traerTodo } from '../lib/paginar'
import { supabase } from '../lib/supabase'
import { fd } from '../lib/formato'
import type { Alerta } from '../lib/tipos'

const TIPOS: Record<Alerta['tipo'], string> = { camion: 'Camión', chofer: 'Chofer', generador: 'Generador', transportista: 'Transportista', operador: 'Operador', planta: 'Planta' }
const PLURAL: Record<Alerta['tipo'], string> = { camion: 'Camiones', chofer: 'Choferes', generador: 'Generadores', transportista: 'Transportistas', operador: 'Operadores', planta: 'Plantas' }
/** Lo urgente arriba: por vencer (lo más próximo primero), después vencido (lo más reciente primero), al final sin cargar */
const PRIORIDAD: Record<Alerta['estado'], number> = { por_vencer: 0, vencido: 1, sin_cargar: 2, vigente: 3 }
const ordenar = (l: Alerta[]) => [...l].sort((a, b) => PRIORIDAD[a.estado] - PRIORIDAD[b.estado]
  || (a.estado === 'vencido' ? String(b.vto).localeCompare(String(a.vto)) : String(a.vto).localeCompare(String(b.vto))))
const ENTIDAD: Record<Alerta['tipo'], string> = { camion: 'camiones', chofer: 'choferes', generador: 'generadores', transportista: 'transportistas', operador: 'operadores', planta: 'plantas' }
const ESTADOS: Record<Alerta['estado'], [string, string]> = { vencido: ['Vencido', 'bad'], sin_cargar: ['Sin cargar', 'bad'], por_vencer: ['Por vencer', 'haz'], vigente: ['Vigente', 'ok'] }

export default function Vencimientos() {
  const nav = useNavigate()
  const [tipo, setTipo] = useState<string>('flota')
  const [estado, setEstado] = useState<string>('problemas')
  const [lista, setLista] = useState<Alerta[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    setCargando(true)
    const armar = () => {
      let c = supabase.from('alertas_vencimiento').select('*')
      c = tipo === 'flota' ? c.in('tipo', ['camion', 'chofer']) : tipo ? c.eq('tipo', tipo) : c
      c = estado === 'problemas' ? c.in('estado', ['vencido', 'por_vencer', 'sin_cargar']) : estado ? c.eq('estado', estado) : c
      return c.order('vto', { ascending: true, nullsFirst: true }).order('tipo').order('id').order('documento')
    }
    traerTodo<Alerta>(armar).then(({ data }) => { setLista(ordenar(data)); setCargando(false) })
  }, [tipo, estado])

  return (
    <>
      <h1>Vencimientos</h1>
      <p className="sub">Con un documento vencido o sin cargar, el sistema no deja emitir con ese camión, chofer o transportista. Tocá una fila para actualizarlo.</p>
      <div className="bar">
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Qué mostrar">
          <option value="flota">Camiones y choferes</option>
          <option value="">Todos</option>
          {Object.entries(PLURAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado">
          <option value="problemas">Vencidos, por vencer y sin cargar</option>
          <option value="vencido">Vencidos</option>
          <option value="por_vencer">Por vencer</option>
          <option value="sin_cargar">Sin cargar</option>
          <option value="vigente">Vigentes</option>
          <option value="">Todos</option>
        </select>
        <span className="muted small">{lista.length} documentos: {(['por_vencer', 'vencido', 'sin_cargar'] as const).map((e) => `${lista.filter((a) => a.estado === e).length} ${ESTADOS[e][0].toLowerCase()}`).join(' · ')}</span>
      </div>
      <div className="card">
        {cargando ? <p className="cargando">Cargando…</p> : lista.length === 0 ? <p className="vacio">Todo al día.</p> : (
          <div className="tw"><table>
            <thead><tr><th>Qué</th><th>Nombre</th><th>Documento</th><th>Vencimiento</th><th>Estado</th></tr></thead>
            <tbody>{lista.map((a) => (
              <tr key={`${a.tipo}${a.id}${a.documento}`} className="fila" tabIndex={0} onClick={() => nav(`/altas/${ENTIDAD[a.tipo]}/${a.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && nav(`/altas/${ENTIDAD[a.tipo]}/${a.id}`)}>
                <td>{TIPOS[a.tipo]}</td><td><b>{a.nombre}</b></td><td>{a.documento}</td><td className="nw">{fd(a.vto)}</td>
                <td><span className={`pill ${ESTADOS[a.estado][1]}`}>{ESTADOS[a.estado][0]}</span>
                  {a.dias != null && a.estado === 'por_vencer' && <span className="muted small"> en {a.dias} días</span>}</td>
              </tr>))}
            </tbody>
          </table></div>)}
      </div>
    </>
  )
}
