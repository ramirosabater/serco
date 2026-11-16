// Función "usuarios": un administrador invita a alguien al sistema.
// Crear usuarios necesita la clave de servicio, por eso se hace acá y no desde el navegador.
// Rol, alta/baja y generadores de un usuario existente se cambian directo desde la app (lo permiten los permisos de admin).
import { admin, cors, env, json, quienLlama } from '../_compartido/comun.ts'

interface Pedido { email?: string; nombre?: string; rol?: string; generadores?: number[] }
const ROLES = ['admin', 'operador', 'consulta', 'cliente']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const quien = await quienLlama(req)
  if (!quien || quien.tipo !== 'usuario' || quien.rol !== 'admin') return json({ error: 'Solo un administrador puede invitar usuarios.' }, 403)

  const p = await req.json().catch(() => ({})) as Pedido
  const email = (p.email ?? '').trim().toLowerCase()
  const nombre = (p.nombre ?? '').trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'El mail no es válido.' }, 400)
  if (!nombre) return json({ error: 'Falta el nombre.' }, 400)
  if (!ROLES.includes(p.rol ?? '')) return json({ error: 'Rol desconocido.' }, 400)
  const generadores = (p.generadores ?? []).filter((x) => Number.isInteger(x))
  if (p.rol === 'cliente' && !generadores.length) return json({ error: 'Un usuario del portal tiene que tener al menos un generador.' }, 400)

  const db = admin()
  const redirectTo = env('APP_URL', 'https://sercosa.netlify.app') + '/elegir-clave'
  let id: string, yaTenia = false
  const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo, data: { nombre } })
  if (error || !data.user) {
    if (!/already|registered|exists/i.test(error?.message ?? '')) return json({ error: `No se pudo invitar: ${error?.message}` }, 400)
    // Ya tiene usuario en Supabase (por ejemplo, creado a mano o una invitación anterior que no terminó).
    // Si ya está en el sistema, no se toca; si no, se lo agrega y se le manda el mail para elegir contraseña.
    const { data: lista, error: eL } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const u = lista?.users.find((x) => (x.email ?? '').toLowerCase() === email)
    if (eL || !u) return json({ error: 'Ya existe un usuario con ese mail.' }, 400)
    const { data: perfil } = await db.from('perfiles').select('id').eq('id', u.id).maybeSingle()
    if (perfil) return json({ error: 'Ya existe un usuario con ese mail: está en la lista de arriba.' }, 400)
    id = u.id; yaTenia = true
  } else id = data.user.id
  const { error: e1 } = await db.from('perfiles').upsert({ id, nombre, email, rol: p.rol, activo: true })
  if (e1) return json({ error: `Se invitó pero no se pudo crear el perfil: ${e1.message}` }, 500)
  if (generadores.length) {
    const { error: e2 } = await db.from('perfil_generadores').insert(generadores.map((g) => ({ perfil_id: id, generador_id: g })))
    if (e2) return json({ error: `Se invitó pero no se pudieron asignar los generadores: ${e2.message}` }, 500)
  }
  if (yaTenia) {
    const { error: e3 } = await db.auth.resetPasswordForEmail(email, { redirectTo })
    if (e3) return json({ id, email, mensaje: `Ya tenía usuario en Supabase: lo agregamos al sistema, pero no salió el mail (${e3.message}). Probá con "Restablecer contraseña".` })
    return json({ id, email, mensaje: `Ya tenía usuario en Supabase: lo agregamos al sistema y le mandamos a ${email} un mail para elegir su contraseña.` })
  }
  return json({ id, email, mensaje: `Le mandamos a ${email} un mail para que elija su contraseña.` })
})
