import { test, expect } from './ayuda'
import path from 'node:path'
import type { Page, Route } from '@playwright/test'

// Pedido de certificados a los choferes. No manda mails ni toca choferes reales:
// la función del servidor y las respuestas de la base se reemplazan por respuestas de prueba.
const PDF = path.join(__dirname, 'archivos', 'psicofisico-prueba.pdf')   // datos inventados: DNI 99.888.777, vale hasta 01/10/2030
const TOKEN = 'a'.repeat(64)

const pedido = (extra: Record<string, unknown> = {}) => ({
  chofer: 'PRUEBA AUTOMATICA', transportista: 'PRUEBA AUTOMATICA', documento: 'sep', label: 'Psicofísico',
  ayuda: 'el PDF del certificado de evaluación psicofísica', lector: 'psicofisico', vto_actual: '2026-11-01',
  vence: '2026-12-01T00:00:00Z', estado: 'enviado', subido: null, motivo: null, dni_fin: '777', puede_subir: true, ...extra,
})

/** Simula la función certificado-chofer y guarda lo que le mandan */
async function funcionDePrueba(page: Page, ver: Record<string, unknown> | null) {
  const recibido: { accion?: string; multipart?: boolean; lectura?: string }[] = []
  await page.route('**/functions/v1/certificado-chofer', async (r: Route) => {
    const ct = r.request().headers()['content-type'] ?? ''
    if (ct.startsWith('multipart/form-data')) {
      const cuerpo = r.request().postDataBuffer()?.toString('latin1') ?? ''
      recibido.push({ multipart: true, lectura: cuerpo.match(/name="lectura"\r\n\r\n(.*?)\r\n/)?.[1] })
      return r.fulfill({ json: { ok: true, vto_leido: '2030-10-01' } })
    }
    const body = r.request().postDataJSON() ?? {}
    recibido.push({ accion: body.accion })
    if (body.accion === 'ver') return ver ? r.fulfill({ json: ver }) : r.fulfill({ status: 404, json: { error: 'El enlace no es válido. Pedile a Serco que te lo mande de nuevo.' } })
    if (body.accion === 'pedir') return r.fulfill({ json: { choferes: 1, documentos: 1, enviados: 1, sin_mail: 0, envios_fallidos: 0, detalle: [] } })
    return r.fulfill({ status: 400, json: { error: 'Acción desconocida' } })
  })
  return recibido
}

test.describe('página pública del chofer', () => {
  test.use({ storageState: { cookies: [], origins: [] } })     // sin usuario, como le llega al chofer

  test('lee el certificado, controla el DNI y lo manda', async ({ page }) => {
    const recibido = await funcionDePrueba(page, pedido())
    await page.goto(`/subir/${TOKEN}`)
    await expect(page.getByRole('heading', { name: 'Psicofísico' })).toBeVisible()
    await expect(page.getByText('El que tenemos')).toContainText('01/11/2026')
    await page.locator('input[type=file]').setInputFiles(PDF)
    await expect(page.locator('.aviso.ok')).toContainText('Vence el 01/10/2030')
    await page.getByRole('button', { name: 'Enviar a Serco' }).click()
    await expect(page.locator('.aviso.ok')).toContainText('Recibimos el certificado con vencimiento 01/10/2030')
    const envio = recibido.find((x) => x.multipart)
    expect(envio?.lectura).toContain('"dni":"99888777"')
    expect(envio?.lectura).toContain('"vence":"2030-10-01"')
  })

  test('no deja mandar el certificado de otra persona', async ({ page }) => {
    await funcionDePrueba(page, pedido({ dni_fin: '123' }))
    await page.goto(`/subir/${TOKEN}`)
    await page.locator('input[type=file]').setInputFiles(PDF)
    await expect(page.locator('.aviso.bad')).toContainText('DNI terminado en 777')
    await expect(page.getByRole('button', { name: 'Enviar a Serco' })).toBeDisabled()
  })

  test('enlace inválido o vencido', async ({ page }) => {
    await funcionDePrueba(page, null)
    await page.goto(`/subir/${TOKEN}`)
    await expect(page.locator('.aviso.bad')).toContainText('El enlace no es válido')
    await page.unrouteAll()
    await funcionDePrueba(page, pedido({ estado: 'vencido', puede_subir: false }))
    await page.goto(`/subir/${TOKEN}`)
    await expect(page.locator('.aviso.bad')).toContainText('venció')
    await expect(page.locator('input[type=file]')).toHaveCount(0)
  })
})

test('vencimientos: revisar lo subido y pedir por mail (con confirmación)', async ({ page }) => {
  const recibido = await funcionDePrueba(page, null)
  let aceptado: unknown = null
  await page.route('**/rest/v1/pedidos_documento?*', (r) => {
    const u = r.request().url()
    if (u.includes('estado=eq.subido')) return r.fulfill({ json: [{ id: 999999, chofer_id: 1, documento: 'sep', subido: '2026-10-20T12:00:00Z',
      archivo: 'habilitaciones/choferes/1/prueba.pdf', vto_leido: '2030-10-01', dni_leido: '99888777', nombre_leido: 'PRUEBA AUTOMATICA', detalle: 'Apto',
      choferes: { nombre: 'CHOFER DE PRUEBA', dni: '99888777', transportistas: { nombre: 'PRUEBA AUTOMATICA' } } }] })
    return r.fulfill({ json: [] })
  })
  await page.route('**/rest/v1/rpc/choferes_para_pedir', (r) => r.fulfill({ json: [
    { chofer_id: 2, chofer: 'OTRO CHOFER DE PRUEBA', transportista: 'PRUEBA AUTOMATICA', documento: 'carga_pel', vto: '2026-11-10', dias: 16, para: 'prueba@ejemplo.com', de_quien: 'chofer' }] }))
  await page.route('**/rest/v1/rpc/aceptar_pedido_documento', (r) => { aceptado = r.request().postDataJSON(); return r.fulfill({ status: 204, body: '' }) })

  await page.goto('/vencimientos')
  const fila = page.locator('[data-pedido="999999"]')
  await expect(fila).toContainText('CHOFER DE PRUEBA')
  await expect(fila).toContainText('DNI leído 99888777 ✓')
  await expect(fila.locator('input[type=date]')).toHaveValue('2030-10-01')
  await fila.getByRole('button', { name: 'Aceptar' }).click()
  await expect(page.locator('[data-ayuda="venc-pedidos"] [role=status]').first()).toContainText('quedó cargado con vencimiento 01/10/2030')
  expect(aceptado).toEqual({ p_id: 999999, p_vto: '2030-10-01' })

  // Pedir por mail: primero muestra a quién le va a escribir, y recién al confirmar llama al servidor
  await page.getByRole('button', { name: 'Pedir por mail (1)' }).click()
  await expect(page.locator('.aviso.haz', { hasText: 'prueba@ejemplo.com' })).toBeVisible()
  expect(recibido.filter((x) => x.accion === 'pedir')).toHaveLength(0)
  await page.getByRole('button', { name: 'Sí, mandarlos' }).click()
  await expect(page.locator('[data-ayuda="venc-pedidos"] [role=status]').first()).toContainText('1 mail enviado')
  expect(recibido.filter((x) => x.accion === 'pedir')).toHaveLength(1)
})
