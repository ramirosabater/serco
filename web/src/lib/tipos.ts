// Tipos de las tablas y vistas que usa la app.
// Cuando el proyecto Supabase esté creado, reemplazar por los generados:
//   npx supabase gen types typescript --project-id <proyecto> > src/lib/database.types.ts

export type Rol = 'admin' | 'operador' | 'consulta' | 'cliente'
export type UM = 'KGS' | 'LTS' | 'MS3'
export type EstadoResiduo = 'almacenado' | 'en_transito' | 'disposicion_final'

export interface Perfil { id: string; nombre: string; rol: Rol; activo: boolean }

export interface Item {
  id: number
  corriente_id: number
  contenedor: string | null
  cantidad: number
  um: UM
  estado: EstadoResiduo
  fecha_entrega_df: string | null
  corrientes?: { codigo: string; descripcion: string | null } | null
  manifiestos_nacion?: { id: number; numero: string; fecha: string; escaneo?: string | null; operadores?: { nombre: string } | null } | null
  certificados?: { id: number; numero: string; fecha: string; archivo: string | null; enviado_cliente?: string | null; operadores?: { nombre: string } | null } | null
}

export interface Manifiesto {
  id: number
  numero: string
  fecha: string
  tipo: 'azul' | 'rosa'
  anulado: boolean
  anulado_motivo: string | null
  direccion_retiro: string | null
  nota: string | null
  escaneo: string | null
  validacion_omitida?: string | null
  instrucciones?: Instrucciones | null
  /** Etapa calculada en la base: 0 almacenado, 1 en tránsito, 2 dispuesto, 3 certificado entregado */
  etapa?: number
  creado?: string
  generadores?: { id: number; nombre: string; cuit: string | null } | null
  generadores_principales?: { nombre: string } | null
  transportistas?: { id: number; nombre: string } | null
  choferes?: { nombre: string } | null
  camiones?: { patente: string } | null
  manifiesto_items?: Item[]
}

export interface Alerta {
  tipo: 'camion' | 'chofer' | 'generador' | 'transportista' | 'operador' | 'planta'
  id: number
  nombre: string
  documento: string
  vto: string | null
  dias: number | null
  estado: 'sin_cargar' | 'vencido' | 'por_vencer' | 'vigente'
}

export interface Opcion { id: number; nombre: string }

/** Bloque 4 del formulario azul: instrucciones de manipulación */
export interface Instrucciones {
  inhalacion: 'Baja' | 'Media' | 'Alta'
  dermica: 'Baja' | 'Media' | 'Alta'
  oral: 'Baja' | 'Media' | 'Alta'
  /** inflamabilidad, reactividad, toxicidad, instrucciones especiales */
  peligros: [boolean, boolean, boolean, boolean]
  /** manipulación, contingencia, rol de emergencia, hoja de ruta, rutas alternativas */
  instructivos: [boolean, boolean, boolean, boolean, boolean]
}
