-- =====================================================================
-- SGRP 2.0 · Sugerencias de Tito y pedido de certificados a los choferes
--   1. ayudante_memoria: qué sugerencias pospuso o no quiere ver cada usuario.
--   2. Reglas de sugerencias (sin inteligencia artificial: consultas fijas, solo lectura).
--   3. pedidos_documento: enlace único que se manda por mail al chofer (o a su transportista)
--      para que suba el certificado nuevo. Lo que sube queda para que alguien de Serco lo acepte.
-- Se puede correr más de una vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Memoria del ayudante (cada usuario ve y cambia solo lo suyo)
-- ---------------------------------------------------------------------
create table if not exists ayudante_memoria (
  usuario     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tema        text not null,
  estado      text not null check (estado in ('nunca', 'pospuesta', 'aceptada')),
  hasta       timestamptz,                    -- hasta cuándo no se vuelve a sugerir (pospuesta / aceptada)
  actualizado timestamptz not null default now(),
  primary key (usuario, tema)
);
alter table ayudante_memoria enable row level security;
drop policy if exists ayudante_memoria_propia on ayudante_memoria;
create policy ayudante_memoria_propia on ayudante_memoria for all
  using (usuario = (select auth.uid())) with check (usuario = (select auth.uid()));
revoke all on ayudante_memoria from anon;
grant select, insert, update, delete on ayudante_memoria to authenticated;

insert into parametros (clave, valor, descripcion) values
  ('dias_espera_certificado', '45', 'Días de espera del certificado de disposición final antes de que el ayudante lo marque'),
  ('dias_pedido_certificado', '30', 'Con cuántos días de anticipación se le pide al chofer el certificado nuevo'),
  ('pedir_certificados_auto', 'no', 'si: la tarea diaria manda sola los pedidos de certificado a los choferes · no: solo con el botón')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------
-- 3. Pedidos de certificado a los choferes (antes de las reglas, que los usan)
-- ---------------------------------------------------------------------
alter table choferes add column if not exists email text;

create table if not exists pedidos_documento (
  id            bigint generated always as identity primary key,
  chofer_id     bigint not null references choferes(id) on delete cascade,
  documento     text not null check (documento in ('carnet', 'carga_pel', 'sep')),
  -- 64 caracteres al azar: es la única llave del enlace
  token         text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  vence         timestamptz not null default now() + interval '20 days',
  estado        text not null default 'pendiente'
                check (estado in ('pendiente', 'enviado', 'sin_mail', 'subido', 'aceptado', 'rechazado', 'cancelado')),
  enviado_a     text,
  enviado       timestamptz,
  pedido_por    uuid default auth.uid(),
  archivo       text,                          -- lo que subió el chofer (bucket documentos)
  vto_leido     date,                          -- vencimiento leído del certificado en el celular del chofer
  dni_leido     text,
  nombre_leido  text,
  detalle       text,
  intentos      int not null default 0,
  subido        timestamptz,
  revisado_por  uuid,
  revisado      timestamptz,
  motivo        text,
  creado        timestamptz not null default now()
);
create index if not exists pedidos_documento_chofer_idx on pedidos_documento (chofer_id, documento);
create index if not exists pedidos_documento_estado_idx on pedidos_documento (estado);
alter table pedidos_documento enable row level security;
drop policy if exists pedidos_documento_leer on pedidos_documento;
create policy pedidos_documento_leer on pedidos_documento for select using ((select es_interno()));
drop policy if exists pedidos_documento_editar on pedidos_documento;
create policy pedidos_documento_editar on pedidos_documento for all using ((select puede_editar())) with check ((select puede_editar()));
revoke all on pedidos_documento from anon, authenticated;
-- El enlace (token) no se lee desde el navegador: solo lo conocen la función del servidor y el mail del chofer
grant select (id, chofer_id, documento, vence, estado, enviado_a, enviado, pedido_por, archivo, vto_leido, dni_leido, nombre_leido,
              detalle, intentos, subido, revisado_por, revisado, motivo, creado) on pedidos_documento to authenticated;
-- Los cambios los hacen las funciones aceptar / rechazar_pedido_documento y la del servidor

/** Documentos de choferes que vencen dentro de p_dias (o vencieron hace menos de 60) y no tienen un pedido abierto */
create or replace function choferes_para_pedir(p_dias int default null)
returns table (chofer_id bigint, chofer text, transportista text, documento text, vto date, dias int, para text, de_quien text)
language sql stable set search_path = public as $$
  with d as (select coalesce(p_dias, parametro_int('dias_pedido_certificado', 30)) as dias),
  docs as (
    select h.id, h.nombre, h.email, h.transportista_id, x.documento, x.vto
    from choferes h
    cross join lateral (values ('carnet', h.carnet_vto), ('carga_pel', h.carga_pel_vto), ('sep', h.sep_vto)) x(documento, vto)
    where h.activo and x.vto is not null
  )
  select docs.id, docs.nombre, t.nombre, docs.documento, docs.vto, docs.vto - current_date,
         coalesce(nullif(trim(docs.email), ''), nullif(trim(t.email), '')),
         case when nullif(trim(docs.email), '') is not null then 'chofer'
              when nullif(trim(t.email), '') is not null then 'transportista' end
  from docs
  join transportistas t on t.id = docs.transportista_id
  cross join d
  where docs.vto <= current_date + d.dias and docs.vto >= current_date - 60
    and not exists (select 1 from pedidos_documento p
                    where p.chofer_id = docs.id and p.documento = docs.documento
                      and p.estado in ('pendiente', 'enviado', 'subido') and p.vence > now())
  order by docs.vto, docs.nombre
$$;

/** Acepta lo que subió el chofer: el archivo y el vencimiento pasan a su ficha */
-- (security definer: el enlace no se puede leer desde el navegador; los permisos se controlan adentro)
create or replace function aceptar_pedido_documento(p_id bigint, p_vto date) returns void
language plpgsql security definer set search_path = public as $$
declare p pedidos_documento;
begin
  if not puede_editar() then raise exception 'Tu usuario no tiene permiso para hacer cambios.'; end if;
  select * into p from pedidos_documento where id = p_id for update;
  if p.id is null or p.estado <> 'subido' then raise exception 'Este pedido ya no está para revisar.'; end if;
  if p_vto is null then raise exception 'Falta el vencimiento.'; end if;
  if p_vto < current_date then raise exception 'Con ese vencimiento el documento ya está vencido: revisá la fecha.'; end if;
  execute format('update choferes set %I = $1, %I = $2 where id = $3', p.documento || '_vto', p.documento || '_archivo')
    using p_vto, p.archivo, p.chofer_id;
  update pedidos_documento set estado = 'aceptado', vto_leido = p_vto, revisado_por = auth.uid(), revisado = now() where id = p_id;
end $$;

create or replace function rechazar_pedido_documento(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not puede_editar() then raise exception 'Tu usuario no tiene permiso para hacer cambios.'; end if;
  update pedidos_documento set estado = 'rechazado', motivo = nullif(trim(p_motivo), ''), revisado_por = auth.uid(), revisado = now()
  where id = p_id and estado = 'subido';
  if not found then raise exception 'Este pedido ya no está para revisar.'; end if;
end $$;

-- Cantidades y números como se leen en Argentina: 1.250,5 · 837-0007468
create or replace function fmt_cant(n numeric) returns text language sql immutable as $$
  select case when n < 0 then '-' else '' end
      || replace(to_char(trunc(abs(n)), 'FM999,999,999,990'), ',', '.')
      || coalesce(',' || nullif(rtrim(split_part(round(abs(n) - trunc(abs(n)), 3)::text, '.', 2), '0'), ''), '')
$$;
create or replace function fmt_numero(n text) returns text language sql immutable as $$
  select case when n ~ '^\d{9}$' then substr(n, 1, 3) || '-' || lpad(substr(n, 4), 7, '0') else n end
$$;

-- ---------------------------------------------------------------------
-- 2. Reglas de sugerencias. Solo leen; cada fila es una sugerencia.
--    tema: lo que se recuerda si el usuario dice "No me lo preguntes más".
-- ---------------------------------------------------------------------
drop function if exists sugerencias_ayudante(text);
create or replace function sugerencias_ayudante(p_area text)
returns table (tema text, titulo text, texto text, boton text, ir text, foco text, prioridad int)
language plpgsql stable set search_path = public as $$
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
      where e.etapa = 0 and not m.anulado and m.fecha < current_date - 3 and m.fecha >= current_date - 120;
    if n > 0 then
      select min(m.fecha) as fecha into r from manifiestos m join manifiesto_etapas e on e.manifiesto_id = m.id
        where e.etapa = 0 and not m.anulado and m.fecha < current_date - 3 and m.fecha >= current_date - 120;
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
        where not m.anulado and m.fecha >= (date_trunc('month', current_date) - interval '6 months')::date
          and m.fecha < date_trunc('month', current_date)::date
        group by m.generador_id
        having count(distinct date_trunc('month', m.fecha)) >= 5)
      select h.generador_id, g.nombre, h.meses, h.dia from hist h join generadores g on g.id = h.generador_id
      where g.activo and extract(day from current_date) >= h.dia + 5
        and not exists (select 1 from manifiestos m where m.generador_id = h.generador_id and not m.anulado
                          and m.fecha >= date_trunc('month', current_date)::date)
      order by h.meses desc, h.dia limit 3
    loop
      return query select 'falta-retiro:' || r.generador_id, 'Algo que falta'::text,
        format('%s tuvo retiro en %s de los últimos 6 meses, casi siempre alrededor del día %s, y este mes todavía no. ¿Preparamos el manifiesto?',
               r.nombre, r.meses, r.dia),
        'Nuevo manifiesto'::text, '/manifiestos/nuevo?generador=' || r.generador_id, 'nm-generador'::text, 5;
    end loop;
  end if;
end $$;

/** Sugerencias al abrir un manifiesto: posible duplicado y cantidades fuera de lo habitual */
drop function if exists sugerencias_manifiesto(bigint);
create or replace function sugerencias_manifiesto(p_id bigint)
returns table (tema text, titulo text, texto text, boton text, ir text, foco text, prioridad int)
language plpgsql stable set search_path = public as $$
declare m manifiestos; r record; f text := 'DD/MM/YYYY';
begin
  if not es_interno() then return; end if;
  select * into m from manifiestos where id = p_id;
  if m.id is null or m.anulado then return; end if;

  -- Posible duplicado: mismo generador, misma corriente y misma cantidad con menos de 10 días de diferencia
  for r in
    select distinct on (o.id) o.id, o.numero, o.fecha, c.codigo, i.cantidad, i.um
    from manifiesto_items i
    join manifiesto_items j on j.corriente_id = i.corriente_id and j.cantidad = i.cantidad and j.um = i.um
    join manifiestos o on o.id = j.manifiesto_id
    join corrientes c on c.id = i.corriente_id
    where i.manifiesto_id = p_id and o.id <> p_id and not o.anulado and o.generador_id = m.generador_id
      and abs(o.fecha - m.fecha) <= 10
    order by o.id limit 2
  loop
    return query select format('duplicado:%s-%s', least(p_id, r.id), greatest(p_id, r.id)), '¿Repetido?'::text,
      format('El manifiesto %s, del %s, es del mismo generador y tiene la misma corriente y cantidad (%s %s de %s). ¿No será el mismo retiro cargado dos veces?',
             fmt_numero(r.numero), to_char(r.fecha, f), fmt_cant(r.cantidad), r.um, r.codigo),
      'Ver el otro'::text, '/manifiestos/' || r.id, null::text, 1;
  end loop;

  -- Valor raro: más de 60 % por encima o por debajo de lo habitual (mediana de los últimos 6 meses, con 3 datos o más)
  for r in
    select i.id, c.codigo, i.cantidad, i.um, h.mediana, h.n
    from manifiesto_items i
    join corrientes c on c.id = i.corriente_id
    cross join lateral (
      select percentile_cont(0.5) within group (order by j.cantidad) as mediana, count(*) as n
      from manifiesto_items j join manifiestos o on o.id = j.manifiesto_id
      where o.generador_id = m.generador_id and not o.anulado and o.id <> p_id
        and j.corriente_id = i.corriente_id and j.um = i.um
        and o.fecha >= m.fecha - interval '6 months' and o.fecha <= m.fecha) h
    where i.manifiesto_id = p_id and h.n >= 3 and h.mediana > 0
      and (i.cantidad > h.mediana * 1.6 or i.cantidad < h.mediana * 0.4)
    limit 2
  loop
    return query select 'raro:' || r.id, 'Cantidad para revisar'::text,
      format('%s %s de %s es %s de lo habitual para este generador: en los últimos 6 meses ronda los %s %s. ¿Está bien cargado?',
             fmt_cant(r.cantidad), r.um, r.codigo,
             case when r.cantidad > r.mediana then 'bastante más' else 'bastante menos' end,
             fmt_cant(round(r.mediana::numeric)), r.um),
      'Mostrame'::text, null::text, format('[data-item="%s"]', r.id), 2;
  end loop;
end $$;

/** "Como siempre": lo que se repite en al menos el 60 % de los retiros de los últimos 6 meses de un generador */
create or replace function como_siempre(p_generador bigint) returns jsonb
language sql stable set search_path = public as $$
  with u as (
    select m.* from manifiestos m
    where m.generador_id = p_generador and not m.anulado and m.fecha >= current_date - interval '6 months'),
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
$$;

revoke execute on function sugerencias_ayudante(text), sugerencias_manifiesto(bigint), como_siempre(bigint),
  choferes_para_pedir(int), aceptar_pedido_documento(bigint, date), rechazar_pedido_documento(bigint, text) from public, anon;
grant execute on function sugerencias_ayudante(text), sugerencias_manifiesto(bigint), como_siempre(bigint),
  choferes_para_pedir(int), aceptar_pedido_documento(bigint, date), rechazar_pedido_documento(bigint, text) to authenticated, service_role;

-- Las funciones del servidor (certificado-chofer y avisos) trabajan con la clave de servicio
grant all on ayudante_memoria, pedidos_documento to service_role;
