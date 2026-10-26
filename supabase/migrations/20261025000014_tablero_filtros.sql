-- =====================================================================
-- SGRP 2.0 · Filtros del tablero: período, planta, transportista, generador, formulario y etapa.
-- Reemplaza tablero_resumen(desde, hasta) por la misma función con filtros opcionales
-- (sin filtros devuelve exactamente lo mismo que antes).
-- Se puede correr más de una vez.
-- =====================================================================
drop function if exists tablero_resumen(date, date);
drop function if exists tablero_resumen(date, date, bigint, bigint, bigint, text, int);

create or replace function tablero_resumen(p_desde date, p_hasta date, p_planta bigint default null, p_transportista bigint default null,
                                           p_generador bigint default null, p_tipo text default null, p_etapa int default null)
returns jsonb language sql stable set search_path = public as $$
  with filtro as (           -- todos los filtros menos período y etapa
    select m.id, m.fecha, m.generador_id, coalesce(e.etapa, 0) as etapa
    from manifiestos m left join manifiesto_etapas e on e.manifiesto_id = m.id
    where not m.anulado
      and (p_planta is null or m.generador_principal_id = p_planta)
      and (p_transportista is null or m.transportista_id = p_transportista)
      and (p_generador is null or m.generador_id = p_generador)
      and (p_tipo is null or m.tipo::text = p_tipo)
  ), periodo as (            -- el gráfico de etapas muestra todas las etapas del período
    select * from filtro where fecha between p_desde and p_hasta
  ), elegidos as (           -- los números de arriba respetan también la etapa elegida
    select * from periodo where p_etapa is null or etapa = p_etapa
  ), meses as (
    select generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month')::date mes
  ), vol as (
    select date_trunc('month', f.fecha)::date mes,
           sum(i.cantidad) filter (where i.um = 'KGS') kgs, sum(i.cantidad) filter (where i.um = 'LTS') lts
    from filtro f join manifiesto_items i on i.manifiesto_id = f.id
    where f.fecha >= date_trunc('month', current_date) - interval '11 months' and (p_etapa is null or f.etapa = p_etapa)
    group by 1
  ), activos as (
    select distinct generador_id from filtro where fecha >= current_date - 365
  ), regularizar as (
    select a.id, a.nombre, a.documento, a.vto, a.estado
    from alertas_vencimiento a join activos x on x.generador_id = a.id
    where a.tipo = 'generador' and a.estado in ('vencido', 'por_vencer', 'sin_cargar')
  )
  select jsonb_build_object(
    'etapas', (select jsonb_build_array(count(*) filter (where etapa = 0), count(*) filter (where etapa = 1), count(*) filter (where etapa = 2),
                                        count(*) filter (where etapa = 3), count(*) filter (where etapa = 4)) from periodo),
    'total', (select count(*) from elegidos),
    'meses', (select jsonb_agg(jsonb_build_object('mes', to_char(me.mes, 'YYYY-MM'), 'kgs', coalesce(v.kgs, 0), 'lts', coalesce(v.lts, 0)) order by me.mes)
              from meses me left join vol v on v.mes = me.mes),
    'regularizar', (select coalesce(jsonb_agg(r order by case r.estado when 'vencido' then 0 when 'por_vencer' then 1 else 2 end, r.vto desc nulls last), '[]')
                    from (select * from regularizar order by case estado when 'vencido' then 0 when 'por_vencer' then 1 else 2 end, vto desc nulls last limit 12) r),
    'kgs', (select coalesce(sum(i.cantidad), 0) from elegidos x join manifiesto_items i on i.manifiesto_id = x.id where i.um = 'KGS'),
    'lts', (select coalesce(sum(i.cantidad), 0) from elegidos x join manifiesto_items i on i.manifiesto_id = x.id where i.um = 'LTS'),
    'generadores', (select count(distinct generador_id) from elegidos),
    'regularizar_total', (select jsonb_build_object('vencido', count(distinct id) filter (where estado = 'vencido'),
                                                    'por_vencer', count(distinct id) filter (where estado = 'por_vencer'),
                                                    'sin_cargar', count(distinct id) filter (where estado = 'sin_cargar')) from regularizar)
  )
$$;
revoke execute on function tablero_resumen(date, date, bigint, bigint, bigint, text, int) from public, anon;
grant execute on function tablero_resumen(date, date, bigint, bigint, bigint, text, int) to authenticated;
