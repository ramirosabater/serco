import { test, expect, PRUEBA } from './ayuda'

// Documentos de las fichas, según lo que pidió Serco el 16/11/2026. Solo mira: no graba nada.

test('cliente: habilitación de generador y convenio (sin municipal ni comercial)', async ({ page }) => {
  await page.goto('/altas/generadores')
  await page.getByPlaceholder(/Buscar/).fill(PRUEBA)
  await page.getByRole('cell', { name: PRUEBA, exact: true }).first().click()
  const docs = page.locator('[data-ayuda="ficha-vtos"]')
  await expect(docs.locator('tr', { hasText: 'Habilitación de generador' })).toBeVisible()
  const convenio = docs.locator('tr', { hasText: 'Convenio' })
  await expect(convenio).toBeVisible()
  await expect(convenio.getByLabel('Número de Convenio')).toHaveCount(0)   // el convenio no lleva número
  await expect(docs.getByText(/municipal|comercial/i)).toHaveCount(0)
})

test('camión: sin habilitación de ruta', async ({ page }) => {
  await page.goto('/altas/camiones')
  await page.locator('tbody tr').first().click()
  const docs = page.locator('[data-ayuda="ficha-vtos"]')
  await expect(docs.locator('tr', { hasText: 'VTV' })).toBeVisible()
  await expect(docs.getByText(/ruta/i)).toHaveCount(0)
})

test('chofer: la carga peligrosa se puede marcar en trámite (30 días más)', async ({ page }) => {
  await page.goto('/altas/choferes')
  await page.locator('tbody tr').first().click()
  const fila = page.locator('[data-ayuda="ficha-vtos"] tr', { hasText: 'Carga peligrosa' })
  await expect(fila.getByLabel(/En trámite \(30 días más\)/)).toBeVisible()
  await expect(page.locator('[data-ayuda="ficha-vtos"] tr', { hasText: 'Carnet de conducir' }).getByLabel(/En trámite/)).toHaveCount(0)
})
