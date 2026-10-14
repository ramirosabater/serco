import type { CSSProperties } from 'react'
import { ETAPAS } from '../lib/formato'

export const colorEtapa = (k: number) => ({ '--sc': `var(--s${k})`, '--sb': `var(--s${k}b)` }) as CSSProperties

export function PillEtapa({ etapa }: { etapa: number }) {
  return <span className="pill st" style={colorEtapa(etapa)}>{ETAPAS[etapa]}</span>
}

/** Recorrido en miniatura: cuatro puntos unidos por una línea, pintados hasta la etapa actual */
export function MiniEtapa({ etapa }: { etapa: number }) {
  return (
    <span className="mini" style={colorEtapa(etapa)} role="img" aria-label={`Etapa: ${ETAPAS[etapa]}`}>
      {ETAPAS.map((_, k) => <span key={k} className="mini-p">{k > 0 && <b className={k <= etapa ? 'd' : ''} />}<i className={k <= etapa ? 'd' : ''} /></span>)}
    </span>
  )
}
