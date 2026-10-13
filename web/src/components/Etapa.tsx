import type { CSSProperties } from 'react'
import { ETAPAS } from '../lib/formato'

export const colorEtapa = (k: number) => ({ '--sc': `var(--s${k})`, '--sb': `var(--s${k}b)` }) as CSSProperties

export function PillEtapa({ etapa }: { etapa: number }) {
  return <span className="pill st" style={colorEtapa(etapa)}>{ETAPAS[etapa]}</span>
}
