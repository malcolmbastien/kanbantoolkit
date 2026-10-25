/**
 * The trail access leaves.
 *
 * One writer, one vocabulary, and a statement builder so the record can share the transaction of the
 * change it describes. An access change that cannot be explained afterwards is not worth committing,
 * so the audit row is not a follow-up call: it goes in the same batch, and a batch that fails takes
 * both with it.
 *
 * No workspace in it. An actor, an action, a target, and a small JSON blob the event itself needs —
 * never a token, a cookie, a password, or a raw address. The address is hashed with the instance's
 * salt, which is the same hash the sign-in limiter counts.
 */

import type { Database, Statement } from './db'

/** The closed vocabulary. A new kind of access change is a new member here, and a decision. */
export type AuditAction =
  | 'signin'
  | 'signin.refused'
  | 'signout'
  | 'invite.create'
  | 'invite.resend'
  | 'invite.revoke'
  | 'invite.accepted'
  | 'user.edit'
  | 'user.role'
  | 'user.instance'
  | 'user.delete'
  | 'user.erase'
  | 'session.revoke'
  | 'identity.unlink'
  | 'user.deactivate'
  | 'user.activate'
  | 'instance.access'
  | 'instance.domains'
  | 'group.create'
  | 'group.edit'
  | 'group.delete'
  | 'group.member'
  | 'group.role'
  | 'workspace.delete'
  // `account.delete` is deliberately absent: closing the account removes this table with the rest,
  // so a trail entry for it would be deleted by the act it describes.
  | 'workspace.import'
  | 'workspace.settings'
  | 'workspace.role'
  | 'workspace.member.remove'
  | 'workspace.invite'

export interface AccessEvent {
  /** Who did it. Absent for something the system did, or for a refusal before anyone is known. */
  actorId?: string
  action: AuditAction
  targetType?: string
  targetId?: string
  /** A little context — never the workspace's own words. */
  data?: Record<string, unknown>
  /** The address, hashed with the instance's salt. */
  ipHash?: string
}

/** A row is a few hundred bytes; anything larger is not an event's description. */
const MAX_DATA = 2_000

/** How long a row is kept. Ninety days: enough to answer "who did that" about last quarter. */
export const RETENTION_DAYS = 90

/** The row as a statement, for a batch that carries the change it describes. */
export function statement(event: AccessEvent): Statement {
  return {
    sql: 'INSERT INTO audit_events (actor_id, action, target_type, target_id, data, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    params: [
      event.actorId ?? null,
      event.action,
      event.targetType ?? null,
      event.targetId ?? null,
      event.data ? JSON.stringify(event.data).slice(0, MAX_DATA) : null,
      event.ipHash ?? null,
    ],
  }
}

/** For a change that is a single statement and nothing else. */
export async function record(db: Database, event: AccessEvent): Promise<void> {
  await db.run(statement(event).sql, statement(event).params)
}

/**
 * Forget what is older than the window.
 *
 * The only deletion the table allows — the update trigger stays, because editing a record is what
 * "append-only" means and deleting an expired one is what retention means. It is not itself audited:
 * a row saying the log was trimmed, which would then also be trimmed, explains nothing to anyone.
 */
export async function pruneAudit(db: Database, options: { now?: Date; days?: number } = {}): Promise<number> {
  const now = options.now ?? new Date()
  const cutoff = new Date(now.getTime() - (options.days ?? RETENTION_DAYS) * 86_400_000).toISOString()
  const result = await db.run('DELETE FROM audit_events WHERE at < ?1', [cutoff])
  return result.changes
}
