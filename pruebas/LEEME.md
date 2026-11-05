# Pruebas automáticas de Gestión Serco

Abren el sistema en un navegador y recorren lo importante solas. En un par de minutos dicen si algo se rompió.

| Prueba | Qué revisa |
| --- | --- |
| 01 Tablero | Que el tablero cargue los números y las etapas, que los filtros cambien los números y queden al recargar, y que abran la agenda y los vencimientos |
| 02 Manifiesto | Emite un manifiesto de prueba, carga la sección 3, la corrige y lo anula. Y que estén "Corregir generador o dirección", "Salvar *" y "Anular" (sin usarlos) |
| 03 Búsqueda | El filtro por etapa, abrir un manifiesto, y los filtros de la lista (planta, corriente) con la exportación a Excel |
| 04 Planta | Por ingresar, armar carga, esperando certificado, Manifiestos Nación, imprimir el viaje en el formulario azul y su anexo (solo mira: no arma viajes) |
| 05 Reportes y cliente | Los cinco reportes y la vista del cliente |
| 06 Ayudante | Que cada circuito de Serquito encuentre lo que explica, que avance recién después de hablar y que Detener corte |
| 07 Sugerencias | Que las reglas respondan en cada pantalla; la tarjeta, "Ahora no", "No me lo preguntes más" (queda guardado) y "Como siempre" |
| 08 Pedido de certificados | La página que abre el chofer (lee el certificado, controla el DNI, enlace vencido) y la revisión en Vencimientos. No manda mails: el servidor se reemplaza por respuestas de prueba |
| 09 Explicaciones | El "?" de los números del tablero y los reportes, y "Explicame el tablero / las estadísticas" (que encuentre cada cosa que explica) |
| 10 Archivos | Subir un escaneo en una ficha y verlo (con el servidor de archivos simulado: no sube nada al Drive de Serco) |
| 11 Certificados de Serco y libros | Reimprimir un certificado de Serco (original y duplicado) y los libros rubricados con número de registro (solo mira: no emite certificados) |

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

- Todo bien: termina con `37 passed`.
- Si algo falla, dice cuál prueba y por qué. Para ver la captura y el paso a paso: `npm.cmd run informe`.
- Para mirar cómo trabaja el navegador: `npm.cmd run ver`.

Con GitHub configurado (abajo) esto corre solo en cada `git push`; a mano sirve para probar en tu PC antes de subir.

## Automáticas en cada `git push` (GitHub Actions)

Cada vez que hacés `git push`, GitHub espera a que Netlify publique esa versión y corre todas las pruebas contra
https://sercosa.netlify.app. Si alguna falla, GitHub te manda un mail. Se configura una sola vez:

1. **Sacar el modo privado de Netlify** (Site configuration → Access & security → Visitor access → sin protección).
   Las pruebas no pueden pasar esa pantalla. El sistema igual pide usuario y contraseña para entrar.
2. **El usuario de prueba** (pasos 1 y 2 de "Una sola vez: preparar", si todavía no lo hiciste).
3. **Cargar su mail y clave en GitHub** (quedan ocultos, no van en el código): en el repositorio de GitHub →
   **Settings → Secrets and variables → Actions → New repository secret**, dos veces:
   - Nombre `PRUEBA_EMAIL`, valor: el mail del usuario de prueba.
   - Nombre `PRUEBA_CLAVE`, valor: su contraseña.
4. Hacer `git push`. En la pestaña **Actions** del repositorio aparece "Pruebas automáticas": tilde verde = todo bien,
   cruz roja = algo falló. Tocando la corrida se ve cuál prueba y por qué; abajo, en **Artifacts**, está el **informe**
   con las capturas (se baja como zip; adentro, abrir `informe/index.html`).

También se puede correr a mano: Actions → Pruebas automáticas → **Run workflow**.

### Si el sitio de Netlify está en modo privado

Mientras el sitio tenga la protección de Netlify ("This site is private"), las pruebas no pueden entrar al publicado. Se prueba contra tu PC:

1. En una ventana de PowerShell, en `C:\Apps\sgrp2\web`: `npm.cmd run dev` (y dejarla abierta).
2. En `pruebas\.env`: `BASE_URL=http://localhost:5173`.
3. En otra ventana, en `C:\Apps\sgrp2\pruebas`: `npm.cmd run probar`.

Usa la misma base de Supabase que el sitio publicado, así que prueba lo mismo; lo único que no revisa es la publicación en Netlify.

## Limpieza

Los manifiestos de prueba quedan anulados. Si querés borrarlos de la base cada tanto, está la línea de limpieza al final de `2026-10-15-datos-de-prueba.sql`. La prueba 07 deja anotadas en la memoria de Serquito sugerencias de prueba (temas que empiezan con `prueba-`); también se borran con esa limpieza.
