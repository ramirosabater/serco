import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
/** Token fijo para pruebas locales contra PostgREST (sin Supabase Auth). */
export const devJwt = (import.meta.env.VITE_DEV_JWT as string | undefined) || undefined

if (!url || !anonKey) {
  throw new Error('Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en el archivo .env')
}

export const supabase = devJwt
  ? createClient(url, anonKey, { accessToken: async () => devJwt })
  : createClient(url, anonKey)

/** Mensaje legible de un error de Supabase/Postgres (las funciones de la base ya devuelven texto en castellano). */
export function mensajeError(e: unknown): string {
  if (!e) return ''
  const err = e as { message?: string; hint?: string }
  return [err.message, err.hint].filter(Boolean).join(' ')
}
