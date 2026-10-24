/**
 * Creating a workspace: the one act that makes a tenant exist.
 *
 * A **workspace** is the tenant (task 126, revised) and an **account** is a person. The person who
 * creates a workspace owns it — that is what "every workspace needs an email to be created" means
 * once the account is the email: the owner is the account that asked for it, not a field somebody
 * else can be written into. They are its administrator and its payer from the first moment, and
 * there is no state in which a workspace exists with nobody responsible for it.
 *
 * One workspace per account, for now: a regular user joins the workspace they were invited to, or
 * creates the one they own. Somebody who belongs to one is told so rather than being given a second
 * — two workspaces for one person is a switching model this product has not decided on.
 */

import { Hono } from 'hono'
import { requireUser } from './access'
import { statement } from './audit'
import type { Database } from './db'
import type { Runtime } from './runtime'

/** A workspace's name is a label people read; anything longer is a paragraph in the wrong place. */
const MAX_NAME = 80

export function workspaceCreateRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  /**
   * Create the workspace this account owns.
   *
   * The creator is the owner and the administrator, in one transaction with the workspace's own
   * settings row — no workspace without a settings row, and no owner without a membership.
   */
  routes.post('/', async (c) => {
    const caller = await requireUser(c, runtime)
    if (caller instanceof Response) return caller

    const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : ''
    if (!name) return c.json({ error: 'a name is required' }, 400)

    const existing = await caller.db.get<{ workspace_id: string }>(
      'SELECT workspace_id FROM workspace_members WHERE user_id = ?1 LIMIT 1',
      [caller.user.id],
    )
    // One workspace per account: joining another is an invitation, not a creation.
    if (existing) {
      return c.json({ error: 'your account already has a workspace', workspaceId: existing.workspace_id }, 409)
    }

    const id = `ws-${crypto.randomUUID()}`
    await caller.db.batch([
      {
        sql: 'INSERT INTO workspaces (id, name, owner_id) VALUES (?1, ?2, ?3)',
        params: [id, name, caller.user.id],
      },
      // The creator owns what they made and administers it; the two are separate facts, which is
      // why one is a row here and the other a column above.
      {
        sql: 'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, ?3)',
        params: [id, caller.user.id, 'admin'],
      },
      { sql: 'INSERT INTO workspace (id, name) VALUES (?1, ?2)', params: [id, name] },
      statement({
        actorId: caller.user.id,
        action: 'workspace.create',
        targetType: 'workspace',
        targetId: id,
        data: { name },
      }),
    ])

    return c.json({ id, name, ownerId: caller.user.id }, 201)
  })

  /** Whether this account already has a workspace, so the sign-up surface can say so before asking. */
  routes.get('/mine', async (c) => {
    const caller = await requireUser(c, runtime)
    if (caller instanceof Response) return caller

    const row = await caller.db.get<{ workspace_id: string; name: string | null }>(
      `SELECT w.workspace_id, s.name FROM workspace_members w
         LEFT JOIN workspace s ON s.id = w.workspace_id
        WHERE w.user_id = ?1 ORDER BY w.workspace_id LIMIT 1`,
      [caller.user.id],
    )
    return c.json({ workspace: row ? { id: row.workspace_id, name: row.name ?? 'Workspace' } : null })
  })

  return routes
}

/** Whether the account belongs to any workspace. Used by the first-run decision too. */
export async function belongsToAWorkspace(db: Database, userId: string): Promise<boolean> {
  return Boolean(await db.get('SELECT 1 AS seen FROM workspace_members WHERE user_id = ?1', [userId]))
}
