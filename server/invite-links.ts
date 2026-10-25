/**
 * The link itself.
 *
 * Public inspection, because the person holding it has not signed in yet — and deliberately
 * uninformative: a masked address, a role, an expiry. Nothing that would let somebody who found a
 * link learn who it was for.
 *
 * **Acceptance has two shapes** (task 154.5):
 *
 * - with a session, the session's verified address must be the invitation's — the link alone grants
 *   nothing, so forwarding it only forwards the question "would you sign in as them";
 * - without one, the link is the proof and the person chooses a password: the account is created with
 *   the role the invitation named, and the invitation is spent. That is the whole of how a deployment
 *   with no identity provider and no mail gets a second person in.
 */

import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { requireUser } from './access'
import { issueSession, sessionCookie, WORKSPACE_ID } from './auth/session'
import { MIN_LENGTH, acceptable, hash } from './auth/password'
import { randomToken, sha256 } from './auth/oauth'
import { salt } from './config'
import { byToken, mask, stateOf } from './invites'
import { record } from './audit'
import type { Database, Statement } from './db'
import type { Runtime } from './runtime'

/** The client's address, hashed — the audit never holds an address, only its salted digest. */
async function addressHashOf(runtime: Runtime, env: unknown, request: Request): Promise<string> {
  return sha256(`${runtime.clientIp(request)}:${salt(env)}`)
}

/** The address the invitation was written for, as the account's email. */
async function accountFor(db: Database, email: string): Promise<boolean> {
  return Boolean(await db.get('SELECT 1 AS seen FROM users WHERE lower(email) = ?1', [email.toLowerCase()]))
}

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
    const db = runtime.database(c.env)
    if (!db) return c.json({ error: 'not configured' }, 503)

    const body = (await c.req.json().catch(() => null)) as { password?: unknown; name?: unknown } | null
    const offered = typeof body?.password === 'string' ? body.password : ''

    // No session: the link is the proof, and the person chooses the password the account will have.
    if (!getCookie(c, sessionCookie(c.env, c.req.raw).name)) {
      const invite = await byToken(db, c.req.param('token'))
      if (!invite || stateOf(invite) !== 'valid') return c.json({ error: 'this invitation is not available' }, 410)
      if (await accountFor(db, invite.email)) {
        return c.json({ error: 'this address already has an account — sign in instead' }, 409)
      }
      if (!acceptable(offered)) return c.json({ error: `a password needs at least ${MIN_LENGTH} characters` }, 400)

      const userId = `u_${randomToken(12)}`
      const name =
        typeof body?.name === 'string' && body.name.trim()
          ? body.name.trim().slice(0, 120)
          : invite.email.split('@')[0].replace(/[._-]+/g, ' ')
      const now = new Date().toISOString()
      const ipHash = await addressHashOf(runtime, c.env, c.req.raw)

      const accepted: Statement[] = [
        { sql: 'INSERT INTO users (id, name, email, password_hash) VALUES (?1, ?2, ?3, ?4)', params: [userId, name, invite.email, await hash(offered)] },
        { sql: "INSERT INTO instance_members (user_id, role) VALUES (?1, 'member')", params: [userId] },
        {
          sql: 'INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES (?1, ?2, ?3, ?4)',
          params: [WORKSPACE_ID, userId, invite.role, invite.invited_by],
        },
        { sql: 'UPDATE invites SET accepted_at = ?1 WHERE id = ?2', params: [now, invite.id] },
        {
          sql: `INSERT INTO audit_events (actor_id, action, target_type, target_id) VALUES (?1, 'invite.accepted', 'invite', ?2)`,
          params: [userId, invite.id],
        },
      ]
      await db.batch(accepted)

      const session = await issueSession(db, userId, { userAgent: c.req.header('user-agent'), ipHash })
      const cookie = sessionCookie(c.env, c.req.raw)
      setCookie(c, cookie.name, session.token, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: session.maxAge,
        secure: cookie.secure,
      })
      await record(db, { actorId: userId, action: 'signin', targetType: 'password', ipHash })

      return c.json({
        id: invite.id,
        workspaces: [{ id: WORKSPACE_ID, role: invite.role }],
        user: { id: userId, name, email: invite.email },
      })
    }

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
