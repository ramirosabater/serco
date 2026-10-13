# SGRP 2.0 · App web

React + Vite + TypeScript, contra Supabase. Se publica en Netlify (`netlify.toml` ya configurado).

## Arrancar

```
npm install
cp .env.example .env.local      # completar URL y anon key del proyecto Supabase
npm run dev
```

## Pantallas

| Ruta | Qué hace |
| --- | --- |
| `/` | Tablero: manifiestos del mes, planta, tránsito, flota vencida |
| `/manifiestos` | Listado con búsqueda y filtros; `/manifiestos/:id` recorrido y anulación |
| `/manifiestos/nuevo` | Emitir: número sugerido y bloqueo en vivo por vencimientos |
| `/manifiestos/:id/imprimir` | Impresión sobre el formulario azul, con ajuste por PC |
| `/reportes/:tipo` | Cantidad por producto, libros provincial, nacional y de transporte, estadísticas |
| `/planta` | Armar carga y Manifiesto Nación; registrar certificados |
| `/vencimientos` | Todo lo vencido, por vencer o sin cargar; cada fila abre su ficha |
| `/altas/:entidad` | Camiones, choferes, transportistas, generadores, plantas, operadores y corrientes |
| `/configuracion` | Solo admin: usuarios (invitar, rol, baja), avisos por mail y parámetros |
| `/portal`, `/portal/certificados` | Clientes: sus retiros y la descarga de certificados |
| `/elegir-clave` | Adonde llegan la invitación y "olvidé mi contraseña" |

Las reglas (bloqueos, numeración, estados) están en la base: la app solo las muestra.

## Pruebas locales sin Supabase

Con un PostgREST propio sobre la base migrada y un token de prueba:

```
POSTGREST_URL=http://localhost:3000 npm run dev
# .env.local: VITE_SUPABASE_URL=http://localhost:5173 · VITE_SUPABASE_ANON_KEY=local · VITE_DEV_JWT=<token>
```

En este modo no hay ingreso ni Storage (no se pueden subir ni ver archivos).

## Tipos

`src/lib/tipos.ts` está escrito a mano. Con el proyecto creado, generarlos:
`npx supabase gen types typescript --project-id <proyecto> > src/lib/database.types.ts`

## Consultas grandes

Supabase devuelve como máximo 1000 filas por pedido. Para listas que pueden pasar ese número, usar
`traerTodo()` de `src/lib/paginar.ts`, que pide de a 1000 hasta traer todo.
