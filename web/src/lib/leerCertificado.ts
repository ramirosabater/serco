// Lee los certificados de los choferes que se suben a la ficha y saca DNI, nombre y vencimiento.
//  - Psicofísico (psicofisicos.com.ar / Tecnogestión): PDF con texto; vale hasta "F. VALIDEZ".
//  - Mercancías peligrosas (Seguridad Vial, LiNTI): el código QR trae DNI y "Vencimiento: dd/mm/aaaa".
//    Sirve el PDF, una foto o una captura de pantalla donde se vea el QR.
//  - Curso FPT (Sicapro): PDF con texto; trae la fecha del curso pero no un vencimiento.
// Todo se hace en el navegador: el archivo no se manda a ningún otro sitio.

export type TipoCertificado = 'psicofisico' | 'mmpp' | 'curso'
export interface Lectura {
  tipo: TipoCertificado
  dni: string | null
  nombre: string | null
  /** AAAA-MM-DD */
  vence: string | null
  /** Otra fecha útil (examen, curso), AAAA-MM-DD */
  fecha: string | null
  detalle: string
}

export const NOMBRE_TIPO: Record<TipoCertificado, string> = {
  psicofisico: 'certificado de evaluación psicofísica',
  mmpp: 'habilitación para mercancías peligrosas (Seguridad Vial)',
  curso: 'certificado de curso (FPT)',
}

const iso = (d: string) => { const m = d.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null }
const soloDigitos = (s: string | undefined | null) => (s ?? '').replace(/\D/g, '') || null
const MESES: Record<string, string> = { enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06', julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10', noviembre: '11', diciembre: '12' }

/** Interpreta el texto de un PDF o el contenido de un QR */
export function interpretar(texto: string): Lectura | null {
  const t = texto.replace(/\s+/g, ' ').trim()

  // QR de Seguridad Vial: "D.N.I.: 36.181.920, Id: 569359, Apellido: Flores, Nombre: Mauro Alejandro, Vencimiento: 20/02/2027, ..."
  if (/Vencimiento:\s*\d{1,2}\/\d{1,2}\/\d{4}/i.test(t) && /D\.N\.I\.:/i.test(t)) {
    const ape = t.match(/Apellido:\s*([^,]+)/i)?.[1]?.trim()
    const nom = t.match(/Nombre:\s*([^,]+)/i)?.[1]?.trim()
    const vence = iso(t.match(/Vencimiento:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)![1])
    return { tipo: 'mmpp', dni: soloDigitos(t.match(/D\.N\.I\.:\s*([\d.]+)/i)?.[1]), nombre: [ape, nom].filter(Boolean).join(' ').toUpperCase() || null,
      vence, fecha: null, detalle: `Curso de mercancías peligrosas, vence el ${t.match(/Vencimiento:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)![1]}` }
  }

  // Psicofísico: "F. VENCIMIENTO" es el plazo para el trámite de la licencia; la evaluación vale hasta "F. VALIDEZ"
  if (/EVALUACI[ÓO]N PSICOF[ÍI]SICA/i.test(t)) {
    // El orden del texto cambia según cómo se extraiga: "F. VENCIMIENTO F. VALIDEZ d1 d2" o "F. VENCIMIENTO d1 ... F. VALIDEZ d2"
    const juntas = t.match(/F\. VENCIMIENTO\s+F\. VALIDEZ\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})/i)
    const validez = juntas?.[2] ?? t.match(/F\. VALIDEZ\s+(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]
    const n1 = t.match(/APELLIDO\/S\s+(.*?)\s*NOMBRE\/S\s+(.+?)\s+DNI\b/i)
    const ape = n1 ? (n1[1] ? `${n1[1]} ${n1[2]}` : n1[2]) : undefined
    const dni = soloDigitos(t.match(/DNI\s+PROVINCIA\s+([\d.]+)/i)?.[1] ?? t.match(/DNI\D{0,12}([\d.]{7,10})/i)?.[1])
    const dictamen = t.match(/DICTAMEN\s+(APTO[A-Z ]*?|NO APTO)\b/i)?.[1]?.trim()
    const examen = t.match(/F\. EXAMEN\s+(?:F\. DICTAMEN\s+)?(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]
    return { tipo: 'psicofisico', dni, nombre: ape?.trim().replace(/\s{2,}/g, ' ') ?? null, vence: validez ? iso(validez) : null, fecha: examen ? iso(examen) : null,
      detalle: `Psicofísico${dictamen ? ' ' + dictamen.toUpperCase() : ''}${validez ? `, válido hasta el ${validez}` : ''}` }
  }

  // Curso FPT: "Se extiende el presente certificado a FLORES , MAURO ALEJANDRO, DNI 36.181.920 por haber APROBADO el Curso: ... 07 de enero de 2026"
  if (/por haber APROBADO el Curso/i.test(t)) {
    const m = t.match(/certificado a\s+(.+?),\s*DNI\s*([\d.]+)/i)
    const curso = t.match(/el Curso:\s*(.+?)\s+\d{1,2} de [a-z]+ de \d{4}/i)?.[1]
    const f = t.match(/(\d{1,2}) de ([a-záéíóú]+) de (\d{4})/i)
    const fecha = f && MESES[f[2].toLowerCase()] ? `${f[3]}-${MESES[f[2].toLowerCase()]}-${f[1].padStart(2, '0')}` : null
    return { tipo: 'curso', dni: soloDigitos(m?.[2]), nombre: m?.[1]?.replace(/\s*,\s*/g, ' ').trim() ?? null, vence: null, fecha,
      detalle: `Curso aprobado${curso ? `: ${curso}` : ''}${f ? ` (${f[0]})` : ''}` }
  }
  return null
}

async function pdfjs() {
  const lib = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  lib.GlobalWorkerOptions.workerSrc = worker
  return lib
}

/** Busca un QR en una imagen (dibujada en un canvas) */
async function leerQR(canvas: HTMLCanvasElement): Promise<string | null> {
  const jsQR = (await import('jsqr')).default
  const ctx = canvas.getContext('2d')!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null
}

async function canvasDeImagen(f: File) {
  const bmp = await createImageBitmap(f)
  const escala = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * escala); c.height = Math.round(bmp.height * escala)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return c
}

/** Lee un archivo subido (PDF o imagen). Devuelve null si no lo reconoce. */
export async function leerCertificado(f: File): Promise<Lectura | null> {
  try {
    if (f.type.startsWith('image/')) {
      const qr = await leerQR(await canvasDeImagen(f))
      return qr ? interpretar(qr) : null
    }
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) return null
    const lib = await pdfjs()
    const doc = await lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise
    let texto = ''
    for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
      const page = await doc.getPage(p)
      const c = await page.getTextContent()
      texto += ' ' + c.items.map((i) => ('str' in i ? i.str : '')).join(' ')
    }
    const porTexto = interpretar(texto)
    if (porTexto) return porTexto
    // Sin texto reconocible: se busca el QR en la primera página
    const page = await doc.getPage(1)
    const vp = page.getViewport({ scale: 2.5 })
    const c = document.createElement('canvas')
    c.width = vp.width; c.height = vp.height
    await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise
    const qr = await leerQR(c)
    return qr ? interpretar(qr) : null
  } catch {
    return null
  }
}
