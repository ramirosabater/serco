# Activar los mails del SGRP

Cuatro partes, unos 40 minutos. Las claves (Resend, CLAVE_TAREA) se escriben solo en tu computadora y en Supabase: no se mandan por chat ni por mail.

Qué queda andando al final:
- **Vencimientos** a Serco: cuando faltan 30, 15 y 5 días, y los lunes el resumen completo.
- **Certificados** a cada generador, apenas se registra su certificado.
- **Cantidad por producto** de la semana anterior, los lunes (si se cargan los mails en Configuración).
- **Invitar usuarios** y **"olvidé mi contraseña"**.
- **Pedido de certificados a los choferes**: un mail con un enlace para que suban el certificado nuevo desde el celular (ver el final).

---

## 1. Resend (el servicio que manda los mails) · 10 min

1. Entrá a <https://resend.com> y creá una cuenta con tu mail.
2. **API Keys → Create API Key**: nombre `sgrp`, permiso **Sending access**. Copiá la clave (empieza con `re_`) y guardala en un lugar seguro: no se vuelve a mostrar.
3. **Para probar ya**, el remitente puede ser `onboarding@resend.dev`. Con ese remitente Resend **solo entrega al mail de tu cuenta**: sirve para probar, no para clientes.
4. **Para usarlo de verdad**: **Domains → Add Domain** con el dominio de Serco (por ejemplo `serco.com.ar`, o mejor un subdominio como `avisos.serco.com.ar`). Resend muestra 3 o 4 registros DNS: hay que pasárselos a quien administra el dominio de Serco para que los cargue. Cuando aparece **Verified**, el remitente pasa a ser algo como `avisos@avisos.serco.com.ar`.

## 2. Publicar las funciones en Supabase · 10 min

En PowerShell, en `C:\Apps\sgrp2`:

1. Iniciá sesión (abre el navegador para autorizar):
   ```
   npx supabase login
   ```
2. Generá la **clave de la tarea programada** (es una contraseña inventada, solo para que la tarea diaria se identifique). Copiá lo que muestra:
   ```
   [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
   ```
3. Cargá los secretos. `REF` es la parte `xxxxxxxx` de tu `https://xxxxxxxx.supabase.co`:
   ```
   npx supabase secrets set --project-ref REF RESEND_API_KEY=re_TU_CLAVE "MAIL_DE=Serco Ambiental <onboarding@resend.dev>" APP_URL=https://sercosa.netlify.app CLAVE_TAREA=LA_CLAVE_DEL_PASO_2
   ```
   Cuando el dominio esté verificado, se vuelve a correr solo con el `MAIL_DE` nuevo.
4. Publicá las tres funciones:
   ```
   npx supabase functions deploy avisos usuarios certificado-chofer --project-ref REF --use-api
   ```
   Tiene que terminar con `Deployed Functions on project REF: avisos, usuarios, certificado-chofer`.

## 3. Mails de usuarios: invitaciones y "olvidé mi contraseña" · 10 min

Los manda Supabase, no nuestras funciones. Sin este paso, Supabase solo los manda a los miembros del proyecto y con un límite de pocos por hora.

1. **Authentication → Emails → SMTP Settings → Enable Custom SMTP**:
   - Sender email: el mismo del `MAIL_DE` (por ahora `onboarding@resend.dev`)
   - Sender name: `Serco Ambiental`
   - Host: `smtp.resend.com` · Port: `465`
   - Username: `resend` · Password: tu clave `re_...`
2. **Authentication → URL Configuration**:
   - Site URL: `https://sercosa.netlify.app`
   - Redirect URLs: agregar `https://sercosa.netlify.app/**` y `http://localhost:5173/**`
3. **Authentication → Emails → Templates**: reemplazar los textos en inglés por estos.

   **Invite user** · Subject: `Te invitaron al sistema de Serco Ambiental`
   ```html
   <h2>Bienvenido al SGRP de Serco Ambiental</h2>
   <p>Te dieron acceso al sistema de gestión de residuos. Para entrar, elegí tu contraseña:</p>
   <p><a href="{{ .ConfirmationURL }}">Elegir mi contraseña</a></p>
   <p>Si no esperabas este mail, ignoralo.</p>
   ```

   **Reset password** · Subject: `Elegí una contraseña nueva`
   ```html
   <h2>Contraseña nueva</h2>
   <p>Pediste cambiar la contraseña del SGRP de Serco Ambiental.</p>
   <p><a href="{{ .ConfirmationURL }}">Elegir una contraseña nueva</a></p>
   <p>Si no lo pediste, ignorá este mail: tu contraseña sigue igual.</p>
   ```

## 4. Probar y programar · 10 min

1. En el sistema: **Configuración → Avisos por mail → "Mandarme un mail de prueba"**. Tiene que llegarte a tu mail (mirá también en correo no deseado). Si falla, el mensaje dice por qué.
2. En **Configuración → Parámetros**, cargá **"Mails que reciben los vencimientos"** (separados por coma). Con el remitente de prueba, solo funciona tu propio mail.
3. En el **SQL Editor** de Supabase abrí `puesta-en-marcha/actualizaciones/activar-avisos.sql`, reemplazá las dos líneas marcadas con `<<<` (la URL del proyecto y la clave del paso 2.2) y tocá **Run**. Al final muestra la tarea `avisos-diarios` programada.
4. Al otro día, después de las 7, en Configuración aparece lo que se mandó. También se ve en el SQL Editor con:
   ```sql
   select status_code, content, created from net._http_response order by created desc limit 5;
   ```

### Cuando el dominio de Serco esté verificado

- Volver a correr el paso 2.3 con `"MAIL_DE=Serco Ambiental <avisos@...>"`.
- Cambiar el Sender email del paso 3.1 por la misma dirección.
- Cargar el mail de cada generador en Altas → Generadores (hoy solo 41 de los 139 activos tienen).

## Pedido de certificados a los choferes

Cuando a un chofer le vence el psicofísico, la licencia de carga peligrosa o el carnet, el sistema le manda un mail con un enlace propio (vale 20 días). Desde el celular sube el PDF o una foto: la página lee el DNI y el vencimiento, avisa si el certificado es de otra persona o ya está vencido, y lo manda. **No pasa solo a la ficha**: aparece en **Vencimientos → Certificados de choferes → Para revisar** y alguien de Serco lo mira y lo acepta con un clic (el vencimiento lo lee el celular del chofer y se podría falsear).

- **A quién le llega:** al mail del chofer (Altas → Choferes → Mail). Si no tiene, al mail de su transportista.
- **A mano:** en la ficha del chofer, "Pedir por mail" en cada documento; o en Vencimientos, "Pedir por mail" para todos los que vencen en los próximos 30 días (antes de mandar muestra a quién).
- **Automático:** apagado. Para que la tarea diaria los mande sola, en Configuración → Parámetros poner `pedir_certificados_auto` en `si`. Conviene hacerlo recién cuando el sistema esté en producción y los mails de los choferes estén cargados: hoy los transportistas tienen mail del Access y les llegarían a ellos.
- **Importante:** el enlace abre `https://sercosa.netlify.app/subir/...`. Mientras el sitio de Netlify tenga la protección de "sitio privado", los choferes no pueden abrirlo. Se saca en Netlify → Site configuration → Access & security al pasar a producción.

