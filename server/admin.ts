/**
 * The instance's own administration.
 *
 * One surface so far: the access posture. Every route here is behind `requireInstanceAdmin`, which
 * reads the role on the request rather than trusting anything the client holds — and every change
 * writes an audit event, because a door opened is a fact somebody should be able to find later.
 */

import { Hono } from 'hono'
import { requireInstanceAdmin } from './access'
import { record } from './audit'
import { accessMode, setAccess } from './instance'
import type { Access } from './instance'
import type { Runtime } from './runtime'

export function adminRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  routes.get('/settings', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller
    return c.json({ access: await accessMode(caller.db) })
  })

  routes.patch('/settings', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const body = (await c.req.json().catch(() => null)) as { access?: unknown } | null
    const access = body?.access
    if (access !== 'open' && access !== 'closed') {
      return c.json({ error: 'access must be "open" or "closed"' }, 400)
    }

    await setAccess(caller.db, access as Access)
    await record(caller.db, {
      actorId: caller.user.id,
      action: 'instance.access',
      targetType: 'instance',
      data: { access },
    })

    return c.json({ access })
  })

  return routes
}
