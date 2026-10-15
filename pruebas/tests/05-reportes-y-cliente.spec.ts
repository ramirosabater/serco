import { test, expect, sinAvisoDeError } from './ayuda'

for (const r of ['producto', 'provincial', 'nacional', 'transporte', 'estadisticas']) {
  test(`reporte ${r}`, async ({ page }) => {
    await page.goto(`/reportes/${r}`)
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.locator('.cargando')).toHaveCount(0, { timeout: 20_000 })
    await sinAvisoDeError(page)
  })
}

test('vista del cliente: retiros por etapa y certificados', async ({ page }) => {
  await page.goto('/vista-cliente')
  await expect(page.getByText('Así ve el portal un generador')).toBeVisible()
  await expect(page.locator('.etapas-portal')).toBeVisible()
  await expect(page.locator('.etapas-portal .kpi')).toHaveCount(5)
  await sinAvisoDeError(page)
  await page.getByRole('link', { name: 'Certificados' }).first().click()
  await expect(page).toHaveURL(/certificados/)
  await sinAvisoDeError(page)
})
