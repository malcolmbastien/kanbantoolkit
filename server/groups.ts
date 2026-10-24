/**
 * Groups: a role granted once to many.
 *
 * A group is a name, the people in it, and — per workspace — the role it carries. It is not a
 * container for permissions: there is no tree, nothing is inherited, and the permission check does
 * not know groups exist. It asks `effectiveRole`, which reads the union of the direct
 * `workspace_members` row and every *active* group's grant for that workspace, and answers the
 * highest role with the source it came from — because "why am I an editor?" deserves an answer,
 * and "because Platform Leads says so" is one.
 *
 * Two things are deliberately absent. **Nesting** (R5): a group has no parent column, so a cycle is
 * not prevented but impossible. And **any authority of its own**: an inactive group grants nothing,
 * immediately, and a group can never grant a role its assigner does not hold.
 *
 * The last-administrator rule (R4) reads the same union: a person made an administrator only by a
 * group is an administrator, so removing that group's grant is refused exactly as removing the last
 * person is.
 */

import { Hono } from 'hono'
import { requireInstanceAdmin } from './access'
import { statement } from './audit'
import { WORKSPACE_ID } from './auth/session'
import type { Role } from '../src/domain/roles'
import type { Database } from './db'
import type { Runtime } from './runtime'

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 }
const ROLES: Role[] = ['viewer', 'editor', 'admin']

export interface Grant {
  role: Role
  /** `direct`, `instance` (the administrator's bypass), or `group:<name>`. */
  source: string
  /** The group's name, when the grant came from one. */
  groupName?: string
}

/**
 * The highest of a direct role and a set of group grants — the same rule `effectiveRole` applies,
 * for a list that has already read the rows in bulk.
 */
export function strongestGrant(
  direct: string | null | undefined,
  grants: Array<{ role: string; name: string }>,
): Grant | undefined {
  const candidates: Array<{ role: Role; source: string; groupName?: string }> = []
  if (direct && (ROLES as string[]).includes(direct)) candidates.push({ role: direct as Role, source: 'direct' })
  for (const grant of grants) {
    if (!(ROLES as string[]).includes(grant.role)) continue
    candidates.push({ role: grant.role as Role, source: `group:${grant.name}`, groupName: grant.name })
  }
  return candidates.reduce<Grant | undefined>((winner, candidate) => {
    if (!winner) return candidate
    if (RANK[candidate.role] > RANK[winner.role]) return candidate
    // A tie keeps the direct row, so "why am I an editor" has one answer rather than two.
    if (RANK[candidate.role] === RANK[winner.role] && candidate.source === 'direct') return candidate
    return winner
  }, undefined)
}

/** Where a role came from, in words a screen can print. */
export function describeGrant(grant: Grant): string {
  if (grant.source === 'direct') return 'directly'
  if (grant.source === 'instance') return 'as an instance administrator'
  return `via ${grant.groupName ?? 'a group'}`
}

/**
 * The role a person has here, and where it came from.
 *
 * The union is read in one statement rather than assembled in the caller, so every path that asks
 * gets the same answer — the middleware, the member list, and the people screen.
 */
export async function effectiveRole(db: Database, userId: string, workspaceId: string): Promise<Grant | undefined> {
  const rows = await db.all<{ role: string; group_name: string | null }>(
    `SELECT w.role AS role, NULL AS group_name
       FROM workspace_members w
      WHERE w.workspace_id = ?2 AND w.user_id = ?1
     UNION ALL
     SELECT r.role AS role, g.name AS group_name
       FROM group_workspace_roles r
       JOIN groups g ON g.id = r.group_id
       JOIN group_members m ON m.group_id = g.id AND m.user_id = ?1
      WHERE r.workspace_id = ?2 AND g.active = 1`,
    [userId, workspaceId],
  )

  let best: Grant | undefined
  for (const row of rows) {
    const role = (ROLES as string[]).includes(row.role) ? (row.role as Role) : undefined
    if (!role) continue
    const candidate: Grant =
      row.group_name === null ? { role, source: 'direct' } : { role, source: `group:${row.group_name}`, groupName: row.group_name }
    // Highest wins; a tie keeps the direct row or the first group by name, so the answer is stable
    // rather than whatever order the database happened to return.
    if (!best || RANK[role] > RANK[best.role]) best = candidate
    else if (RANK[role] === RANK[best.role] && best.source !== 'direct' && candidate.source === 'direct') best = candidate
  }
  return best
}

/**
 * Everybody who administers this workspace — directly, or through an active group.
 *
 * This is the count the last-administrator rule is written against. `except` simulates the change
 * being judged: a group losing its grant, or one person leaving one group, so the answer is "who
 * would be left" rather than "who is left now".
 */
export async function workspaceAdminIds(
  db: Database,
  workspaceId: string,
  except?: { groupId: string; userId?: string },
): Promise<Set<string>> {
  const params: unknown[] = [workspaceId]
  // A group losing its grant (or being deactivated or deleted) stops counting entirely; one person
  // leaving a group stops counting through *that* group, and may still count through another.
  const withoutGroup = except && !except.userId ? `AND m.group_id <> ?${params.length + 1}` : ''
  if (except && !except.userId) params.push(except.groupId)
  const withoutMember =
    except?.userId ? `AND NOT (m.group_id = ?${params.length + 1} AND m.user_id = ?${params.length + 2})` : ''
  if (except?.userId) params.push(except.groupId, except.userId)

  const rows = await db.all<{ id: string }>(
    `SELECT u.id
       FROM users u
      WHERE u.status = 'active'
        AND (
          EXISTS (
            SELECT 1 FROM workspace_members w
             WHERE w.user_id = u.id AND w.workspace_id = ?1 AND w.role = 'admin'
          )
          OR EXISTS (
            SELECT 1 FROM group_members m
              JOIN groups g ON g.id = m.group_id AND g.active = 1
              JOIN group_workspace_roles r
                ON r.group_id = g.id AND r.workspace_id = ?1 AND r.role = 'admin'
             WHERE m.user_id = u.id ${withoutGroup} ${withoutMember}
          )
        )`,
    params,
  )
  return new Set(rows.map((row) => row.id))
}

/**
 * Would this change leave the workspace with nobody who can administer it?
 *
 * The same shape as the person-level rule, applied to the grant rather than to the person: a
 * workspace somebody cannot administer is one nobody can repair.
 */
export async function leavesNoAdmin(
  db: Database,
  workspaceId: string,
  except?: { groupId: string; userId?: string },
): Promise<boolean> {
  return (await workspaceAdminIds(db, workspaceId, except)).size === 0
}

export const NO_ADMIN = 'This would leave nobody able to administer this workspace. Give somebody the role first.'

interface GroupRow {
  id: string
  name: string
  description: string | null
  active: number
  created_at: string
}

interface GroupMemberRow {
  group_id: string
  user_id: string
  name: string
  email: string
}

export function groupsRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  /** The role the caller may hand out here: nobody grants more than they hold. */
  async function grantable(db: Database, callerId: string, instanceRole: string, workspaceId: string): Promise<Role> {
    if (instanceRole === 'admin') return 'admin'
    return (await effectiveRole(db, callerId, workspaceId))?.role ?? 'viewer'
  }

  async function groupOf(db: Database, id: string): Promise<GroupRow | undefined> {
    return db.get<GroupRow>('SELECT id, name, description, active, created_at FROM groups WHERE id = ?1', [id])
  }

  /**
   * Every group, with the people in it and the role it carries here.
   *
   * Read whole rather than paged: a team has tens of groups, and one screen reads all of them. The
   * member list carries names because the screen's job is to answer "who is in this one?" without a
   * second request per row.
   */
  routes.get('/', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const groups = await caller.db.all<GroupRow>('SELECT id, name, description, active, created_at FROM groups ORDER BY name')
    const members = await caller.db.all<GroupMemberRow>(
      `SELECT m.group_id, m.user_id, u.name, u.email
         FROM group_members m JOIN users u ON u.id = m.user_id
        ORDER BY u.name`,
    )
    const roles = await caller.db.all<{ group_id: string; workspace_id: string; role: string }>(
      'SELECT group_id, workspace_id, role FROM group_workspace_roles',
    )

    return c.json({
      workspaceId: WORKSPACE_ID,
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description ?? undefined,
        active: group.active === 1,
        createdAt: group.created_at,
        members: members
          .filter((member) => member.group_id === group.id)
          .map((member) => ({ id: member.user_id, name: member.name, email: member.email })),
        roles: Object.fromEntries(roles.filter((role) => role.group_id === group.id).map((role) => [role.workspace_id, role.role])),
      })),
    })
  })

  routes.post('/', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const body = (await c.req.json().catch(() => null)) as { name?: unknown; description?: unknown } | null
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : ''
    if (!name) return c.json({ error: 'a name is required' }, 400)
    const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 500) || null : null

    const existing = await caller.db.get('SELECT 1 AS seen FROM groups WHERE lower(name) = lower(?1)', [name])
    if (existing) return c.json({ error: 'there is already a group with that name' }, 409)

    const id = `grp-${crypto.randomUUID()}`
    await caller.db.batch([
      {
        sql: 'INSERT INTO groups (id, name, description, created_by) VALUES (?1, ?2, ?3, ?4)',
        params: [id, name, description, caller.user.id],
      },
      statement({ actorId: caller.user.id, action: 'group.create', targetType: 'group', targetId: id, data: { name } }),
    ])

    return c.json({ id, name, description: description ?? undefined, active: true, members: [], roles: {} }, 201)
  })

  /** The name, the words, and whether it is on — one route, because they are one thing. */
  routes.patch('/:id', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const group = await groupOf(caller.db, c.req.param('id'))
    if (!group) return c.json({ error: 'no such group' }, 404)

    const body = (await c.req.json().catch(() => null)) as { name?: unknown; description?: unknown; active?: unknown } | null
    const updates: Record<string, string | number | null> = {}

    if (body && 'name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
      if (!name) return c.json({ error: 'a name is required' }, 400)
      const clash = await caller.db.get(
        'SELECT 1 AS seen FROM groups WHERE lower(name) = lower(?1) AND id <> ?2',
        [name, group.id],
      )
      if (clash) return c.json({ error: 'there is already a group with that name' }, 409)
      updates.name = name
    }
    if (body && 'description' in body) {
      updates.description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) || null : null
    }
    if (body && 'active' in body) {
      if (typeof body.active !== 'boolean') return c.json({ error: 'active must be true or false' }, 400)
      // Turning a group off is a grant disappearing; it must not take the last administrator with it.
      if (!body.active && (await leavesNoAdmin(caller.db, WORKSPACE_ID, { groupId: group.id }))) {
        return c.json({ error: NO_ADMIN }, 409)
      }
      updates.active = body.active ? 1 : 0
    }

    if (!Object.keys(updates).length) return c.json({ error: 'nothing to change' }, 400)

    const columns = Object.keys(updates)
    await caller.db.batch([
      {
        sql: `UPDATE groups SET ${columns.map((column, index) => `${column} = ?${index + 1}`).join(', ')} WHERE id = ?${columns.length + 1}`,
        params: [...Object.values(updates), group.id],
      },
      statement({
        actorId: caller.user.id,
        action: 'group.edit',
        targetType: 'group',
        targetId: group.id,
        data: { fields: columns, ...(typeof updates.active === 'number' ? { active: updates.active === 1 } : {}) },
      }),
    ])

    return c.json({ id: group.id })
  })

  /** Gone, not hidden: an inactive group is the reversible answer to a role that is not wanted now. */
  routes.delete('/:id', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const group = await groupOf(caller.db, c.req.param('id'))
    if (!group) return c.json({ error: 'no such group' }, 404)

    // Deleting a *live* group is the same change as deactivating it, for the count's purposes.
    if (group.active === 1 && (await leavesNoAdmin(caller.db, WORKSPACE_ID, { groupId: group.id }))) {
      return c.json({ error: NO_ADMIN }, 409)
    }

    await caller.db.batch([
      { sql: 'DELETE FROM groups WHERE id = ?1', params: [group.id] },
      statement({
        actorId: caller.user.id,
        action: 'group.delete',
        targetType: 'group',
        targetId: group.id,
        data: { name: group.name },
      }),
    ])

    return c.body(null, 204)
  })

  routes.post('/:id/members', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const group = await groupOf(caller.db, c.req.param('id'))
    if (!group) return c.json({ error: 'no such group' }, 404)

    const body = (await c.req.json().catch(() => null)) as { userId?: unknown } | null
    const userId = typeof body?.userId === 'string' ? body.userId : ''
    const person = await caller.db.get<{ id: string; name: string }>('SELECT id, name FROM users WHERE id = ?1', [userId])
    if (!person) return c.json({ error: 'no such person' }, 404)

    if (!group.active) return c.json({ error: 'this group is inactive; turn it on before adding people' }, 409)

    await caller.db.batch([
      {
        sql: 'INSERT INTO group_members (group_id, user_id, added_by) VALUES (?1, ?2, ?3) ON CONFLICT (group_id, user_id) DO NOTHING',
        params: [group.id, person.id, caller.user.id],
      },
      statement({
        actorId: caller.user.id,
        action: 'group.member',
        targetType: 'group',
        targetId: group.id,
        data: { op: 'add', userId: person.id },
      }),
    ])

    return c.json({ id: group.id, members: [person.id] }, 201)
  })

  routes.delete('/:id/members/:userId', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const group = await groupOf(caller.db, c.req.param('id'))
    if (!group) return c.json({ error: 'no such group' }, 404)

    const userId = c.req.param('userId')
    // Leaving the last admin-carrying group must not take the last administrator with it.
    if (group.active === 1 && (await leavesNoAdmin(caller.db, WORKSPACE_ID, { groupId: group.id, userId }))) {
      return c.json({ error: NO_ADMIN }, 409)
    }

    await caller.db.batch([
      { sql: 'DELETE FROM group_members WHERE group_id = ?1 AND user_id = ?2', params: [group.id, userId] },
      statement({
        actorId: caller.user.id,
        action: 'group.member',
        targetType: 'group',
        targetId: group.id,
        data: { op: 'remove', userId },
      }),
    ])

    return c.body(null, 204)
  })

  /**
   * The role this group carries in a workspace — or none.
   *
   * The one place a group gains authority, and therefore the one place the two limits apply: the
   * role cannot exceed what the assigner holds, and it cannot be the last administrator either.
   */
  routes.put('/:id/role', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const group = await groupOf(caller.db, c.req.param('id'))
    if (!group) return c.json({ error: 'no such group' }, 404)

    const body = (await c.req.json().catch(() => null)) as { role?: unknown; workspaceId?: unknown } | null
    const workspaceId = typeof body?.workspaceId === 'string' && body.workspaceId ? body.workspaceId : WORKSPACE_ID
    const role = body?.role === null ? null : ROLES.includes(body?.role as Role) ? (body?.role as Role) : undefined
    if (role === undefined) return c.json({ error: 'role must be viewer, editor, admin or null' }, 400)

    if (role && RANK[role] > RANK[await grantable(caller.db, caller.user.id, caller.instanceRole, workspaceId)]) {
      return c.json({ error: `you cannot grant a role you do not hold here` }, 403)
    }

    const current = await caller.db.get<{ role: string }>(
      'SELECT role FROM group_workspace_roles WHERE group_id = ?1 AND workspace_id = ?2',
      [group.id, workspaceId],
    )

    // Losing an admin grant is the group-level form of the last-administrator rule.
    if (group.active === 1 && current?.role === 'admin' && role !== 'admin') {
      if (await leavesNoAdmin(caller.db, workspaceId, { groupId: group.id })) return c.json({ error: NO_ADMIN }, 409)
    }

    await caller.db.batch([
      role
        ? {
            sql: `INSERT INTO group_workspace_roles (group_id, workspace_id, role) VALUES (?1, ?2, ?3)
                  ON CONFLICT (group_id, workspace_id) DO UPDATE SET role = excluded.role`,
            params: [group.id, workspaceId, role],
          }
        : { sql: 'DELETE FROM group_workspace_roles WHERE group_id = ?1 AND workspace_id = ?2', params: [group.id, workspaceId] },
      statement({
        actorId: caller.user.id,
        action: 'group.role',
        targetType: 'group',
        targetId: group.id,
        data: { workspaceId, role },
      }),
    ])

    return c.json({ id: group.id, workspaceId, role })
  })

  return routes
}
