/**
 * The instance's own administration.
 *
 * One surface so far: the access posture. Every route here is behind `requireInstanceAdmin`, which
 * reads the role on the request rather than trusting anything the client holds — and every change
 * writes an audit event, because a door opened is a fact somebody should be able to find later.
 */

import { Hono } from 'hono'
import { requireInstanceAdmin } from './access'
import { statement } from './audit'
import type { Role } from '../src/domain/roles'
import { normaliseDomain, setAccess, setAllowedDomains, settings } from './instance'
import { effectiveRole, strongestGrant, workspaceAdminIds } from './groups'
import { publicUrl } from './config'
import { createInvite, liveFor, resendInvite, revokeInvite, stateOf } from './invites'
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
    return c.json(await settings(caller.db))
  })

  routes.patch('/settings', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const body = (await c.req.json().catch(() => null)) as { access?: unknown; allowedDomains?: unknown } | null
    if (!body || (!('access' in body) && !('allowedDomains' in body))) {
      return c.json({ error: 'nothing to change' }, 400)
    }

    if ('access' in body) {
      const access = body.access
      if (access !== 'open' && access !== 'closed') {
        return c.json({ error: 'access must be "open" or "closed"' }, 400)
      }
      await setAccess(
        caller.db,
        access as Access,
        statement({ actorId: caller.user.id, action: 'instance.access', targetType: 'instance', data: { access } }),
      )
    }

    if ('allowedDomains' in body) {
      if (!Array.isArray(body.allowedDomains)) return c.json({ error: 'allowedDomains must be a list' }, 400)
      const domains: string[] = []
      for (const entry of body.allowedDomains) {
        const domain = typeof entry === 'string' ? normaliseDomain(entry) : undefined
        if (!domain) return c.json({ error: `that is not a domain: ${String(entry)}` }, 400)
        if (!domains.includes(domain)) domains.push(domain)
      }
      await setAllowedDomains(
        caller.db,
        domains,
        statement({
          actorId: caller.user.id,
          action: 'instance.domains',
          targetType: 'instance',
          // The list itself is configuration, not a secret; the count is enough for the trail.
          data: { domains: domains.length },
        }),
      )
    }

    return c.json(await settings(caller.db))
  })

  /**
   * The roster, as the judgement needs it.
   *
   * Read immediately before the write rather than held from an earlier read: the whole point of
   * these rules is that the count is the count *now*.
   */
  async function personOf(db: Database, id: string) {
    const row = await db.get<{ id: string; status: string; instance: string | null }>(
      `SELECT u.id, u.status, i.role AS instance
       FROM users u
       LEFT JOIN instance_members i ON i.user_id = u.id
       WHERE u.id = ?1`,
      [id],
    )
    if (!row) return undefined
    // The standing that matters is the effective one: a person made an administrator by a group is
    // an administrator, and the last-administrator rule has to see them.
    const grant = await effectiveRole(db, id, WORKSPACE_ID)
    return { ...row, workspace: grant?.role ?? null }
  }

  async function activeAdmins(db: Database): Promise<{ instance: number; workspace: number }> {
    const row = await db.get<{ instance: number }>(
      `SELECT COUNT(*) AS instance FROM instance_members m JOIN users u ON u.id = m.user_id
        WHERE m.role = 'admin' AND u.status = 'active'`,
    )
    // A workspace administrator is anybody who *is* one: directly, or through an active group
    // (task 146). A count that ignored groups would let the last one be removed by a side door.
    return { instance: row?.instance ?? 0, workspace: (await workspaceAdminIds(db, WORKSPACE_ID)).size }
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
    scope: (invite as Invite & { scope?: string }).scope ?? 'instance',
  })

  const link = (c: Parameters<typeof requireInstanceAdmin>[0], token: string) =>
    `${publicUrl(c.env, c.req.raw)}/?invite=${encodeURIComponent(token)}`

  routes.get('/invites', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    // The inviter's name and, once it is spent, the name of the account it became: the record of who
    // invited whom is half the reason to keep an accepted row.
    const rows = await caller.db.all<Invite & { invited_by_name: string | null; accepted_name: string | null }>(
      `SELECT i.id, i.email, i.role, i.invited_by, i.created_at, i.expires_at, i.accepted_at, i.revoked_at, i.scope,
              u.name AS invited_by_name, a.name AS accepted_name
       FROM invites i
       LEFT JOIN users u ON u.id = i.invited_by
       LEFT JOIN users a ON lower(a.email) = i.email
       ORDER BY i.created_at DESC LIMIT 200`,
    )

    return c.json({
      invites: rows.map((row) => ({
        ...view(row),
        invitedByName: row.invited_by_name ?? undefined,
        acceptedName: row.accepted_name ?? undefined,
      })),
    })
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

    const { invite, token } = await createInvite(caller.db, {
      email,
      role,
      invitedBy: caller.user.id,
      days,
      // The id is minted inside; the record of it is written with it, in one batch.
      audit: (id) =>
        statement({ actorId: caller.user.id, action: 'invite.create', targetType: 'invite', targetId: id, data: { role } }),
    })

    return c.json({ invite: view(invite), url: link(c, token) }, 201)
  })

  /** A new token, and the old link stops matching anything. */
  routes.post('/invites/:id/resend', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const id = c.req.param('id')
    const resent = await resendInvite(
      caller.db,
      id,
      new Date(),
      statement({ actorId: caller.user.id, action: 'invite.resend', targetType: 'invite', targetId: id }),
    )
    if (!resent) return c.json({ error: 'no such invitation' }, 404)

    return c.json({ invite: view(resent.invite), url: link(c, resent.token) })
  })

  routes.delete('/invites/:id', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const id = c.req.param('id')
    await revokeInvite(
      caller.db,
      id,
      statement({ actorId: caller.user.id, action: 'invite.revoke', targetType: 'invite', targetId: id }),
    )

    return c.body(null, 204)
  })

  /**
   * The directory.
   *
   * Paged by name, filtered and searched in the database rather than in the browser: a directory is
   * the one list that grows without anyone deciding it should, and "download all of them" stops
   * being acceptable at about the third team.
   */
  routes.get('/users', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const search = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 100)
    const status = c.req.query('status') === 'inactive' ? 'inactive' : c.req.query('status') === 'active' ? 'active' : ''
    const role = ['viewer', 'editor', 'admin'].includes(c.req.query('role') ?? '') ? c.req.query('role')! : ''
    const provider = (c.req.query('provider') ?? '').trim().toLowerCase().slice(0, 40)
    const sort = c.req.query('sort') === 'active' ? 'active' : 'name'
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 200)
    const after = c.req.query('after') ?? ''

    const params: unknown[] = [WORKSPACE_ID]
    const where: string[] = []

    if (search) {
      where.push(`(lower(u.name) LIKE ?${params.length + 1} OR lower(u.email) LIKE ?${params.length + 1})`)
      params.push(`%${search}%`)
    }
    if (status) {
      where.push(`u.status = ?${params.length + 1}`)
      params.push(status)
    }
    if (role) {
      where.push(`w.role = ?${params.length + 1}`)
      params.push(role)
    }
    if (provider) {
      where.push(`EXISTS (SELECT 1 FROM identities d WHERE d.user_id = u.id AND d.provider = ?${params.length + 1})`)
      params.push(provider)
    }
    if (after) {
      // The cursor is the last row's sort value and id, compared as a pair, so a page boundary
      // cannot repeat or skip a person who shares a name — or a time.
      const [value, id] = [after.slice(0, after.indexOf('|')), after.slice(after.indexOf('|') + 1)]
      if (sort === 'active') {
        where.push(`(coalesce(u.last_seen_at, ''), u.id) < (?${params.length + 1}, ?${params.length + 2})`)
      } else {
        where.push(`(u.name, u.id) > (?${params.length + 1}, ?${params.length + 2})`)
      }
      params.push(value, id)
    }

    const rows = await caller.db.all<{
      id: string
      name: string
      email: string
      avatar_url: string | null
      status: string
      last_seen_at: string | null
      created_at: string
      instance_role: string | null
      workspace_role: string | null
    }>(
      `SELECT u.id, u.name, u.email, u.avatar_url, u.status, u.last_seen_at, u.created_at,
              i.role AS instance_role, w.role AS workspace_role
       FROM users u
       LEFT JOIN instance_members i ON i.user_id = u.id
       LEFT JOIN workspace_members w ON w.user_id = u.id AND w.workspace_id = ?1
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${sort === 'active' ? "coalesce(u.last_seen_at, '') DESC, u.id" : 'u.name, u.id'}
       LIMIT ?${params.length + 1}`,
      [...params, limit + 1],
    )

    const page = rows.slice(0, limit)

    // Where each of these people gets their role, in one query rather than one per row.
    const grants = page
      .length
      ? await caller.db.all<{ user_id: string; role: string; name: string }>(
          `SELECT m.user_id, r.role, g.name
             FROM group_members m
             JOIN groups g ON g.id = m.group_id AND g.active = 1
             JOIN group_workspace_roles r ON r.group_id = g.id AND r.workspace_id = ?1
            WHERE m.user_id IN (${page.map((_, index) => `?${index + 2}`).join(', ')})`,
          [WORKSPACE_ID, ...page.map((row) => row.id)],
        )
      : []

    const last = page[page.length - 1]
    // How many active administrators exist, so the interface can explain a disabled control before
    // the server refuses it. The server still refuses.
    const providers = await caller.db.all<{ provider: string }>(
      'SELECT DISTINCT provider FROM identities ORDER BY provider',
    )
    // The count the interface explains a disabled control with: group-granted administrators are
    // administrators, so the number has to include them (task 146, R4).
    const admins = { n: (await workspaceAdminIds(caller.db, WORKSPACE_ID)).size }

    return c.json({
      admins: admins?.n ?? 0,
      providers: providers.map((row) => row.provider),
      people: page.map((row) => {
        // The direct row, then every active group's grant, highest wins — the same rule the
        // permission check applies, answered here so the screen can say where a role came from.
        const best = strongestGrant(
          row.workspace_role,
          grants.filter((grant) => grant.user_id === row.id),
        )

        return {
          id: row.id,
          name: row.name,
          email: row.email,
          avatarUrl: row.avatar_url ?? undefined,
          status: row.status,
          lastSeenAt: row.last_seen_at ?? undefined,
          joinedAt: row.created_at,
          instanceRole: row.instance_role ?? 'member',
          role: row.workspace_role ?? 'viewer',
          effectiveRole: best?.role ?? 'viewer',
          roleSource: best?.source ?? 'direct',
          roleGroup: best?.groupName,
        }
      }),
      cursor: rows.length > limit && last ? `${sort === 'active' ? (last.last_seen_at ?? '') : last.name}|${last.id}` : null,
    })
  })

  /**
   * One person, for the drawer: who they are, whether an invitation is waiting, what they have been
   * doing, and the last few things that happened to them.
   */
  routes.get('/users/:id', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const id = c.req.param('id')
    const target = await personOf(caller.db, id)
    if (!target) return c.json({ error: 'no such person' }, 404)

    const user = await caller.db.get<{ name: string; email: string; avatar_url: string | null; last_seen_at: string | null; created_at: string }>(
      'SELECT name, email, avatar_url, last_seen_at, created_at FROM users WHERE id = ?1',
      [id],
    )
    const sessions = await caller.db.get<{ live: number; seen: string | null }>(
      `SELECT COUNT(*) AS live, MAX(last_seen_at) AS seen FROM sessions
       WHERE user_id = ?1 AND revoked_at IS NULL AND expires_at > ?2`,
      [id, new Date().toISOString()],
    )
    const invite = await caller.db.get<{ id: string; role: string; expires_at: string }>(
      `SELECT id, role, expires_at FROM invites
       WHERE email = lower(?1) AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?2
       ORDER BY created_at DESC LIMIT 1`,
      [user?.email ?? '', new Date().toISOString()],
    )
    const audit = await caller.db.all<{ at: string; action: string; actor: string | null }>(
      `SELECT e.at, e.action, a.name AS actor FROM audit_events e
       LEFT JOIN users a ON a.id = e.actor_id
       WHERE e.target_id = ?1 OR e.actor_id = ?1
       ORDER BY e.at DESC, e.id DESC LIMIT 10`,
      [id],
    )

    return c.json({
      person: {
        id,
        name: user?.name ?? '',
        email: user?.email ?? '',
        avatarUrl: user?.avatar_url ?? undefined,
        status: target.status,
        lastSeenAt: user?.last_seen_at ?? undefined,
        joinedAt: user?.created_at ?? '',
        instanceRole: target.instance ?? 'member',
        role: target.workspace ?? 'viewer',
      },
      sessions: { live: sessions?.live ?? 0, lastSeenAt: sessions?.seen ?? undefined },
      invite: invite ? { id: invite.id, role: invite.role, expiresAt: invite.expires_at } : undefined,
      audit,
    })
  })

  /** Edit what an administrator may edit. The address is recorded by name, never by value. */
  routes.patch('/users/:id', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const id = c.req.param('id')
    const target = await personOf(caller.db, id)
    if (!target) return c.json({ error: 'no such person' }, 404)

    const body = (await c.req.json().catch(() => null)) as { name?: unknown; email?: unknown } | null
    const updates: Record<string, string> = {}

    if (body && 'name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
      if (!name) return c.json({ error: 'a name is required' }, 400)
      updates.name = name
    }
    if (body && 'email' in body) {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 200) : ''
      if (!email.includes('@')) return c.json({ error: 'an address is required' }, 400)
      updates.email = email
    }
    if (!Object.keys(updates).length) return c.json({ error: 'nothing to change' }, 400)

    const columns = Object.keys(updates)
    await caller.db.batch([
      {
        sql: `UPDATE users SET ${columns.map((column, index) => `${column} = ?${index + 1}`).join(', ')}, updated_at = ?${columns.length + 1} WHERE id = ?${columns.length + 2}`,
        params: [...Object.values(updates), new Date().toISOString(), id],
      },
      statement({
        actorId: caller.user.id,
        action: 'user.edit',
        targetType: 'user',
        targetId: id,
        // Field names only. A trail that carried addresses would be a second directory.
        data: { fields: columns, by: 'administrator' },
      }),
    ])

    return c.json({ id })
  })

  /** Sign somebody out everywhere. Their next request is refused; nothing else changes. */
  routes.post('/users/:id/sessions/revoke', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const id = c.req.param('id')
    if (!(await personOf(caller.db, id))) return c.json({ error: 'no such person' }, 404)

    const live = await caller.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?1 AND revoked_at IS NULL',
      [id],
    )
    const now = new Date().toISOString()
    await caller.db.batch([
      { sql: 'UPDATE sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL', params: [now, id] },
      statement({ actorId: caller.user.id, action: 'session.revoke', targetType: 'user', targetId: id }),
    ])

    return c.json({ revoked: live?.n ?? 0 })
  })

  /**
   * Erase a person, rather than delete them.
   *
   * The account stays, with no address, no picture and no name that identifies anybody — so every
   * card, log entry and assignment that names them still resolves, and the person is gone from the
   * record. That is the difference 144 is about: delete removes the way in, erase removes the person
   * from what remains.
   */
  routes.post('/users/:id/erase', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const id = c.req.param('id')
    if (!(await personOf(caller.db, id))) return c.json({ error: 'no such person' }, 404)
    if (id === caller.user.id) return c.json({ error: 'You cannot erase yourself.' }, 409)

    const now = new Date().toISOString()
    await caller.db.batch([
      {
        sql: `UPDATE users SET name = 'Erased person', email = 'erased+?1@invalid', avatar_url = NULL,
                status = 'inactive', updated_at = ?2 WHERE id = ?1`,
        params: [id, now],
      },
      { sql: 'UPDATE sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL', params: [now, id] },
      { sql: 'DELETE FROM identities WHERE user_id = ?1', params: [id] },
      statement({ actorId: caller.user.id, action: 'user.erase', targetType: 'user', targetId: id }),
    ])

    return c.body(null, 204)
  })

  /** Change what somebody may do here. The last workspace administrator cannot be demoted. */
  routes.patch('/users/:id/role', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) as { role?: unknown } | null
    const role = body?.role
    if (role !== 'viewer' && role !== 'editor' && role !== 'admin') {
      return c.json({ error: 'role must be viewer, editor or admin' }, 400)
    }

    const refused = await refuse(c, caller, id, 'demote')
    if (refused) return refused

    await caller.db.batch([
      {
        sql: `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, ?3)
              ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`,
        params: [WORKSPACE_ID, id, role],
      },
      statement({
        actorId: caller.user.id,
        action: 'user.role',
        targetType: 'user',
        targetId: id,
        data: { workspaceRole: role },
      }),
    ])

    return c.json({ id, role })
  })

  /**
   * Several people at once.
   *
   * Judged as a whole before anything is written, the way the bulk parent change refuses a selection
   * that would cycle: if one row is protected, the operation does not happen and the row is named.
   * A partial application would be worse than a refusal, because nobody could tell afterwards which
   * half had happened.
   */
  routes.post('/users/bulk', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const body = (await c.req.json().catch(() => null)) as {
      ids?: unknown
      operation?: unknown
      role?: unknown
    } | null

    const ids = Array.isArray(body?.ids)
      ? [...new Set(body.ids.filter((id): id is string => typeof id === 'string'))].slice(0, 200)
      : []
    if (!ids.length) return c.json({ error: 'nothing selected' }, 400)

    const operation = body?.operation
    if (operation !== 'deactivate' && operation !== 'activate' && operation !== 'role') {
      return c.json({ error: 'operation must be deactivate, activate or role' }, 400)
    }
    const role = body?.role
    if (operation === 'role' && role !== 'viewer' && role !== 'editor' && role !== 'admin') {
      return c.json({ error: 'role must be viewer, editor or admin' }, 400)
    }

    // Every row, before any of them. A refusal names the row, because "that selection cannot be
    // changed" is not something an operator can act on.
    if (operation !== 'activate') {
      for (const id of ids) {
        const refused = await refuse(c, caller, id, operation === 'role' ? 'demote' : 'deactivate')
        if (!refused) continue
        if (refused.status === 404) return refused
        const named = await caller.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?1', [id])
        const answer = (await refused.json()) as { error?: string }
        return c.json({ error: `${named?.name ?? 'That person'} — ${answer.error ?? 'cannot be changed'}`, id }, 409)
      }
    } else {
      for (const id of ids) {
        if (!(await personOf(caller.db, id))) return c.json({ error: 'no such person' }, 404)
      }
    }

    const now = new Date().toISOString()
    const statements = []
    for (const id of ids) {
      if (operation === 'role') {
        statements.push({
          sql: `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, ?3)
                ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`,
          params: [WORKSPACE_ID, id, role as string],
        })
        statements.push(
          statement({ actorId: caller.user.id, action: 'user.role', targetType: 'user', targetId: id, data: { workspaceRole: role } }),
        )
      } else {
        statements.push({
          sql: `UPDATE users SET status = ?1, updated_at = ?2 WHERE id = ?3`,
          params: [operation === 'deactivate' ? 'inactive' : 'active', now, id],
        })
        if (operation === 'deactivate') {
          statements.push({ sql: 'UPDATE sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL', params: [now, id] })
        }
        statements.push(
          statement({
            actorId: caller.user.id,
            action: operation === 'deactivate' ? 'user.deactivate' : 'user.activate',
            targetType: 'user',
            targetId: id,
          }),
        )
      }
    }

    await caller.db.batch(statements)
    return c.json({ changed: ids.length })
  })

  /**
   * The directory as a file.
   *
   * The columns a person needs, and nothing that could authenticate anybody: no session, no token,
   * no hash. Quoted per RFC 4180, because a name with a comma in it is a name, not a broken file.
   */
  routes.get('/users.csv', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const search = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 100)
    const status = c.req.query('status') === 'inactive' ? 'inactive' : c.req.query('status') === 'active' ? 'active' : ''

    const params: unknown[] = [WORKSPACE_ID]
    const where: string[] = []
    if (search) {
      where.push(`(lower(u.name) LIKE ?${params.length + 1} OR lower(u.email) LIKE ?${params.length + 1})`)
      params.push(`%${search}%`)
    }
    if (status) {
      where.push(`u.status = ?${params.length + 1}`)
      params.push(status)
    }

    const rows = await caller.db.all<{
      name: string
      email: string
      role: string | null
      status: string
      last_seen_at: string | null
      created_at: string
    }>(
      `SELECT u.name, u.email, w.role, u.status, u.last_seen_at, u.created_at
       FROM users u
       LEFT JOIN workspace_members w ON w.user_id = u.id AND w.workspace_id = ?1
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY u.name, u.id
       LIMIT 10000`,
      params,
    )

    const quote = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
    const lines = [
      ['name', 'email', 'role', 'status', 'last active', 'joined'].join(','),
      ...rows.map((row) =>
        [row.name, row.email, row.role ?? 'viewer', row.status, row.last_seen_at ?? '', row.created_at].map(quote).join(','),
      ),
    ]

    return new Response(lines.join('\r\n'), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        // The date is in the name so two exports a week apart do not silently replace each other.
        'content-disposition': `attachment; filename="flowline-people-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  })

  /**
   * Delete an account.
   *
   * It removes the way in and the record of who they were to the instance — not the work: a card
   * keeps its assignee, because `people` is a different table and a person who has left is still
   * the person who did the work.
   */
  routes.delete('/users/:id', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const id = c.req.param('id')
    const refused = await refuse(c, caller, id, 'delete')
    if (refused) return refused

    await caller.db.batch([
      { sql: 'DELETE FROM users WHERE id = ?1', params: [id] },
      statement({ actorId: caller.user.id, action: 'user.delete', targetType: 'user', targetId: id }),
    ])

    return c.body(null, 204)
  })

  return routes
}
