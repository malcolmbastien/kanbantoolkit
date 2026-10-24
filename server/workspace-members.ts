/**
 * The workspace's own members.
 *
 * This is the boundary the two axes exist for. An **instance** administrator runs the deployment;
 * a **workspace** administrator runs this team — and may invite into it, change a role, or remove
 * somebody, without being able to grant themselves anything at the instance level.
 *
 * The guard is the same roster judgement the People screen uses; the difference is which question
 * was asked before it (`workspace.members` rather than `instance admin`).
 */

import { Hono } from 'hono'
import { requireWorkspace } from './access'
import { statement } from './audit'
import { WORKSPACE_ID } from './auth/session'
import { mayAdminister } from '../src/domain/roster'
import { accountRemovalStatements, isLastDeploymentAdministrator } from './workspace/account'
import { effectiveRole, strongestGrant, workspaceAdminIds } from './groups'
import type { Roster, RosterOperation } from '../src/domain/roster'
import { createInvite } from './invites'
import type { Role } from '../src/domain/roles'
import type { Database } from './db'
import type { Runtime } from './runtime'

async function memberOf(db: Database, id: string) {
  const row = await db.get<{ id: string; status: string; instance: string | null }>(
    `SELECT u.id, u.status, i.role AS instance
     FROM users u
     LEFT JOIN instance_members i ON i.user_id = u.id
     WHERE u.id = ?1`,
    [id],
  )
  if (!row) return undefined
  // Effective, not direct: a person who administers through a group administers (task 146, R4).
  const grant = await effectiveRole(db, id, WORKSPACE_ID)
  return { ...row, workspace: grant?.role ?? null }
}

async function admins(db: Database): Promise<{ instance: number; workspace: number }> {
  const row = await db.get<{ instance: number }>(
    `SELECT COUNT(*) AS instance FROM instance_members m JOIN users u ON u.id = m.user_id
      WHERE m.role = 'admin' AND u.status = 'active'`,
  )
  // Group-granted administrators are administrators, so the count includes them.
  return { instance: row?.instance ?? 0, workspace: (await workspaceAdminIds(db, WORKSPACE_ID)).size }
}

export function workspaceMembersRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  routes.get('/', async (c) => {
    const caller = await requireWorkspace(c, runtime, 'workspace.members')
    if (caller instanceof Response) return caller

    const settings = await caller.db.get<{ name: string; description: string }>(
      'SELECT name, description FROM workspace WHERE id = ?1',
      [WORKSPACE_ID],
    )
    const members = await caller.db.all<{
      id: string
      name: string
      email: string
      avatar_url: string | null
      status: string
      role: string
      created_at: string
    }>(
      `SELECT u.id, u.name, u.email, u.avatar_url, u.status, w.role, w.created_at
       FROM workspace_members w JOIN users u ON u.id = w.user_id
       WHERE w.workspace_id = ?1
       ORDER BY w.created_at, u.name`,
      [WORKSPACE_ID],
    )
    const grants = await caller.db.all<{ user_id: string; role: string; name: string }>(
      `SELECT m.user_id, r.role, g.name
         FROM group_members m
         JOIN groups g ON g.id = m.group_id AND g.active = 1
         JOIN group_workspace_roles r ON r.group_id = g.id AND r.workspace_id = ?1`,
      [WORKSPACE_ID],
    )

    return c.json({
      workspace: { name: settings?.name ?? 'Flowline', description: settings?.description ?? '' },
      members: members.map((member) => {
        const effective = strongestGrant(
          member.role,
          grants.filter((grant) => grant.user_id === member.id),
        )
        return {
          id: member.id,
          name: member.name,
          email: member.email,
          avatarUrl: member.avatar_url ?? undefined,
          status: member.status,
          // The direct row is what the select edits; the effective role is what the server grants,
          // and the source is how the screen explains the difference.
          role: member.role,
          effectiveRole: effective?.role ?? member.role,
          roleSource: effective?.source ?? 'direct',
          roleGroup: effective?.groupName,
          joinedAt: member.created_at,
        }
      }),
    })
  })

  /** The name and the description: this workspace's own voice, not the instance's. */
  routes.patch('/', async (c) => {
    const caller = await requireWorkspace(c, runtime, 'workspace.settings')
    if (caller instanceof Response) return caller

    const body = (await c.req.json().catch(() => null)) as { name?: unknown; description?: unknown } | null
    const updates: Record<string, string> = {}
    if (body && 'name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
      if (!name) return c.json({ error: 'a name is required' }, 400)
      updates.name = name
    }
    if (body && 'description' in body) {
      updates.description = typeof body.description === 'string' ? body.description.slice(0, 2_000) : ''
    }
    if (!Object.keys(updates).length) return c.json({ error: 'nothing to change' }, 400)

    const columns = Object.keys(updates)
    await caller.db.batch([
      {
        sql: `INSERT INTO workspace (id, ${columns.join(', ')}) VALUES (?1${columns.map((_, index) => `, ?${index + 2}`).join('')})
              ON CONFLICT (id) DO UPDATE SET ${columns.map((column, index) => `${column} = ?${index + 2}`).join(', ')}`,
        params: [WORKSPACE_ID, ...Object.values(updates)],
      },
      statement({
        actorId: caller.user.id,
        action: 'workspace.settings',
        targetType: 'workspace',
        targetId: WORKSPACE_ID,
        data: { fields: columns },
      }),
    ])

    return c.body(null, 204)
  })

  /** Invite somebody into this workspace, with the role it names. It says which workspace it is for. */
  routes.post('/invites', async (c) => {
    const caller = await requireWorkspace(c, runtime, 'workspace.members')
    if (caller instanceof Response) return caller

    const body = (await c.req.json().catch(() => null)) as { email?: unknown; role?: unknown; days?: unknown } | null
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!email.includes('@')) return c.json({ error: 'an address is required' }, 400)

    const role: Role = body?.role === 'viewer' || body?.role === 'admin' ? body.role : 'editor'
    const days = typeof body?.days === 'number' ? body.days : undefined

    const { invite, token } = await createInvite(caller.db, {
      email,
      role,
      invitedBy: caller.user.id,
      days,
      scope: 'workspace',
      audit: (id) =>
        statement({
          actorId: caller.user.id,
          action: 'workspace.invite',
          targetType: 'invite',
          targetId: id,
          data: { role, scope: 'workspace' },
        }),
    })

    return c.json({ invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expires_at }, token }, 201)
  })

  async function judge(c: Parameters<typeof requireWorkspace>[0], caller: { user: { id: string; role: string }; instanceRole: string; db: Database }, targetId: string, operation: RosterOperation) {
    const target = await memberOf(caller.db, targetId)
    if (!target) return c.json({ error: 'no such member' }, 404) as unknown as Response

    const counts = await admins(caller.db)
    const roster: Roster = {
      actor: { id: caller.user.id, active: true, instanceAdmin: caller.instanceRole === 'admin', workspaceAdmin: caller.user.role === 'admin' },
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

  /** Change a role here. Nothing else — not the instance role, not another workspace. */
  routes.patch('/members/:id', async (c) => {
    const caller = await requireWorkspace(c, runtime, 'workspace.members')
    if (caller instanceof Response) return caller

    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) as { role?: unknown } | null
    const role = body?.role
    if (role !== 'viewer' && role !== 'editor' && role !== 'admin') {
      return c.json({ error: 'role must be viewer, editor or admin' }, 400)
    }

    const refused = await judge(c, caller, id, 'demote')
    if (refused) return refused

    await caller.db.batch([
      {
        sql: 'UPDATE workspace_members SET role = ?1 WHERE workspace_id = ?2 AND user_id = ?3',
        params: [role, WORKSPACE_ID, id],
      },
      statement({ actorId: caller.user.id, action: 'workspace.role', targetType: 'user', targetId: id, data: { role } }),
    ])

    return c.json({ id, role })
  })

  /**
   * Close somebody's door without ending them.
   *
   * Deactivation keeps the account: they cannot sign in, their sessions end, and every place the
   * history names them keeps their name. It is the reversible act, and the members screen must not
   * let it be mistaken for the one below.
   */
  routes.post('/members/:id/deactivate', async (c) => {
    const caller = await requireWorkspace(c, runtime, 'workspace.members')
    if (caller instanceof Response) return caller

    const id = c.req.param('id')
    const refused = await judge(c, caller, id, 'deactivate')
    if (refused) return refused

    const now = new Date().toISOString()
    await caller.db.batch([
      { sql: "UPDATE users SET status = 'inactive', updated_at = ?1 WHERE id = ?2", params: [now, id] },
      // A deactivation that left a session working would be a door that looks shut and is not.
      { sql: 'UPDATE sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL', params: [now, id] },
      statement({ actorId: caller.user.id, action: 'user.deactivate', targetType: 'user', targetId: id }),
    ])

    return c.body(null, 204)
  })

  /** The other end of it: the account is still there, so its door can be opened again. */
  routes.post('/members/:id/activate', async (c) => {
    const caller = await requireWorkspace(c, runtime, 'workspace.members')
    if (caller instanceof Response) return caller

    const id = c.req.param('id')
    const target = await memberOf(caller.db, id)
    if (!target) return c.json({ error: 'no such member' }, 404)

    await caller.db.batch([
      {
        sql: "UPDATE users SET status = 'active', updated_at = ?1 WHERE id = ?2",
        params: [new Date().toISOString(), id],
      },
      statement({ actorId: caller.user.id, action: 'user.activate', targetType: 'user', targetId: id }),
    ])

    return c.body(null, 204)
  })

  /**
   * Remove somebody: their account ends, and the work they did keeps saying "Former member".
   *
   * Not deactivation. This deletes the record — the person, their ways in, their sessions, their
   * memberships — and touches none of the work: no item, no log entry, no comment, no placement, no
   * edge, and no audit event. The trail entry is written first, so it survives with its actor
   * nulled by the foreign key that already points at a person (task 144).
   *
   * Coming back is a fresh invitation and a **new** account: the history of this one is not
   * re-attached, because attaching it would be a claim about identity nobody can check.
   */
  routes.delete('/members/:id', async (c) => {
    const caller = await requireWorkspace(c, runtime, 'workspace.members')
    if (caller instanceof Response) return caller

    const id = c.req.param('id')
    const refused = await judge(c, caller, id, 'remove')
    if (refused) return refused

    // An account going is an instance membership going too: the deployment must keep somebody who
    // can administer it (task 126's guard).
    if (await isLastDeploymentAdministrator(caller.db, id)) {
      return c.json({ error: 'this is the last administrator of the deployment. Appoint another one first.' }, 409)
    }

    const person = await caller.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?1', [id])
    await caller.db.batch([
      statement({
        actorId: caller.user.id,
        action: 'workspace.member.remove',
        targetType: 'user',
        targetId: id,
        // The name, because the row it points at is about to be gone.
        data: { name: person?.name ?? 'somebody', account: true },
      }),
      ...accountRemovalStatements('id = ?1', [id]),
    ])

    return c.body(null, 204)
  })

  return routes
}
