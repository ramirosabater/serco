import { useEffect, useState } from 'react'
import { supabase, mensajeError } from '../lib/supabase'

interface Dir { id: number; direccion: string; ciudad: string | null }

/** Direcciones donde se retiran los residuos de un generador */
export default function DireccionesRetiro({ generadorId, soloLectura }: { generadorId: number; soloLectura: boolean }) {
  const [dirs, setDirs] = useState<Dir[]>([])
  const [nueva, setNueva] = useState('')
  const [ciudad, setCiudad] = useState('')
  const [error, setError] = useState('')

  const cargar = () => supabase.from('generador_direcciones').select('id, direccion, ciudad').eq('generador_id', generadorId).order('direccion')
    .then(({ data }) => setDirs((data ?? []) as Dir[]))
  useEffect(() => { cargar() }, [generadorId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function agregar() {
    if (!nueva.trim()) return
    setError('')
    const { error } = await supabase.from('generador_direcciones').insert({ generador_id: generadorId, direccion: nueva.trim().toUpperCase(), ciudad: ciudad.trim().toUpperCase() || null })
    if (error) setError(error.code === '23505' ? 'Esa dirección ya está cargada.' : mensajeError(error))
    else { setNueva(''); setCiudad(''); cargar() }
  }

  async function quitar(d: Dir) {
    if (!window.confirm(`¿Quitar la dirección ${d.direccion}? Los manifiestos ya emitidos la conservan.`)) return
    const { error } = await supabase.from('generador_direcciones').delete().eq('id', d.id)
    if (error) setError(mensajeError(error)); else cargar()
  }

  return (
    <div className="card mt">
      <h2>Direcciones de retiro ({dirs.length})</h2>
      {error && <div className="aviso bad" style={{ marginBottom: 12 }}>{error}</div>}
      {dirs.length === 0 ? <p className="muted">Sin direcciones cargadas.</p> : (
        <table><tbody>{dirs.map((d) => (
          <tr key={d.id}><td>{d.direccion}</td><td className="muted">{d.ciudad ?? ''}</td>
            <td style={{ textAlign: 'right' }}>{!soloLectura && <button type="button" className="link" onClick={() => quitar(d)}>Quitar</button>}</td></tr>))}
        </tbody></table>)}
      {!soloLectura && (
        <div className="bar mt">
          <input placeholder="Nueva dirección" value={nueva} onChange={(e) => setNueva(e.target.value)} style={{ flex: 2, minWidth: 200 }} aria-label="Nueva dirección" />
          <input placeholder="Ciudad" value={ciudad} onChange={(e) => setCiudad(e.target.value)} style={{ flex: 1, minWidth: 120 }} aria-label="Ciudad" />
          <button type="button" onClick={agregar} disabled={!nueva.trim()}>Agregar dirección</button>
        </div>)}
    </div>
  )
}
