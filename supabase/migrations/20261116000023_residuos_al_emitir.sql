-- =====================================================================
-- Gestión Serco · Residuos previstos al emitir (pedido de Serco, 16/11/2026)
--
-- En el paso 1 (Emitir) se elige la corriente de cada residuo: la descripción, la unidad y el estado físico se
-- completan solos y salen impresos en la sección 3 del formulario. El tipo de contenedor y la cantidad real se
-- escriben a mano y se cargan después, al entrar a planta (paso 2), con las mismas corrientes ya puestas.
-- Lo previsto queda en el manifiesto (no son residuos todavía: no cuenta en estadísticas ni cambia la etapa).
-- Se puede correr más de una vez.
-- =====================================================================
alter table manifiestos add column if not exists residuos_previstos jsonb;
comment on column manifiestos.residuos_previstos is
  'Corrientes elegidas al emitir: [{"corriente_id": 12, "um": "KGS"}]. La sección 3 se carga al entrar a planta.';

create or replace function emitir_manifiesto(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_id bigint; v_tr bigint := (p->>'transportista_id')::bigint; v_num text := p->>'numero';
  v_sug text; v_aviso text; v_emite boolean; it jsonb; v_hay boolean; v_prev jsonb;
begin
  if not puede_editar() and auth.uid() is not null then raise exception 'Tu usuario no puede emitir manifiestos'; end if;
  if v_num !~ '^\d{9}$' then raise exception 'El número tiene que tener 9 dígitos, como figura en el formulario (ej. 837007470)'; end if;
  if exists (select 1 from manifiestos where transportista_id = v_tr and numero = v_num) then
    raise exception 'El formulario % ya está usado', left(v_num, 3) || '-' || substr(v_num, 4);
  end if;
  v_sug := sugerir_numero(v_tr);
  if v_sug is not null and left(v_sug, 3) = left(v_num, 3) and v_num > v_sug then
    v_aviso := 'Se saltearon formularios: el siguiente era ' || left(v_sug, 3) || '-' || substr(v_sug, 4)
               || '. Si se perdieron o rompieron, hay que anularlos.';
  end if;
  select emite_manifiestos into v_emite from transportistas where id = v_tr;
  v_hay := jsonb_array_length(coalesce(p->'items', '[]')) > 0;

  -- corrientes previstas: solo las que existen, con su unidad (la que eligieron o la habitual de la corriente)
  select jsonb_agg(jsonb_build_object('corriente_id', c.id,
                   'um', coalesce(nullif(x.e->>'um', ''), c.um::text, 'KGS')) order by x.n)
    into v_prev
  from jsonb_array_elements(case when jsonb_typeof(p->'previstos') = 'array' then p->'previstos' else '[]' end)
       with ordinality x(e, n)
  join corrientes c on c.id = (x.e->>'corriente_id')::bigint;
  if jsonb_array_length(coalesce(v_prev, '[]')) > 7 then raise exception 'El formulario tiene 7 renglones'; end if;

  insert into manifiestos (numero, transportista_id, tipo, fecha, generador_id, generador_principal_id, direccion_retiro,
                           chofer_id, camion_id, nota, validacion_omitida, instrucciones, ingreso_planta, residuos_previstos, creado_por)
  values (v_num, v_tr, case when v_emite then 'azul' else 'rosa' end::tipo_manifiesto,
          coalesce((p->>'fecha')::date, current_date), (p->>'generador_id')::bigint,
          (p->>'generador_principal_id')::bigint, p->>'direccion_retiro', (p->>'chofer_id')::bigint,
          (p->>'camion_id')::bigint, p->>'nota', p->>'validacion_omitida', p->'instrucciones',
          case when v_hay then coalesce((p->>'fecha')::date, current_date) end, v_prev, auth.uid())
  returning id into v_id;

  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]')) loop
    insert into manifiesto_items (manifiesto_id, corriente_id, contenedor, cant_estimada, cantidad, um)
    values (v_id, (it->>'corriente_id')::bigint, it->>'contenedor', (it->>'cant_estimada')::numeric,
            (it->>'cantidad')::numeric, (it->>'um')::unidad_medida);
  end loop;
  if coalesce((select valor from parametros where clave = 'bloquear_generador'), 'si') <> 'si'
     and coalesce(array_length(problemas_generador((p->>'generador_id')::bigint, coalesce((p->>'fecha')::date, current_date)), 1), 0) > 0 then
    v_aviso := concat_ws(' · ', v_aviso, array_to_string(problemas_generador((p->>'generador_id')::bigint,
                                                          coalesce((p->>'fecha')::date, current_date)), ' · '));
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'aviso', v_aviso);
end $$;
