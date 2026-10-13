-- =====================================================================
-- SGRP 2.0 · Impresión del formulario azul y reportes
-- Se puede correr más de una vez sin problema.
-- =====================================================================

-- Textos fijos que se imprimen en el formulario (a confirmar con Serco)
insert into parametros (clave, valor, descripcion) values
  ('form_inhalacion', 'Baja', 'Formulario, sección 4: toxicidad por inhalación'),
  ('form_dermica', 'Baja', 'Formulario, sección 4: toxicidad dérmica'),
  ('form_oral', 'Baja', 'Formulario, sección 4: toxicidad oral'),
  ('form_instructivos', 'SI,SI,SI,SI,NO', 'Formulario, sección 5: manipulación, contingencia, rol de emergencia, hoja de ruta y rutas alternativas (SI = adjunta)')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------
-- Libro de movimientos: una fila por residuo, con todo lo que piden los
-- libros provincial y de transporte. Respeta los permisos de cada usuario.
-- ---------------------------------------------------------------------
create or replace view libro_movimientos with (security_invoker = true) as
  select i.id, m.id as manifiesto_id, m.numero, m.fecha, m.tipo,
         m.transportista_id, t.nombre as transportista,
         m.generador_principal_id, gp.nombre as planta,
         m.generador_id, g.nombre as generador, g.cuit as generador_cuit, m.direccion_retiro,
         ca.patente, ch.nombre as chofer,
         c.codigo as corriente, c.descripcion as corriente_descripcion,
         i.contenedor, i.cantidad, i.um, i.estado,
         mn.numero as nacion, mn.fecha as nacion_fecha,
         ce.numero as certificado, ce.fecha as certificado_fecha, i.fecha_entrega_df,
         o.nombre as operador
  from manifiesto_items i
  join manifiestos m on m.id = i.manifiesto_id and not m.anulado
  join generadores g on g.id = m.generador_id
  join transportistas t on t.id = m.transportista_id
  join corrientes c on c.id = i.corriente_id
  left join generadores_principales gp on gp.id = m.generador_principal_id
  left join camiones ca on ca.id = m.camion_id
  left join choferes ch on ch.id = m.chofer_id
  left join manifiestos_nacion mn on mn.id = i.manifiesto_nacion_id
  left join certificados ce on ce.id = i.certificado_id
  left join operadores o on o.id = coalesce(ce.operador_id, mn.operador_id);

-- Libro nacional: una fila por Manifiesto Nación, con sus residuos y certificados
create or replace view libro_nacional with (security_invoker = true) as
  select mn.id, mn.numero, mn.fecha, o.nombre as operador, t.nombre as transportista, gp.nombre as planta,
         mn.generador_principal_id,
         count(i.id) as residuos,
         string_agg(distinct c.codigo, ', ' order by c.codigo) as corrientes,
         sum(i.cantidad) filter (where i.um = 'KGS') as kgs,
         sum(i.cantidad) filter (where i.um = 'LTS') as lts,
         string_agg(distinct ce.numero, ', ' order by ce.numero) as certificados,
         max(ce.fecha) as certificado_fecha,
         bool_and(i.estado = 'disposicion_final') as cerrado
  from manifiestos_nacion mn
  left join manifiesto_items i on i.manifiesto_nacion_id = mn.id
  left join corrientes c on c.id = i.corriente_id
  left join certificados ce on ce.id = i.certificado_id
  left join operadores o on o.id = mn.operador_id
  left join transportistas t on t.id = mn.transportista_id
  left join generadores_principales gp on gp.id = mn.generador_principal_id
  group by mn.id, o.nombre, t.nombre, gp.nombre;

-- ---------------------------------------------------------------------
-- Cantidad transportada por producto: por corriente y período
-- p_agrupar: 'semana' | 'quincena' | 'mes'
-- ---------------------------------------------------------------------
create or replace function reporte_por_producto(p_desde date, p_hasta date, p_agrupar text default 'mes', p_planta bigint default null)
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
  group by 1, 2, 3, 4
  order by 1, 2
$$;

-- ---------------------------------------------------------------------
-- Estadísticas del período, en un solo pedido
-- ---------------------------------------------------------------------
create or replace function estadisticas(p_desde date, p_hasta date)
returns jsonb language sql stable set search_path = public as $$
  with base as (
    select i.*, m.fecha, m.generador_id, m.transportista_id, m.id as man_id
    from manifiesto_items i join manifiestos m on m.id = i.manifiesto_id and not m.anulado
    where m.fecha between p_desde and p_hasta
  )
  select jsonb_build_object(
    'manifiestos', (select count(distinct man_id) from base),
    'generadores', (select count(distinct generador_id) from base),
    'residuos', (select count(*) from base),
    'totales', (select coalesce(jsonb_object_agg(um, total), '{}') from (select um, sum(cantidad) total from base group by um) x),
    'por_estado', (select coalesce(jsonb_object_agg(estado, n), '{}') from (select estado, count(*) n from base group by estado) x),
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
    'por_mes', (select coalesce(jsonb_agg(x order by x.mes), '[]') from (
        select to_char(date_trunc('month', fecha), 'YYYY-MM') mes,
               sum(cantidad) filter (where um = 'KGS') kgs, sum(cantidad) filter (where um = 'LTS') lts
        from base group by 1) x)
  )
$$;

-- Permisos: igual que el resto (sin acceso anónimo)
revoke all on libro_movimientos, libro_nacional from anon;
revoke execute on function reporte_por_producto(date, date, text, bigint) from public, anon;
revoke execute on function estadisticas(date, date) from public, anon;
grant select on libro_movimientos, libro_nacional to authenticated;
grant execute on function reporte_por_producto(date, date, text, bigint), estadisticas(date, date) to authenticated;
