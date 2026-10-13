-- SGRP 2.0 · Paso 1: tablas, permisos y vistas. Pegar todo en el SQL Editor de Supabase y tocar Run.

-- =====================================================================
-- SGRP 2.0 · Serco Ambiental S.A. · Esquema inicial v0.2
-- FloWerITT · Ramiro Sabater · 05/10/2026
--
-- Armado sobre la estructura real de SGRP.mdb (Jet 4, 33 tablas).
-- Entre corchetes: tabla.campo de origen en el Access.
--
-- Orden de trabajo:
--   1. Este archivo: tablas, índices, permisos (RLS) y vistas.
--   2. Carga de la historia con el script de migración.
--   3. 20261005000002_reglas.sql: validaciones e historial de cambios.
--      Van después de la carga para que la historia sucia entre completa
--      y quede anotada en el informe de inconsistencias, sin forzarla.
--
-- Queda afuera: costos y facturación ([ItemCosto], [Costo*], [Facturado]),
-- tablas de menú y gráficos del Access, y las contraseñas de [Usuarios].
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;  -- en Supabase las extensiones van en "extensions"

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type unidad_medida   as enum ('KGS', 'LTS', 'MS3');                    -- [IdMedida / UM]
create type estado_residuo  as enum ('almacenado', 'en_transito', 'disposicion_final'); -- [EstadoDetManif]
create type tipo_manifiesto as enum ('azul', 'rosa');  -- azul: lo emite Serco · rosa: lo emite el transportista
create type rol_usuario     as enum ('admin', 'operador', 'consulta', 'cliente');

-- ---------------------------------------------------------------------
-- Catálogos simples (listas desplegables)
-- ---------------------------------------------------------------------
create table provincias (nombre text primary key);                           -- [Provincia]
create table ciudades (                                                       -- [Ciudad]
  nombre    text primary key,
  provincia text references provincias(nombre) on update cascade,
  cp        text
);
create table actividades (nombre text primary key);                           -- [Actividad]

create table parametros (                                                     -- valores sueltos del sistema
  clave text primary key,
  valor text not null,
  descripcion text
);
-- Se cargan en la migración: rpgyosp_serco [RPGLibro.RPGyOSP], proximo_cert_rp [RPGLibro.RPCertNro]

-- ---------------------------------------------------------------------
-- Generadores principales ("Cliente de"): Serco, Quimiguay, Ineco…
-- Son las plantas/operadores que reciben el residuo. [Generador Principal]
-- ---------------------------------------------------------------------
create table generadores_principales (
  id            bigint generated always as identity primary key,
  id_access     integer unique,                      -- [IdGenerador]
  nombre        text not null unique,                -- [GeneradorNombre]
  cuit          text,                                -- [GeneradorCuit]
  direccion     text,                                -- [GeneradorDirección]
  ciudad        text,                                -- [GeneradorCiudad]
  cp            text,                                -- [GeneradorCP]
  provincia     text,                                -- [GeneradorProvincia]
  telefono      text,                                -- [GeneradorTelefono]
  ubicacion     text,                                -- [GeneradorUbicacion]
  email         text,                                -- [GeneradorEmail]
  hab_nac_nro   text,  hab_nac_vto date,             -- [GeneradorNroHab / GeneradorVtoHab]
  hab_pro_nro   text,  hab_pro_vto date,             -- [GeneradorNroHabPro / GeneradorVtoHabPro]
  hab_mun_nro   text,  hab_mun_vto date,             -- [GeneradorNroHabMun / GeneradorVtoHabMun]
  hab_nac_archivo text,                              -- [GeneradorHabNac]
  hab_pro_archivo text,                              -- [GeneradorHabPro]
  hab_mun_archivo text,                              -- [GeneradorHabMun]
  activo        boolean not null default true
);
-- [GeneradorPassword] no se migra.

-- ---------------------------------------------------------------------
-- Generadores (clientes que generan el residuo) [Clientes]
-- ---------------------------------------------------------------------
create table generadores (
  id                     bigint generated always as identity primary key,
  id_access              integer unique,             -- [IdClientes]
  nombre                 text not null,              -- [NombreCompañía]
  cuit                   text,                       -- [Cuit] · hay CUIT repetidos (p. ej. dos razones sociales)
  cod_iva                text,                       -- [CodIva] RI / CF
  actividad              text,                       -- [Actividad]
  direccion              text,                       -- [Dirección]
  ciudad                 text,                       -- [Ciudad]
  provincia              text,                       -- [Provincia]
  cp                     text,                       -- [CódPostal]
  contacto_nombre        text,                       -- [NombreContacto]
  contacto_apellido      text,                       -- [ApellidosContacto]
  contacto_cargo         text,                       -- [CargoContacto]
  telefono               text,                       -- [NúmTeléfono]
  celular                text,                       -- [Núm Celular]
  fax                    text,                       -- [NúmFax]
  email                  text,                       -- [DirCorreoElectrónico] · destino del aviso de certificado
  notas                  text,                       -- [Notas]
  alta                   date,                       -- [Fecha Alta]
  modo_retiro            text,                       -- [ModoRetiro]
  generador_principal_id bigint references generadores_principales(id), -- [GenePrin]
  hab_mun_nro            text,  hab_mun_vto date,    -- [CliNroHabMun / CliVtoHabMun]
  hab_mun_archivo        text,                       -- [CliImaHabMun]
  hab_com_nro            text,  hab_com_vto date,    -- [CliNroHabCom / CliVtoHabCom]
  hab_com_archivo        text,                       -- [CliImaHabCom]
  activo                 boolean not null default true -- [ClienteActivo] (hoy vacío en todos)
);
create index generadores_nombre_idx on generadores (nombre);  -- sin unique: en el Access hay nombres que solo difieren en espacios
create index generadores_cuit_idx on generadores (cuit);
create index generadores_nombre_trgm on generadores using gin (nombre extensions.gin_trgm_ops);

create table generador_direcciones (                 -- [ClientesDirecciones]
  id            bigint generated always as identity primary key,
  generador_id  bigint not null references generadores(id) on delete cascade, -- [IdClientes]
  direccion     text not null,                       -- [DireccionDeRetiro]
  ciudad        text,                                -- [Ciudad]
  provincia     text,                                -- [Provincia]
  cp            text,                                -- [CódPostal]
  unique (generador_id, direccion)
);

-- ---------------------------------------------------------------------
-- Transportistas, camiones y choferes
-- ---------------------------------------------------------------------
create table transportistas (                        -- [Transporte]
  id                 bigint generated always as identity primary key,
  id_access          integer unique,                 -- [IdNroTransp]
  nombre             text not null unique,           -- [IdTransporte]
  cuit               text,                           -- [CuitTrans]
  direccion          text,                           -- [DireccTransp]
  localidad          text,                           -- [LocalidadTransp]
  provincia          text,                           -- [ProvinciaTransp]
  cp                 text,                           -- [CPTransp]
  telefono           text,                           -- [TelefonoTransp]
  email              text,                           -- [emailTransp]
  hab_nac_nro        text,  hab_nac_vto date,        -- [TransNroHabNac / TransVtoHabNac]
  hab_pro_nro        text,  hab_pro_vto date,        -- [TransNroHabPro / TransVtoHabPro]
  hab_mun_nro        text,  hab_mun_vto date,        -- [TransNroHabMun / TransVtoHabMun]
  hab_nac_archivo    text,                           -- [HabNacTransp]
  hab_pro_archivo    text,                           -- [HabPciaTransp]
  hab_mun_archivo    text,                           -- [HabMunTransp]
  ret_env_amb        text,                           -- [RetEnvAmb] (a confirmar con Serco)
  emite_manifiestos  boolean not null default false, -- true en SERCO SRL y SERCO AMBIENTAL SA: formulario azul
  proximo_numero     integer,                        -- [TransNroManif] numerador del formulario
  activo             boolean not null default true   -- [transporteActivo] A/B
);

create table camiones (                              -- [Camiones]
  id                 bigint generated always as identity primary key,
  transportista_id   bigint not null references transportistas(id), -- [IdNroTransp]
  patente            text not null,                  -- [IdPatente]
  tipo               text,                           -- nuevo: batea, cisterna, chasis…
  capacidad          numeric(14,3),                  -- nuevo (pregunta abierta a Serco)
  capacidad_um       unidad_medida,
  ruta_vto           date,                           -- [PatenteRutaVto] habilitación de ruta
  ruta_archivo       text,                           -- [PatenteRuta] (en el Access guarda la ruta del archivo)
  titulo_archivo     text,                           -- [PatenteTitulo]
  cedula_archivo     text,                           -- [PatenteCedVerde]
  rastreo_archivo    text,                           -- [PatenteRastreoSat]
  vtv_vto            date,                           -- [PatenteVTVVto]
  vtv_archivo        text,                           -- [PatenteVTVImagen]
  carga_pel_nro      text,  carga_pel_vto date,      -- [PatenteCPeligNro / PatenteCPeligVto]
  carga_pel_archivo  text,                           -- [PatenteCPeligImagen]
  activo             boolean not null default true,  -- [CamionesActivo] A/B
  unique (transportista_id, patente)
);

create table choferes (                              -- [Choferes]
  id                 bigint generated always as identity primary key,
  transportista_id   bigint not null references transportistas(id), -- [IdNroTransp]
  nombre             text not null,                  -- [Chofer]
  carnet_nro         text,  carnet_vto date,         -- [NroCarnet / NroCarnetVto]
  carnet_archivo     text,                           -- [NroCarnetImagen]
  carga_pel_vto      date,                           -- [CCargaPeligVto]
  carga_pel_archivo  text,                           -- [CCargaPeligImagen]
  sep_vto            date,                           -- [SEPVto]
  sep_archivo        text,                           -- [SEPImagen]
  activo             boolean not null default true,  -- [ChoferActivo] A/B
  creado_en_migracion boolean not null default false, -- choferes que figuran en manifiestos pero ya no estaban en la tabla
  unique (transportista_id, nombre)
);

-- ---------------------------------------------------------------------
-- Operadores de disposición final [OperadorDispFinal]
-- ---------------------------------------------------------------------
create table operadores (
  id                 bigint generated always as identity primary key,
  nombre             text not null unique,           -- [IdOperadorDF] (en el Access el nombre era la clave)
  cuit               text,                           -- [CuitODF]
  direccion          text,                           -- [DirecciónODF]
  localidad          text,                           -- [LocalidadODF]
  provincia          text,                           -- [ProvinciaODF]
  cp                 text,                           -- [CPODF]
  telefono           text,                           -- [TelefonoODF]
  email              text,                           -- [emailODF]
  ubicacion          text,                           -- [UbicacionODF]
  hab_nac_nro        text,  hab_nac_vto date,        -- [NroHabNac / VtoHabNac]
  hab_pro_nro        text,  hab_pro_vto date,        -- [HabProNroODF / HabProVtoODF]
  hab_mun_nro        text,  hab_mun_vto date,        -- [HabMunNroODF / HabMunVtoODF]
  hab_nac_archivo    text,                           -- [HabilitacionNacion]
  hab_pro_archivo    text,                           -- [HabProODF]
  hab_mun_archivo    text,                           -- [HabMunODF]
  activo             boolean not null default true
);

-- ---------------------------------------------------------------------
-- Corrientes y habilitaciones por corriente
-- ---------------------------------------------------------------------
create table corrientes (                            -- [Corrientes]
  id               bigint generated always as identity primary key,
  codigo           text not null unique,             -- [IdCorrientes] tal cual: "Y48 C/Y9", "Y48Y9A"…
  descripcion      text,                             -- [DescripCorrientes]
  um               unidad_medida,                    -- [UM]
  estado_fisico    text,                             -- [EstadoCte] normalizado: SÓLIDO / LÍQUIDO / SEMISÓLIDO
  grupo_incompat   text,                             -- nuevo: baterías, ácidos, bases, asbestos… (pregunta abierta)
  activa           boolean not null default true,
  creada_en_migracion boolean not null default false -- corrientes usadas en manifiestos que no estaban en la tabla
);

create table planta_corrientes (                     -- [GeneradorCorrientes]: qué recibe cada generador principal
  generador_principal_id bigint not null references generadores_principales(id) on delete cascade,
  corriente_id           bigint not null references corrientes(id),
  um                     unidad_medida,              -- [UM]
  primary key (generador_principal_id, corriente_id)
);
create table transportista_corrientes (              -- [TransporteCorrientes]
  transportista_id bigint not null references transportistas(id) on delete cascade,
  corriente_id     bigint not null references corrientes(id),
  um               unidad_medida,
  primary key (transportista_id, corriente_id)
);
create table operador_corrientes (                   -- [OperadorDispFinalCorrientes]
  operador_id      bigint not null references operadores(id) on delete cascade,
  corriente_id     bigint not null references corrientes(id),
  primary key (operador_id, corriente_id)
);

-- ---------------------------------------------------------------------
-- Manifiestos de retiro y sus residuos [Manifiestos] [ManifiestoDet]
-- ---------------------------------------------------------------------
create table manifiestos (
  id                      bigint generated always as identity primary key,
  numero                  text not null,             -- [IdManifiesto] 9 dígitos con ceros: "837007468", "000757127"
  transportista_id        bigint not null references transportistas(id), -- [IdNroTransp]
  tipo                    tipo_manifiesto not null default 'azul',
  fecha                   date not null,             -- [FchaAltaManif]
  generador_id            bigint not null references generadores(id),    -- [IdClientes]
  generador_principal_id  bigint references generadores_principales(id), -- [IdGenerador] (0 o vacío → nulo)
  direccion_retiro        text,                      -- [RetiroDirec] texto tal cual (muchas no están en ClientesDirecciones)
  chofer_id               bigint references choferes(id),  -- [IdChofer] + [IdNroTransp]
  camion_id               bigint references camiones(id),  -- [IdPatente] + [IdNroTransp]
  nota                    text,                      -- [NotaManif]
  forma_transporte        text,                      -- [FormaDeTransp]
  escaneo                 text,                      -- [Ruta] escaneo firmado
  anulado                 boolean not null default false, -- en el Access: "ANULADO" escrito en chofer o dirección
  anulado_motivo          text,
  creado_por              uuid references auth.users(id),
  creado                  timestamptz not null default now(), -- [FchUsrAlta]
  modificado_por          uuid references auth.users(id),
  modificado              timestamptz,               -- [FchUsrModi]
  usuario_access          integer,                   -- [NroUsrAlta]
  unique (transportista_id, numero)                  -- el número se repite entre transportistas
);
create index manifiestos_numero_idx on manifiestos (numero);
create index manifiestos_generador_fecha_idx on manifiestos (generador_id, fecha);
create index manifiestos_fecha_idx on manifiestos (fecha);
create index manifiestos_gp_idx on manifiestos (generador_principal_id);

create table manifiestos_nacion (                    -- [ManifTransNacion] formulario verde
  id                      bigint generated always as identity primary key,
  numero                  text not null unique,      -- [IdManTraNac]
  fecha                   date not null,             -- [FchaManTraNac]
  transportista_id        bigint references transportistas(id),          -- [IdNroTransp]
  generador_principal_id  bigint references generadores_principales(id), -- [IdGenerador]
  operador_id             bigint references operadores(id),              -- [OperadorDF] (vacío en 1.252)
  hab_nac_nro             text,  hab_nac_vto date,   -- [MnNroHabNac / MnVtoHabNac] copia al emitir
  escaneo                 text,                      -- [LogoManTraNac]
  creado                  timestamptz not null default now(),
  usuario_access          integer
);
create index manifiestos_nacion_fecha_idx on manifiestos_nacion (fecha);

create table certificados (                          -- [CertificadosDispFinal]
  id                      bigint generated always as identity primary key,
  numero                  text not null,             -- [NroCertDispFinal] (se repite entre operadores)
  manifiesto_nacion_id    bigint references manifiestos_nacion(id),      -- [IdManTraNac]
  fecha                   date not null,             -- [FechaCertificado]
  operador_id             bigint references operadores(id),              -- [IdOperadorDF]
  generador_principal_id  bigint references generadores_principales(id), -- [IdGenerador]
  corriente_id            bigint references corrientes(id),              -- [IdCte]
  kgs                     numeric(14,3),             -- [Kgs]
  lts                     numeric(14,3),             -- [Lts]
  tipo_tratamiento        text,                      -- [TipoTratamientoODF] D1, D5, R7/R9/R11…
  tipo                    char(1),                   -- [CDFTipo] P / N (a confirmar: ¿provincial / nacional?)
  fecha_listado           date,                      -- [FechaListCDF]
  entregado               boolean not null default false, -- [CDFentregado]
  entregado_fecha         date,                      -- [CDFentFecha]
  habilitaciones          jsonb,                     -- [ODFNroHabNac, GPNroHab*…] copia al emitir
  archivo                 text,                      -- [Imagen] PDF · riesgo principal de la migración
  enviado_cliente         timestamptz,               -- nuevo: aviso automático al generador
  creado                  timestamptz not null default now(),
  usuario_access          integer,
  unique nulls not distinct (numero, manifiesto_nacion_id) -- misma clave que el Access
);
create index certificados_operador_idx on certificados (operador_id, numero);

create table manifiesto_items (                      -- [ManifiestoDet]
  id                    bigint generated always as identity primary key,
  id_access             integer unique,              -- [IdDetManif]
  manifiesto_id         bigint not null references manifiestos(id) on delete cascade,
  corriente_id          bigint not null references corrientes(id), -- [IdCorriente]
  contenedor            text,                        -- [DescripcionIngreso] BATEA, TAMBOR, BOLSAS…
  descripcion_egreso    text,                        -- [DescripcionEgreso]
  cant_estimada         numeric(14,3),               -- nuevo (formulario: Cant. Estimada)
  cantidad              numeric(14,3) not null,      -- [Cantidad]
  um                    unidad_medida not null,      -- [IdMedida]
  estado                estado_residuo not null default 'almacenado', -- [EstadoDetManif]
  manifiesto_nacion_id  bigint references manifiestos_nacion(id),     -- [IdManTraNac]
  certificado_id        bigint references certificados(id),           -- [NroCertDispFinal + IdManTraNac]
  fecha_entrega_df      date,                        -- [FchaEntDF]
  rpg_nro               integer,                     -- [RPG] 734
  cert_rp_nro           integer,                     -- [NroCert] certificado RPGyOSP (pregunta abierta)
  ref_access            jsonb                        -- referencias originales que no se pudieron enlazar
);
create index items_manifiesto_idx on manifiesto_items (manifiesto_id);
create index items_estado_idx on manifiesto_items (estado);
create index items_nacion_idx on manifiesto_items (manifiesto_nacion_id);
create index items_certificado_idx on manifiesto_items (certificado_id);
create index items_corriente_idx on manifiesto_items (corriente_id);

-- ---------------------------------------------------------------------
-- Usuarios y permisos
-- ---------------------------------------------------------------------
create table perfiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  nombre        text not null,
  rol           rol_usuario not null default 'consulta', -- [Usuarios.Nivel] 90/80 → admin/operador · 50 → cliente
  activo        boolean not null default true,       -- [Baneado] invertido
  notas         text,
  creado        timestamptz not null default now()
);
create table perfil_generadores (                    -- qué generadores ve cada usuario del portal
  perfil_id     uuid not null references perfiles(id) on delete cascade,
  generador_id  bigint not null references generadores(id) on delete cascade,
  primary key (perfil_id, generador_id)
);
-- En el Access el portal filtraba por rango de CUIT [strdesde/strhasta]. Un CUIT puede
-- tener más de un generador (p. ej. GE Oil & Gas y Wood Group), por eso la tabla puente.

-- ---------------------------------------------------------------------
-- Historial de cambios (los triggers se crean en 0002, después de la carga)
-- ---------------------------------------------------------------------
create table historial (
  id          bigint generated always as identity primary key,
  tabla       text not null,
  registro    text not null,
  accion      text not null check (accion in ('alta','cambio','baja')),
  antes       jsonb,
  despues     jsonb,
  usuario     uuid,
  fecha       timestamptz not null default now()
);
create index historial_registro_idx on historial (tabla, registro);

-- ---------------------------------------------------------------------
-- Migración: corridas, inconsistencias y archivos
-- ---------------------------------------------------------------------
create table migracion_corridas (
  id        bigint generated always as identity primary key,
  inicio    timestamptz not null default now(),
  fin       timestamptz,
  resumen   jsonb                                    -- conteos por tabla: Access vs. Supabase
);
create table migracion_inconsistencias (
  id          bigint generated always as identity primary key,
  corrida_id  bigint not null references migracion_corridas(id) on delete cascade,
  tabla       text not null,
  clave_access text,
  resultado   text not null check (resultado in ('corregido','migrado_sin_enlace','revisar','descartado')),
  problema    text not null,
  detalle     jsonb
);
create index migracion_incons_idx on migracion_inconsistencias (corrida_id, tabla, problema);
create table migracion_archivos (                    -- seguimiento de los PDF e imágenes
  ruta_access  text primary key,                     -- \\USUARIO-PC\Users\Usuario\Documents\SERCOAMBIENTAL\RAYGROUP\…
  carpeta      text,                                 -- Manifiestos, ManifiestosNacion, CertDispFinal, Vehiculos…
  archivo_local text,                                -- archivo encontrado en la copia de RAYGROUP
  como         text check (como in ('ruta','numero')), -- encontrado por la ruta del Access o buscando por número
  storage_path text,                                 -- destino en el bucket "documentos"
  encontrado   boolean not null default false,
  bytes        bigint,
  subido       timestamptz,
  corrida_id   bigint references migracion_corridas(id)
);

-- ---------------------------------------------------------------------
-- Nombres de los documentos en el Storage (bucket "documentos")
-- Misma regla que en el Access: una carpeta por tipo de documento y el
-- archivo se llama con el número único del documento.
-- Los certificados van en una subcarpeta por operador porque el número
-- se repite entre operadores (en el Access se resolvía con un prefijo:
-- "Quimi-", "Ineco ", "Seres ").
-- ---------------------------------------------------------------------
create or replace function ruta_documento(tipo text, numero text, operador_id bigint default null, ext text default 'pdf')
returns text language sql immutable as $$
  select case tipo
    when 'manifiesto'  then 'manifiestos/' || numero || '.' || lower(ext)
    when 'nacion'      then 'manifiestos-nacion/' || numero || '.' || lower(ext)
    when 'certificado' then 'certificados/' || coalesce(operador_id::text, 'sin-operador') || '/' || numero || '.' || lower(ext)
  end
$$;

-- ---------------------------------------------------------------------
-- Vistas
-- ---------------------------------------------------------------------
create view vencimientos with (security_invoker = true) as
  select 'camion'::text as tipo, c.id, c.patente as nombre, 'VTV'::text as documento, c.vtv_vto as vto from camiones c where c.activo
  union all select 'camion', c.id, c.patente, 'Carga peligrosa', c.carga_pel_vto from camiones c where c.activo
  union all select 'camion', c.id, c.patente, 'Ruta', c.ruta_vto from camiones c where c.activo
  union all select 'chofer', h.id, h.nombre, 'Carnet', h.carnet_vto from choferes h where h.activo
  union all select 'chofer', h.id, h.nombre, 'Licencia carga peligrosa', h.carga_pel_vto from choferes h where h.activo
  union all select 'chofer', h.id, h.nombre, 'Psicofísico', h.sep_vto from choferes h where h.activo
  union all select 'generador', g.id, g.nombre, 'Habilitación municipal', g.hab_mun_vto from generadores g where g.activo
  union all select 'transportista', t.id, t.nombre, 'Habilitación provincial', t.hab_pro_vto from transportistas t where t.activo
  union all select 'transportista', t.id, t.nombre, 'Habilitación nacional', t.hab_nac_vto from transportistas t where t.activo
  union all select 'operador', o.id, o.nombre, 'Habilitación nacional', o.hab_nac_vto from operadores o where o.activo
  union all select 'planta', p.id, p.nombre, 'Habilitación provincial', p.hab_pro_vto from generadores_principales p where p.activo;

-- Una fila por residuo con todo lo que muestra "Manifiestos por generador"
create view residuos_detalle with (security_invoker = true) as
  select i.id, m.id as manifiesto_id, m.numero, m.fecha, m.tipo,
         m.generador_id, g.nombre as generador,
         m.generador_principal_id, gp.nombre as generador_principal,
         t.nombre as transportista, ca.patente, ch.nombre as chofer,
         c.codigo as corriente, i.contenedor, i.cantidad, i.um, i.estado,
         mn.numero as manifiesto_nacion, ce.numero as certificado,
         i.fecha_entrega_df, o.nombre as operador
  from manifiesto_items i
  join manifiestos m on m.id = i.manifiesto_id
  join generadores g on g.id = m.generador_id
  join transportistas t on t.id = m.transportista_id
  join corrientes c on c.id = i.corriente_id
  left join generadores_principales gp on gp.id = m.generador_principal_id
  left join camiones ca on ca.id = m.camion_id
  left join choferes ch on ch.id = m.chofer_id
  left join manifiestos_nacion mn on mn.id = i.manifiesto_nacion_id
  left join certificados ce on ce.id = i.certificado_id
  left join operadores o on o.id = coalesce(ce.operador_id, mn.operador_id);

-- ---------------------------------------------------------------------
-- Seguridad por filas (RLS)
--   Las funciones van entre paréntesis con select, (select es_interno()), para que
--   Postgres las evalúe una vez por consulta y no una vez por fila.
--   Personal de Serco: admin y operador editan, consulta solo lee.
--   Clientes (portal): ven solo lo de sus generadores.
-- ---------------------------------------------------------------------
create or replace function mi_rol() returns rol_usuario
language sql stable security definer set search_path = public as $$
  select rol from perfiles where id = auth.uid() and activo
$$;
create or replace function es_interno() returns boolean
language sql stable set search_path = public as $$ select coalesce(mi_rol() in ('admin','operador','consulta'), false) $$;
create or replace function puede_editar() returns boolean
language sql stable set search_path = public as $$ select coalesce(mi_rol() in ('admin','operador'), false) $$;
create or replace function mis_generadores() returns setof bigint
language sql stable security definer set search_path = public as $$
  select pg.generador_id from perfil_generadores pg join perfiles p on p.id = pg.perfil_id
  where p.id = auth.uid() and p.activo and p.rol = 'cliente'
$$;
create or replace function es_cliente() returns boolean
language sql stable set search_path = public as $$ select coalesce(mi_rol() = 'cliente', false) $$;

do $$
declare t text;
begin
  foreach t in array array['provincias','ciudades','actividades','parametros','generadores_principales',
                           'generadores','generador_direcciones','transportistas','camiones','choferes',
                           'operadores','corrientes','planta_corrientes','transportista_corrientes',
                           'operador_corrientes','manifiestos','manifiestos_nacion','certificados',
                           'manifiesto_items']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using ((select es_interno()))', t||'_leer', t);
    execute format('create policy %I on %I for all using ((select puede_editar())) with check ((select puede_editar()))', t||'_editar', t);
  end loop;
end $$;

-- Portal de clientes
create policy generadores_portal on generadores for select using (id in (select mis_generadores()));
create policy manifiestos_portal on manifiestos for select using (generador_id in (select mis_generadores()));
create policy items_portal on manifiesto_items for select
  using (manifiesto_id in (select m.id from manifiestos m where m.generador_id in (select mis_generadores())));
create policy certificados_portal on certificados for select
  using (id in (select i.certificado_id from manifiesto_items i join manifiestos m on m.id = i.manifiesto_id
                where m.generador_id in (select mis_generadores())));
create policy nacion_portal on manifiestos_nacion for select
  using (id in (select i.manifiesto_nacion_id from manifiesto_items i join manifiestos m on m.id = i.manifiesto_id
                where m.generador_id in (select mis_generadores())));
do $$
declare t text;
begin
  foreach t in array array['corrientes','operadores','transportistas','generadores_principales','camiones','choferes']
  loop
    execute format('create policy %I on %I for select using ((select es_cliente()))', t||'_portal', t);
  end loop;
end $$;

alter table perfiles enable row level security;
create policy perfiles_propio on perfiles for select using (id = (select auth.uid()) or (select mi_rol()) = 'admin');
create policy perfiles_admin  on perfiles for all using ((select mi_rol()) = 'admin') with check ((select mi_rol()) = 'admin');
alter table perfil_generadores enable row level security;
create policy perfil_gen_propio on perfil_generadores for select using (perfil_id = (select auth.uid()) or (select mi_rol()) = 'admin');
create policy perfil_gen_admin  on perfil_generadores for all using ((select mi_rol()) = 'admin') with check ((select mi_rol()) = 'admin');

alter table historial enable row level security;
create policy historial_leer on historial for select using ((select es_interno()));
alter table migracion_corridas enable row level security;
create policy mig_corridas_leer on migracion_corridas for select using ((select es_interno()));
alter table migracion_inconsistencias enable row level security;
create policy mig_incons_leer on migracion_inconsistencias for select using ((select es_interno()));
alter table migracion_archivos enable row level security;
create policy mig_archivos_leer on migracion_archivos for select using ((select es_interno()));
