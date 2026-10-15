import { defineConfig, devices } from '@playwright/test'
import 'dotenv/config'

// Contra qué sistema se prueba: por defecto el publicado. Para probar en tu PC: BASE_URL=http://localhost:5173
const BASE_URL = process.env.BASE_URL || 'https://sercosa.netlify.app'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,                       // de a una: comparten el usuario y los datos de prueba
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'informe' }]],
  use: {
    baseURL: BASE_URL,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'ingreso', testMatch: /ingreso\.setup\.ts/ },
    {
      name: 'gestion-serco',
      dependencies: ['ingreso'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 }, storageState: '.sesion/usuario.json' },
    },
  ],
})
