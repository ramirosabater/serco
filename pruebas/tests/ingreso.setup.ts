import { test as setup, expect } from '@playwright/test'
import fs from 'node:fs'

// Entra una vez con el usuario de prueba y guarda la sesión para el resto de las pruebas
setup('entrar al sistema', async ({ page }) => {
  fs.mkdirSync('.sesion', { recursive: true })
  try {
    await page.goto('/')
  } catch (e) {
    if (String(e).includes('ERR_CONNECTION_REFUSED') && (process.env.BASE_URL ?? '').includes('localhost'))
      throw new Error('No está andando el sistema en tu PC. Abrí otra ventana, entrá a C:\\Apps\\sgrp2\\web, corré "npm.cmd run dev", dejala abierta y volvé a probar.')
    throw e
  }
  // Netlify con "sitio privado" (protección del equipo) no deja entrar a un navegador automático
  if (await page.getByText('This site is private').isVisible({ timeout: 5_000 }).catch(() => false)) {
    throw new Error('El sitio de Netlify está en modo privado: las pruebas no pueden pasar esa pantalla. '
      + 'Probá contra tu PC (BASE_URL=http://localhost:5173 en pruebas/.env, con "npm.cmd run dev" andando en web) '
      + 'o sacá la protección en Netlify → Site configuration → Access & security. Ver LEEME.md.')
  }
  const mail = page.locator('input[type=email]')
  // Esperar a que termine de cargar: aparece el ingreso o, en una copia local con sesión de desarrollo, el Tablero
  // (isVisible no espera: mirarlo una sola vez mientras dice "Cargando…" hacía saltear el ingreso)
  await expect(mail.or(page.getByRole('heading', { name: 'Tablero' })).first()).toBeVisible({ timeout: 30_000 })
  if (await mail.isVisible()) {
    const email = process.env.PRUEBA_EMAIL?.trim(), clave = process.env.PRUEBA_CLAVE?.trim()
    if (!email || !clave) throw new Error('Falta PRUEBA_EMAIL o PRUEBA_CLAVE en pruebas/.env (ver LEEME.md)')
    const pass = page.locator('input[type=password]')
    // Esperar a que la página termine de cargar: si se escribe antes, al redibujarse borra lo escrito
    await page.waitForLoadState('networkidle')
    for (let intento = 0; intento < 3; intento++) {
      await mail.fill(email)
      await pass.fill(clave)
      if (await mail.inputValue() === email && await pass.inputValue() === clave) break
      await page.waitForTimeout(1000)
    }
    await expect(mail, 'el mail no quedó escrito en el ingreso').toHaveValue(email)
    await page.getByRole('button', { name: 'Entrar' }).click()
  }
  // Si no entra, que diga por qué (clave, permisos o confirmación) en vez de "no encontré el Tablero"
  const tablero = page.getByRole('heading', { name: 'Tablero' })
  const alerta = page.getByRole('alert')
  const sinAcceso = page.getByRole('heading', { name: 'Sin acceso' })
  try {
    await expect(tablero.or(alerta).or(sinAcceso).first()).toBeVisible({ timeout: 20_000 })
  } catch {
    throw new Error(`Después de tocar "Entrar" no pasó nada en 20 segundos (sigue en: "${(await page.locator('h1').first().innerText().catch(() => '?')).trim()}"). Mirá la captura en el informe.`)
  }
  if (await sinAcceso.isVisible())
    throw new Error(`El usuario de prueba (${process.env.PRUEBA_EMAIL}) entra pero no tiene permisos en el sistema: falta correr 2026-10-15-datos-de-prueba.sql con su mail (ver LEEME.md)`)
  if (await alerta.isVisible())
    throw new Error(`No pudo entrar con el usuario de prueba (${process.env.PRUEBA_EMAIL}): "${(await alerta.innerText()).trim()}". Revisá PRUEBA_EMAIL y PRUEBA_CLAVE (en GitHub: Settings → Secrets; en la PC: pruebas/.env) y que el usuario esté confirmado en Supabase.`)
  await expect(tablero).toBeVisible()
  await page.context().storageState({ path: '.sesion/usuario.json' })
})
