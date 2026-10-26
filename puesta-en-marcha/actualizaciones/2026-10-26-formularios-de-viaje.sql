-- =====================================================================
-- Formularios de viaje del Access: no contarlos dos veces
--
-- En el Access, cuando Serco armaba un viaje a disposición final, además del Manifiesto Nación cargaba
-- un manifiesto azul con el mismo número, a nombre de Serco, con una sola línea que resume lo que lleva.
-- Ese renglón ya está en los manifiestos de los clientes que van en el viaje: sumarlo es contar dos veces.
-- Acá esos manifiestos quedan marcados como "formulario del viaje" (viaje_id). No se borran: siguen con su
-- número, su PDF y el enlace desde el viaje, pero no cuentan como retiros en tablero, reportes ni avisos.
-- Los viajes que solo tienen ese renglón (sin manifiestos de clientes) no se marcan: ahí es el único dato.
-- En el sistema nuevo esto no vuelve a pasar: el viaje se imprime desde el Manifiesto Nación.
-- =====================================================================
alter table manifiestos add column if not exists viaje_id bigint references manifiestos_nacion(id) on delete set null;
comment on column manifiestos.viaje_id is 'Si está cargado, este manifiesto es el formulario del viaje (Manifiesto Nación) cargado en el Access como retiro: no cuenta en estadísticas.';
create index if not exists manifiestos_viaje_idx on manifiestos(viaje_id) where viaje_id is not null;

-- Control del número del formulario (corrige la actualización del viaje en el formulario azul)
create or replace function numero_formulario_libre() returns trigger
language plpgsql set search_path = public as $$
declare otro record;
begin
  -- Lo que viene del Access no se controla (ahí el viaje y su formulario azul comparten número).
  if new.numero is null or new.transportista_id is null or new.usuario_access is not null or new.creado_por is null then return new; end if;
  select 'el Manifiesto Nación (viaje) del ' || to_char(fecha, 'DD/MM/YYYY') as que into otro
  from manifiestos_nacion where numero = new.numero and transportista_id = new.transportista_id limit 1;
  if otro.que is not null then
    raise exception 'El formulario % ya se usó en %. Revisá el número del talonario.', fmt_numero(new.numero), otro.que;
  end if;
  return new;
end $$;
revoke execute on function numero_formulario_libre() from public, anon, authenticated;

-- Al emitir un retiro se controla que el número no sea el de un viaje. Al armar un viaje no se bloquea:
-- un viaje directo (del generador al operador, sin pasar por planta) lleva el número del manifiesto del retiro.
-- En ese caso la pantalla avisa para que se revise.
drop trigger if exists numero_libre on manifiestos;
create trigger numero_libre before insert on manifiestos for each row execute function numero_formulario_libre();
drop trigger if exists numero_libre on manifiestos_nacion;

-- CUIT de Serco (SERCO AMBIENTAL SA y la anterior SERCO SRL)
create or replace function marcar_formularios_viaje() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update manifiestos m set viaje_id = mn.id
  from generadores g, manifiestos_nacion mn
  where g.id = m.generador_id and g.cuit in ('30710247605', '30657359943')
    and mn.numero = m.numero and mn.transportista_id = m.transportista_id
    and m.viaje_id is null
    and exists (select 1 from manifiesto_items o where o.manifiesto_nacion_id = mn.id and o.manifiesto_id <> m.id);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function marcar_formularios_viaje() from public, anon, authenticated;
select marcar_formularios_viaje() as "formularios de viaje marcados";


-- tablero_resumen: sin los formularios de viaje (1)
CREATE OR REPLACE FUNCTION public.tablero_resumen(p_desde date, p_hasta date, p_planta bigint DEFAULT NULL::bigint, p_transportista bigint DEFAULT NULL::bigint, p_generador bigint DEFAULT NULL::bigint, p_tipo text DEFAULT NULL::text, p_etapa integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with filtro as (           -- todos los filtros menos período y etapa
    select m.id, m.fecha, m.generador_id, coalesce(e.etapa, 0) as etapa
    from manifiestos m left join manifiesto_etapas e on e.manifiesto_id = m.id
    where not m.anulado and m.viaje_id is null
      and (p_planta is null or m.generador_principal_id = p_planta)
      and (p_transportista is null or m.transportista_id = p_transportista)
      and (p_generador is null or m.generador_id = p_generador)
      and (p_tipo is null or m.tipo::text = p_tipo)
  ), periodo as (            -- el gráfico de etapas muestra todas las etapas del período
    select * from filtro where fecha between p_desde and p_hasta
  ), elegidos as (           -- los números de arriba respetan también la etapa elegida
    select * from periodo where p_etapa is null or etapa = p_etapa
  ), meses as (
    select generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month')::date mes
  ), vol as (
    select date_trunc('month', f.fecha)::date mes,
           sum(i.cantidad) filter (where i.um = 'KGS') kgs, sum(i.cantidad) filter (where i.um = 'LTS') lts
    from filtro f join manifiesto_items i on i.manifiesto_id = f.id
    where f.fecha >= date_trunc('month', current_date) - interval '11 months' and (p_etapa is null or f.etapa = p_etapa)
    group by 1
  ), activos as (
    select distinct generador_id from filtro where fecha >= current_date - 365
  ), regularizar as (
    select a.id, a.nombre, a.documento, a.vto, a.estado
    from alertas_vencimiento a join activos x on x.generador_id = a.id
    where a.tipo = 'generador' and a.estado in ('vencido', 'por_vencer', 'sin_cargar')
  )
  select jsonb_build_object(
    'etapas', (select jsonb_build_array(count(*) filter (where etapa = 0), count(*) filter (where etapa = 1), count(*) filter (where etapa = 2),
                                        count(*) filter (where etapa = 3), count(*) filter (where etapa = 4)) from periodo),
    'total', (select count(*) from elegidos),
    'meses', (select jsonb_agg(jsonb_build_object('mes', to_char(me.mes, 'YYYY-MM'), 'kgs', coalesce(v.kgs, 0), 'lts', coalesce(v.lts, 0)) order by me.mes)
              from meses me left join vol v on v.mes = me.mes),
    'regularizar', (select coalesce(jsonb_agg(r order by case r.estado when 'vencido' then 0 when 'por_vencer' then 1 else 2 end, r.vto desc nulls last), '[]')
                    from (select * from regularizar order by case estado when 'vencido' then 0 when 'por_vencer' then 1 else 2 end, vto desc nulls last limit 12) r),
    'kgs', (select coalesce(sum(i.cantidad), 0) from elegidos x join manifiesto_items i on i.manifiesto_id = x.id where i.um = 'KGS'),
    'lts', (select coalesce(sum(i.cantidad), 0) from elegidos x join manifiesto_items i on i.manifiesto_id = x.id where i.um = 'LTS'),
    'generadores', (select count(distinct generador_id) from elegidos),
    'regularizar_total', (select jsonb_build_object('vencido', count(distinct id) filter (where estado = 'vencido'),
                                                    'por_vencer', count(distinct id) filter (where estado = 'por_vencer'),
                                                    'sin_cargar', count(distinct id) filter (where estado = 'sin_cargar')) from regularizar)
  )
$function$;

-- estadisticas: sin los formularios de viaje (1)
CREATE OR REPLACE FUNCTION public.estadisticas(p_desde date, p_hasta date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with base as (
    select i.*, m.fecha, m.generador_id, m.transportista_id, m.generador_principal_id, m.id as man_id
    from manifiesto_items i join manifiestos m on m.id = i.manifiesto_id and not m.anulado and m.viaje_id is null
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
$function$;

-- reporte_por_producto: sin los formularios de viaje (1)
CREATE OR REPLACE FUNCTION public.reporte_por_producto(p_desde date, p_hasta date, p_agrupar text DEFAULT 'mes'::text, p_planta bigint DEFAULT NULL::bigint, p_transportista bigint DEFAULT NULL::bigint)
 RETURNS TABLE(periodo date, corriente text, descripcion text, um unidad_medida, cantidad numeric, residuos bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select case p_agrupar
           when 'semana' then date_trunc('week', m.fecha)::date
           when 'quincena' then (date_trunc('month', m.fecha) + case when extract(day from m.fecha) > 15 then interval '15 days' else interval '0' end)::date
           else date_trunc('month', m.fecha)::date
         end as periodo,
         c.codigo, c.descripcion, i.um, sum(i.cantidad), count(*)
  from manifiesto_items i
  join manifiestos m on m.id = i.manifiesto_id and not m.anulado and m.viaje_id is null
  join corrientes c on c.id = i.corriente_id
  where m.fecha between p_desde and p_hasta
    and (p_planta is null or m.generador_principal_id = p_planta)
    and (p_transportista is null or m.transportista_id = p_transportista)
  group by 1, 2, 3, 4
  order by 1, 2
$function$;

-- generador_resumen: sin los formularios de viaje (1)
CREATE OR REPLACE FUNCTION public.generador_resumen(p_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with base as (
    select m.id, m.fecha, i.cantidad, i.um, i.corriente_id
    from manifiestos m join manifiesto_items i on i.manifiesto_id = m.id
    where m.generador_id = p_id and not m.anulado and m.viaje_id is null
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
$function$;

-- como_siempre: sin los formularios de viaje (1)
CREATE OR REPLACE FUNCTION public.como_siempre(p_generador bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with u as (
    select m.* from manifiestos m
    where m.generador_id = p_generador and not m.anulado and m.viaje_id is null and m.fecha >= current_date - interval '6 months'),
  n as (select count(*) as n from u),
  dir as (select direccion_retiro as v, count(*) as k from u where direccion_retiro is not null group by 1 order by 2 desc limit 1),
  tr as (select transportista_id as v, count(*) as k from u group by 1 order by 2 desc limit 1),
  ch as (select chofer_id as v, count(*) as k from u, tr where u.transportista_id = tr.v and chofer_id is not null group by 1 order by 2 desc limit 1),
  ca as (select camion_id as v, count(*) as k from u, tr where u.transportista_id = tr.v and camion_id is not null group by 1 order by 2 desc limit 1)
  select case when n.n < 3 then null else jsonb_strip_nulls(jsonb_build_object(
    'retiros', n.n,
    'direccion', (select v from dir where k >= 0.6 * n.n),
    'transportista_id', (select v from tr where k >= 0.6 * n.n),
    'chofer_id', (select ch.v from ch, tr where ch.k >= 0.6 * n.n and tr.k >= 0.6 * n.n),
    'chofer', (select h.nombre from ch join choferes h on h.id = ch.v, tr where ch.k >= 0.6 * n.n and tr.k >= 0.6 * n.n and h.activo),
    'camion_id', (select ca.v from ca, tr where ca.k >= 0.6 * n.n and tr.k >= 0.6 * n.n),
    'patente', (select c.patente from ca join camiones c on c.id = ca.v, tr where ca.k >= 0.6 * n.n and tr.k >= 0.6 * n.n and c.activo))) end
  from n
$function$;

-- sugerencias_ayudante: sin los formularios de viaje (4)
CREATE OR REPLACE FUNCTION public.sugerencias_ayudante(p_area text)
 RETURNS TABLE(tema text, titulo text, texto text, boton text, ir text, foco text, prioridad integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  n int; r record;
  f text := 'DD/MM/YYYY';
begin
  if not es_interno() then return; end if;

  -- Certificados que subieron los choferes y esperan que alguien los mire
  if p_area in ('tablero', 'altas') then
    select count(*) into n from pedidos_documento where estado = 'subido';
    if n > 0 then
      return query select 'pedidos-subidos'::text, 'Certificados para revisar'::text,
        format('%s %s el certificado nuevo desde el enlace del mail. Revisalo y aceptalo para que pase a la ficha.',
               n, case when n = 1 then 'chofer subió' else 'choferes subieron' end),
        'Revisarlos'::text, '/vencimientos'::text, 'venc-revisar'::text, 1;
    end if;
  end if;

  -- Vencimientos de la flota y los transportistas en los próximos 15 días
  if p_area in ('tablero', 'altas') then
    select count(*) into n from alertas_vencimiento a
      where a.tipo in ('camion', 'chofer', 'transportista') and a.estado = 'por_vencer' and a.dias <= 15;
    if n > 0 then
      select a.documento, a.nombre, a.vto into r from alertas_vencimiento a
        where a.tipo in ('camion', 'chofer', 'transportista') and a.estado = 'por_vencer' and a.dias <= 15 order by a.vto, a.nombre limit 1;
      return query select 'vencimientos-15'::text, 'Vencimientos cerca'::text,
        format('%s %s en los próximos 15 días. El primero: %s de %s, el %s.', n,
               case when n = 1 then 'documento vence' else 'documentos vencen' end, r.documento, r.nombre, to_char(r.vto, f)),
        'Verlos'::text, '/vencimientos'::text, 'venc-tabla'::text, 2;
    end if;
  end if;

  -- Choferes con documentos por vencer a los que todavía no se les pidió el certificado
  if p_area in ('tablero', 'altas') and puede_editar() then
    select count(distinct c.chofer_id) into n from choferes_para_pedir(null) c;
    if n > 0 then
      return query select 'pedir-certificados'::text, 'Pedir certificados'::text,
        format('%s documentos por vencer y todavía no %s el certificado nuevo. Se puede pedir por mail con un enlace para subirlo desde el celular.',
               case when n = 1 then '1 chofer tiene' else n || ' choferes tienen' end, case when n = 1 then 'se le pidió' else 'se les pidió' end),
        'Ver el botón'::text, '/vencimientos'::text, 'venc-pedir'::text, 3;
    end if;
  end if;

  -- Residuos cerca del plazo máximo en planta
  if p_area in ('tablero', 'planta') then
    select count(*) into n from residuos_en_planta e where e.dias_restantes between -30 and 30;   -- lo de hace años es otro tema (datos del Access)
    if n > 0 then
      select e.corriente, e.generador, e.dias_restantes into r from residuos_en_planta e where e.dias_restantes between -30 and 30 order by e.dias_restantes limit 1;
      return query select 'plazo-planta'::text, 'Plazo en planta'::text,
        format('%s %s cerca del plazo en planta (o lo pasaron hace poco). El más apurado: %s de %s, %s. Conviene armar una carga.',
               n, case when n = 1 then 'residuo está' else 'residuos están' end, r.corriente, r.generador,
               case when r.dias_restantes < 0 then format('pasado hace %s días', -r.dias_restantes)
                    when r.dias_restantes = 0 then 'vence hoy' else format('le quedan %s días', r.dias_restantes) end),
        'Armar carga'::text, '/planta'::text, 'pl-tab-plan'::text, 2;
    end if;
  end if;

  -- Manifiestos que siguen Iniciados (falta la sección 3) hace más de 3 días
  if p_area in ('tablero', 'manifiestos', 'planta') then
    select count(*) into n from manifiestos m join manifiesto_etapas e on e.manifiesto_id = m.id
      where e.etapa = 0 and not m.anulado and m.viaje_id is null and m.fecha < current_date - 3 and m.fecha >= current_date - 120;
    if n > 0 then
      select min(m.fecha) as fecha into r from manifiestos m join manifiesto_etapas e on e.manifiesto_id = m.id
        where e.etapa = 0 and not m.anulado and m.viaje_id is null and m.fecha < current_date - 3 and m.fecha >= current_date - 120;
      return query select 'iniciados-viejos'::text, 'Falta la sección 3'::text,
        format('%s %s Iniciado hace más de 3 días (el más viejo es del %s): falta cargar lo que entró a planta.',
               n, case when n = 1 then 'manifiesto sigue en' else 'manifiestos siguen en' end, to_char(r.fecha, f)),
        'Ir a cargarlos'::text, '/planta?v=ingresar'::text, 'pl-ingresar'::text, 3;
    end if;
  end if;

  -- Viajes a disposición final que esperan el certificado hace mucho
  if p_area in ('tablero', 'planta') then
    select count(*) into n from manifiestos_nacion mn
      where mn.fecha < current_date - parametro_int('dias_espera_certificado', 45) and mn.fecha >= current_date - 365
        and exists (select 1 from manifiesto_items i where i.manifiesto_nacion_id = mn.id and i.estado = 'en_transito');
    if n > 0 then
      return query select 'viajes-sin-certificado'::text, 'Certificados que no llegan'::text,
        format('%s %s más de %s días esperando el certificado de disposición final. Puede que haya llegado y falte registrarlo, o que haya que reclamarlo al operador.',
               n, case when n = 1 then 'viaje lleva' else 'viajes llevan' end, parametro_int('dias_espera_certificado', 45)),
        'Verlos'::text, '/planta?v=transito'::text, 'pl-tab-transito'::text, 4;
    end if;
  end if;

  -- Algo que falta: generadores con retiro casi todos los meses que este mes todavía no tuvieron
  if p_area in ('tablero', 'manifiestos') and extract(day from current_date) >= 5 then
    for r in
      with hist as (
        select m.generador_id, count(distinct date_trunc('month', m.fecha)) as meses,
               percentile_disc(0.5) within group (order by extract(day from m.fecha)::int) as dia
        from manifiestos m
        where not m.anulado and m.viaje_id is null and m.fecha >= (date_trunc('month', current_date) - interval '6 months')::date
          and m.fecha < date_trunc('month', current_date)::date
        group by m.generador_id
        having count(distinct date_trunc('month', m.fecha)) >= 5)
      select h.generador_id, g.nombre, h.meses, h.dia from hist h join generadores g on g.id = h.generador_id
      where g.activo and extract(day from current_date) >= h.dia + 5
        and not exists (select 1 from manifiestos m where m.generador_id = h.generador_id and not m.anulado and m.viaje_id is null
                          and m.fecha >= date_trunc('month', current_date)::date)
      order by h.meses desc, h.dia limit 3
    loop
      return query select 'falta-retiro:' || r.generador_id, 'Algo que falta'::text,
        format('%s tuvo retiro en %s de los últimos 6 meses, casi siempre alrededor del día %s, y este mes todavía no. ¿Preparamos el manifiesto?',
               r.nombre, r.meses, r.dia),
        'Nuevo manifiesto'::text, '/manifiestos/nuevo?generador=' || r.generador_id, 'nm-generador'::text, 5;
    end loop;
  end if;
end $function$;

-- Libro nacional: los kilos y litros de cada viaje sin el renglón del formulario del viaje (si no, se suma dos veces)
create or replace view libro_nacional with (security_invoker = true) as
SELECT mn.id, mn.numero, mn.fecha, o.nombre AS operador, t.nombre AS transportista, gp.nombre AS planta, mn.generador_principal_id,
    count(i.id) AS residuos,
    string_agg(DISTINCT c.codigo, ', '::text ORDER BY c.codigo) AS corrientes,
    sum(i.cantidad) FILTER (WHERE i.um = 'KGS'::unidad_medida) AS kgs,
    sum(i.cantidad) FILTER (WHERE i.um = 'LTS'::unidad_medida) AS lts,
    string_agg(DISTINCT ce.numero, ', '::text ORDER BY ce.numero) AS certificados,
    max(ce.fecha) AS certificado_fecha,
    bool_and(i.estado = 'disposicion_final'::estado_residuo) AS cerrado
FROM manifiestos_nacion mn
  LEFT JOIN manifiesto_items i ON i.manifiesto_nacion_id = mn.id
       AND NOT EXISTS (SELECT 1 FROM manifiestos fv WHERE fv.id = i.manifiesto_id AND fv.viaje_id = mn.id)
  LEFT JOIN corrientes c ON c.id = i.corriente_id
  LEFT JOIN certificados ce ON ce.id = i.certificado_id
  LEFT JOIN operadores o ON o.id = mn.operador_id
  LEFT JOIN transportistas t ON t.id = mn.transportista_id
  LEFT JOIN generadores_principales gp ON gp.id = mn.generador_principal_id
GROUP BY mn.id, o.nombre, t.nombre, gp.nombre;

-- Libros provincial y de transporte: el formulario del viaje sigue (el Access también lo listaba: es un formulario
-- usado del talonario), pero marcado para que se vea qué es.
create or replace view libro_movimientos with (security_invoker = true) as
SELECT i.id,
    m.id AS manifiesto_id,
    m.numero,
    m.fecha,
    m.tipo,
    m.transportista_id,
    t.nombre AS transportista,
    m.generador_principal_id,
    gp.nombre AS planta,
    m.generador_id,
    g.nombre AS generador,
    g.cuit AS generador_cuit,
    m.direccion_retiro,
    ca.patente,
    ch.nombre AS chofer,
    c.codigo AS corriente,
    c.descripcion AS corriente_descripcion,
    i.contenedor,
    i.cantidad,
    i.um,
    i.estado,
    mn.numero AS nacion,
    mn.fecha AS nacion_fecha,
    ce.numero AS certificado,
    ce.fecha AS certificado_fecha,
    i.fecha_entrega_df,
    o.nombre AS operador,
    m.viaje_id IS NOT NULL AS formulario_viaje
   FROM ((((((((((manifiesto_items i
     JOIN manifiestos m ON (((m.id = i.manifiesto_id) AND (NOT m.anulado))))
     JOIN generadores g ON ((g.id = m.generador_id)))
     JOIN transportistas t ON ((t.id = m.transportista_id)))
     JOIN corrientes c ON ((c.id = i.corriente_id)))
     LEFT JOIN generadores_principales gp ON ((gp.id = m.generador_principal_id)))
     LEFT JOIN camiones ca ON ((ca.id = m.camion_id)))
     LEFT JOIN choferes ch ON ((ch.id = m.chofer_id)))
     LEFT JOIN manifiestos_nacion mn ON ((mn.id = i.manifiesto_nacion_id)))
     LEFT JOIN certificados ce ON ((ce.id = i.certificado_id)))
     LEFT JOIN operadores o ON ((o.id = COALESCE(ce.operador_id, mn.operador_id))));

grant select on libro_movimientos, libro_nacional to authenticated;
