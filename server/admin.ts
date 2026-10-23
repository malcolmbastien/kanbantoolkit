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
import type { Role } from '../src/domain/roles'
import { accessMode, setAccess } from './instance'
import { publicUrl } from './config'
import { createInvite, liveFor, pending, resendInvite, revokeInvite, stateOf } from './invites'
import type { Invite } from './invites'
import { mayAdminister } from '../src/domain/roster'
import type { Roster, RosterOperation } from '../src/domain/roster'
import { WORKSPACE_ID } from './auth/session'
import type { Database } from './db'
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

  /**
   * The roster, as the judgement needs it.
   *
   * Read immediately before the write rather than held from an earlier read: the whole point of
   * these rules is that the count is the count *now*.
   */
  async function personOf(db: Database, id: string) {
    return db.get<{ id: string; status: string; instance: string | null; workspace: string | null }>(
      `SELECT u.id, u.status, i.role AS instance, w.role AS workspace
       FROM users u
       LEFT JOIN instance_members i ON i.user_id = u.id
       LEFT JOIN workspace_members w ON w.user_id = u.id AND w.workspace_id = ?2
       WHERE u.id = ?1`,
      [id, WORKSPACE_ID],
    )
  }

  async function activeAdmins(db: Database): Promise<{ instance: number; workspace: number }> {
    const row = await db.get<{ instance: number; workspace: number }>(
      `SELECT
         (SELECT COUNT(*) FROM instance_members m JOIN users u ON u.id = m.user_id
           WHERE m.role = 'admin' AND u.status = 'active') AS instance,
         (SELECT COUNT(*) FROM workspace_members w JOIN users u ON u.id = w.user_id
           WHERE w.role = 'admin' AND w.workspace_id = ?1 AND u.status = 'active') AS workspace`,
      [WORKSPACE_ID],
    )
    return { instance: row?.instance ?? 0, workspace: row?.workspace ?? 0 }
  }

  /** The one judgement, with the roster read for it. Answers a response when it refuses. */
  async function refuse(
    c: Parameters<typeof requireInstanceAdmin>[0],
    caller: { db: Database; user: { id: string; role: string }; instanceRole: string },
    targetId: string,
    operation: RosterOperation,
  ): Promise<Response | undefined> {
    const target = await personOf(caller.db, targetId)
    if (!target) return c.json({ error: 'no such person' }, 404) as unknown as Response

    const counts = await activeAdmins(caller.db)
    const roster: Roster = {
      actor: {
        id: caller.user.id,
        active: true,
        instanceAdmin: caller.instanceRole === 'admin',
        workspaceAdmin: caller.user.role === 'admin',
      },
      target: {
        id: target.id,
        active: target.status === 'active',
        instanceAdmin: target.instance === 'admin',
        workspaceAdmin: target.workspace === 'admin',
      },
      instanceAdmins: counts.instance,
      workspaceAdmins: counts.workspace,
    }

    const verdict = mayAdminister(roster, operation)
    return verdict.ok ? undefined : (c.json({ error: verdict.reason }, 409) as unknown as Response)
  }

  /**
   * Close somebody's door.
   *
   * One batch: the status, every live session, and the record of it. A deactivation that left a
   * session working would be a door that looks shut and is not.
   */
  routes.post('/users/:id/deactivate', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const id = c.req.param('id')
    const refused = await refuse(c, caller, id, 'deactivate')
    if (refused) return refused

    const now = new Date().toISOString()
    await caller.db.batch([
      { sql: "UPDATE users SET status = 'inactive', updated_at = ?1 WHERE id = ?2", params: [now, id] },
      {
        sql: 'UPDATE sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL',
        params: [now, id],
      },
      {
        sql: 'INSERT INTO audit_events (actor_id, action, target_type, target_id) VALUES (?1, ?2, ?3, ?4)',
        params: [caller.user.id, 'user.deactivate', 'user', id],
      },
    ])

    return c.body(null, 204)
  })

  /** Open it again. Nothing is restored but the door: the account, its identities and its history
   *  were never removed, so a new sign-in finds the same person. */
  routes.post('/users/:id/activate', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const id = c.req.param('id')
    const target = await personOf(caller.db, id)
    if (!target) return c.json({ error: 'no such person' }, 404)

    const now = new Date().toISOString()
    await caller.db.batch([
      { sql: "UPDATE users SET status = 'active', updated_at = ?1 WHERE id = ?2", params: [now, id] },
      {
        sql: 'INSERT INTO audit_events (actor_id, action, target_type, target_id) VALUES (?1, ?2, ?3, ?4)',
        params: [caller.user.id, 'user.activate', 'user', id],
      },
    ])

    return c.body(null, 204)
  })

  /** The list's shape: everything but the token, which exists only in the link. */
  const view = (invite: Invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    invitedBy: invite.invited_by,
    createdAt: invite.created_at,
    expiresAt: invite.expires_at,
    acceptedAt: invite.accepted_at,
    revokedAt: invite.revoked_at,
    state: stateOf(invite),
  })

  const link = (c: Parameters<typeof requireInstanceAdmin>[0], token: string) =>
    `${publicUrl(c.env, c.req.raw)}/?invite=${encodeURIComponent(token)}`

  routes.get('/invites', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller
    return c.json({ invites: (await pending(caller.db)).map(view) })
  })

  /**
   * Mint a link. The plaintext token is in the answer and nowhere else — it is not stored, so a
   * second call cannot return the same one; a resend is the way to get another.
   *
   * The answer says nothing about whether the address already has an account, because the question
   * is not asked: an invitation is a door for an address, not a note about a person.
   */
  routes.post('/invites', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const body = (await c.req.json().catch(() => null)) as { email?: unknown; role?: unknown; days?: unknown } | null
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!email.includes('@')) return c.json({ error: 'an address is required' }, 400)

    const role: Role = body?.role === 'viewer' || body?.role === 'admin' ? body.role : 'editor'
    const days = typeof body?.days === 'number' ? body.days : undefined

    // One live token per address, not two: a second link to the same person is a second way in that
    // nobody remembers sending.
    if (await liveFor(caller.db, email)) {
      return c.json({ error: 'an invitation is already pending for that address' }, 409)
    }

    const { invite, token } = await createInvite(caller.db, { email, role, invitedBy: caller.user.id, days })
    await record(caller.db, {
      actorId: caller.user.id,
      action: 'invite.create',
      targetType: 'invite',
      targetId: invite.id,
      data: { role },
    })

    return c.json({ invite: view(invite), url: link(c, token) }, 201)
  })

  /** A new token, and the old link stops matching anything. */
  routes.post('/invites/:id/resend', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const resent = await resendInvite(caller.db, c.req.param('id'))
    if (!resent) return c.json({ error: 'no such invitation' }, 404)

    await record(caller.db, {
      actorId: caller.user.id,
      action: 'invite.resend',
      targetType: 'invite',
      targetId: resent.invite.id,
    })

    return c.json({ invite: view(resent.invite), url: link(c, resent.token) })
  })

  routes.delete('/invites/:id', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    await revokeInvite(caller.db, c.req.param('id'))
    await record(caller.db, {
      actorId: caller.user.id,
      action: 'invite.revoke',
      targetType: 'invite',
      targetId: c.req.param('id'),
    })

    return c.body(null, 204)
  })

  return routes
}
