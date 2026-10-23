/**
 * The trail access leaves.
 *
 * One row per event, and no workspace in it: an actor, an action, a target, and a small JSON blob
 * the event itself needs. A log that copied card titles would be a second copy of the workspace and
 * a second thing to keep safe — so it names the card by id and stops there.
 *
 * The table refuses updates and deletes in the schema itself. A record that can be edited is not a
 * record, and "we never do that" is a promise rather than a constraint.
 */

import type { Database } from './db'

export interface AccessEvent {
  /** Who did it. Absent for something the system did. */
  actorId?: string
  /** What happened, in a closed vocabulary: `signin`, `signout`, `invite.accepted`, … */
  action: string
  targetType?: string
  targetId?: string
  /** A little context — never the workspace's own words. */
  data?: Record<string, unknown>
  /** The address, hashed the same way the sign-in limiter hashes it. */
  ipHash?: string
}

/** A row is a few hundred bytes; anything larger is not an event's description. */
const MAX_DATA = 2_000

export async function record(db: Database, event: AccessEvent): Promise<void> {
  const data = event.data ? JSON.stringify(event.data).slice(0, MAX_DATA) : null
  await db.run(
    'INSERT INTO audit_events (actor_id, action, target_type, target_id, data, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    [event.actorId ?? null, event.action, event.targetType ?? null, event.targetId ?? null, data, event.ipHash ?? null],
  )
}
