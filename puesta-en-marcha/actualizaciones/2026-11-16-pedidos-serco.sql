-- =====================================================================
-- Gestión Serco · Pedidos de Serco después de las pruebas del 16/11/2026
--
-- 1. Clientes: la "habilitación municipal" pasa a llamarse Habilitación de generador (mismos datos: número,
--    vencimiento y escaneo). Se agrega el Convenio (vencimiento y escaneo): avisa en vencimientos pero no frena
--    la emisión. La habilitación comercial deja de mostrarse (los datos quedan en la base).
-- 4. Carga peligrosa del chofer "en trámite": vale hasta 30 días después del vencimiento.
--    Al cargar un vencimiento nuevo, el "en trámite" se apaga solo.
-- 5. Habilitación de ruta del camión: ya no se usa (no se controla ni aparece en vencimientos).
-- 6. Salvar una cantidad con * ya no pide motivo.
-- 7. Certificado de Serco al cliente: un renglón por corriente (cantidad sumada), no uno por manifiesto.
-- Se puede correr más de una vez.
-- =====================================================================

-- 1 · Convenio del cliente
alter table generadores add column if not exists convenio_vto date;
alter table generadores add column if not exists convenio_archivo text;
comment on column generadores.hab_mun_vto is 'Habilitación de generador (antes "habilitación municipal"): se controla al emitir';
comment on column generadores.convenio_vto is 'Convenio con Serco: avisa en vencimientos, no frena la emisión';

-- 4 · Carga peligrosa del chofer en trámite
alter table choferes add column if not exists carga_pel_tramite boolean not null default false;
comment on column choferes.carga_pel_tramite is 'Renovación en trámite: la carga peligrosa vale hasta 30 días después del vencimiento';

create or replace function carga_pel_vigente_hasta(p_vto date, p_tramite boolean) returns date
language sql immutable as $$ select case when p_tramite then p_vto + 30 else p_vto end $$;

create or replace function apagar_tramite_carga_pel() returns trigger
language plpgsql set search_path = public as $$
begin
  -- llegó el carnet nuevo (vencimiento más adelante): ya no está en trámite
  if new.carga_pel_tramite and new.carga_pel_vto is distinct from old.carga_pel_vto
     and (old.carga_pel_vto is null or new.carga_pel_vto > old.carga_pel_vto) then
    new.carga_pel_tramite := false;
  end if;
  return new;
end $$;
drop trigger if exists apagar_tramite_carga_pel on choferes;
create trigger apagar_tramite_carga_pel before update on choferes for each row execute function apagar_tramite_carga_pel();

-- Qué impide emitir: sin ruta del camión; carga peligrosa del chofer con los 30 días si está en trámite
create or replace function problemas_flota(p_transportista bigint, p_camion bigint, p_chofer bigint, p_fecha date)
returns text[] language plpgsql stable set search_path = public as $$
declare
  r record; p text[] := '{}';
begin
  if p_camion is null then p := p || 'Falta elegir el camión'::text;
  else
    select * into r from camiones where id = p_camion;
    if r.transportista_id <> p_transportista then p := p || ('El camión ' || r.patente || ' no es de este transportista'); end if;
    if not r.activo then p := p || ('El camión ' || r.patente || ' está dado de baja'); end if;
    p := p || array_remove(array[
      vto_problema('Camión ' || r.patente || ' · VTV', r.vtv_vto, p_fecha),
      vto_problema('Camión ' || r.patente || ' · carga peligrosa', r.carga_pel_vto, p_fecha)], null);
  end if;

  if p_chofer is null then p := p || 'Falta elegir el chofer'::text;
  else
    select * into r from choferes where id = p_chofer;
    if r.transportista_id <> p_transportista then p := p || ('El chofer ' || r.nombre || ' no es de este transportista'); end if;
    if not r.activo then p := p || ('El chofer ' || r.nombre || ' está dado de baja'); end if;
    p := p || array_remove(array[
      vto_problema('Chofer ' || r.nombre || ' · carnet', r.carnet_vto, p_fecha),
      vto_problema('Chofer ' || r.nombre || ' · carga peligrosa' || case when r.carga_pel_tramite then ' (en trámite)' else '' end,
                   carga_pel_vigente_hasta(r.carga_pel_vto, r.carga_pel_tramite), p_fecha),
      vto_problema('Chofer ' || r.nombre || ' · psicofísico', r.sep_vto, p_fecha)], null);
  end if;

  select * into r from transportistas where id = p_transportista;
  if not r.activo then p := p || ('El transportista ' || r.nombre || ' está dado de baja'); end if;
  p := p || array_remove(array[vto_problema('Transportista ' || r.nombre || ' · habilitación provincial', r.hab_pro_vto, p_fecha)], null);
  return p;
end $$;

create or replace function problemas_generador(p_generador bigint, p_fecha date)
returns text[] language plpgsql stable set search_path = public as $$
declare g record; p text[] := '{}';
begin
  select * into g from generadores where id = p_generador;
  if not g.activo then p := p || ('El generador ' || g.nombre || ' está dado de baja'); end if;
  return p || array_remove(array[vto_problema('Generador ' || g.nombre || ' · habilitación de generador', g.hab_mun_vto, p_fecha)], null);
end $$;

-- Vencimientos: sin ruta; habilitación de generador y convenio; carga peligrosa en trámite con sus 30 días
create or replace view vencimientos with (security_invoker = true) as
  select 'camion'::text as tipo, c.id, c.patente as nombre, 'VTV'::text as documento, c.vtv_vto as vto from camiones c where c.activo
  union all select 'camion', c.id, c.patente, 'Carga peligrosa', c.carga_pel_vto from camiones c where c.activo
  union all select 'chofer', h.id, h.nombre, 'Carnet', h.carnet_vto from choferes h where h.activo
  union all select 'chofer', h.id, h.nombre, case when h.carga_pel_tramite then 'Licencia carga peligrosa (en trámite)' else 'Licencia carga peligrosa' end,
                   carga_pel_vigente_hasta(h.carga_pel_vto, h.carga_pel_tramite) from choferes h where h.activo
  union all select 'chofer', h.id, h.nombre, 'Psicofísico', h.sep_vto from choferes h where h.activo
  union all select 'generador', g.id, g.nombre, 'Habilitación de generador', g.hab_mun_vto from generadores g where g.activo
  union all select 'generador', g.id, g.nombre, 'Convenio', g.convenio_vto from generadores g where g.activo
  union all select 'transportista', t.id, t.nombre, 'Habilitación provincial', t.hab_pro_vto from transportistas t where t.activo
  union all select 'transportista', t.id, t.nombre, 'Habilitación nacional', t.hab_nac_vto from transportistas t where t.activo
  union all select 'operador', o.id, o.nombre, 'Habilitación nacional', o.hab_nac_vto from operadores o where o.activo
  union all select 'planta', p.id, p.nombre, 'Habilitación provincial', p.hab_pro_vto from generadores_principales p where p.activo;

-- Tablero, "generadores a regularizar": solo la habilitación (el convenio no frena nada)
do $$
declare f record; def text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosrc like '%regularizar as%' and p.prosrc like '%a.tipo = ''generador'' and a.estado in%'
  loop
    def := replace(pg_get_functiondef(f.oid), 'a.tipo = ''generador'' and a.estado in', 'a.tipo = ''generador'' and a.documento <> ''Convenio'' and a.estado in');
    execute def;
  end loop;
end $$;

-- 6 · Salvar con * sin motivo (el motivo queda opcional: si viene, se anota)
create or replace function salvar_cantidad(p_item bigint, p_cantidad numeric, p_motivo text default null) returns void
language plpgsql set search_path = public as $$
declare i manifiesto_items; m manifiestos; b text;
begin
  if not puede_editar() then raise exception 'Tu usuario no puede corregir manifiestos'; end if;
  if coalesce(p_cantidad, 0) <= 0 then raise exception 'La cantidad tiene que ser mayor a cero'; end if;
  select * into i from manifiesto_items where id = p_item for update;
  if i.id is null then raise exception 'No existe el residuo'; end if;
  select * into m from manifiestos where id = i.manifiesto_id;
  if m.anulado then raise exception 'El manifiesto está anulado'; end if;
  b := manifiesto_bloqueo(m.id);
  if b is not null then raise exception '%', b; end if;
  if i.certificado_id is not null then
    raise exception 'Ya llegó el certificado del operador: la cantidad no se salva, hay que anular el manifiesto';
  end if;
  if p_cantidad = i.cantidad then return; end if;
  update manifiesto_items
  set cantidad = p_cantidad,
      salvado = concat_ws(' · ', salvado, format('* %s → %s %s (%s)',
                  fmt_cant(i.cantidad), fmt_cant(p_cantidad), case i.um when 'KGS' then 'kg' when 'LTS' then 'l' else 'm³' end,
                  concat_ws(', ', nullif(trim(coalesce(p_motivo, '')), ''), to_char(current_date, 'DD/MM/YYYY'))))
  where id = p_item;
end $$;
grant execute on function salvar_cantidad(bigint, numeric, text) to authenticated;

-- 7 · Certificado de Serco: un renglón por corriente dentro de cada certificado del operador
create or replace function certificado_serco(p_numero integer) returns jsonb
language sql stable security invoker set search_path = public as $$
  with it as (
    select i.*, m.numero as man_numero, m.fecha as man_fecha, m.generador_id, m.transportista_id
    from manifiesto_items i join manifiestos m on m.id = i.manifiesto_id
    where i.cert_rp_nro = p_numero
  ), cab as (
    select (select min(generador_id) from it) as generador_id, (select min(certificado_id) from it) as certificado_id
  ), por_corriente as (
    select x.certificado_id, c.codigo as corriente, c.estado_fisico, x.um, sum(x.cantidad) as cantidad,
           array_agg(distinct x.man_numero order by x.man_numero) as manifiestos,
           min(x.man_fecha) as fecha_desde, max(x.man_fecha) as fecha,
           string_agg(distinct t.nombre, ' / ') as transportista, string_agg(distinct t.hab_pro_nro, ' / ') as transportista_rpg
    from it x left join corrientes c on c.id = x.corriente_id left join transportistas t on t.id = x.transportista_id
    group by x.certificado_id, c.codigo, c.estado_fisico, x.um
  )
  select case when not exists (select 1 from it) then null else jsonb_build_object(
    'numero', p_numero,
    'rpg', (select max(rpg_nro) from it),
    'generador', (select jsonb_build_object('nombre', g.nombre, 'cuit', g.cuit, 'direccion', g.direccion, 'ciudad', g.ciudad,
                   'provincia', g.provincia, 'hab_mun_nro', g.hab_mun_nro, 'email', g.email)
                  from generadores g, cab where g.id = cab.generador_id),
    'certificados', (select coalesce(jsonb_agg(jsonb_build_object(
          'numero', ce.numero, 'fecha', ce.fecha, 'fecha_listado', ce.fecha_listado, 'tipo_tratamiento', ce.tipo_tratamiento,
          'operador', jsonb_build_object('nombre', o.nombre, 'ubicacion', coalesce(o.ubicacion, o.localidad)),
          'planta', (select jsonb_build_object('nombre', gp.nombre, 'cuit', gp.cuit, 'direccion', gp.direccion, 'ciudad', gp.ciudad,
                       'provincia', gp.provincia, 'telefono', gp.telefono, 'email', gp.email, 'hab_pro_nro', gp.hab_pro_nro,
                       'hab_pro_vto', gp.hab_pro_vto, 'hab_nac_nro', gp.hab_nac_nro, 'hab_nac_vto', gp.hab_nac_vto,
                       'hab_mun_nro', gp.hab_mun_nro, 'hab_mun_vto', gp.hab_mun_vto)
                     from generadores_principales gp where gp.id = ce.generador_principal_id),
          'residuos', (select jsonb_agg(jsonb_build_object(
                'corriente', r.corriente, 'estado_fisico', r.estado_fisico, 'cantidad', r.cantidad, 'um', r.um,
                'manifiestos', to_jsonb(r.manifiestos), 'fecha_desde', r.fecha_desde, 'fecha', r.fecha,
                'transportista', r.transportista, 'transportista_rpg', r.transportista_rpg)
                order by r.corriente, r.um)
              from por_corriente r where r.certificado_id is not distinct from ce.id))
          order by ce.fecha), '[]')
        from certificados ce left join operadores o on o.id = ce.operador_id
        where ce.id in (select certificado_id from it)),
    'serco', (select jsonb_object_agg(clave, valor) from parametros where clave in ('rpgyosp_serco'))
  ) end
$$;
grant execute on function certificado_serco(integer) to authenticated;
