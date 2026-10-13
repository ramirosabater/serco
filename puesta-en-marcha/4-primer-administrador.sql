-- SGRP 2.0 · Paso 4: darte permisos de administrador.
-- Antes: Authentication → Users → Add user → Create new user (tu mail y una contraseña, con "Auto Confirm User").
-- Después: cambiá el mail de abajo por el tuyo, pegá esto en el SQL Editor y tocá Run.

insert into perfiles (id, nombre, email, rol, activo)
select id, 'Ramiro Sabater', email, 'admin', true
from auth.users
where email = 'ramirosabater@gmail.com'
on conflict (id) do update set rol = 'admin', activo = true;

-- Tiene que mostrar una fila con tu nombre y rol "admin":
select nombre, email, rol from perfiles;
