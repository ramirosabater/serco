import { test as setup, expect } from '@playwright/test'
import fs from 'node:fs'

// Entra una vez con el usuario de prueba y guarda la sesión para el resto de las pruebas
setup('entrar al sistema', async ({ page }) => {
  fs.mkdirSync('.sesion', { recursive: true })
  await page.goto('/')
  // Netlify con "sitio privado" (protección del equipo) no deja entrar a un navegador automático
  if (await page.getByText('This site is private').isVisible({ timeout: 5_000 }).catch(() => false)) {
    throw new Error('El sitio de Netlify está en modo privado: las pruebas no pueden pasar esa pantalla. '
      + 'Probá contra tu PC (BASE_URL=http://localhost:5173 en pruebas/.env, con "npm.cmd run dev" andando en web) '
      + 'o sacá la protección en Netlify → Site configuration → Access & security. Ver LEEME.md.')
  }
  const mail = page.locator('input[type=email]')
  // En una copia local con sesión de desarrollo no aparece el ingreso
  if (await mail.isVisible({ timeout: 8_000 }).catch(() => false)) {
    const email = process.env.PRUEBA_EMAIL, clave = process.env.PRUEBA_CLAVE
    if (!email || !clave) throw new Error('Falta PRUEBA_EMAIL o PRUEBA_CLAVE en pruebas/.env (ver LEEME.md)')
    await mail.fill(email)
    await page.locator('input[type=password]').fill(clave)
    await page.getByRole('button', { name: 'Entrar' }).click()
  }
  await expect(page.getByRole('heading', { name: 'Tablero' })).toBeVisible()
  await page.context().storageState({ path: '.sesion/usuario.json' })
})
