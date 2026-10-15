-- SGRP 2.0 · Etapa "Iniciado".
-- El manifiesto se emite con las secciones 1, 2, 4 y 5 del formulario (generador, transportista,
-- vehículo, chofer, instrucciones). La sección 3 (residuos, contenedores y cantidades) se carga
-- cuando la carga llega a la planta: recién ahí queda "Almacenado".
-- Etapas: 0 iniciado · 1 almacenado · 2 en tránsito · 3 dispuesto · 4 certificado entregado.
-- Se puede correr más de una vez.

alter table manifiestos add column if not exists ingreso_planta date;
comment on column manifiestos.ingreso_planta is 'Día en que la carga entró a la planta y se cargó la sección 3 (desde ahí corre el plazo en planta)';

-- ---------------------------------------------------------------------
-- Emitir: ya no exige residuos (si vienen, se cargan igual: sirve para los formularios rosa)
-- ---------------------------------------------------------------------
create or replace function emitir_manifiesto(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_id bigint; v_tr bigint := (p->>'transportista_id')::bigint; v_num text := p->>'numero';
  v_sug text; v_aviso text; v_emite boolean; it jsonb; v_hay boolean;
begin
  if not puede_editar() and auth.uid() is not null then raise exception 'Tu usuario no puede emitir manifiestos'; end if;
  if v_num !~ '^\d{9}$' then raise exception 'El número tiene que tener 9 dígitos, como figura en el formulario (ej. 837007470)'; end if;
  if exists (select 1 from manifiestos where transportista_id = v_tr and numero = v_num) then
    raise exception 'El formulario % ya está usado', left(v_num, 3) || '-' || substr(v_num, 4);
  end if;
  v_sug := sugerir_numero(v_tr);
  if v_sug is not null and left(v_sug, 3) = left(v_num, 3) and v_num > v_sug then
    v_aviso := 'Se saltearon formularios: el siguiente era ' || left(v_sug, 3) || '-' || substr(v_sug, 4)
               || '. Si se perdieron o rompieron, hay que anularlos.';
  end if;
  select emite_manifiestos into v_emite from transportistas where id = v_tr;
  v_hay := jsonb_array_length(coalesce(p->'items', '[]')) > 0;

  insert into manifiestos (numero, transportista_id, tipo, fecha, generador_id, generador_principal_id, direccion_retiro,
                           chofer_id, camion_id, nota, validacion_omitida, instrucciones, ingreso_planta, creado_por)
  values (v_num, v_tr, case when v_emite then 'azul' else 'rosa' end::tipo_manifiesto,
          coalesce((p->>'fecha')::date, current_date), (p->>'generador_id')::bigint,
          (p->>'generador_principal_id')::bigint, p->>'direccion_retiro', (p->>'chofer_id')::bigint,
          (p->>'camion_id')::bigint, p->>'nota', p->>'validacion_omitida', p->'instrucciones',
          case when v_hay then coalesce((p->>'fecha')::date, current_date) end, auth.uid())
  returning id into v_id;

  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]')) loop
    insert into manifiesto_items (manifiesto_id, corriente_id, contenedor, cant_estimada, cantidad, um)
    values (v_id, (it->>'corriente_id')::bigint, it->>'contenedor', (it->>'cant_estimada')::numeric,
            (it->>'cantidad')::numeric, (it->>'um')::unidad_medida);
  end loop;
  if coalesce((select valor from parametros where clave = 'bloquear_generador'), 'si') <> 'si'
     and coalesce(array_length(problemas_generador((p->>'generador_id')::bigint, coalesce((p->>'fecha')::date, current_date)), 1), 0) > 0 then
    v_aviso := concat_ws(' · ', v_aviso, array_to_string(problemas_generador((p->>'generador_id')::bigint,
                                                          coalesce((p->>'fecha')::date, current_date)), ' · '));
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'aviso', v_aviso);
end $$;

-- ---------------------------------------------------------------------
-- Ingreso a planta: se carga la sección 3. Mientras todo siga almacenado, se puede corregir
-- (se reemplazan los renglones).
-- ---------------------------------------------------------------------
create or replace function cargar_residuos(p_manifiesto bigint, p_items jsonb, p_ingreso date default null,
                                           p_validacion_omitida text default null) returns integer
language plpgsql set search_path = public as $$
declare m manifiestos; it jsonb; n int := 0;
begin
  if not puede_editar() and auth.uid() is not null then raise exception 'Tu usuario no puede cargar residuos'; end if;
  select * into m from manifiestos where id = p_manifiesto for update;
  if m.id is null then raise exception 'No existe el manifiesto'; end if;
  if m.anulado then raise exception 'El manifiesto está anulado'; end if;
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then raise exception 'Cargá al menos un residuo con su cantidad'; end if;
  if jsonb_array_length(p_items) > 7 then raise exception 'El formulario tiene 7 renglones'; end if;
  if exists (select 1 from manifiesto_items where manifiesto_id = p_manifiesto and estado <> 'almacenado') then
    raise exception 'Hay residuos de este manifiesto que ya salieron de la planta: no se pueden cambiar';
  end if;
  -- El motivo para pasar por alto una corriente no habilitada queda en el manifiesto (lo controla validar_item)
  if p_validacion_omitida is not null and m.validacion_omitida is distinct from p_validacion_omitida then
    update manifiestos set validacion_omitida = concat_ws(' · ', validacion_omitida, p_validacion_omitida) where id = p_manifiesto;
  end if;
  delete from manifiesto_items where manifiesto_id = p_manifiesto;
  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce((it->>'cantidad')::numeric, 0) <= 0 then raise exception 'Falta la cantidad real de un residuo'; end if;
    insert into manifiesto_items (manifiesto_id, corriente_id, contenedor, cant_estimada, cantidad, um)
    values (p_manifiesto, (it->>'corriente_id')::bigint, nullif(it->>'contenedor', ''), (it->>'cant_estimada')::numeric,
            (it->>'cantidad')::numeric, (it->>'um')::unidad_medida);
    n := n + 1;
  end loop;
  update manifiestos set ingreso_planta = coalesce(p_ingreso, ingreso_planta, current_date) where id = p_manifiesto;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Etapas con "Iniciado"
-- ---------------------------------------------------------------------
create or replace function calcular_etapa(p_id bigint) returns smallint
language sql stable set search_path = public as $$
  select coalesce(min(case i.estado when 'almacenado' then 1 when 'en_transito' then 2
                               else case when c.enviado_cliente is not null then 4 else 3 end end), 0)::smallint
  from manifiesto_items i left join certificados c on c.id = i.certificado_id
  where i.manifiesto_id = p_id
$$;

create or replace function recalcular_etapas() returns integer
language sql security definer set search_path = public as $$
  with calc as (
    select m.id, coalesce(x.e, 0)::smallint e
    from manifiestos m left join (
      select i.manifiesto_id, min(case i.estado when 'almacenado' then 1 when 'en_transito' then 2
                                   else case when c.enviado_cliente is not null then 4 else 3 end end) e
      from manifiesto_items i left join certificados c on c.id = i.certificado_id group by 1) x on x.manifiesto_id = m.id
  ), ins as (
    insert into manifiesto_etapas (manifiesto_id, etapa) select id, e from calc
    on conflict (manifiesto_id) do update set etapa = excluded.etapa
    where manifiesto_etapas.etapa is distinct from excluded.etapa
    returning 1)
  select count(*)::int from ins
$$;

-- Al emitir sin residuos también tiene que existir su fila (etapa 0)
create or replace function trg_manifiesto_etapa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into manifiesto_etapas (manifiesto_id, etapa) values (new.id, 0) on conflict do nothing;
  return null;
end $$;
drop trigger if exists manifiestos_etapa on manifiestos;
create trigger manifiestos_etapa after insert on manifiestos for each row execute function trg_manifiesto_etapa();
revoke execute on function trg_manifiesto_etapa() from public, anon, authenticated;

select recalcular_etapas();

create or replace function tablero_resumen(p_desde date, p_hasta date)
returns jsonb language sql stable set search_path = public as $$
  with etapas as (
    select coalesce(e.etapa, 0) etapa
    from manifiestos m left join manifiesto_etapas e on e.manifiesto_id = m.id
    where not m.anulado and m.fecha between p_desde and p_hasta
  ), meses as (
    select generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month')::date mes
  ), vol as (
    select date_trunc('month', m.fecha)::date mes,
           sum(i.cantidad) filter (where i.um = 'KGS') kgs, sum(i.cantidad) filter (where i.um = 'LTS') lts
    from manifiestos m join manifiesto_items i on i.manifiesto_id = m.id
    where not m.anulado and m.fecha >= date_trunc('month', current_date) - interval '11 months'
    group by 1
  ), activos as (
    select distinct generador_id from manifiestos where not anulado and fecha >= current_date - 365
  ), regularizar as (
    select a.id, a.nombre, a.documento, a.vto, a.estado
    from alertas_vencimiento a join activos x on x.generador_id = a.id
    where a.tipo = 'generador' and a.estado in ('vencido', 'por_vencer', 'sin_cargar')
  )
  select jsonb_build_object(
    'etapas', (select jsonb_build_array(count(*) filter (where etapa = 0), count(*) filter (where etapa = 1), count(*) filter (where etapa = 2),
                                        count(*) filter (where etapa = 3), count(*) filter (where etapa = 4)) from etapas),
    'meses', (select jsonb_agg(jsonb_build_object('mes', to_char(me.mes, 'YYYY-MM'), 'kgs', coalesce(v.kgs, 0), 'lts', coalesce(v.lts, 0)) order by me.mes)
              from meses me left join vol v on v.mes = me.mes),
    'regularizar', (select coalesce(jsonb_agg(r order by case r.estado when 'vencido' then 0 when 'por_vencer' then 1 else 2 end, r.vto desc nulls last), '[]')
                    from (select * from regularizar order by case estado when 'vencido' then 0 when 'por_vencer' then 1 else 2 end, vto desc nulls last limit 12) r),
    'kgs', (select coalesce(sum(i.cantidad), 0) from manifiestos m join manifiesto_items i on i.manifiesto_id = m.id
            where not m.anulado and m.fecha between p_desde and p_hasta and i.um = 'KGS'),
    'generadores', (select count(distinct generador_id) from manifiestos where not anulado and fecha between p_desde and p_hasta),
    'regularizar_total', (select jsonb_build_object('vencido', count(distinct id) filter (where estado = 'vencido'),
                                                    'por_vencer', count(distinct id) filter (where estado = 'por_vencer'),
                                                    'sin_cargar', count(distinct id) filter (where estado = 'sin_cargar')) from regularizar)
  )
$$;

-- ---------------------------------------------------------------------
-- El plazo en planta corre desde el ingreso a planta (si no hay, desde el retiro, como en el Access)
-- ---------------------------------------------------------------------
create or replace view residuos_en_planta with (security_invoker = true) as
  with p as materialized (select parametro_int('plazo_planta_dias', 365) as plazo)
  select i.id, m.id as manifiesto_id, m.numero, m.fecha,
         current_date - coalesce(m.ingreso_planta, m.fecha) as dias_en_planta,
         p.plazo - (current_date - coalesce(m.ingreso_planta, m.fecha)) as dias_restantes,
         m.generador_principal_id, gp.nombre as planta, g.nombre as generador,
         c.id as corriente_id, c.codigo as corriente, c.grupo_incompat, i.contenedor, i.cantidad, i.um
  from manifiesto_items i
  join manifiestos m on m.id = i.manifiesto_id and not m.anulado
  join generadores g on g.id = m.generador_id
  join corrientes c on c.id = i.corriente_id
  left join generadores_principales gp on gp.id = m.generador_principal_id
  cross join p
  where i.estado = 'almacenado';

revoke execute on function cargar_residuos(bigint, jsonb, date, text) from public, anon;
grant execute on function cargar_residuos(bigint, jsonb, date, text), tablero_resumen(date, date) to authenticated;
