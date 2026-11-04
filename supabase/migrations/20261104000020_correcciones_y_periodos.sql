-- =====================================================================
-- Gestión Serco · Corregir y anular manifiestos, y períodos presentados a provincia
--
-- Reglas de Serco (04/11/2026):
--   - Cantidad: una corrección chica se "salva con *" mientras no haya llegado el certificado (CDF) del operador.
--     Después del CDF no se salva: se anula.
--   - Generador (razón social / CUIT, porque se equivocaron de cliente) y dirección de retiro: se corrigen en
--     cualquier etapa.
--   - Anular: en cualquier etapa.
--   - Pero nada de esto si el período ya se presentó a provincia (el libro provincial de la planta):
--     ni corregir ni anular.
-- Las correcciones quedan en el historial del manifiesto (quién, cuándo, valor anterior y motivo).
-- Se puede correr más de una vez.
-- =====================================================================

-- Períodos del libro provincial ya presentados a provincia (por planta)
create table if not exists periodos_presentados (
  id bigint generated always as identity primary key,
  generador_principal_id bigint not null references generadores_principales(id),
  desde date not null,
  hasta date not null check (hasta >= desde),
  presentado date not null default current_date,
  registro_desde integer,
  registro_hasta integer,
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid()
);
create index if not exists periodos_presentados_planta_idx on periodos_presentados(generador_principal_id, desde, hasta);
alter table periodos_presentados enable row level security;
drop policy if exists periodos_leer on periodos_presentados;
create policy periodos_leer on periodos_presentados for select to authenticated using ((select es_interno()));
grant select on periodos_presentados to authenticated;

drop trigger if exists periodos_presentados_historial on periodos_presentados;
create trigger periodos_presentados_historial after insert or update or delete on periodos_presentados
  for each row execute function registrar_historial();

-- Marca de cantidad salvada ("1.200 kg → 1.180 kg · motivo"), como el asterisco del papel
alter table manifiesto_items add column if not exists salvado text;

create or replace function es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and rol = 'admin' and activo)
$$;

/** Si el manifiesto ya se informó a provincia: el texto que se muestra; si no, null */
create or replace function manifiesto_bloqueo(p_id bigint) returns text
language sql stable set search_path = public as $$
  select 'Ya se presentó a provincia el ' || to_char(p.presentado, 'DD/MM/YYYY')
         || ' (libro provincial del ' || to_char(p.desde, 'DD/MM/YYYY') || ' al ' || to_char(p.hasta, 'DD/MM/YYYY')
         || '): no se puede corregir ni anular.'
  from manifiestos m join periodos_presentados p
    on p.generador_principal_id = m.generador_principal_id and m.fecha between p.desde and p.hasta
  where m.id = p_id
  order by p.presentado desc limit 1
$$;
grant execute on function manifiesto_bloqueo(bigint) to authenticated;

-- Marcar un período como presentado (solo administradores)
create or replace function marcar_presentado(p_planta bigint, p_desde date, p_hasta date,
                                             p_registro_desde integer default null, p_registro_hasta integer default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not es_admin() then raise exception 'Solo un administrador puede marcar el libro como presentado'; end if;
  if p_hasta < p_desde then raise exception 'La fecha hasta es anterior a desde'; end if;
  insert into periodos_presentados (generador_principal_id, desde, hasta, registro_desde, registro_hasta)
  values (p_planta, p_desde, p_hasta, p_registro_desde, p_registro_hasta) returning id into v_id;
  return v_id;
end $$;
revoke all on function marcar_presentado(bigint, date, date, integer, integer) from public, anon;
grant execute on function marcar_presentado(bigint, date, date, integer, integer) to authenticated;

-- Deshacer una marca hecha por error (solo administradores; queda en el historial)
create or replace function desmarcar_presentado(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo un administrador puede deshacer la marca'; end if;
  delete from periodos_presentados where id = p_id;
end $$;
revoke all on function desmarcar_presentado(bigint) from public, anon;
grant execute on function desmarcar_presentado(bigint) to authenticated;

-- Corregir generador y/o dirección de retiro (en cualquier etapa, salvo presentado a provincia)
create or replace function corregir_manifiesto(p_id bigint, p_generador bigint, p_direccion text, p_motivo text) returns void
language plpgsql set search_path = public as $$
declare m manifiestos; b text;
begin
  if not puede_editar() then raise exception 'Tu usuario no puede corregir manifiestos'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la corrección'; end if;
  select * into m from manifiestos where id = p_id for update;
  if m.id is null then raise exception 'No existe el manifiesto'; end if;
  if m.anulado then raise exception 'El manifiesto está anulado'; end if;
  b := manifiesto_bloqueo(p_id);
  if b is not null then raise exception '%', b; end if;
  if p_generador is null then raise exception 'Elegí el generador'; end if;
  -- la flota y los vencimientos se controlaron al emitir: corregir el cliente no los vuelve a pedir
  perform set_config('sgrp.correccion', '1', true);
  update manifiestos set generador_id = p_generador, direccion_retiro = nullif(trim(p_direccion), ''),
         nota = concat_ws(E'\n', nullif(nota, ''), 'Corregido el ' || to_char(current_date, 'DD/MM/YYYY') || ': ' || trim(p_motivo))
  where id = p_id;
  perform set_config('sgrp.correccion', '', true);
end $$;
grant execute on function corregir_manifiesto(bigint, bigint, text, text) to authenticated;

-- Salvar la cantidad de un residuo ("*"): mientras no llegó el certificado del operador
create or replace function salvar_cantidad(p_item bigint, p_cantidad numeric, p_motivo text) returns void
language plpgsql set search_path = public as $$
declare i manifiesto_items; m manifiestos; b text;
begin
  if not puede_editar() then raise exception 'Tu usuario no puede corregir manifiestos'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo'; end if;
  if coalesce(p_cantidad, 0) <= 0 then raise exception 'La cantidad tiene que ser mayor a cero'; end if;
  select * into i from manifiesto_items where id = p_item for update;
  if i.id is null then raise exception 'No existe el residuo'; end if;
  select * into m from manifiestos where id = i.manifiesto_id;
  if m.anulado then raise exception 'El manifiesto está anulado'; end if;
  b := manifiesto_bloqueo(m.id);
  if b is not null then raise exception '%', b; end if;
  if i.certificado_id is not null then
    raise exception 'Ya llegó el certificado del operador: la cantidad no se salva, hay que anular el manifiesto';
  end if;
  if p_cantidad = i.cantidad then return; end if;
  update manifiesto_items
  set cantidad = p_cantidad,
      salvado = concat_ws(' · ', salvado, format('* %s → %s %s (%s, %s)',
                  fmt_cant(i.cantidad), fmt_cant(p_cantidad), case i.um when 'KGS' then 'kg' when 'LTS' then 'l' else 'm³' end, trim(p_motivo), to_char(current_date, 'DD/MM/YYYY')))
  where id = p_item;
end $$;
grant execute on function salvar_cantidad(bigint, numeric, text) to authenticated;

-- Anular: en cualquier etapa, salvo presentado a provincia
create or replace function anular_manifiesto(p_manifiesto bigint, p_motivo text) returns void
language plpgsql set search_path = public as $$
declare b text;
begin
  if not puede_editar() and auth.uid() is not null then raise exception 'Tu usuario no puede anular manifiestos'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la anulación'; end if;
  b := manifiesto_bloqueo(p_manifiesto);
  if b is not null and auth.uid() is not null then raise exception '%', b; end if;
  update manifiestos set anulado = true, anulado_motivo = p_motivo where id = p_manifiesto;
end $$;

-- La corrección completa de los residuos (sección 3) sigue siendo mientras están en planta; y tampoco si está presentado
create or replace function cargar_residuos(p_manifiesto bigint, p_items jsonb, p_ingreso date DEFAULT NULL::date, p_validacion_omitida text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare m manifiestos; it jsonb; n int := 0; b text;
begin
  if not puede_editar() and auth.uid() is not null then raise exception 'Tu usuario no puede cargar residuos'; end if;
  select * into m from manifiestos where id = p_manifiesto for update;
  if m.id is null then raise exception 'No existe el manifiesto'; end if;
  if m.anulado then raise exception 'El manifiesto está anulado'; end if;
  if exists (select 1 from manifiesto_items where manifiesto_id = p_manifiesto) then
    b := manifiesto_bloqueo(p_manifiesto);
    if b is not null and auth.uid() is not null then raise exception '%', b; end if;
  end if;
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then raise exception 'Cargá al menos un residuo con su cantidad'; end if;
  if jsonb_array_length(p_items) > 7 then raise exception 'El formulario tiene 7 renglones'; end if;
  if exists (select 1 from manifiesto_items where manifiesto_id = p_manifiesto and estado <> 'almacenado') then
    raise exception 'Hay residuos de este manifiesto que ya salieron de la planta: no se pueden cambiar (la cantidad se puede salvar con *)';
  end if;
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
end $function$;

-- Al corregir el generador no se vuelve a controlar la flota de ese día (los camiones pueden estar hoy inhabilitados)
create or replace function validar_manifiesto() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.anulado then return new; end if;
  if current_setting('sgrp.correccion', true) = '1' then return new; end if;
  if tg_op = 'UPDATE' and (new.chofer_id, new.camion_id, new.generador_id, new.fecha, new.transportista_id)
                      is not distinct from (old.chofer_id, old.camion_id, old.generador_id, old.fecha, old.transportista_id)
  then return new; end if;
  -- Solo se valida la flota en los manifiestos que emite Serco (azul); los rosas los emite otro transportista
  if new.tipo = 'azul' then
    perform exigir_sin_problemas(
      problemas_manifiesto(new.transportista_id, new.camion_id, new.chofer_id, new.generador_id, new.fecha),
      new.validacion_omitida);
  end if;
  return new;
end $$;

-- Defensa en la base: lo presentado a provincia no se cambia por ningún otro camino desde el sistema
-- (sí puede seguir su recorrido: viaje, certificado, etc.). Las novedades del Access no pasan por acá.
create or replace function proteger_presentado() returns trigger
language plpgsql set search_path = public as $$
declare b text; mid bigint;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name = 'manifiestos' then
    if (new.generador_id, new.direccion_retiro, new.fecha, new.numero, new.transportista_id, new.anulado)
       is not distinct from (old.generador_id, old.direccion_retiro, old.fecha, old.numero, old.transportista_id, old.anulado)
    then return new; end if;
    b := manifiesto_bloqueo(old.id);
  elsif tg_op = 'DELETE' then
    mid := old.manifiesto_id;
  elsif tg_op = 'INSERT' then
    mid := new.manifiesto_id;
  else
    if (new.cantidad, new.corriente_id, new.um) is not distinct from (old.cantidad, old.corriente_id, old.um)
    then return new; end if;
    mid := new.manifiesto_id;
  end if;
  if mid is not null then b := coalesce(b, manifiesto_bloqueo(mid)); end if;
  if b is not null then raise exception '%', b; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists proteger_presentado on manifiestos;
create trigger proteger_presentado before update on manifiestos for each row execute function proteger_presentado();
drop trigger if exists proteger_presentado on manifiesto_items;
create trigger proteger_presentado before insert or update or delete on manifiesto_items for each row execute function proteger_presentado();
