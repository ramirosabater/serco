-- =====================================================================
-- SGRP 2.0 · Archivos en Google Drive
--   Los PDF y fotos (manifiestos, Manifiestos Nación, certificados, habilitaciones, lo que suben
--   los choferes) se guardan en el Drive de la cuenta de Serco. En la base queda "drive:<id>"
--   en la misma columna donde antes iba la ruta del Storage (los que ya estaban en el Storage siguen andando).
--   Solo las funciones del servidor tocan el Drive: el navegador nunca ve las claves de Google.
-- Se puede correr más de una vez.
-- =====================================================================

-- Carpetas ya creadas en el Drive (para no crearlas dos veces): "certificados/12" → id de la carpeta
create table if not exists drive_carpetas (
  ruta   text primary key,
  id     text not null,
  creado timestamptz not null default now()
);
alter table drive_carpetas enable row level security;     -- sin políticas: solo el servidor
revoke all on drive_carpetas from anon, authenticated;
grant all on drive_carpetas to service_role;

/** ¿Este usuario puede ver este archivo? Personal de Serco: todo. Clientes: solo los escaneos y certificados de sus retiros. */
create or replace function puede_ver_archivo(p_usuario uuid, p_ruta text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.rol in ('admin', 'operador', 'consulta') then true
      when p.rol = 'cliente' then
        exists (select 1 from manifiestos m join perfil_generadores pg on pg.generador_id = m.generador_id
                where pg.perfil_id = p.id and m.escaneo = p_ruta)
        or exists (select 1 from certificados c join manifiesto_items i on i.certificado_id = c.id
                   join manifiestos m on m.id = i.manifiesto_id join perfil_generadores pg on pg.generador_id = m.generador_id
                   where pg.perfil_id = p.id and c.archivo = p_ruta)
      else false end
    from perfiles p where p.id = p_usuario and p.activo), false)
$$;
revoke execute on function puede_ver_archivo(uuid, text) from public, anon, authenticated;
grant execute on function puede_ver_archivo(uuid, text) to service_role;
