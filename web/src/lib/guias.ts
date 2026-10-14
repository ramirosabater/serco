import type { Rol } from './tipos'

// Guías "paso a paso". Cada paso resalta un elemento de la pantalla marcado con data-ayuda="…".
// Si el paso tiene `ruta`, la ayuda lleva a esa pantalla. Si el elemento todavía no está
// (por ejemplo, hay que abrir un manifiesto primero), se muestra `falta` y la guía espera.

export interface Paso {
  sel?: string
  ruta?: string
  titulo: string
  texto: string
  /** Qué tiene que hacer la persona si el elemento no está en pantalla */
  falta?: string
  /** Pasa solo al siguiente cuando se toca el elemento resaltado */
  alTocar?: boolean
}

export interface Guia {
  id: string
  titulo: string
  grupo: string
  /** Pantallas donde la guía aparece primero ("En esta pantalla") */
  pantalla: RegExp
  roles: Rol[]
  pasos: Paso[]
}

const EDITAN: Rol[] = ['admin', 'operador']
const INTERNOS: Rol[] = ['admin', 'operador', 'consulta']
const ABRIR_MANIFIESTO = 'Abrí un manifiesto de la lista (tocá su fila) y la guía sigue sola.'

export const GUIAS: Guia[] = [
  {
    id: 'emitir', titulo: 'Emitir un manifiesto', grupo: 'Manifiestos', pantalla: /^\/(manifiestos(\/nuevo)?)?$/, roles: EDITAN,
    pasos: [
      { ruta: '/manifiestos', sel: 'man-nuevo', titulo: 'Empezar', texto: 'Tocá "Nuevo manifiesto".', alTocar: true },
      { ruta: '/manifiestos/nuevo', sel: 'nm-numero', titulo: 'Número del formulario', texto: 'El sistema sugiere el número que sigue. Comparalo con el formulario azul que tenés en la mano antes de seguir.' },
      { sel: 'nm-generador', titulo: 'Generador', texto: 'Empezá a escribir el nombre o el CUIT y elegilo de la lista. Después elegí la dirección de retiro.' },
      { sel: 'nm-flota', titulo: 'Camión y chofer', texto: 'Si el camión, el chofer, el transportista o el generador tienen algo vencido, aparece en rojo acá y el sistema no deja emitir. Se arregla en Vencimientos.' },
      { sel: 'nm-instrucciones', titulo: 'Instrucciones (secciones 4 y 5)', texto: 'Vienen con los valores de siempre. Cambialas solo si este retiro es distinto.', falta: 'Esta parte aparece solo en el formulario azul de Serco.' },
      { sel: 'nm-residuos', titulo: 'Residuos: después', texto: 'Los residuos (sección 3) no se cargan ahora: se cargan cuando la carga entra a planta, desde Planta → Por ingresar.' },
      { sel: 'nm-emitir', titulo: 'Emitir', texto: 'El manifiesto queda "Iniciado". Con "Emitir e imprimir" salen las secciones 1, 2, 4 y 5 sobre el formulario azul.' },
    ],
  },
  {
    id: 'ingreso', titulo: 'Registrar el ingreso a planta (sección 3)', grupo: 'Planta', pantalla: /^\/(planta|manifiestos\/\d+)$/, roles: EDITAN,
    pasos: [
      { ruta: '/planta?v=ingresar', sel: 'pl-ingresar', titulo: 'Por ingresar', texto: 'Acá están los manifiestos emitidos que todavía no tienen residuos cargados. Tocá "Cargar residuos" en el que llegó.' , alTocar: true },
      { sel: 'det-sec3', titulo: 'Sección 3', texto: 'Una fila por corriente: contenedor, cantidad estimada (la del remito) y real (la pesada o medida en planta). Entran hasta 7, como en el papel. Poné la fecha en que entró.', falta: 'Abrí un manifiesto "Iniciado" de la lista y la guía sigue sola.' },
      { sel: 'det-sec3', titulo: 'Guardar', texto: 'Al guardar pasa a "Almacenado" y empieza a contar el plazo en planta desde la fecha de ingreso. Después podés imprimir la sección 3 en el formulario y las etiquetas QR.' },
    ],
  },
  {
    id: 'imprimir', titulo: 'Imprimir en el formulario azul', grupo: 'Manifiestos', pantalla: /^\/manifiestos(\/\d+(\/imprimir)?)?$/, roles: EDITAN,
    pasos: [
      { ruta: '/manifiestos', sel: 'man-buscar', titulo: 'Buscar el manifiesto', texto: 'Escribí el número o el generador y abrí el manifiesto.' },
      { sel: 'det-imprimir', titulo: 'Imprimir en el formulario', texto: 'Tocá este botón.', falta: ABRIR_MANIFIESTO, alTocar: true },
      { sel: 'imp-guia', titulo: 'Revisar sobre el formulario', texto: 'Con esta opción ves los datos sobre el formulario escaneado, para controlar que todo cae en su casillero. El fondo nunca se imprime.' },
      { sel: 'imp-calib', titulo: 'Si sale corrido', texto: 'Si en el papel los datos quedan corridos, mové unos milímetros a la derecha o hacia abajo y volvé a imprimir. Queda guardado en esta PC.' },
      { sel: 'imp-imprimir', titulo: 'Imprimir', texto: 'Poné el formulario azul en la bandeja. En la ventana de impresión: A4, escala 100 % y márgenes "Ninguno".' },
    ],
  },
  {
    id: 'etiquetas', titulo: 'Imprimir etiquetas con QR', grupo: 'Manifiestos', pantalla: /^\/manifiestos(\/\d+(\/etiquetas)?)?$/, roles: EDITAN,
    pasos: [
      { ruta: '/manifiestos', sel: 'man-buscar', titulo: 'Buscar el manifiesto', texto: 'Escribí el número o el generador y abrí el manifiesto.' },
      { sel: 'det-etiquetas', titulo: 'Etiquetas', texto: 'Tocá "Etiquetas".', falta: ABRIR_MANIFIESTO, alTocar: true },
      { sel: 'etiq-cantidad', titulo: 'Cuántos contenedores', texto: 'Poné cuántas bolsas, tambores o bateas tiene cada residuo: sale una etiqueta por contenedor.' },
      { sel: 'etiq-imprimir', titulo: 'Imprimir', texto: 'Salen 8 por hoja A4 (10 × 7 cm). El QR abre el recorrido del residuo en el sistema.' },
    ],
  },
  {
    id: 'recorrido', titulo: 'Ver en qué etapa está un residuo', grupo: 'Manifiestos', pantalla: /^\/manifiestos(\/\d+)?$/, roles: INTERNOS,
    pasos: [
      { ruta: '/manifiestos', sel: 'man-buscar', titulo: 'Buscar el manifiesto', texto: 'Escribí el número o el generador y abrí el manifiesto.' },
      { sel: 'det-recorrido', titulo: 'Recorrido', texto: 'Iniciado (emitido, faltan los residuos), almacenado en planta, en tránsito a disposición final, dispuesto y certificado. Abajo, cada residuo con su manifiesto Nación y su certificado.', falta: ABRIR_MANIFIESTO },
    ],
  },
  {
    id: 'viaje', titulo: 'Armar un viaje a disposición final', grupo: 'Planta', pantalla: /^\/planta$/, roles: EDITAN,
    pasos: [
      { ruta: '/planta', sel: 'pl-plan', titulo: 'Viajes sugeridos', texto: 'El sistema reparte lo almacenado en viajes según el vencimiento del plazo en planta, la capacidad de la batea o la cisterna, qué se puede mezclar y qué acepta cada operador. Arriba dice cuántos conviene mandar ahora.' },
      { sel: 'pl-usar', titulo: 'Elegir un viaje', texto: 'Revisá el destino y tocá "Armar este viaje". Con "Mover…" podés pasar un residuo a otro viaje o dejarlo en planta.', alTocar: true },
      { sel: 'pl-nacion', titulo: 'Datos del viaje', texto: 'Cargá el número del formulario verde, el camión y el chofer. El operador ya viene elegido.' },
      { sel: 'pl-armar', titulo: 'Armar el manifiesto Nación', texto: 'Los residuos pasan a "En tránsito" hasta que llegue el certificado. Si preferís elegir a mano, está la pestaña "Elegir a mano".' },
    ],
  },
  {
    id: 'certificado', titulo: 'Registrar un certificado', grupo: 'Planta', pantalla: /^\/planta$/, roles: EDITAN,
    pasos: [
      { ruta: '/planta?v=transito', sel: 'pl-esperando', titulo: 'Viajes sin certificado', texto: 'Acá están los manifiestos Nación que todavía esperan el certificado del operador.' },
      { sel: 'pl-registrar', titulo: 'Registrar', texto: 'Tocá "Registrar certificado" en el viaje que corresponde.', falta: 'No hay viajes esperando certificado.', alTocar: true },
      { sel: 'pl-pdf', titulo: 'Número y PDF', texto: 'Cargá número, fecha y tratamiento, y adjuntá el PDF. Al registrarlo, el generador ya lo puede descargar desde su portal.' },
    ],
  },
  {
    id: 'vencimiento', titulo: 'Actualizar un vencimiento', grupo: 'Vencimientos y altas', pantalla: /^\/(vencimientos|altas\/.*)$/, roles: EDITAN,
    pasos: [
      { ruta: '/vencimientos', sel: 'venc-filtro', titulo: 'Qué mirar', texto: 'Elegí camiones y choferes, generadores, operadores… y el estado: vencidos, por vencer o sin cargar.' },
      { sel: 'venc-tabla', titulo: 'Abrir la ficha', texto: 'Tocá la fila del documento que querés actualizar.' },
      { sel: 'ficha-vtos', titulo: 'Nueva fecha y escaneo', texto: 'Cargá la nueva fecha de vencimiento y, si lo tenés, subí el escaneo del documento.', falta: 'Tocá una fila de la tabla para abrir la ficha.' },
      { sel: 'ficha-guardar', titulo: 'Guardar', texto: 'Al guardar, el sistema vuelve a dejar emitir con ese camión, chofer o generador, y el próximo vencimiento aparece en la agenda.' },
    ],
  },
  {
    id: 'alta', titulo: 'Dar de alta un generador', grupo: 'Vencimientos y altas', pantalla: /^\/altas(\/.*)?$/, roles: EDITAN,
    pasos: [
      { ruta: '/altas/generadores', sel: 'altas-secciones', titulo: 'Altas', texto: 'Acá están camiones, choferes, generadores, transportistas, operadores, plantas y corrientes. Lo mismo sirve para cualquiera de ellos.' },
      { sel: 'altas-buscar', titulo: 'Fijate si ya existe', texto: 'Buscalo por nombre o CUIT antes de agregarlo, para no duplicarlo.' },
      { sel: 'altas-agregar', titulo: 'Agregar', texto: 'Tocá "Agregar generador".', alTocar: true },
      { ruta: '/altas/generadores/nuevo', sel: 'ficha-datos', titulo: 'Datos', texto: 'Nombre, CUIT (se controla que sea válido), mail para los avisos y teléfono.' },
      { sel: 'ficha-vtos', titulo: 'Habilitaciones', texto: 'Cargá número y vencimiento de cada habilitación. Sin esto el sistema no deja emitirle manifiestos.' },
      { sel: 'ficha-guardar', titulo: 'Guardar', texto: 'Después de guardarlo podés indicar sus corrientes habilitadas y direcciones de retiro.' },
    ],
  },
  {
    id: 'libro', titulo: 'Sacar un libro rubricado', grupo: 'Reportes', pantalla: /^\/reportes(\/.*)?$/, roles: INTERNOS,
    pasos: [
      { ruta: '/reportes/provincial', sel: 'rep-tipos', titulo: 'Elegir el libro', texto: 'Libro provincial, de transporte o nacional. También están el reporte por producto y las estadísticas.' },
      { sel: 'rep-fechas', titulo: 'Período', texto: 'Elegí desde y hasta.' },
      { sel: 'rep-imprimir', titulo: 'Imprimir', texto: 'Sale en A4 apaisado, con "Hoja N de M" en cada página, listo para el libro.' },
      { sel: 'rep-excel', titulo: 'Excel', texto: 'También lo podés bajar para abrir en Excel.' },
    ],
  },
  {
    id: 'agenda', titulo: 'Usar la agenda', grupo: 'Planta', pantalla: /^\/agenda$/, roles: INTERNOS,
    pasos: [
      { ruta: '/agenda', sel: 'agenda-calendario', titulo: 'El mes', texto: 'Cada día muestra los retiros, los vencimientos de habilitaciones y los residuos que cumplen el plazo máximo en planta. En rojo, lo ya vencido. Tocá un día para ver el detalle.' },
      { sel: 'agenda-filtros', titulo: 'Filtrar', texto: 'Mostrá u ocultá cada tipo de evento.' },
    ],
  },
  {
    id: 'invitar', titulo: 'Invitar a un usuario', grupo: 'Configuración', pantalla: /^\/configuracion$/, roles: ['admin'],
    pasos: [
      { ruta: '/configuracion', sel: 'cfg-invitar', titulo: 'Invitar', texto: 'Cargá el mail y el nombre de la persona.' },
      { sel: 'cfg-rol', titulo: 'Rol', texto: 'Administrador, operador o consulta para la gente de Serco. "Cliente" para un generador: solo ve sus retiros y certificados.' },
      { sel: 'cfg-enviar', titulo: 'Mandar', texto: 'Le llega un mail para elegir su contraseña.' },
    ],
  },
  {
    id: 'portal-retiros', titulo: 'Ver mis retiros', grupo: 'Portal', pantalla: /^\/portal$/, roles: ['cliente'],
    pasos: [
      { ruta: '/portal', sel: 'portal-retiros', titulo: 'Sus retiros', texto: 'Cada retiro con su etapa: almacenado en planta, en viaje a disposición final o certificado. Tocá uno para ver el detalle.' },
    ],
  },
  {
    id: 'portal-cert', titulo: 'Descargar un certificado', grupo: 'Portal', pantalla: /^\/portal(\/certificados)?$/, roles: ['cliente'],
    pasos: [
      { ruta: '/portal', sel: 'portal-tab-cert', titulo: 'Certificados', texto: 'Entrá a "Certificados".', alTocar: true },
      { ruta: '/portal/certificados', sel: 'portal-descargar', titulo: 'Descargar', texto: 'Cada certificado de disposición final se baja en PDF.', falta: 'Todavía no hay certificados.' },
    ],
  },
]
