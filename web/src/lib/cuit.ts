/** Valida un CUIT/CUIL argentino con su dígito verificador. Acepta guiones o espacios. */
export function cuitValido(c: string): boolean {
  const d = c.replace(/\D/g, '')
  if (d.length !== 11) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const s = pesos.reduce((a, p, i) => a + p * Number(d[i]), 0)
  let v = 11 - (s % 11)
  if (v === 11) v = 0
  if (v === 10) v = 9
  return v === Number(d[10])
}
export const soloDigitos = (c: string) => c.replace(/\D/g, '')
