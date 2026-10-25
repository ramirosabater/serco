import { test, expect } from './ayuda'
import type { Page } from '@playwright/test'

// Tableros que se explican: el "?" junto a cada número y "Explicame…", que recorre todo resaltando cada cosa.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('ayuda-voz', 'no') } catch { /* */ } })
})
const globo = (page: Page) => page.locator('.bt-globo')

test('el "?" explica un número con los datos de la pantalla y ofrece ir al detalle', async ({ page }) => {
  await page.goto('/')
  const kpi = page.locator('[data-ayuda="kpi-total"]')
  const valor = (await kpi.locator('.v').innerText()).trim()
  await expect(kpi.locator('.v')).not.toHaveText('…')
  await kpi.getByRole('button', { name: /Qué significa/ }).click()
  await expect(globo(page).locator('h3')).toContainText(`${(await kpi.locator('.v').innerText()).trim()} manifiestos`)
  await expect(page.locator('.bt-foco')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)                       // el "?" no navega
  await globo(page).getByRole('button', { name: /Ver la lista/ }).click()
  await expect(page).toHaveURL(/\/manifiestos\?desde=/)
  expect(valor).not.toBe('')
})

for (const [ruta, boton] of [['/', 'Explicame el tablero'], ['/reportes/estadisticas', 'Explicame las estadísticas']]) {
  test(`"${boton}" recorre todo y encuentra cada cosa`, async ({ page }) => {
    await page.goto(ruta)
    await page.getByRole('button', { name: boton }).click()
    const meta = globo(page).locator('.bt-meta span').nth(1)
    await expect(meta).toHaveText(/1 de \d+/)
    const total = Number((await meta.innerText()).split(' de ')[1])
    expect(total).toBeGreaterThan(2)
    await globo(page).getByRole('button', { name: '⏸ Pausa' }).click()
    for (let i = 1; i <= total; i++) {
      await expect(meta).toHaveText(`${i} de ${total}`)
      await expect(page.locator('.bt-foco'), `paso ${i}`).toBeVisible({ timeout: 8000 })
      await expect(globo(page).locator('.bt-texto')).not.toContainText('No lo encuentro')
      await globo(page).getByRole('button', { name: i < total ? 'Siguiente' : '¡Listo!' }).click()
    }
  })
}

test('cada reporte tiene su "?"', async ({ page }) => {
  for (const r of ['producto', 'provincial', 'nacional', 'transporte', 'estadisticas']) {
    await page.goto(`/reportes/${r}`)
    await page.locator('p.sub').getByRole('button', { name: /Qué significa/ }).click()
    await expect(globo(page).locator('.bt-texto')).not.toBeEmpty()
    await globo(page).getByRole('button', { name: '¡Listo!' }).click()
  }
})
