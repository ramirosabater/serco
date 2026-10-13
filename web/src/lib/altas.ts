// Configuración de las pantallas de Altas: qué campos y qué documentos con vencimiento tiene cada cosa.
export type TipoCampo = 'texto' | 'numero' | 'fecha' | 'bool' | 'opciones' | 'ref' | 'email' | 'cuit'

export interface Campo {
  k: string
  label: string
  tipo: TipoCampo
  req?: boolean
  opciones?: { v: string; l: string }[]
  ref?: { tabla: string; label: string; filtro?: Record<string, unknown> }
  ayuda?: string
  ancho?: 'doble'
}

/** Un documento con vencimiento: número (opcional), fecha de vencimiento y archivo escaneado */
export interface Documento { label: string; nro?: string; vto: string; archivo?: string }

export type Extra = 'corrientes' | 'direcciones'

export interface Entidad {
  clave: string
  tabla: string
  titulo: string
  singular: string
  nombre: string
  /** columnas para el listado además del nombre */
  columnas?: { k: string; label: string; ref?: string }[]
  select?: string
  campos: Campo[]
  documentos: Documento[]
  extras?: Extra[]
  /** tabla y columna de corrientes habilitadas */
  corrientes?: { tabla: string; fk: string; conUm: boolean }
  activo: 'activo' | 'activa'
  ayuda: string
}

const UM = [{ v: 'KGS', l: 'kg' }, { v: 'LTS', l: 'litros' }, { v: 'MS3', l: 'm³' }]
const transportista: Campo = { k: 'transportista_id', label: 'Transportista', tipo: 'ref', req: true, ref: { tabla: 'transportistas', label: 'nombre' } }
const contacto: Campo[] = [
  { k: 'cuit', label: 'CUIT', tipo: 'cuit' },
  { k: 'direccion', label: 'Dirección', tipo: 'texto', ancho: 'doble' },
  { k: 'provincia', label: 'Provincia', tipo: 'texto' },
  { k: 'cp', label: 'Código postal', tipo: 'texto' },
  { k: 'telefono', label: 'Teléfono', tipo: 'texto' },
  { k: 'email', label: 'Mail', tipo: 'email', ayuda: 'A donde llegan los avisos automáticos' },
]
const habilitaciones = (sufijo = ''): Documento[] => [
  { label: 'Habilitación nacional' + sufijo, nro: 'hab_nac_nro', vto: 'hab_nac_vto', archivo: 'hab_nac_archivo' },
  { label: 'Habilitación provincial' + sufijo, nro: 'hab_pro_nro', vto: 'hab_pro_vto', archivo: 'hab_pro_archivo' },
  { label: 'Habilitación municipal' + sufijo, nro: 'hab_mun_nro', vto: 'hab_mun_vto', archivo: 'hab_mun_archivo' },
]

export const ENTIDADES: Entidad[] = [
  {
    clave: 'camiones', tabla: 'camiones', titulo: 'Camiones', singular: 'camión', nombre: 'patente', activo: 'activo',
    ayuda: 'Con la VTV, la carga peligrosa o la ruta vencidas, el camión no puede salir con un manifiesto.',
    select: '*, transportistas(nombre)', columnas: [{ k: 'transportistas', label: 'Transportista', ref: 'nombre' }, { k: 'tipo', label: 'Tipo' }],
    campos: [
      { k: 'patente', label: 'Patente', tipo: 'texto', req: true },
      transportista,
      { k: 'tipo', label: 'Tipo', tipo: 'texto', ayuda: 'Batea, cisterna, chasis…' },
      { k: 'capacidad', label: 'Capacidad', tipo: 'numero', ayuda: 'Se usa para armar las cargas' },
      { k: 'capacidad_um', label: 'Unidad de la capacidad', tipo: 'opciones', opciones: UM },
    ],
    documentos: [
      { label: 'VTV', vto: 'vtv_vto', archivo: 'vtv_archivo' },
      { label: 'Carga peligrosa', nro: 'carga_pel_nro', vto: 'carga_pel_vto', archivo: 'carga_pel_archivo' },
      { label: 'Habilitación de ruta', vto: 'ruta_vto', archivo: 'ruta_archivo' },
    ],
  },
  {
    clave: 'choferes', tabla: 'choferes', titulo: 'Choferes', singular: 'chofer', nombre: 'nombre', activo: 'activo',
    ayuda: 'Con el carnet, la licencia de carga peligrosa o el psicofísico vencidos, el chofer no puede salir con un manifiesto.',
    select: '*, transportistas(nombre)', columnas: [{ k: 'transportistas', label: 'Transportista', ref: 'nombre' }],
    campos: [{ k: 'nombre', label: 'Apellido y nombre', tipo: 'texto', req: true, ancho: 'doble' }, transportista],
    documentos: [
      { label: 'Carnet de conducir', nro: 'carnet_nro', vto: 'carnet_vto', archivo: 'carnet_archivo' },
      { label: 'Licencia de carga peligrosa (CNRT)', vto: 'carga_pel_vto', archivo: 'carga_pel_archivo' },
      { label: 'Psicofísico', vto: 'sep_vto', archivo: 'sep_archivo' },
    ],
  },
  {
    clave: 'transportistas', tabla: 'transportistas', titulo: 'Transportistas', singular: 'transportista', nombre: 'nombre', activo: 'activo',
    ayuda: 'Con la habilitación provincial vencida, el transportista no puede emitir manifiestos.',
    columnas: [{ k: 'cuit', label: 'CUIT' }],
    campos: [
      { k: 'nombre', label: 'Razón social', tipo: 'texto', req: true, ancho: 'doble' },
      ...contacto, { k: 'localidad', label: 'Localidad', tipo: 'texto' },
      { k: 'emite_manifiestos', label: 'Emite manifiestos de Serco (formulario azul)', tipo: 'bool' },
    ],
    documentos: habilitaciones(),
    extras: ['corrientes'], corrientes: { tabla: 'transportista_corrientes', fk: 'transportista_id', conUm: true },
  },
  {
    clave: 'generadores', tabla: 'generadores', titulo: 'Generadores', singular: 'generador', nombre: 'nombre', activo: 'activo',
    ayuda: 'La habilitación municipal del generador se controla al emitir el manifiesto.',
    select: '*, generadores_principales(nombre)', columnas: [{ k: 'cuit', label: 'CUIT' }, { k: 'ciudad', label: 'Ciudad' }],
    campos: [
      { k: 'nombre', label: 'Razón social', tipo: 'texto', req: true, ancho: 'doble' },
      ...contacto, { k: 'ciudad', label: 'Ciudad', tipo: 'texto' },
      { k: 'actividad', label: 'Actividad', tipo: 'texto' },
      { k: 'generador_principal_id', label: 'Planta que recibe sus residuos', tipo: 'ref', ref: { tabla: 'generadores_principales', label: 'nombre' } },
      { k: 'contacto_nombre', label: 'Nombre del contacto', tipo: 'texto' },
      { k: 'contacto_apellido', label: 'Apellido del contacto', tipo: 'texto' },
      { k: 'celular', label: 'Celular', tipo: 'texto' },
    ],
    documentos: [
      { label: 'Habilitación municipal', nro: 'hab_mun_nro', vto: 'hab_mun_vto', archivo: 'hab_mun_archivo' },
      { label: 'Habilitación comercial', nro: 'hab_com_nro', vto: 'hab_com_vto', archivo: 'hab_com_archivo' },
    ],
    extras: ['direcciones'],
  },
  {
    clave: 'plantas', tabla: 'generadores_principales', titulo: 'Plantas', singular: 'planta', nombre: 'nombre', activo: 'activo',
    ayuda: 'Las plantas que reciben los residuos (en el Access, "Generador principal").',
    columnas: [{ k: 'cuit', label: 'CUIT' }, { k: 'ciudad', label: 'Ciudad' }],
    campos: [{ k: 'nombre', label: 'Nombre', tipo: 'texto', req: true, ancho: 'doble' }, ...contacto, { k: 'ciudad', label: 'Ciudad', tipo: 'texto' }],
    documentos: habilitaciones(),
    extras: ['corrientes'], corrientes: { tabla: 'planta_corrientes', fk: 'generador_principal_id', conUm: true },
  },
  {
    clave: 'operadores', tabla: 'operadores', titulo: 'Operadores', singular: 'operador', nombre: 'nombre', activo: 'activo',
    ayuda: 'Operadores de disposición final. Solo reciben las corrientes para las que están habilitados.',
    columnas: [{ k: 'cuit', label: 'CUIT' }, { k: 'provincia', label: 'Provincia' }],
    campos: [{ k: 'nombre', label: 'Razón social', tipo: 'texto', req: true, ancho: 'doble' }, ...contacto, { k: 'localidad', label: 'Localidad', tipo: 'texto' }],
    documentos: habilitaciones(),
    extras: ['corrientes'], corrientes: { tabla: 'operador_corrientes', fk: 'operador_id', conUm: false },
  },
  {
    clave: 'corrientes', tabla: 'corrientes', titulo: 'Corrientes', singular: 'corriente', nombre: 'codigo', activo: 'activa',
    ayuda: 'Las corrientes de residuos que maneja Serco.',
    columnas: [{ k: 'descripcion', label: 'Descripción' }, { k: 'estado_fisico', label: 'Estado físico' }],
    campos: [
      { k: 'codigo', label: 'Código', tipo: 'texto', req: true, ayuda: 'Como figura en el manifiesto, por ejemplo Y48Y9A' },
      { k: 'descripcion', label: 'Descripción', tipo: 'texto', ancho: 'doble' },
      { k: 'um', label: 'Unidad habitual', tipo: 'opciones', opciones: UM },
      { k: 'estado_fisico', label: 'Estado físico', tipo: 'opciones', opciones: [{ v: 'SÓLIDO', l: 'Sólido' }, { v: 'LÍQUIDO', l: 'Líquido' }, { v: 'SEMISÓLIDO', l: 'Semisólido' }] },
      { k: 'grupo_incompat', label: 'Grupo de incompatibilidad', tipo: 'texto', ayuda: 'Residuos del mismo grupo no viajan con otros grupos (baterías, ácidos, bases, asbestos…)' },
    ],
    documentos: [],
  },
]

export const entidad = (clave?: string) => ENTIDADES.find((e) => e.clave === clave)

export type EstadoDoc = 'vencido' | 'sin_cargar' | 'por_vencer' | 'vigente'
const DIAS_AVISO = 45

export function estadoVto(vto: string | null | undefined, hoy = new Date().toISOString().slice(0, 10)): EstadoDoc {
  if (!vto) return 'sin_cargar'
  if (vto < hoy) return 'vencido'
  const dias = (Date.parse(vto) - Date.parse(hoy)) / 86400000
  return dias <= DIAS_AVISO ? 'por_vencer' : 'vigente'
}

/** El peor estado entre todos los documentos */
export function estadoFicha(e: Entidad, fila: Record<string, unknown>): EstadoDoc | null {
  if (!e.documentos.length) return null
  const orden: EstadoDoc[] = ['vencido', 'sin_cargar', 'por_vencer', 'vigente']
  const estados = e.documentos.map((d) => estadoVto(fila[d.vto] as string | null))
  return orden.find((o) => estados.includes(o)) ?? 'vigente'
}

export const ETIQUETA_ESTADO: Record<EstadoDoc, [string, string]> = {
  vencido: ['Vencido', 'bad'], sin_cargar: ['Falta cargar', 'bad'], por_vencer: ['Por vencer', 'haz'], vigente: ['Al día', 'ok'],
}
