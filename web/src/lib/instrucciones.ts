import type { Instrucciones } from './tipos'

// Bloque 4 y 5 del formulario azul. Cada manifiesto guarda las suyas;
// los valores por defecto salen de Configuración → Parámetros (form_*).

export const NIVELES = ['Baja', 'Media', 'Alta'] as const
export const PELIGROS = ['Inflamabilidad', 'Reactividad', 'Toxicidad', 'Instrucciones especiales'] as const
export const INSTRUCTIVOS = ['Manipulación para el operador', 'Planes de contingencia', 'Rol de emergencia', 'Hoja de ruta', 'Rutas alternativas'] as const

const nivel = (v: string | undefined) => (NIVELES.find((n) => n.toLowerCase() === (v ?? '').trim().toLowerCase()) ?? 'Baja')
const siNo = (v: string | undefined, n: number, def: string) =>
  (v ?? def).split(',').map((x) => x.trim().toUpperCase() === 'SI').concat(Array(n).fill(false)).slice(0, n)

export function instruccionesPorDefecto(p: Record<string, string>): Instrucciones {
  return {
    inhalacion: nivel(p.form_inhalacion), dermica: nivel(p.form_dermica), oral: nivel(p.form_oral),
    peligros: siNo(p.form_peligros, 4, 'NO,NO,NO,NO') as Instrucciones['peligros'],
    instructivos: siNo(p.form_instructivos, 5, 'SI,SI,SI,SI,NO') as Instrucciones['instructivos'],
  }
}
