-- =====================================================================
-- SGRP 2.0 · Operación diaria · aplicar DESPUÉS de cargar la historia
--
--   1. Bloqueo al emitir: chofer, camión, transportista y generador al día.
--   2. Corrientes habilitadas: transportista, planta (generador principal) y operador.
--   3. Numeración: el número viene del formulario preimpreso; el sistema sugiere
--      el siguiente, controla que no se repita y avisa si se salta números.
--   4. Funciones para la app: emitir manifiesto, armar Manifiesto Nación,
--      registrar certificado y anular manifiesto.
--   5. Vistas para el tablero, la agenda y los avisos por mail.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------
alter table manifiestos
  add column validacion_omitida  text;      -- motivo, solo admin: deja emitir aunque algo esté vencido

alter table manifiestos alter column generador_id drop not null;
alter table manifiestos add constraint manifiestos_generador_salvo_anulado
  check (anulado or generador_id is not null) not valid;

alter table manifiestos_nacion
  add column camion_id  bigint references camiones(id),   -- el formulario verde lleva vehículo y conductor
  add column chofer_id  bigint references choferes(id),
  add column validacion_omitida text;

insert into parametros (clave, valor, descripcion) values
  ('dias_aviso_vencimiento', '45', 'Con cuántos días de anticipación se avisa un vencimiento'),
  ('plazo_planta_dias', '365', 'Plazo máximo de un residuo en planta (pregunta abierta a Serco)'),
  ('bloquear_generador', 'si', 'si: no deja emitir con la habilitación del generador vencida o sin cargar · no: solo avisa')
on conflict (clave) do nothing;

create or replace function parametro_int(p_clave text, p_defecto int) returns int
language sql stable as $$ select coalesce((select valor::int from parametros where clave = p_clave), p_defecto) $$;

-- ---------------------------------------------------------------------
-- 1. Qué impide emitir (devuelve la lista de problemas en castellano)
-- ---------------------------------------------------------------------
create or replace function vto_problema(p_doc text, p_vto date, p_fecha date) returns text
language sql immutable as $$
  select case
    when p_vto is null   then p_doc || ': sin cargar'
    when p_vto < p_fecha then p_doc || ': vencido el ' || to_char(p_vto, 'DD/MM/YYYY')
  end
$$;

create or replace function problemas_flota(p_transportista bigint, p_camion bigint, p_chofer bigint, p_fecha date)
returns text[] language plpgsql stable set search_path = public as $$
declare
  r record; p text[] := '{}';
begin
  if p_camion is null then p := p || 'Falta elegir el camión'::text;
  else
    select * into r from camiones where id = p_camion;
    if r.transportista_id <> p_transportista then p := p || ('El camión ' || r.patente || ' no es de este transportista'); end if;
    if not r.activo then p := p || ('El camión ' || r.patente || ' está dado de baja'); end if;
    p := p || array_remove(array[
      vto_problema('Camión ' || r.patente || ' · VTV', r.vtv_vto, p_fecha),
      vto_problema('Camión ' || r.patente || ' · carga peligrosa', r.carga_pel_vto, p_fecha),
      vto_problema('Camión ' || r.patente || ' · ruta', r.ruta_vto, p_fecha)], null);
  end if;

  if p_chofer is null then p := p || 'Falta elegir el chofer'::text;
  else
    select * into r from choferes where id = p_chofer;
    if r.transportista_id <> p_transportista then p := p || ('El chofer ' || r.nombre || ' no es de este transportista'); end if;
    if not r.activo then p := p || ('El chofer ' || r.nombre || ' está dado de baja'); end if;
    p := p || array_remove(array[
      vto_problema('Chofer ' || r.nombre || ' · carnet', r.carnet_vto, p_fecha),
      vto_problema('Chofer ' || r.nombre || ' · carga peligrosa', r.carga_pel_vto, p_fecha),
      vto_problema('Chofer ' || r.nombre || ' · psicofísico', r.sep_vto, p_fecha)], null);
  end if;

  select * into r from transportistas where id = p_transportista;
  if not r.activo then p := p || ('El transportista ' || r.nombre || ' está dado de baja'); end if;
  p := p || array_remove(array[vto_problema('Transportista ' || r.nombre || ' · habilitación provincial', r.hab_pro_vto, p_fecha)], null);
  return p;
end $$;

create or replace function problemas_generador(p_generador bigint, p_fecha date)
returns text[] language plpgsql stable set search_path = public as $$
declare g record; p text[] := '{}';
begin
  select * into g from generadores where id = p_generador;
  if not g.activo then p := p || ('El generador ' || g.nombre || ' está dado de baja'); end if;
  return p || array_remove(array[vto_problema('Generador ' || g.nombre || ' · habilitación municipal', g.hab_mun_vto, p_fecha)], null);
end $$;

-- La habilitación del generador bloquea o solo avisa según el parámetro "bloquear_generador"
-- (al arrancar, casi ningún generador activo la tiene cargada en el Access).
create or replace function problemas_manifiesto(p_transportista bigint, p_camion bigint, p_chofer bigint,
                                                p_generador bigint, p_fecha date)
returns text[] language plpgsql stable set search_path = public as $$
declare p text[];
begin
  p := problemas_flota(p_transportista, p_camion, p_chofer, p_fecha);
  if coalesce((select valor from parametros where clave = 'bloquear_generador'), 'si') = 'si' then
    p := p || problemas_generador(p_generador, p_fecha);
  end if;
  return p;
end $$;

create or replace function exigir_sin_problemas(p_problemas text[], p_omitida text) returns void
language plpgsql stable set search_path = public as $$
begin
  if coalesce(array_length(p_problemas, 1), 0) = 0 then return; end if;
  if p_omitida is not null and (mi_rol() = 'admin' or auth.uid() is null) then return; end if;
  raise exception using
    errcode = 'P0001',
    message = 'No se puede emitir: ' || array_to_string(p_problemas, ' · '),
    hint = 'Corregilo en Altas (vencimientos o corrientes habilitadas). Un administrador puede emitir igual indicando el motivo.';
end $$;

create or replace function validar_manifiesto() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.anulado then return new; end if;
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
create trigger manifiestos_validar before insert or update on manifiestos
  for each row execute function validar_manifiesto();

-- ---------------------------------------------------------------------
-- 2. Corrientes habilitadas
--    Se controla solo si la empresa tiene corrientes cargadas: si la lista está
--    vacía, la pantalla de Altas lo marca como pendiente de completar.
-- ---------------------------------------------------------------------
create or replace function corriente_no_habilitada(p_manifiesto bigint, p_corriente bigint) returns text
language plpgsql stable set search_path = public as $$
declare m record; cod text;
begin
  select * into m from manifiestos where id = p_manifiesto;
  select codigo into cod from corrientes where id = p_corriente;
  if exists (select 1 from transportista_corrientes where transportista_id = m.transportista_id)
     and not exists (select 1 from transportista_corrientes where transportista_id = m.transportista_id and corriente_id = p_corriente) then
    return 'El transportista no está habilitado para la corriente ' || cod;
  end if;
  if m.generador_principal_id is not null
     and exists (select 1 from planta_corrientes where generador_principal_id = m.generador_principal_id)
     and not exists (select 1 from planta_corrientes where generador_principal_id = m.generador_principal_id and corriente_id = p_corriente) then
    return 'La planta no está habilitada para recibir la corriente ' || cod;
  end if;
  return null;
end $$;

create or replace function validar_item() returns trigger
language plpgsql set search_path = public as $$
declare msg text; omit text;
begin
  if tg_op = 'UPDATE' and new.corriente_id = old.corriente_id then return new; end if;
  msg := corriente_no_habilitada(new.manifiesto_id, new.corriente_id);
  select validacion_omitida into omit from manifiestos where id = new.manifiesto_id;
  if msg is not null then perform exigir_sin_problemas(array[msg], omit); end if;
  return new;
end $$;
create trigger items_validar before insert or update on manifiesto_items
  for each row execute function validar_item();

-- ---------------------------------------------------------------------
-- 3. Numeración de formularios preimpresos
-- ---------------------------------------------------------------------
-- Siguiente número de la serie que viene usando el transportista (ej. 837007469 → 837007470)
create or replace function sugerir_numero(p_transportista bigint) returns text
language sql stable set search_path = public as $$
  with ultimo as (
    select numero from manifiestos
    where transportista_id = p_transportista and numero ~ '^\d{9}$'
    order by fecha desc, numero desc limit 1
  )
  select left(numero, 3) || lpad((substr(numero, 4)::int + 1)::text, 6, '0')
  from (select max(m.numero) as numero from manifiestos m, ultimo u
        where m.transportista_id = p_transportista and left(m.numero, 3) = left(u.numero, 3)) s
$$;

-- ---------------------------------------------------------------------
-- 4. Funciones para la app (respetan los permisos de cada usuario)
-- ---------------------------------------------------------------------
-- Emitir un manifiesto con sus residuos en un solo paso.
-- p: {numero, transportista_id, fecha, generador_id, generador_principal_id, direccion_retiro,
--     chofer_id, camion_id, nota, validacion_omitida,
--     items: [{corriente_id, contenedor, cant_estimada, cantidad, um}]}
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
                           chofer_id, camion_id, nota, validacion_omitida, creado_por)
  values (v_num, v_tr, case when v_emite then 'azul' else 'rosa' end::tipo_manifiesto,
          coalesce((p->>'fecha')::date, current_date), (p->>'generador_id')::bigint,
          (p->>'generador_principal_id')::bigint, p->>'direccion_retiro', (p->>'chofer_id')::bigint,
          (p->>'camion_id')::bigint, p->>'nota', p->>'validacion_omitida', auth.uid())
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

-- Armar un Manifiesto Nación con residuos almacenados (pasan a "en tránsito")
create or replace function armar_nacion(p_numero text, p_fecha date, p_transportista bigint, p_operador bigint,
                                        p_camion bigint, p_chofer bigint, p_items bigint[],
                                        p_validacion_omitida text default null) returns bigint
language plpgsql set search_path = public as $$
declare v_id bigint; v_gp bigint; n_gp int; malos text;
begin
  if not puede_editar() and auth.uid() is not null then raise exception 'Tu usuario no puede emitir Manifiestos Nación'; end if;
  if coalesce(array_length(p_items, 1), 0) = 0 then raise exception 'Elegí al menos un residuo'; end if;
  if exists (select 1 from manifiestos_nacion where numero = p_numero) then raise exception 'El Manifiesto Nación % ya existe', p_numero; end if;

  select string_agg(m.numero || ' ' || c.codigo, ', ') into malos
  from manifiesto_items i join manifiestos m on m.id = i.manifiesto_id join corrientes c on c.id = i.corriente_id
  where i.id = any(p_items) and (i.estado <> 'almacenado' or m.anulado);
  if malos is not null then raise exception 'Estos residuos no están almacenados: %', malos; end if;

  select count(distinct m.generador_principal_id), min(m.generador_principal_id) into n_gp, v_gp
  from manifiesto_items i join manifiestos m on m.id = i.manifiesto_id where i.id = any(p_items);
  if n_gp > 1 then raise exception 'Los residuos elegidos son de plantas distintas: armá un Manifiesto Nación por planta'; end if;

  if exists (select 1 from operador_corrientes where operador_id = p_operador) then
    select string_agg(distinct c.codigo, ', ') into malos
    from manifiesto_items i join corrientes c on c.id = i.corriente_id
    where i.id = any(p_items)
      and not exists (select 1 from operador_corrientes oc where oc.operador_id = p_operador and oc.corriente_id = i.corriente_id);
    if malos is not null then
      perform exigir_sin_problemas(array['El operador no está habilitado para: ' || malos], p_validacion_omitida);
    end if;
  end if;

  perform exigir_sin_problemas(problemas_flota(p_transportista, p_camion, p_chofer, p_fecha), p_validacion_omitida);

  insert into manifiestos_nacion (numero, fecha, transportista_id, generador_principal_id, operador_id, camion_id, chofer_id, validacion_omitida)
  values (p_numero, p_fecha, p_transportista, v_gp, p_operador, p_camion, p_chofer, p_validacion_omitida)
  returning id into v_id;

  update manifiesto_items set estado = 'en_transito', manifiesto_nacion_id = v_id where id = any(p_items);
  return v_id;
end $$;

-- Registrar el certificado de disposición final (los residuos pasan a "disposición final").
-- Queda pendiente de aviso al cliente (enviado_cliente vacío) para la función de mails.
create or replace function registrar_certificado(p_numero text, p_fecha date, p_nacion bigint, p_items bigint[],
                                                 p_archivo text default null, p_tipo_tratamiento text default null,
                                                 p_fecha_entrega date default null) returns bigint
language plpgsql set search_path = public as $$
declare v_id bigint; n record; malos text;
begin
  if not puede_editar() and auth.uid() is not null then raise exception 'Tu usuario no puede registrar certificados'; end if;
  select * into n from manifiestos_nacion where id = p_nacion;
  if n.id is null then raise exception 'No existe el Manifiesto Nación'; end if;
  if coalesce(array_length(p_items, 1), 0) = 0 then
    select array_agg(id) into p_items from manifiesto_items where manifiesto_nacion_id = p_nacion and estado = 'en_transito';
  end if;
  select string_agg(i.id::text, ', ') into malos from manifiesto_items i
  where i.id = any(p_items) and (i.manifiesto_nacion_id is distinct from p_nacion or i.estado <> 'en_transito');
  if malos is not null then raise exception 'Hay residuos que no están en tránsito con este Manifiesto Nación'; end if;
  if exists (select 1 from certificados where numero = p_numero and operador_id = n.operador_id and manifiesto_nacion_id = p_nacion) then
    raise exception 'El certificado % ya está registrado', p_numero;
  end if;

  insert into certificados (numero, manifiesto_nacion_id, fecha, operador_id, generador_principal_id, tipo_tratamiento, archivo,
                            kgs, lts)
  select p_numero, p_nacion, p_fecha, n.operador_id, n.generador_principal_id, p_tipo_tratamiento, p_archivo,
         nullif(sum(cantidad) filter (where um = 'KGS'), 0), nullif(sum(cantidad) filter (where um = 'LTS'), 0)
  from manifiesto_items where id = any(p_items)
  returning id into v_id;

  update manifiesto_items
  set estado = 'disposicion_final', certificado_id = v_id, fecha_entrega_df = coalesce(p_fecha_entrega, n.fecha)
  where id = any(p_items);
  return v_id;
end $$;

create or replace function anular_manifiesto(p_manifiesto bigint, p_motivo text) returns void
language plpgsql set search_path = public as $$
begin
  if not puede_editar() and auth.uid() is not null then raise exception 'Tu usuario no puede anular manifiestos'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la anulación'; end if;
  if exists (select 1 from manifiesto_items where manifiesto_id = p_manifiesto and estado <> 'almacenado') then
    raise exception 'No se puede anular: tiene residuos que ya salieron de planta';
  end if;
  update manifiestos set anulado = true, anulado_motivo = p_motivo where id = p_manifiesto;
end $$;

-- Formulario perdido o roto, sin manifiesto cargado: se registra como anulado para no dejar huecos.
create or replace function anular_formulario(p_transportista bigint, p_numero text, p_motivo text) returns bigint
language plpgsql set search_path = public as $$
declare v_id bigint;
begin
  if not puede_editar() and auth.uid() is not null then raise exception 'Tu usuario no puede anular formularios'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la anulación'; end if;
  insert into manifiestos (numero, transportista_id, fecha, anulado, anulado_motivo, creado_por)
  values (p_numero, p_transportista, current_date, true, p_motivo, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 5. Vistas para tablero, agenda y avisos
-- ---------------------------------------------------------------------
create view alertas_vencimiento with (security_invoker = true) as
  select v.*, v.vto - current_date as dias,
         case when v.vto is null then 'sin_cargar'
              when v.vto < current_date then 'vencido'
              when v.vto - current_date <= p.aviso then 'por_vencer'
              else 'vigente' end as estado
  from vencimientos v
  cross join (select parametro_int('dias_aviso_vencimiento', 45) as aviso) p
  -- de los generadores, solo los que tuvieron retiros en el último año (en el Access no se daban de baja)
  where v.tipo <> 'generador'
     or exists (select 1 from manifiestos m where m.generador_id = v.id and m.fecha > current_date - 365 and not m.anulado);

create view residuos_en_planta with (security_invoker = true) as
  with p as materialized (select parametro_int('plazo_planta_dias', 365) as plazo)
  select i.id, m.id as manifiesto_id, m.numero, m.fecha, current_date - m.fecha as dias_en_planta,
         p.plazo - (current_date - m.fecha) as dias_restantes,
         m.generador_principal_id, gp.nombre as planta, g.nombre as generador,
         c.id as corriente_id, c.codigo as corriente, c.grupo_incompat, i.contenedor, i.cantidad, i.um
  from manifiesto_items i
  join manifiestos m on m.id = i.manifiesto_id and not m.anulado
  join generadores g on g.id = m.generador_id
  join corrientes c on c.id = i.corriente_id
  left join generadores_principales gp on gp.id = m.generador_principal_id
  cross join p
  where i.estado = 'almacenado';

create view certificados_por_avisar with (security_invoker = true) as
  select c.id as certificado_id, c.numero, c.fecha, c.archivo, g.id as generador_id, g.nombre as generador, g.email
  from certificados c
  join manifiesto_items i on i.certificado_id = c.id
  join manifiestos m on m.id = i.manifiesto_id
  join generadores g on g.id = m.generador_id
  where c.enviado_cliente is null
  group by c.id, g.id;
