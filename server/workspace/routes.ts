/**
 * The workspace, over HTTP.
 *
 * A read, and only a read: it proves the schema and the shape before anything writes through it.
 * It answers a signed-in member of this instance and nobody else — not an anonymous request, and
 * not an account that exists without a membership.
 */

import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { SESSION_COOKIE, userForToken } from '../auth/session'
import type { Runtime } from '../runtime'
import { readWorkspace } from './read'

export function workspaceRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  routes.get('/', async (c) => {
    const db = runtime.database(c.env)
    if (!db) return c.json({ error: 'not configured' }, 503)

    const token = getCookie(c, SESSION_COOKIE)
    if (!token) return c.json({ error: 'sign in to read the workspace' }, 401)

    const user = await userForToken(db, token)
    if (!user) return c.json({ error: 'sign in to read the workspace' }, 401)

    const member = await db.get('SELECT 1 AS member FROM members WHERE user_id = ?1', [user.id])
    if (!member) return c.json({ error: 'not a member of this workspace' }, 403)

    const workspace = await readWorkspace(db)
    // Whose workspace this is, answered by the session rather than by a pointer the browser keeps.
    return c.json({ ...workspace, meUserId: user.id })
  })

  return routes
}
