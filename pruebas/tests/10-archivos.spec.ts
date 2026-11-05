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
  // para entender una falla: qué pasó con el grabado de la ficha y qué errores mostró la consola
  const ficha: string[] = [], errores: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => errores.push(e.message.slice(0, 200)))
  page.on('requestfinished', async (r) => { if (r.url().includes('/rest/v1/transportistas') && r.method() !== 'GET') ficha.push(`${r.method()} ${(await r.response())?.status()}`) })
  page.on('requestfailed', (r) => { if (r.url().includes('/rest/v1/') || r.url().includes('/functions/')) ficha.push(`FALLÓ ${r.method()} ${r.url().split('/v1/')[1]?.slice(0, 60)} ${r.failure()?.errorText}`) })
  await page.goto('/altas/transportistas')
  await page.getByPlaceholder(/Buscar/).fill(PRUEBA)
  await page.getByRole('cell', { name: PRUEBA, exact: true }).first().click()
  const fila = page.locator('tr', { hasText: 'Habilitación provincial' }).first()
  await fila.locator('input[type=file]').setInputFiles(PDF)
  await expect.poll(() => pedidos.find((p) => p.tipo === 'subir')?.ruta ?? '').toMatch(/^habilitaciones\/transportistas\/[A-Za-z0-9 ._-]+\/hab_pro_archivo-/)
  // o aparece "Ver", o la pantalla mostró un error: en ese caso la prueba falla diciendo cuál
  const aviso = page.locator('[role=alert]')
  const aparecio = await fila.getByRole('button', { name: 'Ver' }).or(aviso).first().waitFor({ timeout: 20_000 }).then(() => true, () => false)
  if (!aparecio) throw new Error('Después de subir no apareció ni "Ver" ni un error.\n' +
    `Fila: ${(await fila.innerText()).replace(/\s+/g, ' ')}\n` +
    `Pedidos a la ficha: ${JSON.stringify(ficha)}\nErrores de la página: ${JSON.stringify(errores)}`)
  if (await aviso.isVisible()) throw new Error('La pantalla mostró un error al subir: ' + (await aviso.innerText()))
  await page.waitForTimeout(1000)   // que termine de acomodarse la fila antes de tocar "Ver"
  await expect(fila.getByRole('button', { name: 'Ver' }), 'el botón Ver desapareció después de subir').toBeVisible()
  const pestana = context.waitForEvent('page')
  await fila.getByRole('button', { name: 'Ver' }).click()
  const nueva = await pestana
  await expect.poll(() => nueva.url()).toContain('__archivo-de-prueba.pdf')
  expect(pedidos.find((p) => p.tipo === 'enlace')?.ruta).toBe('drive:archivo-de-prueba')
  await nueva.close()
})
