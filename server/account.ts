/**
 * The account: its name, its billing record, and the two ways to destroy it.
 *
 * An **account** is the deployment — its people, its workspaces, its trail. The Account Admin is the
 * instance administrator under the name the role now earns (task 126); there is no third level,
 * because whoever can administer a deployment is whoever can close it.
 *
 * Two deletions, and they are deliberately different acts:
 *
 * - **a workspace** takes its boards, lanes, items, placements and its own members, and leaves the
 *   account, its people and its trail standing. The audit entry is written in the same transaction
 *   and survives, because after the workspace is gone somebody still has to be able to say it was
 *   deleted, and by whom.
 * - **the account** takes everything: every table this database holds. Nothing writes a row
 *   afterwards, so the entry that would describe it cannot survive it — and the confirmation, the
 *   name typed, is what stands in its place.
 *
 * What is never stored: a card number, a CVC, a bank detail. The billing record points at the
 * payment provider's customer; the digits belong to the provider. `instance_settings` is asserted to
 * have exactly the fields below, so "just one more column" has to say what it is doing there.
 */

import { Hono } from 'hono'
import { requireInstanceAdmin } from './access'
import { statement } from './audit'
import { canAccount } from '../src/domain/roles'
import type { AccountAction } from '../src/domain/roles'
import type { Database } from './db'
import type { Runtime } from './runtime'

/** The one settings row: everything about the instance that is not a person or a workspace. */
const ROW = 'instance'

export interface Billing {
  /** Where an invoice goes. Null until somebody says. */
  email?: string
  company?: string
  /** The payment provider's customer id. A pointer, never a number that could be charged. */
  reference?: string
  plan?: string
}

export interface Account {
  name: string
  billing: Billing
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The account's record, with the fields that were never set left out rather than nulled. */
export async function readAccount(db: Database): Promise<Account> {
  const row = await db.get<{
    name: string | null
    billing_email: string | null
    company_name: string | null
    billing_reference: string | null
    plan: string | null
  }>(
    'SELECT name, billing_email, company_name, billing_reference, plan FROM instance_settings WHERE id = ?1',
    [ROW],
  )
  return {
    name: row?.name?.trim() || 'Flowline',
    billing: {
      ...(row?.billing_email ? { email: row.billing_email } : {}),
      ...(row?.company_name ? { company: row.company_name } : {}),
      ...(row?.billing_reference ? { reference: row.billing_reference } : {}),
      ...(row?.plan ? { plan: row.plan } : {}),
    },
  }
}

/**
 * A patch, read field by field.
 *
 * Nothing is merged blindly: a key this does not know is ignored, and a value it cannot accept is a
 * refusal rather than a silent trim. An empty string clears a field, which is a person saying they
 * would rather not have one.
 */
export function readAccountPatch(input: unknown): { ok: true; updates: Record<string, string | null> } | { ok: false; reason: string } {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'nothing to change' }
  const body = input as Record<string, unknown>
  const updates: Record<string, string | null> = {}

  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return { ok: false, reason: 'the account needs a name' }
    if (name.length > 80) return { ok: false, reason: 'the name is too long' }
    updates.name = name
  }

  const billing = (body.billing ?? {}) as Record<string, unknown>
  if (typeof billing !== 'object') return { ok: false, reason: 'billing must be an object' }

  const text = (value: unknown, limit: number): string | null =>
    typeof value === 'string' ? value.trim().slice(0, limit) || null : null

  if ('email' in billing) {
    const email = typeof billing.email === 'string' ? billing.email.trim() : ''
    if (email && !EMAIL.test(email)) return { ok: false, reason: 'that is not an email address' }
    updates.billing_email = email || null
  }
  if ('company' in billing) updates.company_name = text(billing.company, 120)
  // A reference is an id the provider issued. It is bounded, and it is never validated as a number.
  if ('reference' in billing) updates.billing_reference = text(billing.reference, 120)
  if ('plan' in billing) updates.plan = text(billing.plan, 40)

  if (!Object.keys(updates).length) return { ok: false, reason: 'nothing to change' }
  return { ok: true, updates }
}

/** Write the record and the record of the change in one transaction. */
export async function writeAccount(
  db: Database,
  updates: Record<string, string | null>,
  audit: Array<ReturnType<typeof statement>>,
): Promise<void> {
  const columns = Object.keys(updates)
  await db.batch([
    {
      sql: `UPDATE instance_settings SET ${columns.map((column, index) => `${column} = ?${index + 1}`).join(', ')}, updated_at = ?${columns.length + 1} WHERE id = ?${columns.length + 2}`,
      params: [...Object.values(updates), new Date().toISOString(), ROW],
    },
    ...audit,
  ])
}

/**
 * Every table this database holds, minus the one that records the schema.
 *
 * Read from `sqlite_master` rather than listed by hand: a table added next year is closed with the
 * rest, instead of surviving a "delete everything" that quietly forgot it. `schema_migrations` stays
 * because it describes the shape of the database rather than anybody's data — deleting it would
 * make the next start try to migrate a schema that is already there.
 */
const TABLES_SQL = `SELECT name FROM sqlite_master
                     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'`

export async function accountTables(db: Database): Promise<string[]> {
  return (await db.all<{ name: string }>(TABLES_SQL)).map((row) => row.name)
}

/**
 * Close the account: every row of every table, in one transaction.
 *
 * Foreign keys are *deferred* for the transaction rather than turned off: the deletes arrive in
 * whatever order the catalogue came back in, and a violation still fails the commit rather than
 * being ignored. The answer is given only after the rows are gone and confirmed gone.
 */
export async function closeAccount(db: Database): Promise<void> {
  const tables = await accountTables(db)
  await db.batch([
    { sql: 'PRAGMA defer_foreign_keys = ON' },
    ...tables.map((table) => ({ sql: `DELETE FROM ${table}` })),
  ])

  const left = await remainingRows(db)
  if (left.length) {
    throw new Error(`the account could not be closed: ${left.map((row) => `${row.name} (${row.n})`).join(', ')}`)
  }
}

/** What is still there, per table. Empty after a successful close; used by the answer, and by tests. */
export async function remainingRows(db: Database): Promise<Array<{ name: string; n: number }>> {
  const tables = await accountTables(db)
  const counts = await Promise.all(
    tables.map(async (table) => {
      const row = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)
      return { name: table, n: row?.n ?? 0 }
    }),
  )
  return counts.filter((row) => row.n > 0)
}

/**
 * Delete a workspace: its work, its members and its settings, in one transaction.
 *
 * The account, its people, its groups and its trail survive — this is a decision about one
 * container, not about the deployment. The audit entry is written to `audit_events`, which carries
 * no workspace id, so it is the one row that outlives the thing it describes.
 */
export async function deleteWorkspace(db: Database, workspaceId: string, audit: ReturnType<typeof statement>): Promise<void> {
  const statements = [
    // Children first, through the parent the scope already names.
    { sql: 'DELETE FROM item_checklist WHERE item_id IN (SELECT id FROM items WHERE workspace_id = ?1)', params: [workspaceId] },
    { sql: 'DELETE FROM item_log WHERE item_id IN (SELECT id FROM items WHERE workspace_id = ?1)', params: [workspaceId] },
    { sql: 'DELETE FROM changes WHERE item_id IN (SELECT id FROM items WHERE workspace_id = ?1)', params: [workspaceId] },
    { sql: 'DELETE FROM locks WHERE item_id IN (SELECT id FROM items WHERE workspace_id = ?1)', params: [workspaceId] },
    {
      sql: 'DELETE FROM board_initiative_types WHERE board_id IN (SELECT id FROM boards WHERE workspace_id = ?1)',
      params: [workspaceId],
    },
    { sql: 'DELETE FROM board_tags WHERE board_id IN (SELECT id FROM boards WHERE workspace_id = ?1)', params: [workspaceId] },
    {
      sql: 'DELETE FROM template_lanes WHERE template_id IN (SELECT id FROM board_templates WHERE workspace_id = ?1)',
      params: [workspaceId],
    },
    // The workspace's own rows.
    { sql: 'DELETE FROM placements WHERE workspace_id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM edges WHERE workspace_id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM links WHERE workspace_id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM key_results WHERE workspace_id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM objectives WHERE workspace_id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM items WHERE workspace_id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM lanes WHERE workspace_id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM boards WHERE workspace_id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM board_templates WHERE workspace_id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM people WHERE workspace_id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM issue_types WHERE workspace_id = ?1', params: [workspaceId] },
    // Membership and grants: a workspace nobody can be in has no invitation and no group grant. The
    // invitations go first, while the members they named are still there to be matched.
    {
      sql: `DELETE FROM invites WHERE scope = 'workspace' AND email IN (
              SELECT u.email FROM users u JOIN workspace_members w ON w.user_id = u.id WHERE w.workspace_id = ?1)`,
      params: [workspaceId],
    },
    { sql: 'DELETE FROM workspace_members WHERE workspace_id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM group_workspace_roles WHERE workspace_id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM workspace WHERE id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM workspaces WHERE id = ?1', params: [workspaceId] },
    audit,
  ]
  await db.batch(statements)
}

/** How many workspaces this account has. The deletion of the last one is refused on the way out. */
export async function workspaceCount(db: Database): Promise<number> {
  return (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM workspaces'))?.n ?? 0
}

export function accountRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  /** The guard for this axis, so a route says which account action it is rather than re-deriving it. */
  const guard = (c: Parameters<typeof requireInstanceAdmin>[0], action: AccountAction) =>
    requireInstanceAdmin(c, runtime, action)

  routes.get('/', async (c) => {
    const caller = await guard(c, 'account.rename')
    if (caller instanceof Response) return caller
    return c.json(await readAccount(caller.db))
  })

  /** The name and the billing record. One route, because they are one record. */
  routes.patch('/', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const parsed = readAccountPatch(await c.req.json().catch(() => null))
    if (!parsed.ok) return c.json({ error: parsed.reason }, 400)

    // Saving the form is one act that may be two powers: the name, and the billing record. Each is
    // judged, and each is recorded — a trail that said only "renamed" would hide the invoice address
    // changing in the same click.
    const fields = Object.keys(parsed.updates)
    // Only the powers that leave a trace; `account.delete` has none by design.
    const acts: Array<'account.rename' | 'account.billing'> = []
    if (fields.includes('name')) acts.push('account.rename')
    const billing = fields.filter((field) => field !== 'name')
    if (billing.length) acts.push('account.billing')

    for (const action of acts) {
      if (!canAccount(caller.instanceRole, action)) return c.json({ error: `an account administrator may not ${action}` }, 403)
    }

    await writeAccount(
      caller.db,
      parsed.updates,
      acts.map((action) =>
        statement({
          actorId: caller.user.id,
          action,
          targetType: 'account',
          // Field names only: the billing record is somebody's address, and a trail is not a copy.
          data: { fields: action === 'account.rename' ? ['name'] : billing },
        }),
      ),
    )

    return c.json(await readAccount(caller.db))
  })

  /**
   * Appoint or unappoint an Account Admin.
   *
   * The last one cannot be unappointed — the same judgement the workspace roster uses — because an
   * account nobody can administer is one nobody can repair, and there is no way back in.
   */
  routes.patch('/admins/:id', async (c) => {
    const caller = await guard(c, 'account.admins')
    if (caller instanceof Response) return caller

    const body = (await c.req.json().catch(() => null)) as { role?: unknown } | null
    const role = body?.role
    if (role !== 'admin' && role !== 'member') return c.json({ error: 'role must be admin or member' }, 400)

    const id = c.req.param('id')
    const target = await caller.db.get<{ id: string; status: string }>('SELECT id, status FROM users WHERE id = ?1', [id])
    if (!target) return c.json({ error: 'no such person' }, 404)

    if (role === 'member') {
      const admins = await caller.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM instance_members m JOIN users u ON u.id = m.user_id WHERE m.role = 'admin' AND u.status = 'active'",
      )
      const isAdmin = await caller.db.get<{ role: string }>('SELECT role FROM instance_members WHERE user_id = ?1', [id])
      if (isAdmin?.role === 'admin' && target.status === 'active' && (admins?.n ?? 0) <= 1) {
        return c.json({ error: 'this is the last Account Admin. Appoint another one first.' }, 409)
      }
    }

    await caller.db.batch([
      {
        sql: `INSERT INTO instance_members (user_id, role) VALUES (?1, ?2)
              ON CONFLICT (user_id) DO UPDATE SET role = excluded.role`,
        params: [id, role],
      },
      statement({
        actorId: caller.user.id,
        action: 'account.admins',
        targetType: 'user',
        targetId: id,
        data: { instanceRole: role },
      }),
    ])

    return c.json({ id, role })
  })

  /**
   * Delete a workspace: the account's decision, not the board's.
   *
   * The last workspace is refused, and the refusal names the alternative, because deleting the only
   * one is not a tidier way of closing the account — it is a workspace-less account nobody can use.
   */
  routes.delete('/workspaces/:id', async (c) => {
    const caller = await guard(c, 'workspace.delete')
    if (caller instanceof Response) return caller

    const id = c.req.param('id')
    const exists = await caller.db.get('SELECT 1 AS seen FROM workspaces WHERE id = ?1', [id])
    if (!exists) return c.json({ error: 'no such workspace' }, 404)
    if ((await workspaceCount(caller.db)) <= 1) {
      return c.json({ error: 'this is the account’s only workspace. Close the account instead.' }, 409)
    }

    await deleteWorkspace(
      caller.db,
      id,
      statement({
        actorId: caller.user.id,
        action: 'workspace.delete',
        targetType: 'workspace',
        targetId: id,
        data: { name: (await caller.db.get<{ name: string }>('SELECT name FROM workspaces WHERE id = ?1', [id]))?.name },
      }),
    )

    return c.body(null, 204)
  })

  /**
   * Close the account.
   *
   * The last-account-admin guard deliberately does not apply: that guard exists to keep a deployment
   * administrable, and this is the act of ending it. The confirmation — the name typed — is what
   * stands in for the second person, and it is checked on the server as well as in the interface,
   * because a confirmation only the client enforces is a suggestion.
   */
  routes.delete('/', async (c) => {
    const caller = await guard(c, 'account.delete')
    if (caller instanceof Response) return caller

    const body = (await c.req.json().catch(() => null)) as { confirm?: unknown } | null
    const account = await readAccount(caller.db)
    const typed = typeof body?.confirm === 'string' ? body.confirm.trim() : ''
    if (typed.toLowerCase() !== account.name.toLowerCase()) {
      return c.json({ error: 'type the account’s name to confirm' }, 400)
    }

    try {
      await closeAccount(caller.db)
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'the account could not be closed' }, 500)
    }

    return c.json({ closed: true })
  })

  return routes
}
