import type { EstadoResiduo, UM } from './tipos'

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })

/** 837007468 → 837 - 0007468, como figura en el formulario */
export const fnum = (n: string) => (/^\d{9}$/.test(n) ? `${n.slice(0, 3)} - ${n.slice(3).padStart(7, '0')}` : n)
/** 2026-09-25 → 25/09/2026 */
export const fd = (s?: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—')
export const num = (n: number) => nf.format(n)
export const umL = (u: UM) => ({ KGS: 'kg', LTS: 'l', MS3: 'm³' })[u]
export const hoy = () => new Date().toISOString().slice(0, 10)

export const ETAPAS = ['Almacenado', 'En tránsito', 'Dispuesto', 'Certificado entregado'] as const
export const etapaDe = (e: EstadoResiduo) => (e === 'almacenado' ? 0 : e === 'en_transito' ? 1 : 2)
/** La etapa de un manifiesto es la del residuo más atrasado */
export const etapaManifiesto = (estados: EstadoResiduo[]) => (estados.length ? Math.min(...estados.map(etapaDe)) : 0)
