import { test, expect, campo, PRUEBA, sinAvisoDeError } from './ayuda'

// Recorrido completo de un manifiesto con el transportista de prueba (formulario rosa: no usa números del azul).
// Al final se anula, así no cuenta en el tablero ni en los reportes.
test('emitir, cargar la sección 3, corregirla y anular', async ({ page }) => {
  const numero = '999' + String(Date.now()).slice(-6)

  // 1. Emitir: secciones 1, 2, 4 y 5
  // Al abrir, la pantalla elige SERCO y pide el número que sigue; al cambiar de transportista lo vuelve a pedir.
  // Hay que esperar esas respuestas: si llegan después, pisan lo que cargó la prueba.
  const sugerencia = () => page.waitForResponse((r) => r.url().includes('/rpc/sugerir_numero'), { timeout: 20_000 })
  let espera = sugerencia()
  await page.goto('/manifiestos/nuevo')
  await expect(page.getByRole('heading', { name: 'Nuevo manifiesto' })).toBeVisible()
  await espera
  const transportista = campo(page, 'Transportista')
  // se elige hasta que quede firme (la pantalla puede terminar de cargar después y volver a SERCO)
  await expect(async () => {
    if ((await transportista.locator('option:checked').textContent()) !== PRUEBA) {
      const e = sugerencia()
      await transportista.selectOption({ label: PRUEBA })
      await e
    }
    await page.waitForTimeout(1000)
    await expect(transportista.locator('option:checked')).toHaveText(PRUEBA, { timeout: 100 })
  }).toPass({ timeout: 30_000 })

  const nro = campo(page, 'Número del formulario')
  // por las dudas, se carga hasta que el número quede firme
  await expect(async () => {
    await nro.fill(numero)
    await page.waitForTimeout(700)
    await expect(nro).toHaveValue(numero, { timeout: 100 })
  }).toPass({ timeout: 15_000 })
  await campo(page, 'Generador').fill(PRUEBA)
  await expect(transportista.locator('option:checked')).toHaveText(PRUEBA)
  await page.getByRole('button', { name: 'Registrar manifiesto' }).click()

  await expect(page).toHaveURL(/\/manifiestos\/\d+$/)
  await expect(page.locator('.pill', { hasText: 'Iniciado' }).first()).toBeVisible()
  await sinAvisoDeError(page)

  // 2. Ingreso a planta: sección 3
  const sec3 = page.locator('[data-ayuda="det-sec3"]')
  await expect(sec3).toBeVisible()
  await campo(sec3, 'Corriente').selectOption({ index: 1 })
  await campo(sec3, 'Contenedor').fill('tambores')
  await campo(sec3, 'Cant. estimada').fill('1.200')
  await campo(sec3, 'Cant. real').fill('1.180,5')
  await sec3.getByRole('button', { name: /ingresó a planta/ }).click()
  await expect(page.getByText('Sección 3 cargada')).toBeVisible()
  await page.getByRole('button', { name: 'Listo' }).click()

  await expect(page.locator('h1 ~ .pill, .pill').filter({ hasText: 'Almacenado' }).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: 'TAMBORES' })).toBeVisible()           // queda en mayúsculas
  await expect(page.getByRole('cell', { name: /1\.180,5/ })).toBeVisible()

  // 3. Corregir la cantidad mientras sigue en planta
  await page.getByRole('button', { name: 'Corregir residuos' }).click()
  await campo(sec3, 'Cant. real').fill('1.000')
  await sec3.getByRole('button', { name: 'Guardar cambios' }).click()
  await page.getByRole('button', { name: 'Listo' }).click()
  await expect(page.getByRole('cell', { name: /^1\.000 / })).toBeVisible()

  // 4. Anular (limpia la prueba)
  await page.getByRole('button', { name: 'Anular manifiesto' }).click()
  await campo(page, 'Motivo de la anulación').fill('Prueba automática')
  await page.getByRole('button', { name: 'Confirmar anulación' }).click()
  await expect(page.locator('.pill', { hasText: 'Anulado' }).first()).toBeVisible()
  await expect(page.getByText('Anulado. Motivo: PRUEBA AUTOMÁTICA')).toBeVisible()   // el cartel rojo de anulado es el esperado
})
