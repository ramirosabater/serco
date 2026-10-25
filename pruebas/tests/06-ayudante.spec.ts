import { test, expect } from './ayuda'
import type { Page } from '@playwright/test'

// Tito, el ayudante. La voz del navegador se reemplaza por una de mentira que avisa cuándo
// empieza y termina, así se puede probar que el circuito avanza recién después de hablar.
async function vozDePrueba(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __dichos: string[]; __terminar: () => void; __pendiente: SpeechSynthesisUtterance | null }
    w.__dichos = []; w.__pendiente = null
    w.__terminar = () => { const u = w.__pendiente; w.__pendiente = null; u?.onend?.(new Event('end') as SpeechSynthesisEvent) }
    const s = window.speechSynthesis
    s.speak = (u: SpeechSynthesisUtterance) => { w.__dichos.push(u.text); w.__pendiente = u; setTimeout(() => u.onstart?.(new Event('start') as SpeechSynthesisEvent), 20) }
    s.cancel = () => { w.__pendiente = null }
  })
}
const abrirCircuito = async (page: Page, titulo: string) => {
  await page.getByRole('button', { name: 'Ayuda' }).click()
  await page.locator('.bt-circuito', { hasText: titulo }).click()
}
const pasoActual = (page: Page) => page.locator('.bt-meta span').nth(1)

test('cada circuito encuentra lo que explica', async ({ page }) => {
  test.setTimeout(240_000)
  await page.addInitScript(() => { try { localStorage.setItem('ayuda-voz', 'no') } catch { /* */ } })
  await page.goto('/')
  await page.waitForFunction(() => !!(window as unknown as { AyudaApp?: unknown }).AyudaApp)
  const circuitos: { titulo: string; pasos: { foco?: string; falta?: string }[] }[] =
    await page.evaluate(() => (window as unknown as { AyudaApp: { circuitos: { titulo: string; roles: string[]; pasos: { foco?: string; falta?: string }[] }[] } })
      .AyudaApp.circuitos.filter((c) => !c.roles.every((r) => r === 'cliente')).map((c) => ({ titulo: c.titulo, pasos: c.pasos.map((p) => ({ foco: p.foco, falta: p.falta })) })))
  const sinEncontrar: string[] = []
  for (const c of circuitos) {
    await page.goto('/')
    await abrirCircuito(page, c.titulo)
    await page.getByRole('button', { name: '⏸ Pausa' }).click()     // a mano, sin esperar
    for (let i = 0; i < c.pasos.length; i++) {
      await expect(pasoActual(page)).toHaveText(`${i + 1} de ${c.pasos.length}`)
      const p = c.pasos[i]
      if (p.foco) {
        // o lo resalta, o dice por qué no está (solo vale si el circuito lo previó)
        await expect(page.locator('.bt-foco').or(page.locator('.bt-texto', { hasText: /No lo encuentro|No encuentro|Ahora no|Todavía no|Esta parte/ }))).toBeVisible({ timeout: 8000 })
        if (!(await page.locator('.bt-foco').isVisible()) && !p.falta) sinEncontrar.push(`${c.titulo} · paso ${i + 1} (${p.foco})`)
      }
      await page.locator('.bt-globo').getByRole('button', { name: i + 1 < c.pasos.length ? 'Siguiente' : '¡Listo!' }).click()
    }
  }
  expect(sinEncontrar, 'pasos que no encuentran su elemento').toEqual([])
})

test('avanza recién después de terminar de hablar, y Detener corta', async ({ page }) => {
  await vozDePrueba(page)
  await page.addInitScript(() => { try { localStorage.setItem('ayuda-voz', 'si') } catch { /* */ } })
  await page.goto('/')
  await abrirCircuito(page, 'El circuito completo de un residuo')
  await expect(pasoActual(page)).toHaveText('1 de 8')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __dichos: string[] }).__dichos.length)).toBeGreaterThan(0)
  // mientras habla no avanza, aunque pase el tiempo
  await page.waitForTimeout(3000)
  await expect(pasoActual(page)).toHaveText('1 de 8')
  await page.evaluate(() => (window as unknown as { __terminar: () => void }).__terminar())
  // termina de hablar → a los ~1,4 s pasa al siguiente
  await expect(pasoActual(page)).toHaveText('2 de 8', { timeout: 6000 })
  // Detener: corta la voz y deja el circuito en pausa
  await expect(page.getByRole('button', { name: '⏹ Detener' })).toBeVisible({ timeout: 8000 })
  await page.getByRole('button', { name: '⏹ Detener' }).click()
  await expect(page.getByRole('button', { name: '▶ Seguir' })).toBeVisible()
  await page.waitForTimeout(3000)
  await expect(pasoActual(page)).toHaveText('2 de 8')
  // Esc cierra
  await page.keyboard.press('Escape')
  await expect(page.locator('.bt-globo')).toHaveCount(0)
})

test('cambia de traje según el área', async ({ page }) => {
  await page.goto('/planta')
  await expect(page.locator('.bt-ayudante')).toHaveAttribute('data-area', 'planta')
  await expect(page.locator('body')).toHaveAttribute('data-area', 'planta')
  await page.goto('/reportes/producto')
  await expect(page.locator('.bt-ayudante')).toHaveAttribute('data-area', 'reportes')
})
