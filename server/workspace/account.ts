/**
 * The workspace's own account: who owns it, what is billed, and the end of it.
 *
 * This is the correction of task 126's first shape. A **workspace** is the tenant: it holds many
 * people's accounts, its boards and its cards, and eventually a bill. An **account** is a person.
 * The owner is the account that is charged — a field, not a role, because a workspace may have
 * several administrators and exactly one payer.
 *
 * Two things follow, and they are the point of this module:
 *
 * - **the bill belongs to the workspace**, not to the deployment, so the record lives on
 *   `workspaces` beside the owner it belongs to;
 * - **deleting a workspace takes that workspace and nothing else** — not another workspace, not the
 *   people's accounts, not the instance. A workspace is isolated, so ending one cannot reach across
 *   the boundary into another.
 *
 * What is never stored: a card number, a CVC, a bank detail. The billing record points at the
 * payment provider's customer; the digits stay with the provider, and a test asserts this table's
 * shape so "just one more column" has to say what it is doing here.
 */

import type { Database } from '../db'
import type { Statement } from '../db'

export interface WorkspaceAccount {
  /** The account that pays for this workspace. Absent when nobody has been made owner yet. */
  ownerId?: string
  ownerName?: string
  name: string
  billing: { email?: string; company?: string; reference?: string; plan?: string }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The workspace's name, owner and billing record. The name lives in `workspace` (settings). */
export async function readWorkspaceAccount(db: Database, workspaceId: string): Promise<WorkspaceAccount> {
  const [settings, owner] = await Promise.all([
    db.get<{ name: string | null }>('SELECT name FROM workspace WHERE id = ?1', [workspaceId]),
    db.get<{
      owner_id: string | null
      billing_email: string | null
      company_name: string | null
      billing_reference: string | null
      plan: string | null
    }>('SELECT owner_id, billing_email, company_name, billing_reference, plan FROM workspaces WHERE id = ?1', [
      workspaceId,
    ]),
  ])

  const ownerName = owner?.owner_id
    ? (await db.get<{ name: string }>('SELECT name FROM users WHERE id = ?1', [owner.owner_id]))?.name
    : undefined

  return {
    ...(owner?.owner_id ? { ownerId: owner.owner_id } : {}),
    ...(ownerName ? { ownerName } : {}),
    // The same fallback the members screen uses, so the two never disagree about what this is called.
    name: settings?.name?.trim() || 'Flowline',
    billing: {
      ...(owner?.billing_email ? { email: owner.billing_email } : {}),
      ...(owner?.company_name ? { company: owner.company_name } : {}),
      ...(owner?.billing_reference ? { reference: owner.billing_reference } : {}),
      ...(owner?.plan ? { plan: owner.plan } : {}),
    },
  }
}

/**
 * A patch, read field by field. Nothing is merged blindly: an unknown key is ignored, and a value it
 * cannot accept is a refusal rather than a silent trim. An empty string clears a field.
 */
export function readAccountPatch(
  input: unknown,
): { ok: true; updates: Record<string, string | null>; ownerId?: string } | { ok: false; reason: string } {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'nothing to change' }
  const body = input as Record<string, unknown>
  const updates: Record<string, string | null> = {}
  let ownerId: string | undefined

  if ('ownerId' in body) {
    if (typeof body.ownerId === 'string' && body.ownerId) ownerId = body.ownerId
    else return { ok: false, reason: 'an owner is required' }
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
  // A reference is an id the provider issued. It is bounded, and never validated as a number.
  if ('reference' in billing) updates.billing_reference = text(billing.reference, 120)
  if ('plan' in billing) updates.plan = text(billing.plan, 40)

  if (!Object.keys(updates).length && !ownerId) return { ok: false, reason: 'nothing to change' }
  return { ok: true, updates, ...(ownerId ? { ownerId } : {}) }
}

/** Write the record, everything with it, in one transaction. */
export async function writeWorkspaceAccount(
  db: Database,
  workspaceId: string,
  patch: { updates: Record<string, string | null>; ownerId?: string },
  audit: Statement[],
): Promise<void> {
  const columns = Object.keys(patch.updates)
  const statements: Statement[] = []

  if (columns.length) {
    statements.push({
      sql: `UPDATE workspaces SET ${columns.map((column, index) => `${column} = ?${index + 1}`).join(', ')} WHERE id = ?${columns.length + 1}`,
      params: [...Object.values(patch.updates), workspaceId],
    })
  }
  if (patch.ownerId) {
    statements.push({ sql: 'UPDATE workspaces SET owner_id = ?1 WHERE id = ?2', params: [patch.ownerId, workspaceId] })
  }

  await db.batch([...statements, ...audit])
}

/**
 * The workspace, and the accounts that belong to it, end together.
 *
 * An account is a person *in this workspace*: it is created for the workspace and deleted with it.
 * So this is not "members lose access" — it is the members themselves going, with their sign-in
 * identities and their sessions. Another workspace and its people are untouched, and the audit entry
 * is written in the same transaction to a table that outlives both, keeping the act and the name of
 * whoever did it (their account is deleted a moment later, so `actor_id` becomes null and the
 * sentence keeps their name in its data).
 */

/**
 * The one refusal: deleting a workspace that holds the deployment's last administrator would leave
 * nobody able to administer it. The same spirit as the last-administrator rule everywhere else.
 */
export async function lastAdministratorRefusal(db: Database, workspaceId: string): Promise<string | undefined> {
  const inside = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM workspace_members w
       JOIN instance_members m ON m.user_id = w.user_id AND m.role = 'admin'
       JOIN users u ON u.id = w.user_id AND u.status = 'active'
      WHERE w.workspace_id = ?1`,
    [workspaceId],
  )
  if (!inside?.n) return undefined

  const all = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM instance_members m JOIN users u ON u.id = m.user_id
      WHERE m.role = 'admin' AND u.status = 'active'`,
  )
  if ((all?.n ?? 0) <= inside.n) {
    return 'this workspace’s people include the last administrator of the deployment. Appoint another one first.'
  }
  return undefined
}
export async function deleteWorkspace(db: Database, workspaceId: string, audit: Statement): Promise<void> {
  await db.batch([
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
    // Membership and grants: the invitations go first, while the members they named are still there
    // to be matched.
    {
      sql: `DELETE FROM invites WHERE scope = 'workspace' AND email IN (
              SELECT u.email FROM users u JOIN workspace_members w ON w.user_id = u.id WHERE w.workspace_id = ?1)`,
      params: [workspaceId],
    },
    { sql: 'DELETE FROM group_workspace_roles WHERE workspace_id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM workspace WHERE id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM workspaces WHERE id = ?1', params: [workspaceId] },
    // Written before the accounts go, so the trail has an actor to null out rather than an id that
    // never existed. The sentence keeps the name in its own data.
    audit,
    // …and now the accounts themselves. Identities, sessions and instance memberships cascade from
    // `users`; what does not is an invitation they sent and a pen they were holding.
    { sql: 'DELETE FROM invites WHERE invited_by IN (SELECT user_id FROM workspace_members WHERE workspace_id = ?1)', params: [workspaceId] },
    { sql: 'DELETE FROM locks WHERE user_id IN (SELECT user_id FROM workspace_members WHERE workspace_id = ?1)', params: [workspaceId] },
    // Their workspace membership cascades from the account, so this is the last statement that has
    // to know who belonged here.
    { sql: 'DELETE FROM users WHERE id IN (SELECT user_id FROM workspace_members WHERE workspace_id = ?1)', params: [workspaceId] },
  ])
}
