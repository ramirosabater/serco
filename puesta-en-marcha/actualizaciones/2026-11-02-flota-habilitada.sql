-- =====================================================================
-- Gestión Serco · Flota habilitada (documentos de la reunión del 26/10/2026)
--
-- Quedan habilitados solo los camiones y choferes de SERCO AMBIENTAL SA con documentación vigente:
--   Camiones (carnet de cargas peligrosas de Chubut):
--     AC683XN  carnet 14198  vence 04/11/2026
--     AG861AT  carnet 14598  vence 10/03/2027   (el archivo decía AG681AT; el carnet dice AG861AT)
--     IUM534   carnet 14399  vence 04/11/2026   (en el sistema figura "IUM534_")
--     MVD144   carnet 15016  vence 03/09/2027   (en el sistema "MVD 144"; el número del carnet se lee con reflejo)
--     NSZ246   carnet 14824  vence 02/07/2027
--     PGF948   carnet 14201  vence 04/11/2026
--   Choferes (certificado de mercancías peligrosas de Seguridad Vial):
--     PAEZ NESTOR FEDERICO JAVIER  DNI 38581785  vence 19/11/2026
--     FLORES MAURO ALEJANDRO       DNI 36181920  vence 20/02/2027  (en el sistema "FLORES ALE")
--     FLORES MAURO RENE            DNI 31594320  vence 28/02/2027  (en el sistema "FLORES MAURO R.")
--     PEROTTI LEONARDO JAVIER      DNI 31043848  vence 23/04/2027  (en el sistema "PEROTTI LEONARDO J")
--
-- El resto queda inhabilitado como histórico (sus manifiestos no se tocan; se vuelve a habilitar desde la ficha):
--   - todos los demás camiones y choferes de Serco (SERCO AMBIENTAL SA y SERCO SRL);
--   - de los otros transportistas, solo los que no se usaron en ningún manifiesto del último año.
-- Los nombres y patentes no se cambian: con ellos se reconocen las novedades del Access.
-- Es UNA sola instrucción: Supabase → SQL Editor → pegar todo → Run. Muestra lo que cambió. Se puede repetir.
-- =====================================================================
with serco as (
  select id, nombre from transportistas where cuit in ('30710247605', '30657359943')
), sasa as (
  select id from transportistas where cuit = '30710247605'
), doc_cam(patente, nro, vto) as (values
  ('AC683XN', '14198', date '2026-11-04'), ('AG861AT', '14598', date '2027-03-10'), ('IUM534', '14399', date '2026-11-04'),
  ('MVD144', '15016', date '2027-09-03'), ('NSZ246', '14824', date '2027-07-02'), ('PGF948', '14201', date '2026-11-04')
), doc_cho(dni, nombre, vto) as (values
  ('38581785', 'PAEZ NESTOR FEDERICO JAVIER', date '2026-11-19'), ('36181920', 'FLORES MAURO ALEJANDRO', date '2027-02-20'),
  ('31594320', 'FLORES MAURO RENE', date '2027-02-28'), ('31043848', 'PEROTTI LEONARDO JAVIER', date '2027-04-23')
), cam as (      -- el camión de SERCO AMBIENTAL SA de cada carnet (patente sin espacios ni guiones bajos)
  select distinct on (d.patente) c.id, d.*, c.patente as patente_sistema, c.carga_pel_nro as nro_antes, c.carga_pel_vto as vto_antes, c.activo as activo_antes
  from doc_cam d join camiones c on upper(regexp_replace(c.patente, '[\s_-]', '', 'g')) = d.patente
  where c.transportista_id in (select id from sasa)
  order by d.patente, c.activo desc, c.id desc
), cho as (      -- el chofer de SERCO AMBIENTAL SA de cada certificado (por DNI)
  select distinct on (d.dni) c.id, d.*, c.nombre as nombre_sistema, c.carga_pel_vto as vto_antes, c.activo as activo_antes
  from doc_cho d join choferes c on d.dni in (regexp_replace(coalesce(c.dni, ''), '\D', '', 'g'), regexp_replace(coalesce(c.carnet_nro, ''), '\D', '', 'g'))
  where c.transportista_id in (select id from sasa)
  order by d.dni, c.activo desc, c.id desc
), usados as (
  select camion_id, chofer_id from manifiestos where fecha >= current_date - 365
), hab_cam as (
  update camiones c set activo = true, carga_pel_nro = x.nro, carga_pel_vto = x.vto
  from cam x where c.id = x.id returning c.id
), hab_cho as (
  update choferes c set activo = true, carga_pel_vto = x.vto, dni = x.dni
  from cho x where c.id = x.id returning c.id
), baja_cam as (
  update camiones c set activo = false
  where c.activo and c.id not in (select id from cam)
    and (c.transportista_id in (select id from serco) or c.id not in (select camion_id from usados where camion_id is not null))
  returning c.id, c.patente, c.transportista_id
), baja_cho as (
  update choferes c set activo = false
  where c.activo and c.id not in (select id from cho)
    and (c.transportista_id in (select id from serco) or c.id not in (select chofer_id from usados where chofer_id is not null))
  returning c.id, c.nombre, c.transportista_id
)
select 'Camión habilitado' as que, patente_sistema as nombre,
       concat_ws(' · ', 'carnet ' || nro, 'vence ' || to_char(vto, 'DD/MM/YYYY'),
         case when vto_antes is distinct from vto then 'antes vencía ' || coalesce(to_char(vto_antes, 'DD/MM/YYYY'), 'sin fecha') end,
         case when nro_antes is distinct from nro then 'antes carnet ' || coalesce(nro_antes, '—') end,
         case when vto - current_date <= 15 then '¡VENCE EN ' || (vto - current_date) || ' DÍAS!' end) as detalle
from cam
union all
select 'Chofer habilitado', nombre_sistema,
       concat_ws(' · ', 'DNI ' || dni, 'vence ' || to_char(vto, 'DD/MM/YYYY'),
         case when vto_antes is distinct from vto then 'antes vencía ' || coalesce(to_char(vto_antes, 'DD/MM/YYYY'), 'sin fecha') end,
         case when vto - current_date <= 30 then '¡VENCE EN ' || (vto - current_date) || ' DÍAS!' end)
from cho
union all
select 'No encontrado', d.patente, 'No está como camión de SERCO AMBIENTAL SA: revisar' from doc_cam d where d.patente not in (select patente from cam)
union all
select 'No encontrado', d.nombre, 'DNI ' || d.dni || ' no está como chofer de SERCO AMBIENTAL SA: revisar' from doc_cho d where d.dni not in (select dni from cho)
union all
select 'Camiones inhabilitados', t.nombre, count(*)::text || ': ' || string_agg(b.patente, ', ' order by b.patente)
from baja_cam b join transportistas t on t.id = b.transportista_id group by t.nombre
union all
select 'Choferes inhabilitados', t.nombre, count(*)::text || ': ' || string_agg(b.nombre, ', ' order by b.nombre)
from baja_cho b join transportistas t on t.id = b.transportista_id group by t.nombre
order by 1, 2;
