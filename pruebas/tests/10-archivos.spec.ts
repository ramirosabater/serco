import { test, expect, PRUEBA } from './ayuda'
import path from 'node:path'
import type { Page } from '@playwright/test'

// Archivos: subir un escaneo en una ficha y verlo. No sube nada de verdad al Drive de Serco:
// la función "archivos" y el guardado de la ficha se reemplazan por respuestas de prueba.
const PDF = path.join(__dirname, 'archivos', 'psicofisico-prueba.pdf')

async function servidorDePrueba(page: Page) {
  const pedidos: { tipo: string; ruta?: string }[] = []
  await page.route('**/functions/v1/archivos', async (r) => {
    const ct = r.request().headers()['content-type'] ?? ''
    if (ct.startsWith('multipart/form-data')) {
      const ruta = (r.request().postDataBuffer()?.toString('latin1') ?? '').match(/name="ruta"\r\n\r\n(.*?)\r\n/)?.[1]
      pedidos.push({ tipo: 'subir', ruta })
      return r.fulfill({ json: { ruta: 'drive:archivo-de-prueba' } })
    }
    const b = r.request().postDataJSON()
    pedidos.push({ tipo: b.accion, ruta: b.ruta })
    return r.fulfill({ json: { url: new URL('/__archivo-de-prueba.pdf', page.url()).href } })
  })
  await page.route('**/__archivo-de-prueba.pdf', (r) => r.fulfill({ path: PDF, contentType: 'application/pdf' }))
  // la ficha no se graba de verdad
  await page.route('**/rest/v1/transportistas?*', (r) => r.request().method() === 'PATCH' ? r.fulfill({ status: 204, body: '' }) : r.fallback())
  return pedidos
}

test('subir un escaneo en una ficha y verlo', async ({ page, context }) => {
  const pedidos = await servidorDePrueba(page)
  await page.goto('/altas/transportistas')
  await page.getByPlaceholder(/Buscar/).fill(PRUEBA)
  await page.getByRole('cell', { name: PRUEBA, exact: true }).first().click()
  const fila = page.locator('tr', { hasText: 'Habilitación provincial' }).first()
  await fila.locator('input[type=file]').setInputFiles(PDF)
  await expect.poll(() => pedidos.find((p) => p.tipo === 'subir')?.ruta ?? '').toMatch(/^habilitaciones\/transportistas\/\d+\/hab_pro_archivo-/)
  await expect(fila.getByRole('button', { name: 'Ver' })).toBeVisible()
  const pestana = context.waitForEvent('page')
  await fila.getByRole('button', { name: 'Ver' }).click()
  const nueva = await pestana
  await expect.poll(() => nueva.url()).toContain('__archivo-de-prueba.pdf')
  expect(pedidos.find((p) => p.tipo === 'enlace')?.ruta).toBe('drive:archivo-de-prueba')
  await nueva.close()
})
