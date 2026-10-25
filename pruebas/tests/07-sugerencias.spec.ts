import { test, expect } from './ayuda'
import type { Page } from '@playwright/test'

// Sugerencias de Tito: la tarjeta, "Ahora no", "No me lo preguntes más" (queda en la base) y "Como siempre".
// Las reglas dependen de los datos, así que acá se prueba que respondan sin error; la tarjeta se prueba
// con sugerencias de prueba que se agregan desde la página (temas únicos, no molestan a nadie).
test.use({ sugerencias: true })

type Sug = { tema: string; titulo?: string; texto: string; boton?: string; ir?: string; foco?: string; prioridad?: number }
const sugerir = (page: Page, s: Sug) => page.evaluate((x) => (window as unknown as { AyudaApp: { sugerir: (s: Sug) => boolean } }).AyudaApp.sugerir(x), s)
const listo = (page: Page) => page.waitForFunction(() => !!(window as unknown as { AyudaApp?: { sugerir?: unknown } }).AyudaApp?.sugerir)
const tarjeta = (page: Page) => page.locator('.bt-sug')

/** Entra sin las sugerencias de la base (para que no se mezclen con las de prueba) */
async function entrarLimpio(page: Page, ruta = '/') {
  await page.route('**/rest/v1/rpc/sugerencias_*', (r) => r.fulfill({ json: [] }))
  await page.goto(ruta)
  await listo(page)
}

test('las reglas responden en cada pantalla', async ({ page }) => {
  for (const [ruta, area] of [['/', 'tablero'], ['/planta', 'planta'], ['/manifiestos', 'manifiestos'], ['/vencimientos', 'altas']]) {
    const resp = page.waitForResponse((r) => r.url().includes('rpc/sugerencias_ayudante') && r.request().postData()?.includes(`"${area}"`) === true, { timeout: 20_000 })
    await page.goto(ruta)
    expect((await resp).status(), `sugerencias de ${area}`).toBe(200)
  }
  // Las de un manifiesto puntual (duplicados y cantidades raras)
  await page.goto('/manifiestos')
  const resp = page.waitForResponse((r) => r.url().includes('rpc/sugerencias_manifiesto'), { timeout: 20_000 })
  await page.locator('table tbody tr.fila').first().click()
  expect((await resp).status()).toBe(200)
})

test('tarjeta, "Ahora no" y "No me lo preguntes más" (que sigue después de recargar)', async ({ page }) => {
  await entrarLimpio(page)
  const tema = `prueba-${Date.now()}`
  expect(await sugerir(page, { tema, titulo: 'Sugerencia de prueba', texto: 'Esto es una prueba automática.', boton: 'Ver vencimientos', ir: '/vencimientos' })).toBe(true)
  await expect(tarjeta(page)).toContainText('Esto es una prueba automática.')
  await tarjeta(page).getByRole('button', { name: 'No me lo preguntes más' }).click()
  await expect(tarjeta(page)).toHaveCount(0)

  // Sin la copia del navegador: lo recuerda la base
  await page.evaluate(() => { localStorage.removeItem('ayuda-memoria'); localStorage.removeItem('ayuda-vistas') })
  await page.reload(); await listo(page)
  await expect.poll(() => sugerir(page, { tema, texto: 'otra vez' }), { timeout: 10_000 }).toBe(false)
  await page.waitForTimeout(500)
  await expect(tarjeta(page)).toHaveCount(0)      // ni siquiera mientras cargaba la memoria

  // "Ahora no": no vuelve hoy
  const tema2 = `prueba-${Date.now()}-b`
  expect(await sugerir(page, { tema: tema2, texto: 'Segunda prueba.' })).toBe(true)
  await tarjeta(page).getByRole('button', { name: 'Ahora no' }).click()
  await expect(tarjeta(page)).toHaveCount(0)
  expect(await sugerir(page, { tema: tema2, texto: 'Segunda prueba.' })).toBe(false)
})

test('aceptar lleva a la pantalla y resalta; las demás esperan en el globo', async ({ page }) => {
  await entrarLimpio(page)
  const t = Date.now()
  await sugerir(page, { tema: `prueba-${t}-1`, titulo: 'Primera', texto: 'Primera de prueba.', boton: 'Mostrame', ir: '/vencimientos', foco: 'venc-tabla', prioridad: 0 })
  await sugerir(page, { tema: `prueba-${t}-2`, titulo: 'Segunda', texto: 'Segunda de prueba.', prioridad: 9 })
  await expect(tarjeta(page)).toContainText('Primera de prueba.')
  await tarjeta(page).getByRole('button', { name: 'Mostrame' }).click()
  await expect(page).toHaveURL(/\/vencimientos/)
  await expect(page.locator('.bt-foco')).toBeVisible({ timeout: 8000 })
  await page.locator('.bt-globo').getByRole('button', { name: '¡Listo!' }).click()

  // Al cerrar, la siguiente no salta sola: queda el numerito en Tito y se ve en el globo
  await sugerir(page, { tema: `prueba-${t}-3`, titulo: 'Tercera', texto: 'Tercera de prueba.', prioridad: 0 })
  await sugerir(page, { tema: `prueba-${t}-4`, titulo: 'Cuarta', texto: 'Cuarta de prueba.', prioridad: 1 })
  await expect(tarjeta(page)).toContainText('Tercera de prueba.')
  await tarjeta(page).getByRole('button', { name: 'Cerrar la sugerencia' }).click()
  await expect(tarjeta(page)).toHaveCount(0)
  await expect(page.locator('.bt-aviso')).toHaveText('1')
  await page.getByRole('button', { name: 'Ayuda' }).click()
  await page.locator('.bt-circuito', { hasText: 'Cuarta' }).click()
  await expect(tarjeta(page)).toContainText('Cuarta de prueba.')
})

test('"Como siempre" completa el nuevo manifiesto (sin emitir)', async ({ page }) => {
  await page.route('**/rest/v1/rpc/como_siempre', (r) => r.fulfill({ json: { retiros: 6, direccion: 'CALLE DE PRUEBA 123' } }))
  await entrarLimpio(page, '/manifiestos/nuevo')
  await page.locator('label.campo', { hasText: 'Generador' }).locator('input').fill('PRUEBA AUTOMATICA')
  await expect(tarjeta(page)).toContainText('CALLE DE PRUEBA 123')
  await tarjeta(page).getByRole('button', { name: 'Completar' }).click()
  await expect(page.locator('label.campo', { hasText: 'Dirección de retiro' }).locator('input')).toHaveValue('CALLE DE PRUEBA 123')
  await expect(page).toHaveURL(/\/manifiestos\/nuevo/)     // no emitió nada
})
