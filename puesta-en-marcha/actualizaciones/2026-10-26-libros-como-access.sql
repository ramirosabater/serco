-- =====================================================================
-- Gestión Serco · Libros rubricados como en el Access
-- Para el libro Nación (por manifiesto, solo certificados nacionales de la planta) hacen falta el tipo y la planta
-- del certificado y las habilitaciones nacionales (CAA) del transporte y del operador.
-- Se puede correr más de una vez.
-- =====================================================================
create or replace view libro_movimientos with (security_invoker = true) as
SELECT i.id,
    m.id AS manifiesto_id,
    m.numero,
    m.fecha,
    m.tipo,
    m.transportista_id,
    t.nombre AS transportista,
    m.generador_principal_id,
    gp.nombre AS planta,
    m.generador_id,
    g.nombre AS generador,
    g.cuit AS generador_cuit,
    m.direccion_retiro,
    ca.patente,
    ch.nombre AS chofer,
    c.codigo AS corriente,
    c.descripcion AS corriente_descripcion,
    i.contenedor,
    i.cantidad,
    i.um,
    i.estado,
    mn.numero AS nacion,
    mn.fecha AS nacion_fecha,
    ce.numero AS certificado,
    ce.fecha AS certificado_fecha,
    i.fecha_entrega_df,
    o.nombre AS operador,
    (m.viaje_id IS NOT NULL) AS formulario_viaje,
    ce.tipo AS certificado_tipo,
    ce.generador_principal_id AS certificado_planta_id,
    t.hab_nac_nro AS transportista_hab_nac,
    COALESCE(ce.habilitaciones ->> 'ODFNroHabNac'::text, o.hab_nac_nro) AS operador_hab_nac
   FROM ((((((((((manifiesto_items i
     JOIN manifiestos m ON (((m.id = i.manifiesto_id) AND (NOT m.anulado))))
     JOIN generadores g ON ((g.id = m.generador_id)))
     JOIN transportistas t ON ((t.id = m.transportista_id)))
     JOIN corrientes c ON ((c.id = i.corriente_id)))
     LEFT JOIN generadores_principales gp ON ((gp.id = m.generador_principal_id)))
     LEFT JOIN camiones ca ON ((ca.id = m.camion_id)))
     LEFT JOIN choferes ch ON ((ch.id = m.chofer_id)))
     LEFT JOIN manifiestos_nacion mn ON ((mn.id = i.manifiesto_nacion_id)))
     LEFT JOIN certificados ce ON ((ce.id = i.certificado_id)))
     LEFT JOIN operadores o ON ((o.id = COALESCE(ce.operador_id, mn.operador_id))));
grant select on libro_movimientos to authenticated;

-- Libro nacional: además, si el viaje tuvo certificado nacional (el libro Nación del Access solo lista esos)
-- y los CAA (habilitación nacional) de la planta, el transporte y el operador.
create or replace view libro_nacional with (security_invoker = true) as
SELECT mn.id, mn.numero, mn.fecha, o.nombre AS operador, t.nombre AS transportista, gp.nombre AS planta, mn.generador_principal_id,
    count(i.id) AS residuos,
    string_agg(DISTINCT c.codigo, ', '::text ORDER BY c.codigo) AS corrientes,
    sum(i.cantidad) FILTER (WHERE i.um = 'KGS'::unidad_medida) AS kgs,
    sum(i.cantidad) FILTER (WHERE i.um = 'LTS'::unidad_medida) AS lts,
    string_agg(DISTINCT ce.numero, ', '::text ORDER BY ce.numero) AS certificados,
    max(ce.fecha) AS certificado_fecha,
    bool_and(i.estado = 'disposicion_final'::estado_residuo) AS cerrado,
    coalesce(bool_or(ce.tipo = 'N'), false) AS nacional,
    gp.hab_nac_nro AS planta_hab_nac,
    t.hab_nac_nro AS transportista_hab_nac,
    coalesce(max(ce.habilitaciones ->> 'ODFNroHabNac'), o.hab_nac_nro) AS operador_hab_nac
FROM manifiestos_nacion mn
  LEFT JOIN manifiesto_items i ON i.manifiesto_nacion_id = mn.id
       AND NOT EXISTS (SELECT 1 FROM manifiestos fv WHERE fv.id = i.manifiesto_id AND fv.viaje_id = mn.id)
  LEFT JOIN corrientes c ON c.id = i.corriente_id
  LEFT JOIN certificados ce ON ce.id = i.certificado_id
  LEFT JOIN operadores o ON o.id = mn.operador_id
  LEFT JOIN transportistas t ON t.id = mn.transportista_id
  LEFT JOIN generadores_principales gp ON gp.id = mn.generador_principal_id
GROUP BY mn.id, o.nombre, o.hab_nac_nro, t.nombre, t.hab_nac_nro, gp.nombre, gp.hab_nac_nro;
grant select on libro_nacional to authenticated;
