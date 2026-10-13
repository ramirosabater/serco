-- =====================================================================
-- SGRP 2.0 · Archivos (Supabase Storage)
-- Bucket privado "documentos": se accede con enlaces firmados desde la app.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do nothing;

-- ¿Este archivo es de un documento que el cliente del portal puede ver?
create or replace function cliente_puede_ver_archivo(ruta text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from manifiestos m
    where m.escaneo = ruta and m.generador_id in (select mis_generadores())
  ) or exists (
    select 1 from certificados c
    join manifiesto_items i on i.certificado_id = c.id
    join manifiestos m on m.id = i.manifiesto_id
    where c.archivo = ruta and m.generador_id in (select mis_generadores())
  )
$$;

create policy documentos_leer on storage.objects for select
  using (bucket_id = 'documentos' and ((select es_interno()) or ((select es_cliente()) and cliente_puede_ver_archivo(name))));
create policy documentos_subir on storage.objects for insert
  with check (bucket_id = 'documentos' and (select puede_editar()));
create policy documentos_reemplazar on storage.objects for update
  using (bucket_id = 'documentos' and (select puede_editar()));
-- Borrar archivos: solo el admin.
create policy documentos_borrar on storage.objects for delete
  using (bucket_id = 'documentos' and (select mi_rol()) = 'admin');
