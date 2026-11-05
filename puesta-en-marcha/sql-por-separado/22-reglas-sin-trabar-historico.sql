-- =====================================================================
-- Gestión Serco · Las reglas de datos no traban lo histórico del Access
--
-- Algunas reglas (manifiesto azul con chofer y camión, residuo en tránsito con Manifiesto Nación, etc.) se agregaron
-- para los datos nuevos. Como restricciones de la tabla, Postgres las vuelve a controlar en CUALQUIER cambio de la fila:
-- un manifiesto de 2016 sin chofer no dejaba ni anotarle el escaneo subido al Drive.
-- Ahora las controla un trigger: siempre al crear, y al modificar solo si cambia el dato que la regla mira.
-- Las reglas para lo nuevo son las mismas. Lo que trae el Access (novedades y migración, sin usuario del sistema)
-- no se controla: hasta la puesta en producción el Access manda. Se puede correr más de una vez.
-- =====================================================================
alter table manifiestos drop constraint if exists manifiestos_con_flota;
alter table manifiestos drop constraint if exists manifiestos_generador_salvo_anulado;
alter table manifiestos drop constraint if exists manifiestos_numero_formato;
alter table manifiesto_items drop constraint if exists items_transito_con_nacion;
alter table manifiesto_items drop constraint if exists items_disposicion_con_certificado;
alter table manifiesto_items drop constraint if exists items_certificado_en_disposicion;
alter table manifiesto_items drop constraint if exists items_cantidad_positiva;
alter table generadores drop constraint if exists generadores_cuit_formato;

create or replace function reglas_manifiesto() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- migración y novedades del Access
  if tg_op = 'INSERT' or (new.numero is distinct from old.numero) then
    if new.numero !~ '^\d{9}$' then raise exception 'El número del manifiesto tiene que tener 9 dígitos'; end if;
  end if;
  if tg_op = 'INSERT' or (new.anulado, new.tipo, new.chofer_id, new.camion_id) is distinct from (old.anulado, old.tipo, old.chofer_id, old.camion_id) then
    if not (new.anulado or new.tipo = 'rosa' or (new.chofer_id is not null and new.camion_id is not null)) then
      raise exception 'Un manifiesto azul necesita chofer y camión';
    end if;
  end if;
  if tg_op = 'INSERT' or (new.anulado, new.generador_id) is distinct from (old.anulado, old.generador_id) then
    if not (new.anulado or new.generador_id is not null) then raise exception 'Falta el generador'; end if;
  end if;
  return new;
end $$;
drop trigger if exists reglas on manifiestos;
create trigger reglas before insert or update on manifiestos for each row execute function reglas_manifiesto();

create or replace function reglas_item() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- migración y novedades del Access
  if tg_op = 'INSERT' or (new.estado, new.manifiesto_nacion_id, new.certificado_id) is distinct from (old.estado, old.manifiesto_nacion_id, old.certificado_id) then
    if new.estado = 'en_transito' and new.manifiesto_nacion_id is null then raise exception 'Un residuo en tránsito tiene que estar en un Manifiesto Nación'; end if;
    if new.estado = 'disposicion_final' and new.certificado_id is null then raise exception 'Un residuo dispuesto tiene que tener certificado'; end if;
    if new.certificado_id is not null and new.estado <> 'disposicion_final' then raise exception 'Un residuo con certificado tiene que estar dispuesto'; end if;
  end if;
  if tg_op = 'INSERT' or new.cantidad is distinct from old.cantidad then
    if not (new.cantidad > 0) then raise exception 'La cantidad tiene que ser mayor a cero'; end if;
  end if;
  return new;
end $$;
drop trigger if exists reglas on manifiesto_items;
create trigger reglas before insert or update on manifiesto_items for each row execute function reglas_item();

create or replace function reglas_generador() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- migración y novedades del Access
  if (tg_op = 'INSERT' or new.cuit is distinct from old.cuit) and new.cuit is not null and new.cuit !~ '^\d{11}$' then
    raise exception 'El CUIT tiene que tener 11 dígitos';
  end if;
  return new;
end $$;
drop trigger if exists reglas on generadores;
create trigger reglas before insert or update on generadores for each row execute function reglas_generador();
