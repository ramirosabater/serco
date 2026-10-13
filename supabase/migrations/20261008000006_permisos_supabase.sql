-- =====================================================================
-- SGRP 2.0 · Ajuste de permisos para Supabase
--
-- Supabase habilita por defecto todas las tablas y funciones de "public"
-- para el rol "anon" (cualquiera que tenga la URL y la clave pública).
-- Los permisos por fila ya lo bloquean, pero acá se cierra del todo:
-- el sistema no tiene nada público, todo requiere usuario.
-- =====================================================================

-- Tablas y vistas: nada para anon
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Funciones: solo usuarios con sesión (y el servicio interno)
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

-- Funciones internas que la app no debe llamar directo
revoke execute on function cerrar_certificados_avisados() from authenticated;
revoke execute on function registrar_historial() from authenticated;
revoke execute on function marcar_modificado() from authenticated;

-- Lo que se cree de acá en adelante sigue la misma regla
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;
