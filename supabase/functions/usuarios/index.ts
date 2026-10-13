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
  const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
    redirectTo: env('APP_URL', 'https://serco.netlify.app') + '/elegir-clave',
    data: { nombre },
  })
  if (error || !data.user) {
    const yaExiste = /already|registered|exists/i.test(error?.message ?? '')
    return json({ error: yaExiste ? 'Ya existe un usuario con ese mail.' : `No se pudo invitar: ${error?.message}` }, 400)
  }
  const id = data.user.id
  const { error: e1 } = await db.from('perfiles').upsert({ id, nombre, email, rol: p.rol, activo: true })
  if (e1) return json({ error: `Se invitó pero no se pudo crear el perfil: ${e1.message}` }, 500)
  if (generadores.length) {
    const { error: e2 } = await db.from('perfil_generadores').insert(generadores.map((g) => ({ perfil_id: id, generador_id: g })))
    if (e2) return json({ error: `Se invitó pero no se pudieron asignar los generadores: ${e2.message}` }, 500)
  }
  return json({ id, email, mensaje: `Le mandamos a ${email} un mail para que elija su contraseña.` })
})
