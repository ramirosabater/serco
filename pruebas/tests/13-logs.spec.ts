import { test, expect } from './ayuda'

// Logs del sistema: solo los ve un administrador. El usuario de las pruebas es operador.
test('logs del sistema: un operador no los ve', async ({ page }) => {
  await page.goto('/configuracion/logs')
  await expect(page.getByText('Esta pantalla es solo para administradores.')).toBeVisible()
  await page.getByRole('button', { name: /Altas/ }).click()
  await expect(page.getByRole('link', { name: /Logs del sistema/ })).toHaveCount(0)
})
