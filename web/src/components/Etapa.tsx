import type { CSSProperties } from 'react'
import { ETAPAS } from '../lib/formato'

/** Iniciado va en gris azulado; las demás etapas usan los colores del prototipo (s0…s3) */
export const colorEtapa = (k: number) => (k === 0 ? { '--sc': 'var(--si)', '--sb': 'var(--sib)' }
  : { '--sc': `var(--s${k - 1})`, '--sb': `var(--s${k - 1}b)` }) as CSSProperties

export function PillEtapa({ etapa }: { etapa: number }) {
  return <span className="pill st" style={colorEtapa(etapa)}>{ETAPAS[etapa]}</span>
}

/** Recorrido en miniatura: un punto por etapa unidos por una línea, pintados hasta la etapa actual */
export function MiniEtapa({ etapa }: { etapa: number }) {
  return (
    <span className="mini" style={colorEtapa(etapa)} role="img" aria-label={`Etapa: ${ETAPAS[etapa]}`}>
      {ETAPAS.map((_, k) => <span key={k} className="mini-p">{k > 0 && <b className={k <= etapa ? 'd' : ''} />}<i className={k <= etapa ? 'd' : ''} /></span>)}
    </span>
  )
}
