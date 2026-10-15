-- SGRP 2.0 · Datos para las pruebas automáticas (carpeta pruebas/). Correr una vez en el SQL Editor.
-- Crea un transportista y un generador "PRUEBA AUTOMATICA" que usan solo las pruebas, y le da
-- permisos de operador al usuario de prueba. Se puede correr más de una vez.
--
-- Antes: Authentication → Users → Add user → Create new user, con un mail de prueba
-- (por ejemplo ramirosabater+pruebas@gmail.com), una contraseña y "Auto Confirm User".
-- Después: poné ese mail en la línea marcada con <<< y tocá Run.

-- Transportista de otro formulario (rosa): no usa la numeración del formulario azul de Serco
insert into transportistas (nombre, emite_manifiestos, activo)
values ('PRUEBA AUTOMATICA', false, true)
on conflict (nombre) do update set activo = true;

-- Generador de prueba, sin planta: no lo ve ningún cliente real
insert into generadores (nombre, activo, notas)
select 'PRUEBA AUTOMATICA', true, 'USADO POR LAS PRUEBAS AUTOMÁTICAS. NO BORRAR.'
where not exists (select 1 from generadores where nombre = 'PRUEBA AUTOMATICA');

-- Usuario de prueba con rol operador
insert into perfiles (id, nombre, email, rol, activo)
select id, 'Pruebas automáticas', email, 'operador', true
from auth.users
where email = 'ramirosabater+pruebas@gmail.com'          -- <<< el mail del usuario de prueba
on conflict (id) do update set rol = 'operador', activo = true;

-- Tiene que mostrar el usuario de prueba con rol "operador":
select nombre, email, rol from perfiles where nombre = 'Pruebas automáticas';

-- ---------------------------------------------------------------------
-- Limpieza (opcional, cada tanto): borra los manifiestos que dejaron las pruebas.
-- Ya quedan anulados, así que no cuentan en ningún reporte; esto solo los saca de la base.
-- Para usarlo, sacá los dos guiones del principio de la línea de abajo y tocá Run.
-- delete from manifiestos where transportista_id = (select id from transportistas where nombre = 'PRUEBA AUTOMATICA');
