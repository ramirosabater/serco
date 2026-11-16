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

test('emitir: al elegir la corriente se completan descripción, unidad y estado físico (sin emitir)', async ({ page }) => {
  await page.goto('/manifiestos/nuevo')
  const sec3 = page.locator('[data-ayuda="nm-residuos"]')
  await expect(sec3.getByText('Se completa al elegir la corriente')).toBeVisible()
  const corriente = sec3.getByLabel('Corriente del residuo 1')
  await expect(corriente.locator('option')).not.toHaveCount(1)          // hay corrientes para elegir
  await corriente.selectOption({ index: 1 })
  await expect(sec3.getByText('Se completa al elegir la corriente')).toHaveCount(0)
  await expect(sec3.getByLabel('Unidad del residuo 1')).toBeEnabled()
  await sec3.getByRole('button', { name: 'Agregar otra corriente' }).click()
  await expect(sec3.getByLabel('Corriente del residuo 2')).toBeVisible()
})
