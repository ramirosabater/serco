import type { Rol } from './tipos'

// Circuitos de ayuda de Serquito: tutoriales paso a paso, agrupados por área de la app.
//
// Cada paso:
//   texto  lo que dice Serquito (en voz alta y en el globo)
//   ir     a qué pantalla lleva antes de explicar. Solo navega: nunca toca guardar, borrar ni nada que cambie datos.
//          Además de una ruta ("/planta?v=transito") acepta atajos que buscan un ejemplo real:
//          ":manifiesto"  un manifiesto con residuos · ":manifiesto/imprimir" · ":manifiesto/etiquetas"
//          ":iniciado"    un manifiesto que espera la sección 3 · ":vencimiento"  la ficha de algo por vencer
//   foco   qué resaltar: el nombre de un data-ayuda, un selector CSS o un texto visible ("texto:Armar este viaje")
//   falta  qué decir si eso no está en pantalla (si no, avisa que puede ser un tema de permisos)
//
// Cada pantalla nueva de la app tiene que sumar su circuito acá.

export type Area = 'tablero' | 'manifiestos' | 'planta' | 'reportes' | 'altas' | 'configuracion' | 'cliente'

export interface Paso {
  titulo?: string
  texto: string
  ir?: string
  foco?: string
  falta?: string
  /** Botón extra del paso (por ejemplo, "Ver esos manifiestos"): navega y termina el circuito */
  boton?: { texto: string; ir: string }
}

export interface Circuito {
  id: string
  titulo: string
  area: Area
  roles: Rol[]
  pasos: Paso[]
}

/** Área de cada pantalla: cambia el "traje" de Serquito y qué circuitos muestra primero */
export function areaDe(ruta: string): Area {
  if (ruta.startsWith('/manifiestos') || ruta.startsWith('/agenda')) return 'manifiestos'
  if (ruta.startsWith('/planta') || ruta.startsWith('/nacion')) return 'planta'
  if (ruta.startsWith('/reportes')) return 'reportes'
  if (ruta.startsWith('/altas') || ruta.startsWith('/vencimientos')) return 'altas'
  if (ruta.startsWith('/configuracion')) return 'configuracion'
  if (ruta.startsWith('/vista-cliente') || ruta.startsWith('/portal')) return 'cliente'
  return 'tablero'
}

export const NOMBRE_AREA: Record<Area, string> = {
  tablero: 'Tablero', manifiestos: 'Manifiestos', planta: 'Planta', reportes: 'Reportes',
  altas: 'Altas y vencimientos', configuracion: 'Configuración', cliente: 'Portal del cliente',
}

const EDITAN: Rol[] = ['admin', 'operador']
const INTERNOS: Rol[] = ['admin', 'operador', 'consulta']

export const CIRCUITOS: Circuito[] = [
  // ---------------------------------------------------------------- Tablero
  {
    id: 'circuito', titulo: 'El circuito completo de un residuo', area: 'tablero', roles: EDITAN,
    pasos: [
      { ir: '/', foco: 'tab-etapas', titulo: 'Cinco etapas', texto: '¡Hola! Cada manifiesto pasa por cinco etapas: iniciado, almacenado, en tránsito, dispuesto y certificado entregado. Vení que te muestro dónde se hace cada una.' },
      { ir: '/manifiestos/nuevo', foco: 'nm-formulario', titulo: 'Iniciado: se emite', texto: 'Todo arranca acá. Cargás el generador, el transportista, el camión, el chofer y las instrucciones, y lo imprimís sobre el formulario azul.' },
      { foco: 'nm-residuos', titulo: 'Los residuos, después', texto: 'Fijate que los residuos no se cargan al emitir: se completan cuando la carga entra a planta, con lo que llegó de verdad.' },
      { ir: '/planta?v=ingresar', foco: 'pl-ingresar', titulo: 'Almacenado: entra a planta', texto: 'Cuando llega el camión, desde acá cargás la sección tres: corriente, contenedor y cantidades. Desde ese día cuenta el plazo en planta.' },
      { ir: '/planta', foco: 'pl-plan', titulo: 'En tránsito: el viaje', texto: 'Con lo almacenado, el sistema te propone los viajes según el vencimiento, el peso y el destino. Al armar uno se emite el Manifiesto Nación.' },
      { ir: '/planta?v=transito', foco: 'pl-esperando', titulo: 'Dispuesto: vuelve el certificado', texto: 'Cuando el operador manda el certificado de disposición final, lo registrás acá con su PDF.' },
      { ir: '/vista-cliente', foco: 'vc-etapas', titulo: 'Certificado entregado', texto: 'Al generador le llega un mail y descarga el certificado desde su portal. Así ve él sus retiros, etapa por etapa.' },
      { ir: '/manifiestos', foco: 'man-buscar', titulo: 'Seguir cualquier residuo', texto: 'Y para seguir cualquier residuo, buscá el manifiesto por número, generador o corriente y abrilo. ¡Eso es todo el circuito!' },
    ],
  },
  {
    id: 'tablero', titulo: 'Leer el tablero', area: 'tablero', roles: INTERNOS,
    pasos: [
      { ir: '/', foco: 'tab-filtros', titulo: 'Los filtros', texto: 'Arriba de todo elegís el período (este año, el mes pasado, fechas a elección) y, si querés, una planta, un transportista, un generador, el formulario o la etapa. Todo el tablero se acomoda a eso.' },
      { foco: '.grid.k4', titulo: 'Los números', texto: 'Los manifiestos del período, las toneladas, los generadores atendidos y lo que todavía no tiene disposición final. El signo de pregunta de cada uno te explica de dónde sale.' },
      { foco: 'tab-etapas', titulo: 'Por etapa', texto: 'Las barras muestran cuántos manifiestos hay en cada etapa. Tocá una barra y te lleva a esa lista.' },
    ],
  },

  // ---------------------------------------------------------------- Manifiestos
  {
    id: 'emitir', titulo: 'Emitir un manifiesto', area: 'manifiestos', roles: EDITAN,
    pasos: [
      { ir: '/manifiestos', foco: 'man-nuevo', titulo: 'Empezar', texto: 'Para emitir, se arranca con "Nuevo manifiesto". Te llevo.' },
      { ir: '/manifiestos/nuevo', foco: 'nm-numero', titulo: 'Número del formulario', texto: 'El sistema te sugiere el número que sigue. Comparalo con el formulario azul que tenés en la mano.' },
      { foco: 'nm-generador', titulo: 'Generador', texto: 'Escribí el nombre o el CUIT y elegilo de la lista. Después, la dirección de retiro.' },
      { foco: 'nm-flota', titulo: 'Camión y chofer', texto: 'Si el camión, el chofer o el generador tienen algo vencido, aparece en rojo y no te deja emitir. Se arregla en Vencimientos.' },
      { foco: 'nm-instrucciones', titulo: 'Instrucciones', texto: 'Las instrucciones vienen con los valores de siempre. Cambialas solo si este retiro es distinto.', falta: 'Esta parte aparece solo con el formulario azul de Serco.' },
      { foco: 'nm-residuos', titulo: 'Residuos: después', texto: 'Los residuos no se cargan ahora: se cargan cuando la carga entra a planta.' },
      { foco: 'nm-emitir', titulo: 'Emitir', texto: 'Al emitir queda iniciado. Con "Emitir e imprimir" salen las secciones uno, dos, cuatro y cinco sobre el formulario azul.' },
    ],
  },
  {
    id: 'recorrido', titulo: 'Ver en qué etapa está un residuo', area: 'manifiestos', roles: INTERNOS,
    pasos: [
      { ir: '/manifiestos', foco: 'man-buscar', titulo: 'Buscar', texto: 'Buscá el manifiesto por número, generador o corriente. Yo te abro uno de ejemplo.' },
      { ir: ':manifiesto', foco: 'det-recorrido', titulo: 'El recorrido', texto: 'Acá ves en qué etapa está: iniciado, almacenado, en tránsito, dispuesto o certificado entregado, con los papeles de cada una.', falta: 'No encuentro un manifiesto de ejemplo para mostrarte.' },
      { foco: 'texto:Historial de cambios', titulo: 'Historial', texto: 'Y más abajo queda quién hizo cada cosa y cuándo.' },
    ],
  },
  {
    id: 'imprimir', titulo: 'Imprimir en el formulario azul', area: 'manifiestos', roles: EDITAN,
    pasos: [
      { ir: ':manifiesto', foco: 'det-imprimir', titulo: 'Desde el manifiesto', texto: 'Desde cualquier manifiesto tocás "Imprimir en el formulario". Te muestro cómo se ve.', falta: 'No encuentro un manifiesto de ejemplo para mostrarte.' },
      { ir: ':manifiesto/imprimir', foco: 'imp-que', titulo: 'Qué imprimir', texto: 'Elegís qué sale: al emitir, las secciones uno, dos, cuatro y cinco; al entrar a planta, solo la tres.' },
      { foco: 'imp-guia', titulo: 'Revisar', texto: 'Con esta opción ves los datos sobre el formulario escaneado, para controlar que todo cae en su casillero. El fondo nunca se imprime.' },
      { foco: 'imp-calib', titulo: 'Si sale corrido', texto: 'Si en el papel queda corrido, movelo unos milímetros y probá de nuevo. Queda guardado en esta compu.' },
      { foco: 'imp-imprimir', titulo: 'Imprimir', texto: 'Poné el formulario azul en la bandeja e imprimí en A4, a escala cien por ciento y sin márgenes.' },
    ],
  },
  {
    id: 'etiquetas', titulo: 'Imprimir etiquetas con QR', area: 'manifiestos', roles: EDITAN,
    pasos: [
      { ir: ':manifiesto', foco: 'det-etiquetas', titulo: 'Desde el manifiesto', texto: 'Las etiquetas salen desde el manifiesto, con el botón "Etiquetas".', falta: 'No encuentro un manifiesto de ejemplo para mostrarte.' },
      { ir: ':manifiesto/etiquetas', foco: 'etiq-cantidad', titulo: 'Cuántos contenedores', texto: 'Poné cuántas bolsas, tambores o bateas tiene cada residuo: sale una etiqueta por contenedor.' },
      { foco: 'etiq-imprimir', titulo: 'Imprimir', texto: 'Salen ocho por hoja. El QR abre el recorrido del residuo en el sistema.' },
    ],
  },
  {
    id: 'agenda', titulo: 'Usar la agenda', area: 'manifiestos', roles: INTERNOS,
    pasos: [
      { ir: '/agenda', foco: 'agenda-calendario', titulo: 'El mes', texto: 'Cada día muestra los retiros, los vencimientos y los residuos que cumplen el plazo en planta. En rojo, lo vencido. Tocá un día para ver el detalle.' },
      { foco: 'agenda-filtros', titulo: 'Filtrar', texto: 'Desde acá mostrás u ocultás cada tipo de evento.' },
    ],
  },

  // ---------------------------------------------------------------- Planta
  {
    id: 'ingreso', titulo: 'Registrar el ingreso a planta', area: 'planta', roles: EDITAN,
    pasos: [
      { ir: '/planta?v=ingresar', foco: 'pl-ingresar', titulo: 'Por ingresar', texto: 'Acá están los manifiestos emitidos que todavía no tienen residuos. Cuando llega la carga, tocás "Cargar residuos".' },
      { ir: ':iniciado', foco: 'det-sec3', titulo: 'La sección tres', texto: 'Una fila por corriente: contenedor, cantidad estimada, la del remito, y real, la que pesaste en planta. Hasta siete, como en el papel.', falta: 'Ahora no hay ningún manifiesto esperando ingreso, así que no te lo puedo mostrar con uno real.' },
      { titulo: 'Guardar', texto: 'Al guardar pasa a almacenado y empieza a contar el plazo en planta. Después podés imprimir la sección tres y las etiquetas.' },
    ],
  },
  {
    id: 'viaje', titulo: 'Armar un viaje a disposición final', area: 'planta', roles: EDITAN,
    pasos: [
      { ir: '/planta', foco: 'pl-plan', titulo: 'Viajes sugeridos', texto: 'El sistema reparte lo almacenado en viajes según el plazo en planta, la capacidad de la batea o la cisterna, qué se puede mezclar y qué acepta cada operador.' },
      { foco: 'pl-usar', titulo: 'Elegir un viaje', texto: 'Revisás el destino y tocás "Armar este viaje". Con "Mover" pasás un residuo a otro viaje o lo dejás en planta.', falta: 'Ahora no hay nada almacenado para armar viajes.' },
      { titulo: 'Datos del viaje', texto: 'Después cargás el número del formulario (el mismo azul de los retiros: el sistema propone el que sigue), el camión y el chofer. Al armarlo lo podés imprimir en el formulario azul. Los residuos pasan a en tránsito hasta que llegue el certificado.' },
      { foco: 'texto:Selección manual', titulo: 'A mano', texto: 'Si preferís elegir vos qué va en el viaje, está la selección manual.' },
    ],
  },
  {
    id: 'certificado', titulo: 'Registrar un certificado', area: 'planta', roles: EDITAN,
    pasos: [
      { ir: '/planta?v=transito', foco: 'pl-esperando', titulo: 'Viajes sin certificado', texto: 'Acá están los Manifiestos Nación que todavía esperan el certificado del operador.' },
      { foco: 'pl-registrar', titulo: 'Registrar', texto: 'En el viaje que corresponde tocás "Registrar certificado".', falta: 'Ahora no hay viajes esperando certificado.' },
      { titulo: 'Número y PDF', texto: 'Cargás número, fecha y tratamiento, y adjuntás el PDF. Al registrarlo, al generador le llega un mail y lo descarga desde su portal.' },
    ],
  },

  // ---------------------------------------------------------------- Reportes
  {
    id: 'libro', titulo: 'Sacar un libro rubricado', area: 'reportes', roles: INTERNOS,
    pasos: [
      { ir: '/reportes/provincial', foco: 'rep-tipos', titulo: 'Elegir el libro', texto: 'Tenés el libro provincial, el de transporte y el nacional, además del reporte por producto y las estadísticas.' },
      { foco: 'rep-fechas', titulo: 'Período', texto: 'Elegís desde y hasta.' },
      { foco: 'rep-imprimir', titulo: 'Imprimir', texto: 'Sale en A4 apaisado, con hoja tanto de tanto en cada página, listo para el libro.' },
      { foco: 'rep-excel', titulo: 'Excel', texto: 'Y si lo necesitás, lo bajás para abrir en Excel.' },
    ],
  },
  {
    id: 'producto', titulo: 'Cantidad por producto', area: 'reportes', roles: INTERNOS,
    pasos: [
      { ir: '/reportes/producto', foco: 'rep-tipos', titulo: 'El reporte', texto: 'Este es el reporte de cantidades por producto, el que antes se armaba a mano.' },
      { foco: 'rep-fechas', titulo: 'Período', texto: 'Elegís las fechas y lo agrupás por semana, quincena o mes.' },
    ],
  },

  // ---------------------------------------------------------------- Altas y vencimientos
  {
    id: 'vencimiento', titulo: 'Actualizar un vencimiento', area: 'altas', roles: EDITAN,
    pasos: [
      { ir: '/vencimientos', foco: 'venc-filtro', titulo: 'Qué mirar', texto: 'Elegís qué ver: camiones y choferes, generadores, operadores, y si están vencidos, por vencer o sin cargar.' },
      { foco: 'venc-tabla', titulo: 'Abrir la ficha', texto: 'Tocás la fila del documento que querés actualizar. Te abro uno.' },
      { ir: ':vencimiento', foco: 'ficha-vtos', titulo: 'Nueva fecha y escaneo', texto: 'Cargás la nueva fecha y subís el escaneo. Si es un certificado de chofer, el sistema lee solo el DNI y la fecha.', falta: 'No encuentro nada por vencer para mostrarte.' },
      { foco: 'ficha-guardar', titulo: 'Guardar', texto: 'Al guardar, el sistema vuelve a dejar emitir con ese camión o chofer.' },
    ],
  },
  {
    id: 'pedir-certificado', titulo: 'Pedirle el certificado al chofer por mail', area: 'altas', roles: EDITAN,
    pasos: [
      { ir: ':chofer', foco: 'ficha-datos', titulo: 'El mail del chofer', texto: 'En la ficha del chofer cargás su mail. Si no tiene, el pedido le llega a su transportista.', falta: 'No encuentro un chofer con algo por vencer para mostrarte.' },
      { foco: 'ficha-pedir', titulo: 'Pedir por mail', texto: 'En cada documento está "Pedir por mail". Le llega un enlace para subir el certificado desde el celular, sin usuario ni contraseña.', falta: 'No encuentro un chofer con algo por vencer para mostrarte.' },
      { ir: '/vencimientos', foco: 'venc-pedidos', titulo: 'Todos juntos', texto: 'En Vencimientos se les puede pedir a todos los que vencen pronto, con un solo botón. Antes de mandar te muestra a quién.', falta: 'Ahora no hay certificados de choferes para pedir ni para revisar: cuando haya, aparecen arriba de todo en Vencimientos.' },
      { foco: 'venc-revisar', titulo: 'Revisar y aceptar', texto: 'Lo que suben los choferes aparece acá. Mirás el archivo, confirmás el vencimiento que leyó el sistema y tocás Aceptar: recién ahí pasa a la ficha.', falta: 'Ahora no hay certificados subidos para revisar: cuando un chofer suba uno, aparece arriba de todo en Vencimientos.' },
    ],
  },
  {
    id: 'alta', titulo: 'Dar de alta un generador', area: 'altas', roles: EDITAN,
    pasos: [
      { ir: '/altas/generadores', foco: 'altas-secciones', titulo: 'Altas', texto: 'Acá están camiones, choferes, generadores, transportistas, operadores, plantas y corrientes. Lo que te muestro sirve para todos.' },
      { foco: 'altas-buscar', titulo: 'Fijate si ya existe', texto: 'Antes de agregarlo, buscalo por nombre o CUIT para no duplicarlo.' },
      { foco: 'altas-agregar', titulo: 'Agregar', texto: 'Si no está, tocás "Agregar". Te llevo.' },
      { ir: '/altas/generadores/nuevo', foco: 'ficha-datos', titulo: 'Datos', texto: 'Nombre, CUIT, que se controla que sea válido, mail para los avisos y teléfono.' },
      { foco: 'ficha-vtos', titulo: 'Habilitaciones', texto: 'Cargá número y vencimiento de cada habilitación. Sin esto no se le pueden emitir manifiestos.' },
      { foco: 'ficha-guardar', titulo: 'Guardar', texto: 'Después de guardarlo, le indicás sus corrientes y sus direcciones de retiro.' },
    ],
  },

  // ---------------------------------------------------------------- Configuración
  {
    id: 'invitar', titulo: 'Invitar a un usuario', area: 'configuracion', roles: ['admin'],
    pasos: [
      { ir: '/configuracion', foco: 'cfg-invitar', titulo: 'Invitar', texto: 'Cargás el mail y el nombre de la persona.' },
      { foco: 'cfg-rol', titulo: 'Rol', texto: 'Administrador, operador o consulta para la gente de Serco. Cliente para un generador: solo ve sus retiros y certificados.' },
      { foco: 'cfg-enviar', titulo: 'Mandar', texto: 'Le llega un mail para elegir su contraseña.' },
    ],
  },

  // ---------------------------------------------------------------- Portal del cliente
  {
    id: 'vista-cliente', titulo: 'Qué ve el cliente', area: 'cliente', roles: INTERNOS,
    pasos: [
      { ir: '/vista-cliente', foco: 'vc-etapas', titulo: 'Sus retiros', texto: 'Así ve un generador su portal: cuántos retiros tiene en cada etapa. Arriba elegís de qué cliente verlo.' },
      { foco: 'portal-retiros', titulo: 'Cada retiro', texto: 'Cada retiro con su etapa. Tocando uno ve el detalle y sus papeles.' },
    ],
  },
  {
    id: 'portal-retiros', titulo: 'Ver mis retiros', area: 'cliente', roles: ['cliente'],
    pasos: [
      { ir: '/portal', foco: 'portal-retiros', titulo: 'Tus retiros', texto: '¡Hola! Acá tenés cada retiro con su etapa: almacenado en planta, en viaje a disposición final o con el certificado listo. Tocá uno para ver el detalle.' },
    ],
  },
  {
    id: 'portal-cert', titulo: 'Descargar un certificado', area: 'cliente', roles: ['cliente'],
    pasos: [
      { ir: '/portal', foco: 'portal-tab-cert', titulo: 'Certificados', texto: 'Los certificados están en esta pestaña. Te llevo.' },
      { ir: '/portal/certificados', foco: 'portal-descargar', titulo: 'Descargar', texto: 'Cada certificado de disposición final se baja en PDF.', falta: 'Todavía no tenés certificados para descargar.' },
    ],
  },
]
