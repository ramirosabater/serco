-- =====================================================================
-- Gestión Serco · ¿Cuántos documentos ya están en el Drive y cuántos no?
-- Solo consulta: no cambia nada. Supabase → SQL Editor → pegar todo → Run.
--   En el Drive:      el sistema ya lo abre desde el Drive
--   En la PC (falta): todavía apunta a la carpeta del Access (no se encontró el archivo o falta subirlo)
--   Sin documento:    el Access no tenía escaneo para ese registro
-- =====================================================================
with docs(que, valor) as (
            select 'Manifiestos', escaneo from manifiestos
  union all select 'Manifiestos Nación', escaneo from manifiestos_nacion
  union all select 'Certificados', archivo from certificados
  union all select 'Habilitaciones de camiones', unnest(array[titulo_archivo, cedula_archivo, rastreo_archivo, vtv_archivo, carga_pel_archivo, ruta_archivo]) from camiones
  union all select 'Habilitaciones de choferes', unnest(array[carnet_archivo, carga_pel_archivo, sep_archivo]) from choferes
  union all select 'Habilitaciones de generadores', unnest(array[hab_mun_archivo, hab_com_archivo]) from generadores
  union all select 'Habilitaciones de transportistas', unnest(array[hab_nac_archivo, hab_pro_archivo, hab_mun_archivo]) from transportistas
  union all select 'Habilitaciones de plantas', unnest(array[hab_nac_archivo, hab_pro_archivo, hab_mun_archivo]) from generadores_principales
  union all select 'Habilitaciones de operadores', unnest(array[hab_nac_archivo, hab_pro_archivo, hab_mun_archivo]) from operadores
)
select que as "Documentos",
       count(*) filter (where valor like 'drive:%') as "En el Drive",
       count(*) filter (where valor like '\\%' or valor ~ '^[A-Za-z]:\\') as "En la PC (falta)",
       count(*) filter (where valor is not null and valor not like 'drive:%' and not (valor like '\\%' or valor ~ '^[A-Za-z]:\\')) as "En Supabase",
       count(*) filter (where valor is null) as "Sin documento",
       count(distinct valor) filter (where valor like 'drive:%') as "Archivos distintos en el Drive"
from docs group by que
union all
select 'TOTAL GB subidos (según el registro de la migración)',
       null, null, null, null, round(sum(bytes) filter (where subido is not null) / 1e9, 1)
from migracion_archivos
order by 1;
