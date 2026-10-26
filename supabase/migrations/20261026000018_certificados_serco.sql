-- =====================================================================
-- Gestión Serco · Certificados de disposición final de Serco (RPGyOSP numerados)
--
-- Cuando vuelve el certificado del operador de disposición final, Serco le da a cada generador su propio
-- certificado: "CERTIFICADOS DE DISPOSICIÓN FINAL · RESIDUOS PELIGROSOS Nº 734 - 0004243", con Serco como
-- operador por almacenamiento, original y duplicado. En el Access era "IMPRIMÍ CDF RPG NUMERADOS".
--   - Uno por generador y por certificado del operador (así lo hacía el Access desde 2020).
--   - El número sale correlativo: el último está en Parámetros (proximo_cert_rp, que en el Access guardaba el
--     último usado) y nunca baja del más alto ya emitido.
--   - El 734 es el RPGyOSP de Serco (parámetro rpgyosp_serco).
--   - La fecha del pie ("Comodoro Rivadavia, mayo de 2026") es la fecha de listado del certificado del operador,
--     como en el Access: se completa al emitir si no estaba.
-- Los migrados del Access ya tienen su número en cada residuo (cert_rp_nro): se pueden volver a imprimir.
-- Se puede correr más de una vez.
-- =====================================================================

update parametros set descripcion = 'Último número de certificado RPGyOSP emitido por Serco (el próximo es este + 1)'
where clave = 'proximo_cert_rp';

create index if not exists manifiesto_items_cert_rp_idx on manifiesto_items(cert_rp_nro) where cert_rp_nro is not null;

-- Certificados ya emitidos: uno por número
create or replace view certificados_serco with (security_invoker = true) as
select i.cert_rp_nro as numero, max(i.rpg_nro) as rpg,
       min(m.generador_id) as generador_id, g.nombre as generador,
       min(i.certificado_id) as certificado_id, ce.numero as certificado, o.nombre as operador,
       coalesce(ce.fecha_listado, ce.fecha) as fecha,
       count(*) as residuos,
       sum(i.cantidad) filter (where i.um = 'KGS') as kgs, sum(i.cantidad) filter (where i.um = 'LTS') as lts
from manifiesto_items i
join manifiestos m on m.id = i.manifiesto_id
join generadores g on g.id = m.generador_id
left join certificados ce on ce.id = i.certificado_id
left join operadores o on o.id = ce.operador_id
where i.cert_rp_nro is not null
group by i.cert_rp_nro, g.nombre, ce.numero, ce.fecha_listado, ce.fecha, o.nombre;

-- Para emitir: residuos con certificado del operador y sin certificado de Serco, por generador y certificado.
-- Sin anulados ni formularios de viaje del Access (Serco no se certifica a sí misma).
create or replace view certificados_serco_pendientes with (security_invoker = true) as
select m.generador_id, g.nombre as generador, i.certificado_id, ce.numero as certificado, ce.fecha as certificado_fecha,
       o.nombre as operador, ce.tipo,
       count(*) as residuos, count(distinct m.id) as manifiestos,
       sum(i.cantidad) filter (where i.um = 'KGS') as kgs, sum(i.cantidad) filter (where i.um = 'LTS') as lts,
       string_agg(distinct c.codigo, ', ' order by c.codigo) as corrientes
from manifiesto_items i
join manifiestos m on m.id = i.manifiesto_id and not m.anulado and m.viaje_id is null
join generadores g on g.id = m.generador_id
join certificados ce on ce.id = i.certificado_id
left join operadores o on o.id = ce.operador_id
left join corrientes c on c.id = i.corriente_id
where i.cert_rp_nro is null
group by m.generador_id, g.nombre, i.certificado_id, ce.numero, ce.fecha, o.nombre, ce.tipo;

grant select on certificados_serco, certificados_serco_pendientes to authenticated;

-- Emitir el certificado de un generador para un certificado del operador. Si ya tenía número, devuelve ese
-- (y le suma los residuos que hubieran quedado sin número).
create or replace function emitir_certificado_serco(p_certificado bigint, p_generador bigint) returns integer
language plpgsql security definer set search_path = public as $$
declare v_num integer; v_rpg integer; v_ult integer;
begin
  if not puede_editar() then raise exception 'Tu usuario no puede emitir certificados'; end if;
  if not exists (select 1 from manifiesto_items i join manifiestos m on m.id = i.manifiesto_id
                 where i.certificado_id = p_certificado and m.generador_id = p_generador and not m.anulado and m.viaje_id is null) then
    raise exception 'Ese generador no tiene residuos en ese certificado';
  end if;

  select max(i.cert_rp_nro) into v_num from manifiesto_items i join manifiestos m on m.id = i.manifiesto_id
  where i.certificado_id = p_certificado and m.generador_id = p_generador;

  select nullif(regexp_replace(valor, '\D', '', 'g'), '')::integer into v_rpg from parametros where clave = 'rpgyosp_serco';
  if v_rpg is null then raise exception 'Falta cargar el RPGyOSP de Serco en Configuración → Parámetros (rpgyosp_serco)'; end if;

  if v_num is null then
    -- número correlativo: se bloquea el parámetro para que dos personas no saquen el mismo
    insert into parametros (clave, valor, descripcion)
    values ('proximo_cert_rp', '0', 'Último número de certificado RPGyOSP emitido por Serco (el próximo es este + 1)')
    on conflict (clave) do nothing;
    select coalesce(nullif(regexp_replace(valor, '\D', '', 'g'), '')::integer, 0) into v_ult
    from parametros where clave = 'proximo_cert_rp' for update;
    v_num := greatest(v_ult, coalesce((select max(cert_rp_nro) from manifiesto_items), 0)) + 1;
    update parametros set valor = v_num::text where clave = 'proximo_cert_rp';
  end if;

  update manifiesto_items i set cert_rp_nro = v_num, rpg_nro = v_rpg
  from manifiestos m
  where m.id = i.manifiesto_id and i.certificado_id = p_certificado and m.generador_id = p_generador
    and not m.anulado and m.viaje_id is null and i.cert_rp_nro is null;

  update certificados set fecha_listado = coalesce(fecha_listado, current_date) where id = p_certificado;
  return v_num;
end $$;
revoke all on function emitir_certificado_serco(bigint, bigint) from public, anon;
grant execute on function emitir_certificado_serco(bigint, bigint) to authenticated;

-- Todo lo que hace falta para imprimir un certificado
create or replace function certificado_serco(p_numero integer) returns jsonb
language sql stable security invoker set search_path = public as $$
  with it as (
    select i.*, m.numero as man_numero, m.fecha as man_fecha, m.generador_id, m.transportista_id
    from manifiesto_items i join manifiestos m on m.id = i.manifiesto_id
    where i.cert_rp_nro = p_numero
  ), cab as (
    select (select min(generador_id) from it) as generador_id, (select min(certificado_id) from it) as certificado_id
  )
  select case when not exists (select 1 from it) then null else jsonb_build_object(
    'numero', p_numero,
    'rpg', (select max(rpg_nro) from it),
    'generador', (select jsonb_build_object('nombre', g.nombre, 'cuit', g.cuit, 'direccion', g.direccion, 'ciudad', g.ciudad,
                   'provincia', g.provincia, 'hab_mun_nro', g.hab_mun_nro, 'email', g.email)
                  from generadores g, cab where g.id = cab.generador_id),
    'certificados', (select coalesce(jsonb_agg(jsonb_build_object(
          'numero', ce.numero, 'fecha', ce.fecha, 'fecha_listado', ce.fecha_listado, 'tipo_tratamiento', ce.tipo_tratamiento,
          'operador', jsonb_build_object('nombre', o.nombre, 'ubicacion', coalesce(o.ubicacion, o.localidad)),
          'planta', (select jsonb_build_object('nombre', gp.nombre, 'cuit', gp.cuit, 'direccion', gp.direccion, 'ciudad', gp.ciudad,
                       'provincia', gp.provincia, 'telefono', gp.telefono, 'email', gp.email, 'hab_pro_nro', gp.hab_pro_nro,
                       'hab_pro_vto', gp.hab_pro_vto, 'hab_nac_nro', gp.hab_nac_nro, 'hab_nac_vto', gp.hab_nac_vto,
                       'hab_mun_nro', gp.hab_mun_nro, 'hab_mun_vto', gp.hab_mun_vto)
                     from generadores_principales gp where gp.id = ce.generador_principal_id),
          'residuos', (select jsonb_agg(jsonb_build_object(
                'corriente', c.codigo, 'estado_fisico', c.estado_fisico, 'cantidad', x.cantidad, 'um', x.um,
                'manifiesto', x.man_numero, 'fecha', x.man_fecha, 'transportista', t.nombre, 'transportista_rpg', t.hab_pro_nro)
                order by x.man_fecha, x.man_numero, c.codigo)
              from it x left join corrientes c on c.id = x.corriente_id left join transportistas t on t.id = x.transportista_id
              where x.certificado_id is not distinct from ce.id))
          order by ce.fecha), '[]')
        from certificados ce left join operadores o on o.id = ce.operador_id
        where ce.id in (select certificado_id from it)),
    'serco', (select jsonb_object_agg(clave, valor) from parametros where clave in ('rpgyosp_serco'))
  ) end
$$;
grant execute on function certificado_serco(integer) to authenticated;
