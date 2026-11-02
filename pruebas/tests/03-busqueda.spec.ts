import { test, expect, sinAvisoDeError } from './ayuda'

// El filtro por etapa llegó a cortar por tiempo en Supabase: que siga respondiendo rápido
for (const [etapa, nombre] of [['1', 'Almacenado'], ['4', 'Certificado entregado']] as const) {
  test(`buscar manifiestos en etapa ${nombre}`, async ({ page }) => {
    await page.goto(`/manifiestos?etapa=${etapa}`)
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('tbody .etapa-celda .pill').first()).toHaveText(nombre)
    await sinAvisoDeError(page)
  })
}

test('abrir un manifiesto desde la lista', async ({ page }) => {
  await page.goto('/manifiestos?etapa=4')
  await page.locator('tbody tr').first().click()
  await expect(page).toHaveURL(/\/manifiestos\/\d+$/)
  await expect(page.getByRole('heading', { name: 'Recorrido del residuo' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Documentos del recorrido' })).toBeVisible()
  await sinAvisoDeError(page)
})

test('filtros de la lista: planta y corriente quedan en la dirección y se exportan', async ({ page }) => {
  await page.goto('/manifiestos')
  const filtros = page.locator('[data-ayuda="man-filtros"]')
  await filtros.getByLabel('Planta').selectOption({ label: 'SERCO AMBIENTAL SA' })
  await expect(page).toHaveURL(/planta=\d+/)
  await filtros.getByLabel('Corriente').selectOption({ label: 'Y9' })
  await expect(page).toHaveURL(/corr=\d+/)
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('tbody tr').first()).toContainText('Y9')
  await sinAvisoDeError(page)
  const descarga = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar a Excel' }).click()
  expect((await descarga).suggestedFilename()).toMatch(/^Manifiestos .*\.csv$/)
  await page.getByRole('button', { name: 'Limpiar filtros' }).click()
  await expect(page).not.toHaveURL(/planta=/)
})
