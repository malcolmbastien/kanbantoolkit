/**
 * The link itself.
 *
 * Public inspection, because the person holding it has not signed in yet — and deliberately
 * uninformative: a masked address, a role, an expiry. Nothing that would let somebody who found a
 * link learn who it was for.
 *
 * Acceptance needs a session, and compares the session's verified address to the invitation's. The
 * link alone grants nothing: forwarding it only forwards the question "would you sign in as them".
 */

import { Hono } from 'hono'
import { requireUser } from './access'
import { WORKSPACE_ID } from './auth/session'
import { byToken, mask, stateOf } from './invites'
import type { Runtime } from './runtime'

export function inviteLinkRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  routes.get('/:token', async (c) => {
    const db = runtime.database(c.env)
    if (!db) return c.json({ error: 'not configured' }, 503)

    const invite = await byToken(db, c.req.param('token'))
    // 410 for everything that is not usable: used, expired and revoked look the same from outside,
    // and a missing token is no different to somebody guessing.
    if (!invite) return c.json({ error: 'this invitation is not available' }, 410)

    const state = stateOf(invite)
    if (state !== 'valid') return c.json({ error: `this invitation is ${state}` }, 410)

    return c.json({ email: mask(invite.email), role: invite.role, expiresAt: invite.expires_at })
  })

  routes.post('/:token', async (c) => {
    const caller = await requireUser(c, runtime)
    if (caller instanceof Response) return caller

    const invite = await byToken(caller.db, c.req.param('token'))
    if (!invite) return c.json({ error: 'this invitation is not available' }, 410)

    const state = stateOf(invite)
    if (state !== 'valid') return c.json({ error: `this invitation is ${state}` }, 410)

    if (invite.email.toLowerCase() !== caller.user.email.toLowerCase()) {
      return c.json({ error: 'this invitation is for another address' }, 403)
    }

    const now = new Date().toISOString()
    await caller.db.batch([
      {
        sql: "INSERT INTO instance_members (user_id, role) VALUES (?1, 'member') ON CONFLICT (user_id) DO NOTHING",
        params: [caller.user.id],
      },
      {
        sql: `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES (?1, ?2, ?3, ?4)
              ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`,
        params: [WORKSPACE_ID, caller.user.id, invite.role, invite.invited_by],
      },
      { sql: 'UPDATE invites SET accepted_at = ?1 WHERE id = ?2', params: [now, invite.id] },
      {
        sql: `INSERT INTO audit_events (actor_id, action, target_type, target_id) VALUES (?1, 'invite.accepted', 'invite', ?2)`,
        params: [caller.user.id, invite.id],
      },
    ])

    return c.json({ id: invite.id, workspaces: [{ id: WORKSPACE_ID, role: invite.role }] })
  })

  return routes
}
