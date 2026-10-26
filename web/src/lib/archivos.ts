import { invocar } from './supabase'

// Archivos del sistema (PDF y fotos). Los guarda y los muestra la función "archivos" del servidor:
// van al Google Drive de Serco (o al Storage de Supabase si Drive todavía no está configurado).
// En la base queda "drive:<id>" o la ruta; el navegador nunca toca las claves de Google.

/** Sube un archivo. `ruta` es dónde va (por ejemplo "habilitaciones/choferes/39/sep_archivo-2026-11-30.pdf").
 *  Devuelve lo que hay que anotar en la base, o el error. */
export async function subirArchivo(ruta: string, archivo: File): Promise<{ guardado: string | null; error: string | null }> {
  const form = new FormData()
  form.append('ruta', ruta)
  form.append('archivo', archivo)
  const { data, error } = await invocar<{ ruta: string }>('archivos', form)
  return { guardado: data?.ruta ?? null, error }
}

/** Abre un archivo en otra pestaña (o lo baja con ese nombre) con un enlace que vence en 5 minutos */
export async function abrirArchivo(ruta: string | null, setError: (s: string) => void, descargarComo?: string) {
  if (!ruta) return
  if (ruta.startsWith('\\') || /^[A-Z]:\\/i.test(ruta)) { setError('Este archivo todavía está en la PC del Access: se sube con la migración de archivos.'); return }
  // La pestaña se abre ya (si se abre después de esperar al servidor, el navegador puede bloquearla)
  const pestana = descargarComo ? null : window.open('', '_blank')
  const { data, error } = await invocar<{ url: string }>('archivos', { accion: 'enlace', ruta, ...(descargarComo ? { descargar: descargarComo } : {}) })
  if (error || !data?.url) { pestana?.close(); setError('No se pudo abrir el archivo: ' + (error ?? 'sin respuesta')); return }
  if (descargarComo) { window.location.href = data.url; return }
  if (pestana) { pestana.opener = null; pestana.location.href = data.url } else window.open(data.url, '_blank', 'noopener')
}
