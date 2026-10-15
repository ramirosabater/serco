-- SGRP 2.0 · Actualización del 15/10/2026: todo en mayúsculas. Correr una vez en el SQL Editor.

-- SGRP 2.0 · Todo en mayúsculas.
-- Pasa a mayúsculas los nombres, direcciones, notas y demás textos de los datos migrados del
-- Access, y deja un trigger para que lo que se cargue desde ahora también quede en mayúsculas.
-- No se tocan: mails, CUIT, teléfonos, números de formulario, rutas de archivos ni parámetros.
-- Se puede correr más de una vez.

-- upper() + las vocales acentuadas y la ñ, por si la base no las convierte sola
create or replace function mayus(t text) returns text
language sql immutable parallel safe set search_path = public as $$
  select translate(upper(t), 'áéíóúüñàèìòù', 'ÁÉÍÓÚÜÑÀÈÌÒÙ')
$$;

-- Trigger genérico: pasa a mayúsculas las columnas que se le indican como argumentos
create or replace function trg_mayusculas() returns trigger
language plpgsql set search_path = public as $$
declare j jsonb := to_jsonb(new); c text;
begin
  foreach c in array tg_argv loop
    if j ? c and jsonb_typeof(j->c) = 'string' and j->>c <> mayus(j->>c) then
      j := jsonb_set(j, array[c], to_jsonb(mayus(j->>c)));
    end if;
  end loop;
  return jsonb_populate_record(new, j);
end $$;

do $$
declare
  r record; c text; sets text;
  cols jsonb := '{
    "actividades":             ["nombre"],
    "generadores":             ["nombre","actividad","direccion","ciudad","provincia","contacto_nombre","contacto_apellido","contacto_cargo","notas","modo_retiro","cod_iva","hab_mun_nro","hab_com_nro"],
    "generador_direcciones":   ["direccion","ciudad","provincia"],
    "generadores_principales": ["nombre","direccion","ciudad","provincia","hab_mun_nro","hab_pro_nro","hab_nac_nro"],
    "transportistas":          ["nombre","direccion","localidad","provincia","hab_mun_nro","hab_pro_nro","hab_nac_nro","ret_env_amb"],
    "operadores":              ["nombre","direccion","localidad","provincia","hab_mun_nro","hab_pro_nro","hab_nac_nro"],
    "camiones":                ["patente","tipo","carga_pel_nro"],
    "choferes":                ["nombre","carnet_nro"],
    "corrientes":              ["descripcion","estado_fisico"],
    "manifiestos":             ["direccion_retiro","nota","forma_transporte","anulado_motivo","validacion_omitida"],
    "manifiesto_items":        ["contenedor","descripcion_egreso"],
    "manifiestos_nacion":      ["validacion_omitida"],
    "certificados":            ["tipo_tratamiento"]
  }';
begin
  for r in select key t, value v from jsonb_each(cols) loop
    -- solo las columnas que existen en esta base
    select string_agg(format('%I = mayus(%I)', x, x), ', '), string_agg(format('%I <> mayus(%I)', x, x), ' or ')
      into sets, c
      from jsonb_array_elements_text(r.v) x
     where exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = r.t and column_name = x);
    if sets is null then continue; end if;

    -- Los datos de siempre: sin disparar el historial ni las validaciones (es solo el formato)
    execute format('alter table %I disable trigger user', r.t);
    execute format('update %I set %s where %s', r.t, sets, c);
    execute format('alter table %I enable trigger user', r.t);

    -- Lo que se cargue desde ahora
    execute format('drop trigger if exists aa_mayusculas on %I', r.t);
    execute format('create trigger aa_mayusculas before insert or update on %I for each row execute function trg_mayusculas(%s)',
                   r.t, (select string_agg(quote_literal(x), ', ') from jsonb_array_elements_text(r.v) x
                          where exists (select 1 from information_schema.columns
                                         where table_schema = 'public' and table_name = r.t and column_name = x)));
  end loop;
end $$;

revoke execute on function trg_mayusculas() from public, anon, authenticated;
