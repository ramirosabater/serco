import { test, expect, sinAvisoDeError } from './ayuda'

// Solo mira: no arma viajes ni registra certificados, para no tocar datos reales
test('planta: por ingresar, armar carga, esperando certificado y Manifiestos Nación', async ({ page }) => {
  await page.goto('/planta?v=ingresar')
  await expect(page.locator('[data-ayuda="pl-ingresar"]')).toBeVisible()
  await sinAvisoDeError(page)

  await page.goto('/planta')
  await expect(page.locator('[data-ayuda="pl-plan"]')).toBeVisible()
  await page.locator('[data-ayuda="pl-tab-mano"], button:has-text("Selección manual")').first().click()
  await expect(page.locator('[data-ayuda="pl-almacenado"]')).toBeVisible()
  await sinAvisoDeError(page)

  await page.goto('/planta?v=transito')
  await expect(page.getByRole('heading', { name: /esperando certificado/ })).toBeVisible()
  await sinAvisoDeError(page)

  await page.goto('/planta?v=nacion')
  await expect(page.getByText(/Manifiestos Nación$/).first()).toBeVisible()
  await sinAvisoDeError(page)
})

// El viaje (Manifiesto Nación) se imprime en el mismo formulario azul: solo mira, no imprime ni guarda
test('viaje: imprimir en el formulario azul', async ({ page }) => {
  await page.goto('/planta?v=nacion')
  await page.locator('tr.fila').first().click()
  await expect(page).toHaveURL(/\/nacion\/\d+$/)
  await page.getByRole('button', { name: /formulario azul/ }).click()
  await expect(page).toHaveURL(/\/nacion\/\d+\/imprimir$/)
  await expect(page.getByRole('heading', { name: /Imprimir viaje/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Volver al Manifiesto Nación' })).toBeVisible()
  await sinAvisoDeError(page)
})
