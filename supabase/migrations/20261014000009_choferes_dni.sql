-- SGRP 2.0 · DNI de los choferes (para consultar y controlar sus certificados).
-- En el Access el número de licencia de conducir es el DNI: se copia de ahí.
-- Se puede correr más de una vez.
alter table choferes add column if not exists dni text;
update choferes set dni = carnet_nro where dni is null and carnet_nro ~ '^\d{7,8}$';
