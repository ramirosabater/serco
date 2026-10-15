import { test as base, expect, type Locator, type Page } from '@playwright/test'

/** El nombre del transportista y del generador que usan las pruebas (los crea datos-de-prueba.sql) */
export const PRUEBA = 'PRUEBA AUTOMATICA'

/** Un campo del formulario por el texto de su etiqueta: <label class="campo">Texto <input/></label> */
export function campo(dentro: Page | Locator, texto: string, n = 0): Locator {
  return dentro.locator('label.campo').filter({ hasText: texto }).nth(n).locator('input, select, textarea').first()
}

/** Igual que el test de Playwright, pero falla si la página tira un error de JavaScript */
export const test = base.extend<{ sinErrores: void }>({
  sinErrores: [async ({ page }, usar) => {
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(e.message))
    await usar()
    expect(errores, 'errores de JavaScript en la página').toEqual([])
  }, { auto: true }],
})

/** Ningún cartel rojo de error (por ejemplo, un "statement timeout" de la base) */
export async function sinAvisoDeError(page: Page) {
  await expect(page.locator('.aviso.bad')).toHaveCount(0)
}

export { expect }
