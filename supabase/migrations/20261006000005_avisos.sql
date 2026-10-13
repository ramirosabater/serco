-- =====================================================================
-- SGRP 2.0 · Avisos por mail
--   * Certificados: a cada generador le llega el aviso de sus certificados nuevos.
--   * Vencimientos: a Serco le llega el resumen de lo vencido y lo por vencer.
-- Los envía la función "avisos" (supabase/functions/avisos), una vez por día.
-- =====================================================================

-- El mail de cada usuario, para mostrarlo en la pantalla de usuarios (lo completa la función "usuarios")
alter table perfiles add column if not exists email text;

-- Qué certificado se avisó a qué generador (un certificado puede amparar residuos de varios)
create table avisos_certificados (
  certificado_id bigint not null references certificados(id) on delete cascade,
  generador_id   bigint not null references generadores(id) on delete cascade,
  email          text,
  resultado      text not null check (resultado in ('enviado', 'sin_mail')),
  fecha          timestamptz not null default now(),
  primary key (certificado_id, generador_id)
);

-- Registro de todo lo que se mandó (o se intentó mandar)
create table avisos_log (
  id           bigint generated always as identity primary key,
  fecha        timestamptz not null default now(),
  tipo         text not null,               -- certificados · vencimientos · prueba
  destinatario text,
  asunto       text,
  ok           boolean not null,
  detalle      text
);

alter table avisos_certificados enable row level security;
create policy avisos_cert_leer on avisos_certificados for select using ((select es_interno()));
alter table avisos_log enable row level security;
create policy avisos_log_leer on avisos_log for select using ((select es_interno()));

insert into parametros (clave, valor, descripcion) values
  ('mails_vencimientos', '', 'Mails de Serco que reciben el resumen de vencimientos, separados por coma'),
  ('dia_resumen_vencimientos', '1', 'Día de la semana del resumen completo (1 = lunes)'),
  ('dias_alerta_vencimientos', '30,15,5', 'Con cuántos días de anticipación llega el aviso de cada vencimiento, separados por coma (0 = el día que vence)')
on conflict (clave) do nothing;

-- Pares certificado-generador que falta avisar (reemplaza la vista de 0004)
drop view if exists certificados_por_avisar;
create view certificados_por_avisar with (security_invoker = true) as
  select c.id as certificado_id, c.numero, c.fecha, c.archivo, o.nombre as operador,
         g.id as generador_id, g.nombre as generador, nullif(trim(g.email), '') as email,
         string_agg(distinct m.numero, ', ' order by m.numero) as manifiestos
  from certificados c
  join manifiesto_items i on i.certificado_id = c.id
  join manifiestos m on m.id = i.manifiesto_id
  join generadores g on g.id = m.generador_id
  left join operadores o on o.id = c.operador_id
  where c.enviado_cliente is null
    and not exists (select 1 from avisos_certificados a where a.certificado_id = c.id and a.generador_id = g.id)
  group by c.id, o.nombre, g.id;

-- Marca como avisados los certificados que ya no tienen generadores pendientes
create or replace function cerrar_certificados_avisados() returns integer
language sql security definer set search_path = public as $$
  with cerrados as (
    update certificados c set enviado_cliente = now()
    where c.enviado_cliente is null
      and exists (select 1 from avisos_certificados a where a.certificado_id = c.id)
      and not exists (select 1 from certificados_por_avisar p where p.certificado_id = c.id)
    returning 1)
  select count(*)::int from cerrados
$$;
revoke execute on function cerrar_certificados_avisados() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Programación diaria (07:00 de Argentina = 10:00 UTC)
-- Requiere las extensiones pg_cron y pg_net (Database → Extensions) y dos
-- secretos en el Vault: project_url y service_role_key. Ver README.
-- ---------------------------------------------------------------------
-- select cron.schedule('avisos-diarios', '0 10 * * *', $$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/avisos',
--     headers := jsonb_build_object('Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
--     body := '{}'::jsonb)
-- $$);
