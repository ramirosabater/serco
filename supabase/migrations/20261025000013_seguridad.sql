-- =====================================================================
-- SGRP 2.0 · Ajustes de la revisión de seguridad (25/10/2026)
--   1. Portal de clientes: ve solo los choferes, camiones y transportistas de SUS retiros
--      (antes podía leer todos los choferes, con DNI y mail: Ley 25.326, minimización).
--   2. Manifiestos, Manifiestos Nación y certificados son documentos legales: borrarlos
--      solo lo puede hacer un administrador (los operadores los anulan, no los borran).
-- Se puede correr más de una vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Portal: solo lo que aparece en los manifiestos del cliente
-- ---------------------------------------------------------------------
create or replace function mis_manifiestos_flota() returns table (transportista_id bigint, chofer_id bigint, camion_id bigint)
language sql stable security definer set search_path = public as $$
  select m.transportista_id, m.chofer_id, m.camion_id from manifiestos m
  where m.generador_id in (select mis_generadores())
$$;
revoke execute on function mis_manifiestos_flota() from public, anon;
grant execute on function mis_manifiestos_flota() to authenticated;

drop policy if exists choferes_portal on choferes;
create policy choferes_portal on choferes for select
  using ((select es_cliente()) and id in (select chofer_id from mis_manifiestos_flota()));
drop policy if exists camiones_portal on camiones;
create policy camiones_portal on camiones for select
  using ((select es_cliente()) and id in (select camion_id from mis_manifiestos_flota()));
drop policy if exists transportistas_portal on transportistas;
create policy transportistas_portal on transportistas for select
  using ((select es_cliente()) and id in (select transportista_id from mis_manifiestos_flota()));

-- ---------------------------------------------------------------------
-- 2. Documentos legales: alta y cambios para admin y operador; borrar, solo admin
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['manifiestos', 'manifiestos_nacion', 'certificados']
  loop
    execute format('drop policy if exists %I on %I', t || '_editar', t);
    execute format('drop policy if exists %I on %I', t || '_alta', t);
    execute format('drop policy if exists %I on %I', t || '_cambio', t);
    execute format('drop policy if exists %I on %I', t || '_borrar', t);
    execute format('create policy %I on %I for insert with check ((select puede_editar()))', t || '_alta', t);
    execute format('create policy %I on %I for update using ((select puede_editar())) with check ((select puede_editar()))', t || '_cambio', t);
    execute format('create policy %I on %I for delete using ((select mi_rol()) = ''admin'')', t || '_borrar', t);
  end loop;
end $$;
