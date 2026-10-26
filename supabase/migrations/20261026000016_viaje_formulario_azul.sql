-- =====================================================================
-- Gestión Serco · El viaje a disposición final (Manifiesto Nación) va en el MISMO formulario azul
-- que los retiros, con el número siguiente del talonario.
--   - El número sugerido mira los retiros y los viajes del mismo transportista.
--   - Un número del talonario no se puede usar dos veces (en un retiro y en un viaje).
--     Las migraciones del Access no pasan por este control (ahí el viaje también figura como retiro).
-- Se puede correr más de una vez.
-- =====================================================================
create or replace function sugerir_numero(p_transportista bigint) returns text
language sql stable set search_path = public as $$
  with usados as (
    select numero, fecha from manifiestos where transportista_id = p_transportista and numero ~ '^\d{9}$'
    union all
    select numero, fecha from manifiestos_nacion where transportista_id = p_transportista and numero ~ '^\d{9}$'
  ), ultimo as (select numero from usados order by fecha desc, numero desc limit 1)
  select left(numero, 3) || lpad((substr(numero, 4)::int + 1)::text, 6, '0')
  from (select max(u.numero) as numero from usados u, ultimo l where left(u.numero, 3) = left(l.numero, 3)) s
$$;

create or replace function numero_formulario_libre() returns trigger
language plpgsql set search_path = public as $$
declare otro record;
begin
  if new.numero is null or new.transportista_id is null then return new; end if;
  if tg_table_name = 'manifiestos' then
    select 'el Manifiesto Nación (viaje) del ' || to_char(fecha, 'DD/MM/YYYY') as que into otro
    from manifiestos_nacion where numero = new.numero and transportista_id = new.transportista_id limit 1;
  else
    select 'el manifiesto de retiro del ' || to_char(fecha, 'DD/MM/YYYY') as que into otro
    from manifiestos where numero = new.numero and transportista_id = new.transportista_id limit 1;
  end if;
  if otro.que is not null then
    raise exception 'El formulario % ya se usó en %. Revisá el número del talonario.', fmt_numero(new.numero), otro.que;
  end if;
  return new;
end $$;
revoke execute on function numero_formulario_libre() from public, anon, authenticated;

drop trigger if exists numero_libre on manifiestos;
create trigger numero_libre before insert on manifiestos for each row execute function numero_formulario_libre();
drop trigger if exists numero_libre on manifiestos_nacion;
create trigger numero_libre before insert on manifiestos_nacion for each row execute function numero_formulario_libre();

grant execute on function sugerir_numero(bigint) to authenticated;
