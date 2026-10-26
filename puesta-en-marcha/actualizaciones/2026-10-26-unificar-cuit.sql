-- =====================================================================
-- Gestión Serco · Generadores con el mismo CUIT y distinto nombre (tipeados a mano en el Access)
--
-- Para cada CUIT válido que usan varias fichas con nombres distintos:
--   - todas pasan a llamarse igual: el nombre de la ficha con el retiro más reciente
--     (a igual fecha, la de más retiros);
--   - esa ficha queda activa y es la que aparece para emitir; las otras quedan dadas de baja
--     (sus retiros viejos no se tocan y en los reportes suman bajo el mismo nombre);
--   - en Notas de cada ficha queda cómo se llamaba antes. El historial guarda el cambio.
-- Los CUIT inválidos (11111111111, 30000000000…) no se tocan: ahí el CUIT es el que está mal.
-- Correr en Supabase → SQL Editor. Se puede correr más de una vez (la segunda no cambia nada).
-- =====================================================================
begin;

create or replace function pg_temp.cuit_valido(c text) returns boolean language sql immutable as $$
  select c ~ '^\d{11}$' and c !~ '^(\d)\1{10}$' and (
    with p as (select array[5,4,3,2,7,6,5,4,3,2] w),
         s as (select sum(substr(c, i, 1)::int * (select w from p)[i]) t from generate_series(1, 10) i)
    select case 11 - (t % 11) when 11 then 0 when 10 then 9 else 11 - (t % 11) end = substr(c, 11, 1)::int from s)
$$;

create temp table _unificar on commit drop as
with grupos as (
  select cuit from generadores
  where cuit is not null and pg_temp.cuit_valido(cuit)
  group by cuit having count(distinct mayus(trim(nombre))) > 1
), actividad as (
  select g.id, g.cuit, g.nombre, max(m.fecha) as ultimo, count(m.id) as retiros
  from generadores g join grupos using (cuit)
  left join manifiestos m on m.generador_id = g.id and not m.anulado
  group by g.id
), elegido as (
  select distinct on (cuit) cuit, id as id_elegido, nombre as nombre_final
  from actividad order by cuit, ultimo desc nulls last, retiros desc, id
)
select a.id, a.cuit, a.nombre as nombre_antes, e.nombre_final, a.id = e.id_elegido as queda_activa, a.retiros, a.ultimo
from actividad a join elegido e using (cuit);

update generadores g set
  nombre = u.nombre_final,
  activo = case when u.queda_activa then true else false end,
  notas  = concat_ws(E'\n', nullif(g.notas, ''),
           case when u.nombre_antes <> u.nombre_final then 'Antes se llamaba: ' || u.nombre_antes end,
           case when not u.queda_activa then 'Unificada por CUIT el 26/10/2026: los retiros nuevos van a la ficha ' || u.nombre_final || ' que está activa.' end)
from _unificar u
where g.id = u.id
  and (g.nombre <> u.nombre_final or g.activo <> u.queda_activa);

-- Lo que quedó (para controlar)
select cuit, nombre_final as "nombre unificado",
       string_agg(nombre_antes || case when queda_activa then ' (activa)' else '' end, ' · ' order by queda_activa desc, nombre_antes) as "fichas (nombre anterior)",
       sum(retiros) as retiros
from _unificar group by cuit, nombre_final order by nombre_final;

commit;
