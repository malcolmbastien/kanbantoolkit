/**
 * The end of a workspace, and the end of an account.
 *
 * A **workspace** is the tenant: it holds many people's accounts, its boards and its cards. An
 * **account** is a person in it — created for the workspace and deleted with it. So this module is
 * the two acts that end something:
 *
 * - **deleting a workspace** takes that workspace and nothing else. Not another workspace, not the
 *   instance. A workspace is isolated, so ending one cannot reach across the boundary into the next.
 * - **removing an account** deletes the person, their sign-in identities and their sessions, while
 *   their words stay in the history under a name the log keeps.
 *
 * There was a third thing here until task 166: the workspace's *bill* — an owner who would be
 * charged, a billing address, a plan. Nothing is sold, so `migrations/0021_no_bill.sql` dropped those
 * columns and this file lost the code that read them. The administrator a workspace has is a role in
 * `workspace_members`, which is the only place authority was ever recorded.
 */

import { DEFAULT_WORKSPACE_NAME } from '../config'
import type { Database } from '../db'
import type { Statement } from '../db'

/** What this workspace is called — the name a person types to end it. */
export async function workspaceNameOf(db: Database, workspaceId: string): Promise<string> {
  const row = await db.get<{ name: string | null }>('SELECT name FROM workspace WHERE id = ?1', [workspaceId])
  // The same fallback the members screen uses, so the two never disagree about what this is called.
  return row?.name?.trim() || DEFAULT_WORKSPACE_NAME
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
 * The rows that end an account, deleted after the trail is written and before the cascade from
 * `users` does the rest: an invitation they sent, a pen they were holding, their name in the
 * workspace's roster.
 *
 * `where` selects the accounts by a subquery on `users`, so the same statements serve "everybody in
 * this workspace" (a deletion) and "this one person" (a removal) without drifting apart.
 */
export function accountRemovalStatements(where: string, params: unknown[]): Statement[] {
  return [
    { sql: `DELETE FROM invites WHERE invited_by IN (SELECT id FROM users WHERE ${where})`, params },
    { sql: `DELETE FROM locks WHERE user_id IN (SELECT id FROM users WHERE ${where})`, params },
    // scoped by its account: the roster row is the person's name in whichever workspace they were in.
    { sql: `DELETE FROM people WHERE id IN (SELECT id FROM users WHERE ${where})`, params },
    // Identities, sessions, instance memberships, workspace memberships and group memberships
    // cascade from here; `audit_events.actor_id` is nulled rather than removed.
    { sql: `DELETE FROM users WHERE ${where}`, params },
  ]
}

/** Whether this person is the deployment's last active administrator. */
export async function isLastDeploymentAdministrator(db: Database, userId: string): Promise<boolean> {
  const target = await db.get<{ role: string; status: string }>(
    `SELECT m.role, u.status FROM instance_members m JOIN users u ON u.id = m.user_id WHERE m.user_id = ?1`,
    [userId],
  )
  if (target?.role !== 'admin' || target.status !== 'active') return false
  const admins = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM instance_members m JOIN users u ON u.id = m.user_id
      WHERE m.role = 'admin' AND u.status = 'active'`,
  )
  return (admins?.n ?? 0) <= 1
}

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
/**
 * A member of a workspace is one of its people.
 *
 * The workspace's roster (`people`) is what a card's assignee, a change's author and "my work" point
 * at, while the *account* lives in `users`. On an instance imported from a file the two arrive
 * together; on a fresh instance the account is made by signing in, and nothing had written the
 * person it is. This is that write: idempotent, by id, on every workspace call — so a member is on
 * the roster from the first thing they read, and an invitation that adds somebody needs no second
 * step to make them a person here.
 */
export async function ensurePersonRow(
  db: Database,
  workspaceId: string,
  user: { id: string; name: string; avatarUrl?: string },
): Promise<void> {
  await db.run(
    `INSERT INTO people (id, workspace_id, name, avatar_url) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name`,
    [user.id, workspaceId, user.name, user.avatarUrl ?? null],
  )
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
    { sql: 'DELETE FROM workspace_structure WHERE workspace_id = ?1', params: [workspaceId] },
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
    // …and now the accounts themselves, by the same statements a single removal uses. The roster
    // was already cleared with the workspace's rows above; the account-scoped deletes are harmless
    // a second time and keep this path and a single removal identical.
    ...accountRemovalStatements('id IN (SELECT user_id FROM workspace_members WHERE workspace_id = ?1)', [workspaceId]),
  ])
}
