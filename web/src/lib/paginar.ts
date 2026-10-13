// Supabase devuelve como máximo 1000 filas por pedido. Esto pide de a 1000 hasta traer todo.
type Pedido = { range: (desde: number, hasta: number) => PromiseLike<{ data: unknown[] | null; error: unknown }> }

/** `armar` tiene que crear la consulta de nuevo en cada llamada (una consulta de Supabase se usa una sola vez). */
export async function traerTodo<T>(armar: () => Pedido, tope = 50000): Promise<{ data: T[]; error: unknown }> {
  const todo: T[] = []
  for (let desde = 0; desde < tope; desde += 1000) {
    const { data, error } = await armar().range(desde, desde + 999)
    if (error) return { data: todo, error }
    todo.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) break
  }
  return { data: todo, error: null }
}
