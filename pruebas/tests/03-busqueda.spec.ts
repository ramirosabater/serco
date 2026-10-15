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
