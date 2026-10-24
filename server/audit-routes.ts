/**
 * Reading the trail, and how the instance is.
 *
 * The trail was written by every access change since 132 and read by nobody but a test; this is its
 * screen. Two authorities, two scopes: an instance administrator reads everything, a workspace
 * administrator reads the events their own workspace's administration produced — and an editor
 * reads neither.
 *
 * Nothing here adds data. It is a read of `audit_events`, `errors`, `users` and the schema version.
 */

import { Hono } from 'hono'
import { requireInstanceAdmin, requireWorkspace } from './access'
import { schemaVersion } from './migrate'
import { REQUIRED_SCHEMA } from './workspace/schema'
import type { Runtime } from './runtime'

interface EventRow {
  id: number
  at: string
  action: string
  actor_id: string | null
  actor_name: string | null
  target_type: string | null
  target_id: string | null
  target_name: string | null
  data: string | null
  ip_hash: string | null
}

const SELECT = `SELECT e.id, e.at, e.action, e.actor_id, a.name AS actor_name, e.target_type, e.target_id,
                       u.name AS target_name, e.data, e.ip_hash
                FROM audit_events e
                LEFT JOIN users a ON a.id = e.actor_id
                LEFT JOIN users u ON u.id = e.target_id AND e.target_type = 'user'`

export function auditRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  /**
   * The trail, newest first, paged by (at, id).
   *
   * A workspace administrator's scope is the prefix their own routes write — the events about this
   * workspace. Everything else belongs to whoever runs the instance.
   */
  routes.get('/audit', async (c) => {
    const caller = await requireWorkspace(c, runtime, 'workspace.members')
    if (caller instanceof Response) return caller

    const instanceAdmin = caller.instanceRole === 'admin'
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 200)
    const params: unknown[] = []
    const where: string[] = []

    if (!instanceAdmin) {
      where.push("e.action LIKE 'workspace.%'")
    }
    for (const [key, column] of [
      ['actor', 'e.actor_id'],
      ['action', 'e.action'],
      ['targetType', 'e.target_type'],
      ['targetId', 'e.target_id'],
    ] as const) {
      const value = (c.req.query(key) ?? '').trim().slice(0, 120)
      if (!value) continue
      where.push(
        key === 'action' ? `${column} LIKE ?${params.length + 1}` : `${column} = ?${params.length + 1}`,
      )
      params.push(key === 'action' ? `${value}%` : value)
    }
    for (const [key, comparison] of [
      ['from', '>='],
      ['to', '<='],
    ] as const) {
      const value = (c.req.query(key) ?? '').trim()
      if (!value) continue
      where.push(`e.at ${comparison} ?${params.length + 1}`)
      params.push(value)
    }
    const after = c.req.query('after') ?? ''
    if (after) {
      const [at, id] = [after.slice(0, after.indexOf('|')), after.slice(after.indexOf('|') + 1)]
      where.push(`(e.at, e.id) < (?${params.length + 1}, ?${params.length + 2})`)
      params.push(at, Number(id) || 0)
    }

    const rows = await caller.db.all<EventRow>(
      `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.at DESC, e.id DESC LIMIT ?${params.length + 1}`,
      [...params, limit + 1],
    )

    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    return c.json({
      events: page.map((row) => ({
        id: row.id,
        at: row.at,
        action: row.action,
        actorName: row.actor_name ?? undefined,
        targetType: row.target_type ?? undefined,
        targetId: row.target_id ?? undefined,
        targetName: row.target_name ?? undefined,
        data: row.data ? (JSON.parse(row.data) as Record<string, unknown>) : undefined,
      })),
      // The raw action, for the detail, and the address hash — never an address.
      cursor: rows.length > limit && last ? `${last.at}|${last.id}` : null,
      scope: instanceAdmin ? 'instance' : 'workspace',
    })
  })

  /** The trail's own details: one event, with its data and the hash the limiter counted. */
  routes.get('/audit/:id', async (c) => {
    const caller = await requireWorkspace(c, runtime, 'workspace.members')
    if (caller instanceof Response) return caller

    const row = await caller.db.get<EventRow>(`${SELECT} WHERE e.id = ?1`, [Number(c.req.param('id')) || 0])
    if (!row) return c.json({ error: 'no such event' }, 404)
    if (caller.instanceRole !== 'admin' && !row.action.startsWith('workspace.')) {
      return c.json({ error: 'no such event' }, 404)
    }

    return c.json({
      id: row.id,
      at: row.at,
      action: row.action,
      actorName: row.actor_name ?? undefined,
      targetType: row.target_type ?? undefined,
      targetId: row.target_id ?? undefined,
      targetName: row.target_name ?? undefined,
      data: row.data ? (JSON.parse(row.data) as Record<string, unknown>) : undefined,
      ipHash: row.ip_hash ?? undefined,
    })
  })

  /** How the instance is: the schema, the directory's counts, and whether the database answers. */
  routes.get('/health', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const version = await schemaVersion(caller.db)
    const counts = await caller.db.get<{ accounts: number; inactive: number; admins: number; members: number }>(
      `SELECT
         (SELECT COUNT(*) FROM users) AS accounts,
         (SELECT COUNT(*) FROM users WHERE status = 'inactive') AS inactive,
         (SELECT COUNT(*) FROM instance_members WHERE role = 'admin') AS admins,
         (SELECT COUNT(*) FROM workspace_members) AS members`,
    )
    const errors = await caller.db.get<{ total: number; newest: string | null }>(
      'SELECT COUNT(*) AS total, MAX(at) AS newest FROM errors',
    )

    return c.json({
      schema: version,
      expected: REQUIRED_SCHEMA,
      database: version >= REQUIRED_SCHEMA ? 'ok' : 'behind',
      counts: {
        accounts: counts?.accounts ?? 0,
        inactive: counts?.inactive ?? 0,
        admins: counts?.admins ?? 0,
        members: counts?.members ?? 0,
      },
      errors: { total: errors?.total ?? 0, newest: errors?.newest ?? undefined },
    })
  })

  /** The inbox task 107 promised: what failed, where, and in which build. */
  routes.get('/errors', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 200)
    const rows = await caller.db.all<{
      id: number
      at: string
      message: string
      url: string
      view: string
      release: string
      ua: string
    }>('SELECT id, at, message, url, view, release, ua FROM errors ORDER BY at DESC, id DESC LIMIT ?1', [limit])

    return c.json({ errors: rows })
  })

  routes.get('/errors/:id', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const row = await caller.db.get<{
      id: number
      at: string
      message: string
      stack: string
      url: string
      view: string
      release: string
      ua: string
    }>('SELECT id, at, message, stack, url, view, release, ua FROM errors WHERE id = ?1', [Number(c.req.param('id')) || 0])

    if (!row) return c.json({ error: 'no such report' }, 404)
    // No query and no address: neither was ever stored, which is why they cannot leak from here.
    return c.json(row)
  })

  return routes
}
