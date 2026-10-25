# Pruebas automáticas de Gestión Serco

Abren el sistema en un navegador y recorren lo importante solas. En un par de minutos dicen si algo se rompió.

| Prueba | Qué revisa |
| --- | --- |
| 01 Tablero | Que el tablero cargue los números y las etapas; que abran la agenda y los vencimientos |
| 02 Manifiesto | Emite un manifiesto de prueba, carga la sección 3, la corrige y lo anula |
| 03 Búsqueda | El filtro por etapa (el que llegó a cortar por tiempo) y abrir un manifiesto |
| 04 Planta | Por ingresar, armar carga, esperando certificado y Manifiestos Nación (solo mira: no arma viajes) |
| 05 Reportes y cliente | Los cinco reportes y la vista del cliente |

La prueba 02 usa siempre el transportista y el generador **PRUEBA AUTOMATICA**, con formulario rosa: no toca la numeración del formulario azul ni datos reales, y el manifiesto queda anulado al terminar (no cuenta en el tablero ni en los reportes).

## Una sola vez: preparar

1. **Usuario de prueba.** En Supabase: Authentication → Users → Add user → Create new user. Mail de prueba (por ejemplo `ramirosabater+pruebas@gmail.com`), una contraseña y tildar "Auto Confirm User".
2. **Datos de prueba.** En el SQL Editor, abrir `puesta-en-marcha/actualizaciones/2026-10-15-datos-de-prueba.sql`, poner ese mail en la línea marcada con `<<<` y tocar Run.
3. **Instalar.** En PowerShell, en `C:\Apps\sgrp2\pruebas`:
   ```
   npm.cmd install
   npx playwright install chromium
   ```
4. **Clave del usuario de prueba.** Copiar `.env.example` como `.env` y completar `PRUEBA_EMAIL` y `PRUEBA_CLAVE`. El `.env` no va a GitHub.

## Cada vez que quieras probar

En `C:\Apps\sgrp2\pruebas`:

```
npm.cmd run probar
```

- Todo bien: termina con `17 passed`.
- Si algo falla, dice cuál prueba y por qué. Para ver la captura y el paso a paso: `npm.cmd run informe`.
- Para mirar cómo trabaja el navegador: `npm.cmd run ver`.

Conviene correrlo después de cada publicación en Netlify (unos minutos después del `git push`).

### Si el sitio de Netlify está en modo privado

Mientras el sitio tenga la protección de Netlify ("This site is private"), las pruebas no pueden entrar al publicado. Se prueba contra tu PC:

1. En una ventana de PowerShell, en `C:\Apps\sgrp2\web`: `npm.cmd run dev` (y dejarla abierta).
2. En `pruebas\.env`: `BASE_URL=http://localhost:5173`.
3. En otra ventana, en `C:\Apps\sgrp2\pruebas`: `npm.cmd run probar`.

Usa la misma base de Supabase que el sitio publicado, así que prueba lo mismo; lo único que no revisa es la publicación en Netlify.

## Limpieza

Los manifiestos de prueba quedan anulados. Si querés borrarlos de la base cada tanto, está la línea de limpieza al final de `2026-10-15-datos-de-prueba.sql`.
