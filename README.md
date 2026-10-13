# SGRP 2.0 · Serco Ambiental

Sistema web de gestión de residuos peligrosos que reemplaza al SGRP en Access.
Stack: Supabase (base, usuarios, archivos) + Netlify (app web).

```
supabase/migrations/
  20261005000001_esquema_inicial.sql   tablas, permisos (RLS) y vistas
  20261005000002_reglas.sql            validaciones e historial · después de la carga
  20261005000003_storage.sql           bucket "documentos" y quién ve cada archivo
  20261005000004_operacion.sql         bloqueos, numeración y funciones de la app · después de la carga
  20261006000005_avisos.sql            avisos por mail: registro y certificados pendientes
  20261008000006_permisos_supabase.sql cierra el acceso anónimo (nada es público)
  20261013000007_impresion_reportes.sql textos del formulario, libros y estadísticas
  20261014000008_funciones_prototipo.sql tablero, historial, instrucciones, planificador de viajes, ficha del generador
  20261014000009_choferes_dni.sql        DNI de los choferes (lectura de certificados)
supabase/functions/
  avisos/                              mails diarios: certificados a clientes, vencimientos a Serco, reporte semanal por producto
  usuarios/                            invitar usuarios (personal y clientes del portal)
migracion/
  migrar.py                            datos: Access → Postgres + informe de inconsistencias (necesita mdbtools)
  cargar_datos.py                      carga un volcado ya migrado en Supabase (solo necesita Python)
  migrar_archivos.py                   archivos: carpeta RAYGROUP → Storage
  hallazgos-access.md                  lo que encontró la migración
web/                                   app React (ver web/README.md)
puesta-en-marcha/                      lo necesario para el primer arranque en Supabase (ver GUIA.md)
```

## Puesta en marcha

Seguir `puesta-en-marcha/GUIA.md`. En resumen:

1. Crear el proyecto Supabase y correr `1-esquema.sql` en el SQL Editor (= migración 0001).
2. Cargar los datos: `python 2-datos/cargar_datos.py "<session pooler URI>"`.
3. Correr `3-reglas.sql` (= migraciones 0002 a 0007).
4. Crear el primer usuario en Authentication y darle rol admin con `4-primer-administrador.sql`.
5. Configurar las URL de Auth y levantar `web/` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.

El volcado `datos-migrados.sql.gz` se genera desde el `.mdb` con `migrar.py` sobre un Postgres local y
`pg_dump --data-only` (sin `perfiles`, `perfil_generadores` ni `historial`). Para regenerarlo con un Access nuevo,
repetir eso y recargar con `cargar_datos.py --reemplazar`.

## Avisos por mail

```
supabase secrets set RESEND_API_KEY=re_... MAIL_DE="Serco Ambiental <avisos@dominio-de-serco>" APP_URL=https://<sitio>.netlify.app
supabase functions deploy avisos usuarios
```

- En Resend hay que verificar el dominio de Serco para poder mandar desde su dirección.
- En Supabase Auth → URL Configuration: Site URL = la del sitio y agregar `/elegir-clave` a las Redirect URLs.
- Programación diaria: activar `pg_cron` y `pg_net`, guardar en el Vault `project_url` y `service_role_key`,
  y ejecutar el `cron.schedule` comentado al final de `0005_avisos.sql`.
- Parámetro `mails_vencimientos`: a quién le llegan los vencimientos (se carga en Configuración).
- Parámetro `dias_alerta_vencimientos` (por defecto `30,15,5`): cada documento avisa cuando faltan esos días;
  agregar `0` para avisar también el día que vence. Los lunes llega además el resumen completo.
- La historia migrada ya figura como avisada: solo se avisan los certificados nuevos.

La migración se puede volver a correr con todo aplicado: desactiva triggers y validaciones durante la carga.

## Funciones de la base que usa la app

| Función | Qué hace |
| --- | --- |
| `sugerir_numero` | siguiente formulario de la serie |
| `problemas_manifiesto` | qué impide emitir (vencimientos, bajas) |
| `emitir_manifiesto` | manifiesto + residuos; bloquea si algo está vencido o no habilitado |
| `armar_nacion` | Manifiesto Nación con residuos almacenados → en tránsito |
| `registrar_certificado` | certificado → disposición final; queda en `certificados_por_avisar` |
| `anular_manifiesto` / `anular_formulario` | anulaciones con motivo |

Parámetros (tabla `parametros`): `dias_aviso_vencimiento`, `plazo_planta_dias`, `bloquear_generador`.
