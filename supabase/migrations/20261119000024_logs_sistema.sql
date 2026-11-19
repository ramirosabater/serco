-- =====================================================================
-- Gestión Serco · Logs del sistema (solo administradores)
--
-- Quién creó, cambió o borró qué y cuándo, a partir del historial que ya guarda la base en cada cambio.
-- Cada renglón dice qué es en castellano (manifiesto 837-0007498, cliente HOPEX SRL…), lleva a su pantalla
-- y trae solo los campos que cambiaron (antes → después). Lo que trae el Access (sin usuario) se puede ver aparte.
-- Se puede correr más de una vez.
-- =====================================================================
create index if not exists historial_fecha_idx on historial (fecha desc, id desc);
create index if not exists historial_usuario_idx on historial (usuario, id desc) where usuario is not null;

create or replace function logs_sistema(
  p_desde timestamptz, p_hasta timestamptz,
  p_usuario uuid default null, p_tabla text default null, p_accion text default null, p_texto text default null,
  p_con_sistema boolean default false, p_antes_de bigint default null, p_limite integer default 100)
returns table (id bigint, fecha timestamptz, usuario text, tabla text, accion text, registro text, que text, enlace text, cambios jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Los logs del sistema son solo para administradores'; end if;
  return query
  with h as (
    select x.* from historial x
    where x.fecha >= p_desde and x.fecha < p_hasta
      and (p_con_sistema or x.usuario is not null)
      and (p_usuario is null or x.usuario = p_usuario)
      and (p_tabla is null or x.tabla = p_tabla)
      and (p_accion is null or x.accion = p_accion)
      and (p_antes_de is null or x.id < p_antes_de)
      and (coalesce(trim(p_texto), '') = '' or coalesce(x.despues, x.antes)::text ilike '%' || trim(p_texto) || '%')
      -- un "cambio" que solo tocó la fecha de modificación no se muestra
      and not (x.accion = 'cambio' and not exists (select 1 from jsonb_each(x.despues) e(k, v)
               where x.antes -> k is distinct from v and k not in ('modificado', 'modificado_por')))
    order by x.id desc
    limit least(greatest(coalesce(p_limite, 100), 1), 500)
  )
  select h.id, h.fecha, coalesce(p.nombre, case when h.usuario is null then 'Sistema (Access)' else 'Usuario borrado' end),
    h.tabla, h.accion, h.registro,
    -- qué es, en castellano
    case h.tabla
      when 'manifiestos' then 'Manifiesto ' || fmt_numero(f.d->>'numero')
      when 'manifiesto_items' then 'Residuo ' || coalesce(c.codigo, '') || ' del manifiesto ' || coalesce(fmt_numero(m.numero), '(borrado)')
      when 'manifiestos_nacion' then 'Manifiesto Nación ' || fmt_numero(f.d->>'numero')
      when 'certificados' then 'Certificado del operador ' || coalesce(f.d->>'numero', '')
      when 'generadores' then 'Cliente ' || coalesce(f.d->>'nombre', '')
      when 'generador_direcciones' then 'Dirección de retiro ' || coalesce(f.d->>'direccion', '')
      when 'generadores_principales' then 'Planta ' || coalesce(f.d->>'nombre', '')
      when 'transportistas' then 'Transportista ' || coalesce(f.d->>'nombre', '')
      when 'camiones' then 'Camión ' || coalesce(f.d->>'patente', '')
      when 'choferes' then 'Chofer ' || coalesce(f.d->>'nombre', '')
      when 'operadores' then 'Operador ' || coalesce(f.d->>'nombre', '')
      when 'corrientes' then 'Corriente ' || coalesce(f.d->>'codigo', '')
      when 'perfiles' then 'Usuario ' || coalesce(f.d->>'nombre', '')
      when 'periodos_presentados' then 'Libro presentado del ' || to_char((f.d->>'desde')::date, 'DD/MM/YYYY') || ' al ' || to_char((f.d->>'hasta')::date, 'DD/MM/YYYY')
      when 'planta_corrientes' then 'Corriente habilitada en planta'
      when 'transportista_corrientes' then 'Corriente habilitada del transportista'
      when 'operador_corrientes' then 'Corriente habilitada del operador'
      else h.tabla
    end,
    -- adónde lleva
    case h.tabla
      when 'manifiestos' then '/manifiestos/' || h.registro
      when 'manifiesto_items' then case when m.id is not null then '/manifiestos/' || m.id end
      when 'manifiestos_nacion' then '/nacion/' || h.registro
      when 'certificados' then case when f.d->>'manifiesto_nacion_id' is not null then '/nacion/' || (f.d->>'manifiesto_nacion_id') end
      when 'generadores' then '/altas/generadores/' || h.registro
      when 'generador_direcciones' then '/altas/generadores/' || (f.d->>'generador_id')
      when 'generadores_principales' then '/altas/plantas/' || h.registro
      when 'transportistas' then '/altas/transportistas/' || h.registro
      when 'camiones' then '/altas/camiones/' || h.registro
      when 'choferes' then '/altas/choferes/' || h.registro
      when 'operadores' then '/altas/operadores/' || h.registro
      when 'corrientes' then '/altas/corrientes/' || h.registro
      when 'perfiles' then '/configuracion'
      when 'periodos_presentados' then '/reportes/provincial'
    end,
    -- qué cambió: { campo: [antes, después] } (en un alta o una baja, los datos que tenía)
    case h.accion
      when 'cambio' then (select jsonb_object_agg(k, jsonb_build_array(h.antes -> k, v)) from jsonb_each(h.despues) e(k, v)
                          where h.antes -> k is distinct from v and k not in ('modificado', 'modificado_por'))
      when 'alta' then (select jsonb_object_agg(k, jsonb_build_array(null, v)) from jsonb_each(h.despues) e(k, v)
                        where v <> 'null'::jsonb and k not in ('id', 'creado', 'creado_por', 'modificado', 'modificado_por'))
      else (select jsonb_object_agg(k, jsonb_build_array(v, null)) from jsonb_each(h.antes) e(k, v)
            where v <> 'null'::jsonb and k not in ('id', 'creado', 'creado_por', 'modificado', 'modificado_por'))
    end
  from h
  cross join lateral (select coalesce(h.despues, h.antes) as d) f
  left join perfiles p on p.id = h.usuario
  left join manifiestos m on h.tabla = 'manifiesto_items' and m.id = (f.d->>'manifiesto_id')::bigint
  left join corrientes c on h.tabla = 'manifiesto_items' and c.id = (f.d->>'corriente_id')::bigint
  order by h.id desc;
end $$;
revoke all on function logs_sistema(timestamptz, timestamptz, uuid, text, text, text, boolean, bigint, integer) from public, anon;
grant execute on function logs_sistema(timestamptz, timestamptz, uuid, text, text, text, boolean, bigint, integer) to authenticated;
