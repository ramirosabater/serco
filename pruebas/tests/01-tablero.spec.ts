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


test('filtros del tablero: cambian los números y quedan en la dirección', async ({ page }) => {
  await page.goto('/')
  const total = page.locator('[data-ayuda="kpi-total"] .v')
  await expect(total).not.toHaveText('…')
  const antes = await total.innerText()
  const filtros = page.locator('[data-ayuda="tab-filtros"]')
  await filtros.locator('label.campo', { hasText: 'Período' }).locator('select').selectOption('mes_pasado')
  await filtros.locator('label.campo', { hasText: 'Formulario' }).locator('select').selectOption('rosa')
  await expect(page).toHaveURL(/p=mes_pasado/)
  await expect(page).toHaveURL(/tipo=rosa/)
  await expect(page.locator('p.sub')).toContainText('formulario rosa')
  await expect(total).not.toHaveText(antes)
  // al recargar se mantienen
  await page.reload()
  await expect(filtros.locator('label.campo', { hasText: 'Formulario' }).locator('select')).toHaveValue('rosa')
  await filtros.getByRole('button', { name: 'Limpiar filtros' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(total).toHaveText(antes)
})
