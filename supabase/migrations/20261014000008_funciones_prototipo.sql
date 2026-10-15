-- SGRP 2.0 · Funciones que faltaban respecto del prototipo que vio Serco
-- (tablero, historial, instrucciones por manifiesto, planificador de viajes, generador, reportes, usuarios).
-- Se puede correr más de una vez.

-- ---------------------------------------------------------------------
-- Instrucciones de manipulación de cada manifiesto (bloque 4 del formulario azul).
-- Si quedan vacías, se imprimen las de Configuración → Parámetros.
-- ---------------------------------------------------------------------
alter table manifiestos add column if not exists instrucciones jsonb;
comment on column manifiestos.instrucciones is
  '{"inhalacion","dermica","oral": Baja|Media|Alta, "peligros": [inflamabilidad, reactividad, toxicidad, especiales], "instructivos": [5 booleanos]}';

create or replace function emitir_manifiesto(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_id bigint; v_tr bigint := (p->>'transportista_id')::bigint; v_num text := p->>'numero';
  v_sug text; v_aviso text; v_emite boolean; it jsonb;
begin
  if not puede_editar() and auth.uid() is not null then raise exception 'Tu usuario no puede emitir manifiestos'; end if;
  if v_num !~ '^\d{9}$' then raise exception 'El número tiene que tener 9 dígitos, como figura en el formulario (ej. 837007470)'; end if;
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'El manifiesto no tiene residuos'; end if;
  if exists (select 1 from manifiestos where transportista_id = v_tr and numero = v_num) then
    raise exception 'El formulario % ya está usado', left(v_num, 3) || '-' || substr(v_num, 4);
  end if;
  v_sug := sugerir_numero(v_tr);
  if v_sug is not null and left(v_sug, 3) = left(v_num, 3) and v_num > v_sug then
    v_aviso := 'Se saltearon formularios: el siguiente era ' || left(v_sug, 3) || '-' || substr(v_sug, 4)
               || '. Si se perdieron o rompieron, hay que anularlos.';
  end if;
  select emite_manifiestos into v_emite from transportistas where id = v_tr;

  insert into manifiestos (numero, transportista_id, tipo, fecha, generador_id, generador_principal_id, direccion_retiro,
                           chofer_id, camion_id, nota, validacion_omitida, instrucciones, creado_por)
  values (v_num, v_tr, case when v_emite then 'azul' else 'rosa' end::tipo_manifiesto,
          coalesce((p->>'fecha')::date, current_date), (p->>'generador_id')::bigint,
          (p->>'generador_principal_id')::bigint, p->>'direccion_retiro', (p->>'chofer_id')::bigint,
          (p->>'camion_id')::bigint, p->>'nota', p->>'validacion_omitida', p->'instrucciones', auth.uid())
  returning id into v_id;

  for it in select * from jsonb_array_elements(p->'items') loop
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
-- Parámetros del planificador de viajes a disposición final
-- ---------------------------------------------------------------------
insert into parametros (clave, valor, descripcion) values
  ('form_peligros', 'NO,NO,NO,NO', 'Formulario azul, por defecto: inflamabilidad, reactividad, toxicidad, instrucciones especiales (SI/NO)'),
  ('plan_capacidad_solidos', '12000', 'Planificador de viajes: kilos que entran en una batea (sólidos y barros)'),
  ('plan_capacidad_liquidos', '25000', 'Planificador de viajes: litros que entran en una cisterna'),
  ('plan_mezclar_solidos', 'si', 'Planificador de viajes: se pueden mezclar corrientes sólidas en un mismo viaje (si/no)'),
  ('plan_mezclar_barros', 'no', 'Planificador de viajes: se pueden mezclar corrientes semisólidas en un mismo viaje (si/no)'),
  ('mails_reporte_producto', '', 'Mails que reciben cada lunes la cantidad transportada por producto de la semana anterior (separados por coma)')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------
-- Etapa de un manifiesto (la del residuo más atrasado): 0 almacenado, 1 en tránsito, 2 dispuesto,
-- 3 certificado entregado (el certificado ya se le mandó al cliente).
-- Se guarda en su propia tabla y se mantiene sola con triggers, para poder filtrar rápido
-- (calcularla al vuelo sobre 30.000 manifiestos tardaba varios segundos).
-- ---------------------------------------------------------------------
create table if not exists manifiesto_etapas (
  manifiesto_id bigint primary key references manifiestos(id) on delete cascade,
  etapa smallint not null default 0
);
create index if not exists manifiesto_etapas_etapa_idx on manifiesto_etapas (etapa, manifiesto_id);
alter table manifiesto_etapas enable row level security;
drop policy if exists etapas_leer on manifiesto_etapas;
create policy etapas_leer on manifiesto_etapas for select using (
  (select es_interno()) or manifiesto_id in (select m.id from manifiestos m where m.generador_id in (select mis_generadores())));
revoke all on manifiesto_etapas from anon;
revoke insert, update, delete on manifiesto_etapas from authenticated;
grant select on manifiesto_etapas to authenticated;

create or replace function calcular_etapa(p_id bigint) returns smallint
language sql stable set search_path = public as $$
  select coalesce(min(case i.estado when 'almacenado' then 0 when 'en_transito' then 1
                               else case when c.enviado_cliente is not null then 3 else 2 end end), 0)::smallint
  from manifiesto_items i left join certificados c on c.id = i.certificado_id
  where i.manifiesto_id = p_id
$$;

create or replace function actualizar_etapa(p_id bigint) returns void
language sql security definer set search_path = public as $$
  insert into manifiesto_etapas (manifiesto_id, etapa) values (p_id, calcular_etapa(p_id))
  on conflict (manifiesto_id) do update set etapa = excluded.etapa
  where manifiesto_etapas.etapa is distinct from excluded.etapa
$$;

create or replace function trg_items_etapa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'DELETE' then perform actualizar_etapa(new.manifiesto_id); end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.manifiesto_id <> new.manifiesto_id) then
    perform actualizar_etapa(old.manifiesto_id);
  end if;
  return null;
end $$;
drop trigger if exists items_etapa on manifiesto_items;
create trigger items_etapa after insert or delete or update of estado, certificado_id, manifiesto_id
  on manifiesto_items for each row execute function trg_items_etapa();

create or replace function trg_cert_etapa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform actualizar_etapa(x.manifiesto_id)
  from (select distinct manifiesto_id from manifiesto_items where certificado_id = new.id) x;
  return null;
end $$;
drop trigger if exists certificados_etapa on certificados;
create trigger certificados_etapa after update of enviado_cliente on certificados
  for each row execute function trg_cert_etapa();

-- Recalcula todas (se usa una vez acá y después de recargar la historia del Access)
create or replace function recalcular_etapas() returns integer
language sql security definer set search_path = public as $$
  with calc as (
    select m.id, coalesce(x.e, 0)::smallint e
    from manifiestos m left join (
      select i.manifiesto_id, min(case i.estado when 'almacenado' then 0 when 'en_transito' then 1
                                   else case when c.enviado_cliente is not null then 3 else 2 end end) e
      from manifiesto_items i left join certificados c on c.id = i.certificado_id group by 1) x on x.manifiesto_id = m.id
  ), ins as (
    insert into manifiesto_etapas (manifiesto_id, etapa) select id, e from calc
    on conflict (manifiesto_id) do update set etapa = excluded.etapa
    where manifiesto_etapas.etapa is distinct from excluded.etapa
    returning 1)
  select count(*)::int from ins
$$;
select recalcular_etapas();

-- La app pide manifiestos.etapa como si fuera una columna (para filtrar usa manifiesto_etapas)
create or replace function etapa(m manifiestos) returns int
language sql stable set search_path = public as $$
  select coalesce((select e.etapa from manifiesto_etapas e where e.manifiesto_id = m.id), 0)::int
$$;

-- ---------------------------------------------------------------------
-- Tablero: manifiestos por etapa, volumen de 12 meses y generadores a regularizar
-- ---------------------------------------------------------------------
create or replace function tablero_resumen(p_desde date, p_hasta date)
returns jsonb language sql stable set search_path = public as $$
  with etapas as (
    select min(case i.estado when 'almacenado' then 0 when 'en_transito' then 1
                             else case when c.enviado_cliente is not null then 3 else 2 end end) etapa
    from manifiestos m join manifiesto_items i on i.manifiesto_id = m.id
    left join certificados c on c.id = i.certificado_id
    where not m.anulado and m.fecha between p_desde and p_hasta
    group by m.id
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
    'etapas', (select jsonb_build_array(count(*) filter (where etapa = 0), count(*) filter (where etapa = 1), count(*) filter (where etapa = 2), count(*) filter (where etapa = 3)) from etapas),
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
-- Historial de cambios de un manifiesto y sus residuos (solo lo que cambió en cada paso)
-- ---------------------------------------------------------------------
create or replace function historial_manifiesto(p_id bigint)
returns table (fecha timestamptz, usuario text, tabla text, registro text, accion text, cambios jsonb, antes jsonb)
language sql stable set search_path = public as $$
  select h.fecha, coalesce(p.nombre, 'Sistema'), h.tabla, h.registro, h.accion,
         case when h.accion = 'cambio' then
           (select jsonb_object_agg(k, v) from jsonb_each(h.despues) e(k, v)
            where h.antes -> k is distinct from v and k not in ('modificado', 'modificado_por'))
         else coalesce(h.despues, '{}'::jsonb) end,
         case when h.accion = 'cambio' then
           (select jsonb_object_agg(k, v) from jsonb_each(h.antes) e(k, v)
            where h.despues -> k is distinct from v and k not in ('modificado', 'modificado_por'))
         else h.antes end
  from historial h left join perfiles p on p.id = h.usuario
  where (h.tabla = 'manifiestos' and h.registro = p_id::text)
     or (h.tabla = 'manifiesto_items' and h.registro in (select id::text from manifiesto_items where manifiesto_id = p_id)
         or h.tabla = 'manifiesto_items' and h.antes ->> 'manifiesto_id' = p_id::text)
  order by h.fecha
$$;

-- ---------------------------------------------------------------------
-- Ficha del generador: qué retira, cuánto y quién entra al portal
-- ---------------------------------------------------------------------
create or replace function generador_resumen(p_id bigint)
returns jsonb language sql stable set search_path = public as $$
  with base as (
    select m.id, m.fecha, i.cantidad, i.um, i.corriente_id
    from manifiestos m join manifiesto_items i on i.manifiesto_id = m.id
    where m.generador_id = p_id and not m.anulado
  )
  select jsonb_build_object(
    'retiros', (select count(distinct id) from base),
    'retiros_12m', (select count(distinct id) from base where fecha >= current_date - 365),
    'primero', (select min(fecha) from base),
    'ultimo', (select max(fecha) from base),
    'corrientes', (select coalesce(jsonb_agg(x order by x.total_12m desc, x.total desc), '[]') from (
        select c.codigo, c.descripcion, b.um, sum(b.cantidad) total,
               coalesce(sum(b.cantidad) filter (where b.fecha >= current_date - 365), 0) total_12m
        from base b join corrientes c on c.id = b.corriente_id group by 1, 2, 3) x),
    'usuarios', case when es_interno() then (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'email', p.email, 'activo', p.activo)), '[]')
                  from perfil_generadores pg join perfiles p on p.id = pg.perfil_id where pg.generador_id = p_id) else '[]'::jsonb end
  )
$$;

-- ---------------------------------------------------------------------
-- Reportes: cantidad por producto con filtro de transportista; estadísticas con estado físico y planta
-- ---------------------------------------------------------------------
drop function if exists reporte_por_producto(date, date, text, bigint);
create or replace function reporte_por_producto(p_desde date, p_hasta date, p_agrupar text default 'mes',
                                                p_planta bigint default null, p_transportista bigint default null)
returns table (periodo date, corriente text, descripcion text, um unidad_medida, cantidad numeric, residuos bigint)
language sql stable set search_path = public as $$
  select case p_agrupar
           when 'semana' then date_trunc('week', m.fecha)::date
           when 'quincena' then (date_trunc('month', m.fecha) + case when extract(day from m.fecha) > 15 then interval '15 days' else interval '0' end)::date
           else date_trunc('month', m.fecha)::date
         end as periodo,
         c.codigo, c.descripcion, i.um, sum(i.cantidad), count(*)
  from manifiesto_items i
  join manifiestos m on m.id = i.manifiesto_id and not m.anulado
  join corrientes c on c.id = i.corriente_id
  where m.fecha between p_desde and p_hasta
    and (p_planta is null or m.generador_principal_id = p_planta)
    and (p_transportista is null or m.transportista_id = p_transportista)
  group by 1, 2, 3, 4
  order by 1, 2
$$;

create or replace function estadisticas(p_desde date, p_hasta date)
returns jsonb language sql stable set search_path = public as $$
  with base as (
    select i.*, m.fecha, m.generador_id, m.transportista_id, m.generador_principal_id, m.id as man_id
    from manifiesto_items i join manifiestos m on m.id = i.manifiesto_id and not m.anulado
    where m.fecha between p_desde and p_hasta
  )
  select jsonb_build_object(
    'manifiestos', (select count(distinct man_id) from base),
    'generadores', (select count(distinct generador_id) from base),
    'residuos', (select count(*) from base),
    'totales', (select coalesce(jsonb_object_agg(um, total), '{}') from (select um, sum(cantidad) total from base group by um) x),
    'por_estado', (select coalesce(jsonb_object_agg(estado, n), '{}') from (select estado, count(*) n from base group by estado) x),
    'estado_fisico', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select coalesce(nullif(trim(c.estado_fisico), ''), 'SIN DATO') nombre, b.um, sum(b.cantidad) total
        from base b join corrientes c on c.id = b.corriente_id group by 1, 2) x),
    'corrientes', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select c.codigo as nombre, b.um, sum(b.cantidad) total from base b join corrientes c on c.id = b.corriente_id
        group by 1, 2 order by 3 desc limit 10) x),
    'generadores_top', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select g.nombre, b.um, sum(b.cantidad) total from base b join generadores g on g.id = b.generador_id
        group by 1, 2 order by 3 desc limit 10) x),
    'destinos', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select o.nombre, b.um, sum(b.cantidad) total from base b
        join manifiestos_nacion mn on mn.id = b.manifiesto_nacion_id join operadores o on o.id = mn.operador_id
        group by 1, 2 order by 3 desc limit 10) x),
    'plantas', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select coalesce(gp.nombre, 'Sin planta') nombre, b.um, sum(b.cantidad) total from base b
        left join generadores_principales gp on gp.id = b.generador_principal_id
        group by 1, 2 order by 3 desc limit 10) x),
    'por_mes', (select coalesce(jsonb_agg(x order by x.mes), '[]') from (
        select to_char(date_trunc('month', fecha), 'YYYY-MM') mes,
               sum(cantidad) filter (where um = 'KGS') kgs, sum(cantidad) filter (where um = 'LTS') lts
        from base group by 1) x)
  )
$$;

-- ---------------------------------------------------------------------
-- Planificador: a qué operador se mandó cada corriente en los últimos dos años
-- ---------------------------------------------------------------------
create or replace function destinos_habituales()
returns table (corriente_id bigint, operador_id bigint, residuos bigint)
language sql stable set search_path = public as $$
  select i.corriente_id, mn.operador_id, count(*)
  from manifiesto_items i join manifiestos_nacion mn on mn.id = i.manifiesto_nacion_id
  where mn.fecha >= current_date - 730 and mn.operador_id is not null
  group by 1, 2
$$;

-- ---------------------------------------------------------------------
-- Usuarios: último ingreso (está en el esquema de autenticación, solo lo ve un administrador)
-- ---------------------------------------------------------------------
create or replace function ultimos_ingresos()
returns table (id uuid, ultimo timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not exists (select 1 from perfiles where perfiles.id = auth.uid() and rol = 'admin' and activo) then
    raise exception 'Solo un administrador puede ver los ingresos';
  end if;
  return query select u.id, u.last_sign_in_at from auth.users u;
end $$;

-- ---------------------------------------------------------------------
-- Velocidad: las reglas del portal solo se evalúan para usuarios clientes
-- (para la gente de Serco alcanza con la regla interna y no se recorre todo cada vez)
-- ---------------------------------------------------------------------
drop policy if exists items_portal on manifiesto_items;
create policy items_portal on manifiesto_items for select using (
  not (select es_interno()) and manifiesto_id in (select m.id from manifiestos m where m.generador_id in (select mis_generadores())));
drop policy if exists certificados_portal on certificados;
create policy certificados_portal on certificados for select using (
  not (select es_interno()) and id in (select i.certificado_id from manifiesto_items i join manifiestos m on m.id = i.manifiesto_id
                                       where m.generador_id in (select mis_generadores())));
drop policy if exists nacion_portal on manifiestos_nacion;
create policy nacion_portal on manifiestos_nacion for select using (
  not (select es_interno()) and id in (select i.manifiesto_nacion_id from manifiesto_items i join manifiestos m on m.id = i.manifiesto_id
                                       where m.generador_id in (select mis_generadores())));

-- Las consultas con reglas de acceso tienen costos estimados altos y Postgres las "compila" (JIT),
-- lo que suma casi un segundo a pedidos que tardan milisegundos. Para los usuarios de la app se apaga.
do $$ begin
  execute 'alter role authenticated set jit = off';
exception when others then raise notice 'No se pudo apagar JIT para authenticated: %', sqlerrm;
end $$;

-- Permisos
revoke execute on function calcular_etapa(bigint), actualizar_etapa(bigint), recalcular_etapas(), trg_items_etapa(), trg_cert_etapa() from public, anon, authenticated;
revoke execute on function etapa(manifiestos), tablero_resumen(date, date), historial_manifiesto(bigint), generador_resumen(bigint),
  reporte_por_producto(date, date, text, bigint, bigint), estadisticas(date, date), ultimos_ingresos(), destinos_habituales() from public, anon;
grant execute on function etapa(manifiestos), tablero_resumen(date, date), historial_manifiesto(bigint), generador_resumen(bigint),
  reporte_por_producto(date, date, text, bigint, bigint), estadisticas(date, date), ultimos_ingresos(), destinos_habituales() to authenticated;
