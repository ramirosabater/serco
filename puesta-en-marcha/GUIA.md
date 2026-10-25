# SGRP 2.0 · Puesta en marcha en Supabase

> También se puede hacer con los archivos de `sql-por-separado`: correr del 01 al 07 en el SQL Editor, después cargar los datos (paso 3 de esta guía), el 08 (administrador), el 09, el 10, el 11, el 12, el 13 y el 14. El resultado es el mismo.

Tiempo estimado: 40 minutos. Se hace una sola vez.

Necesitás en tu PC: **Python 3** y **Node.js LTS**. Para chequearlo, abrí PowerShell y escribí `python --version` y `node --version`.

## 1. Crear el proyecto (5 min)

1. Entrá a supabase.com → **New project**.
2. Elegí tu organización, con el plan Free para desarrollo. Cuando Serco tenga su cuenta Pro, el proyecto se transfiere entero, con los datos incluidos.
3. Completá:
   - **Name:** `sgrp2`
   - **Database password:** generá una solo con letras y números (sin @ # / ?) y **guardala**, porque se usa en el paso 3.
   - **Region:** South America (São Paulo).
4. Esperá un par de minutos a que termine de crearse.

## 2. Crear las tablas (2 min)

1. Andá a **SQL Editor** → **New query**.
2. Abrí `1-esquema.sql` con el Bloc de notas, copiá todo, pegalo y tocá **Run**.
3. Tiene que decir *Success. No rows returned*.

## 3. Cargar los datos del Access (5 min)

1. En Supabase, tocá **Connect** (arriba) → pestaña **Session pooler** → copiá la dirección (*URI*).
2. En esa dirección, reemplazá `[YOUR-PASSWORD]` por la contraseña del paso 1. Ojo con los corchetes: también se van.
3. Abrí PowerShell en la carpeta `2-datos` (clic derecho en la carpeta → *Abrir en Terminal*) y corré:

```
pip install psycopg2-binary
python cargar_datos.py "postgresql://postgres.xxxx:CLAVE@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"
```

Tiene que terminar con **Todo coincide**: 29.853 manifiestos, 30.908 residuos, 7.628 Manifiestos Nación y 7.650 certificados.

## 4. Reglas y permisos (2 min)

En el SQL Editor, abrí una **New query**, pegá todo `3-reglas.sql` y tocá **Run**.
Si Supabase avisa que la consulta tiene operaciones "destructivas", confirmá con **Run this query**: son cambios de permisos, no borran datos.

## 5. Tu usuario administrador (3 min)

1. Andá a **Authentication** → **Users** → **Add user** → **Create new user**.
2. Poné tu mail y una contraseña, y tildá **Auto Confirm User**.
3. En el SQL Editor, pegá `4-primer-administrador.sql`, revisá que tenga tu mail y tocá **Run**. Tiene que mostrarte con rol `admin`.

## 6. Direcciones de ingreso (1 min)

En **Authentication** → **URL Configuration**:

- **Site URL:** `http://localhost:5173`
- **Redirect URLs:** agregá `http://localhost:5173/elegir-clave`

Cuando se publique en Netlify, se cambian por la dirección real.

## 7. Abrir el sistema en tu PC (10 min)

1. En Supabase, andá a **Project Settings** → **API Keys** y copiá la **Project URL** y la clave **anon** (o **publishable**).
2. En la carpeta `web`, creá un archivo llamado `.env.local` con este contenido:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=la-clave-anon-o-publishable
```

3. En PowerShell, dentro de la carpeta `web`, corré:

```
npm install
npm run dev
```

4. Abrí http://localhost:5173 y entrá con tu mail.

El Tablero tiene que mostrar números y Manifiestos tiene que listar los 29.853.

## Importante

- **Nunca** pongas en `.env.local` la clave **service_role** ni la contraseña de la base. Solo van la URL y la clave anon/publishable.
- La contraseña de la base y las claves no se mandan por chat ni por mail.
- Si el proyecto Free queda una semana sin uso, Supabase lo pausa. Se reactiva con un clic desde el panel.

## Para recargar los datos más adelante

Si cambia el Access, por ejemplo antes del arranque definitivo, se genera un `datos-migrados.sql.gz` nuevo a partir del `SGRP.mdb` actualizado y se carga con:

```
python cargar_datos.py "<dirección>" --reemplazar
```

Esto vacía los datos y los vuelve a cargar. Los usuarios y los generadores asignados a cada cliente se conservan.
**Ojo:** también borra lo que se haya cargado en el sistema nuevo, así que se usa solo antes del arranque. Si encuentra datos cargados desde el sistema, pide que escribas BORRAR para seguir.

## Actualizaciones

Si ya hiciste la puesta en marcha y después llega una versión nueva, corré en el SQL Editor los archivos de la carpeta `actualizaciones` posteriores a la fecha en que la hiciste. Se pueden correr más de una vez sin problema.

Si todavía no la hiciste, no hace falta: `3-reglas.sql` ya los incluye.

## Lo que queda para después

- **Archivos:** subir los PDF, unos 20 GB. Necesita el plan Pro de Serco.
- **Avisos por mail:** ver `AVISOS.md` (Resend, funciones `avisos` y `usuarios`, tarea diaria).
- **Publicación en Netlify**, para usar el sistema desde cualquier lugar.
