# Conectar el Google Drive de Serco

Todos los PDF y fotos del sistema se guardan en el Drive de la cuenta de Gmail de Serco (Google One de 200 GB):
los del Access que se migran y los nuevos (manifiestos firmados, Manifiestos Nación, certificados, habilitaciones,
certificados de choferes, lo que suben los choferes desde el enlace del mail).

- El sistema solo puede ver y tocar **los archivos que él mismo sube** (permiso `drive.file`): no ve el resto del Drive.
- Las claves quedan solo en tu PC (`migracion\.env.drive`) y en Supabase. No van a GitHub ni al navegador.
- Los archivos no tienen enlace público: para verlos, el sistema controla quién es y da un enlace que vence en 5 minutos.
- Mientras Drive no esté conectado, los archivos nuevos van al Storage de Supabase (como hasta ahora) y siguen andando después.

Son unos 20 minutos, una sola vez. Todo con la cuenta de Gmail de Serco.

## 1. Proyecto en Google Cloud · 10 min

1. Entrá a <https://console.cloud.google.com> con la cuenta de Gmail de Serco y aceptá las condiciones.
2. Arriba, en el selector de proyectos: **Nuevo proyecto** → nombre `Gestion Serco` → **Crear**. Dejalo seleccionado.
3. Menú → **APIs y servicios → Biblioteca** → buscá **Google Drive API** → **Habilitar**.
4. Menú → **APIs y servicios → Pantalla de consentimiento de OAuth** (en algunas cuentas se llama **Google Auth Platform**) → **Comenzar**:
   - Nombre de la app: `Gestión Serco` · correo de asistencia: la cuenta de Gmail de Serco.
   - Público: **Externo**.
   - Datos de contacto: la misma cuenta. Aceptá y **Crear**.
5. En **Público** (Audience): tocá **Publicar app** → **Confirmar**. Tiene que quedar "En producción".
   Si queda "En prueba", el permiso vence a los 7 días y hay que volver a autorizar.
   (Como el permiso es solo "archivos que crea la app", Google no pide verificación.)
6. En **Clientes** (o **Credenciales → Crear credenciales → ID de cliente de OAuth**):
   - Tipo de aplicación: **App de escritorio** · nombre `migracion` → **Crear**.
   - Tocá **Descargar JSON** y guardalo en `C:\Apps\sgrp2\migracion` (se llama `client_secret_….json`; no va a GitHub).

## 2. Autorizar · 3 min

En PowerShell, en `C:\Apps\sgrp2\migracion`:

```
python autorizar_drive.py client_secret_XXXX.json
```

(Con el nombre real del archivo: escribí `client_secret_` y tocá Tab para que se complete.)

Se abre el navegador: entrá con la cuenta de Gmail de Serco y tocá **Continuar / Permitir**.
Al terminar, en el Drive aparece la carpeta **Gestión Serco · Documentos** y te muestra los dos comandos del paso 3.

## 3. Pasarle las claves a Supabase · 3 min

En PowerShell, en `C:\Apps\sgrp2` (REF es la parte `xxxx` de `https://xxxx.supabase.co`):

```
npx supabase secrets set --env-file migracion\.env.drive --project-ref REF
npx supabase functions deploy archivos certificado-chofer --project-ref REF --use-api --no-verify-jwt
```

Antes, en el SQL Editor de Supabase, correr `puesta-en-marcha/actualizaciones/2026-10-26-archivos-drive.sql`.

Para probar: en el sistema, en la ficha de un camión, subí un escaneo y tocá **Ver**. En el Drive aparece dentro de
`Gestión Serco · Documentos/habilitaciones/camiones/…`.

## 4. Subir los PDF del Access · varias horas (se puede cortar)

En PowerShell, en `C:\Apps\sgrp2\migracion` (una sola vez: `pip install psycopg2-binary`):

```
python migrar_archivos.py "C:\serco 26102026" "C:\RAYGROUP"
```

Primero sin `--drive`: solo revisa y dice cuántos encontró, cuántos faltan y cuántos GB son. Si está bien:

```
python migrar_archivos.py "C:\serco 26102026" "C:\RAYGROUP" --drive
```

- Pide la dirección de la base (Supabase → Connect → Session pooler, con la contraseña). No se ve mientras la pegás.
- Busca primero en la copia nueva y, si no está, en la vieja.
- Va mostrando el avance y cuánto falta. Si se corta (o apagás la PC), se vuelve a correr el mismo comando
  y sigue desde donde quedó: lo subido no se sube dos veces.
- Al terminar, correr de nuevo la validación: la hoja **Archivos** del Excel tiene que mostrar los subidos.

Los listados `archivos_no_encontrados.csv` y `archivos_sin_documento.txt` quedan en esa carpeta y no van a GitHub.

## Si algo falla

- **"Google no dio acceso al Drive"**: el permiso se venció o se sacó. Volver a hacer el paso 2 y el 3.
- **Cambiar de cuenta de Google**: repetir los pasos 1 a 3 con la cuenta nueva. Los archivos ya subidos quedan en la cuenta vieja.
