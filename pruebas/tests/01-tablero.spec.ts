import { test, expect, sinAvisoDeError } from './ayuda'

test('el tablero muestra los números y las etapas', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Tablero' })).toBeVisible()
  await expect(page.locator('.kpi').first()).toBeVisible()
  await expect(page.locator('[data-ayuda="tab-etapas"]')).toContainText('Certificado entregado')
  // los números cargaron (no quedan los "…" de espera)
  await expect(page.locator('.kpi .v').first()).not.toHaveText('…')
  await sinAvisoDeError(page)
})

test('la agenda y los vencimientos abren', async ({ page }) => {
  await page.goto('/agenda')
  await expect(page.getByRole('heading', { name: /Agenda/ })).toBeVisible()
  await sinAvisoDeError(page)
  await page.goto('/vencimientos')
  await expect(page.getByRole('heading', { name: /Vencimientos/ })).toBeVisible()
  await sinAvisoDeError(page)
})
