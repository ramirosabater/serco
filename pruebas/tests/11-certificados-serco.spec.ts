import { test, expect, sinAvisoDeError } from './ayuda'

// Solo mira: no emite certificados (los números son correlativos y no vuelven atrás)
test('certificados de Serco: para emitir y reimprimir uno emitido (original y duplicado)', async ({ page }) => {
  await page.goto('/certificados-serco')
  await expect(page.getByRole('heading', { name: 'Certificados de Serco' })).toBeVisible()
  await sinAvisoDeError(page)
  await page.getByRole('tab', { name: 'Emitidos' }).click()
  await page.locator('tr.fila').first().click()
  await expect(page).toHaveURL(/\/certificados-serco\/\d+$/)
  await expect(page.getByRole('heading', { name: /Certificado \d+ - \d{7}/ })).toBeVisible()
  await expect(page.locator('.cert-copia')).toHaveText(['ORIGINAL', 'DUPLICADO'])
  await expect(page.locator('.cert-hoja').first()).toContainText('DATOS DEL OPERADOR POR ALMACENAMIENTO')
})

test('libros rubricados: número de registro y columnas del Access', async ({ page }) => {
  await page.goto('/reportes/provincial')
  await expect(page.getByLabel('Nº de registro inicial')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Libro rubricado/ })).toBeVisible()
  await sinAvisoDeError(page)
  await page.goto('/reportes/nacional')
  await expect(page.getByRole('heading', { name: /Libro de manifiestos de Nación/ })).toBeVisible()
  await page.goto('/reportes/transporte')
  await expect(page.getByRole('heading', { name: /Libro de manifiestos del transporte/ })).toBeVisible()
})
