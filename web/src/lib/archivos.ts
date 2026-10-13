import { supabase, mensajeError } from './supabase'

/** Abre un archivo del Storage con un enlace firmado de 5 minutos */
export async function abrirArchivo(ruta: string | null, setError: (s: string) => void) {
  if (!ruta) return
  if (ruta.startsWith('\\')) { setError('El archivo todavía no se migró desde la PC del Access.'); return }
  const { data, error } = await supabase.storage.from('documentos').createSignedUrl(ruta, 300)
  if (error || !data) setError('No se pudo abrir el archivo: ' + mensajeError(error))
  else window.open(data.signedUrl, '_blank', 'noopener')
}
