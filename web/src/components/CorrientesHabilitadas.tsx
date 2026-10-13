import { useEffect, useMemo, useState } from 'react'
import { supabase, mensajeError } from '../lib/supabase'

interface Corriente { id: number; codigo: string; descripcion: string | null; um: string | null }

/** Lista de corrientes con casillas: qué corrientes puede transportar, recibir o tratar esta empresa */
export default function CorrientesHabilitadas({ config, id, soloLectura }: {
  config: { tabla: string; fk: string; conUm: boolean }; id: number; soloLectura: boolean
}) {
  const [todas, setTodas] = useState<Corriente[]>([])
  const [original, setOriginal] = useState<Set<number>>(new Set())
  const [marcadas, setMarcadas] = useState<Set<number>>(new Set())
  const [filtro, setFiltro] = useState('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    supabase.from('corrientes').select('id, codigo, descripcion, um').eq('activa', true).order('codigo')
      .then(({ data }) => setTodas((data ?? []) as Corriente[]))
    supabase.from(config.tabla).select('corriente_id').eq(config.fk, id).then(({ data }) => {
      const s = new Set((data ?? []).map((x: { corriente_id: number }) => x.corriente_id))
      setOriginal(s); setMarcadas(new Set(s))
    })
  }, [config, id])

  const visibles = useMemo(() => todas.filter((c) => !filtro || `${c.codigo} ${c.descripcion ?? ''}`.toLowerCase().includes(filtro.toLowerCase())), [todas, filtro])
  const altas = [...marcadas].filter((x) => !original.has(x))
  const bajas = [...original].filter((x) => !marcadas.has(x))

  function alternar(cid: number) {
    setOk('')
    setMarcadas((m) => { const n = new Set(m); if (n.has(cid)) n.delete(cid); else n.add(cid); return n })
  }

  async function guardar() {
    setError(''); setGuardando(true)
    if (altas.length) {
      const filas = altas.map((cid) => ({ [config.fk]: id, corriente_id: cid, ...(config.conUm ? { um: todas.find((c) => c.id === cid)?.um ?? null } : {}) }))
      const { error } = await supabase.from(config.tabla).insert(filas)
      if (error) { setError(mensajeError(error)); setGuardando(false); return }
    }
    if (bajas.length) {
      const { error } = await supabase.from(config.tabla).delete().eq(config.fk, id).in('corriente_id', bajas)
      if (error) { setError(mensajeError(error)); setGuardando(false); return }
    }
    setOriginal(new Set(marcadas)); setGuardando(false); setOk('Corrientes guardadas.')
  }

  return (
    <div className="card mt">
      <div className="bar" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Corrientes habilitadas ({marcadas.size})</h2>
        <input type="search" placeholder="Filtrar corrientes" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar corrientes" />
      </div>
      {original.size === 0 && marcadas.size === 0 && (
        <div className="aviso haz" style={{ marginBottom: 12 }}>No tiene corrientes cargadas: mientras la lista esté vacía, el sistema no controla las corrientes de esta empresa.</div>)}
      {error && <div className="aviso bad" style={{ marginBottom: 12 }}>{error}</div>}
      {ok && <div className="aviso ok" style={{ marginBottom: 12 }}>{ok}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '4px 16px' }}>
        {visibles.map((c) => (
          <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0' }}>
            <input type="checkbox" checked={marcadas.has(c.id)} onChange={() => alternar(c.id)} disabled={soloLectura} style={{ marginTop: 4 }} />
            <span><b>{c.codigo}</b> <span className="muted small">{c.descripcion}</span></span>
          </label>))}
      </div>
      {!soloLectura && (
        <div className="bar mt" style={{ justifyContent: 'flex-end' }}>
          {(altas.length > 0 || bajas.length > 0) && <span className="muted small">{altas.length} para agregar, {bajas.length} para quitar</span>}
          <button type="button" className="pri" onClick={guardar} disabled={guardando || (!altas.length && !bajas.length)}>{guardando ? 'Guardando…' : 'Guardar corrientes'}</button>
        </div>)}
    </div>
  )
}
