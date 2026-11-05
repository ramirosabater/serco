import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// version.json: qué commit está publicado (Netlify pone COMMIT_REF). Lo usan las pruebas automáticas de GitHub
// para esperar a que Netlify termine de publicar antes de probar.
const version = (): Plugin => ({
  name: 'version',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json',
      source: JSON.stringify({ commit: process.env.COMMIT_REF ?? 'local', publicado: new Date().toISOString() }) })
  },
})

// En pruebas locales sin Supabase, /rest/v1 se redirige a un PostgREST propio (ver README)
export default defineConfig({
  plugins: [react(), version()],
  server: {
    proxy: process.env.POSTGREST_URL
      ? {
          '/rest/v1': { target: process.env.POSTGREST_URL, rewrite: (p) => p.replace(/^\/rest\/v1/, '') },
          // Funciones corriendo con Deno en la PC (opcional)
          ...(process.env.FUNCIONES_ARCHIVOS_URL ? { '/functions/v1/archivos': { target: process.env.FUNCIONES_ARCHIVOS_URL, rewrite: (p: string) => p.replace(/^\/functions\/v1\/archivos/, '') } } : {}),
          ...(process.env.FUNCIONES_URL ? { '/functions/v1': { target: process.env.FUNCIONES_URL, rewrite: (p: string) => p.replace(/^\/functions\/v1\/[^/?]+/, '') } } : {}),
        }
      : undefined,
  },
})
