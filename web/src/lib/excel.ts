// Exporta una tabla a un archivo que Excel abre directo (CSV con ; y coma decimal, como usa Excel en Argentina).
export interface Columna<T> { t: string; v: (fila: T) => string | number | null | undefined }

const celda = (x: string | number | null | undefined) => {
  if (x == null) return ''
  if (typeof x === 'number') return String(x).replace('.', ',')
  const s = /^\d{4}-\d{2}-\d{2}$/.test(x) ? `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(0, 4)}` : x
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportarExcel<T>(nombre: string, columnas: Columna<T>[], filas: T[]) {
  const lineas = [columnas.map((c) => celda(c.t)).join(';'), ...filas.map((f) => columnas.map((c) => celda(c.v(f))).join(';'))]
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${nombre}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
