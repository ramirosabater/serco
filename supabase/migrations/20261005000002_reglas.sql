-- =====================================================================
-- SGRP 2.0 · Reglas e historial · aplicar DESPUÉS de cargar la historia
--
-- Las validaciones se crean "not valid": no revisan la historia migrada
-- (lo que no cumple ya está en migracion_inconsistencias), pero sí se
-- exigen en todo lo que se cargue desde ahora.
-- =====================================================================

-- Un residuo en tránsito tiene Manifiesto Nación; uno con certificado está en disposición final
alter table manifiesto_items add constraint items_transito_con_nacion
  check (estado <> 'en_transito' or manifiesto_nacion_id is not null) not valid;
alter table manifiesto_items add constraint items_disposicion_con_certificado
  check (estado <> 'disposicion_final' or certificado_id is not null) not valid;
alter table manifiesto_items add constraint items_certificado_en_disposicion
  check (certificado_id is null or estado = 'disposicion_final') not valid;
alter table manifiesto_items add constraint items_cantidad_positiva
  check (cantidad > 0) not valid;

-- Números de manifiesto de 9 dígitos y CUIT de 11
alter table manifiestos add constraint manifiestos_numero_formato
  check (numero ~ '^\d{9}$') not valid;
alter table generadores add constraint generadores_cuit_formato
  check (cuit is null or cuit ~ '^\d{11}$') not valid;

-- Los manifiestos azules nuevos llevan chofer y camión (no los anulados ni los rosas de otros transportistas)
alter table manifiestos add constraint manifiestos_con_flota
  check (anulado or tipo = 'rosa' or (chofer_id is not null and camion_id is not null)) not valid;

-- ---------------------------------------------------------------------
-- Historial de cambios: quién cambió qué y cuándo
-- ---------------------------------------------------------------------
create or replace function registrar_historial() returns trigger
language plpgsql security definer set search_path = public as $$
declare fila jsonb := to_jsonb(coalesce(new, old));
begin
  insert into historial (tabla, registro, accion, antes, despues, usuario)
  values (
    tg_table_name,
    coalesce(fila->>'id', fila::text),
    case tg_op when 'INSERT' then 'alta' when 'UPDATE' then 'cambio' else 'baja' end,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    auth.uid()
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['generadores_principales','generadores','generador_direcciones','transportistas',
                           'camiones','choferes','operadores','corrientes','planta_corrientes',
                           'transportista_corrientes','operador_corrientes','manifiestos',
                           'manifiestos_nacion','certificados','manifiesto_items','perfiles']
  loop
    execute format('create trigger %I after insert or update or delete on %I
                    for each row execute function registrar_historial()', t||'_historial', t);
  end loop;
end $$;

-- Fecha y usuario de modificación en manifiestos
create or replace function marcar_modificado() returns trigger
language plpgsql as $$
begin
  new.modificado := now();
  new.modificado_por := auth.uid();
  return new;
end $$;
create trigger manifiestos_modificado before update on manifiestos
  for each row execute function marcar_modificado();
