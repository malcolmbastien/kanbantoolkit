/**
 * The lease on a card's content.
 *
 * One person holds a card's pen; anyone may read it and arrange it. The lock is the *UX* that makes
 * a conflict rare — the revision is what makes a lost update impossible — so it is deliberately
 * short-lived: 60 seconds, renewed while somebody is actually there, taken over automatically when
 * it lapses instead of leaving a card stranded behind a closed laptop.
 *
 * Acquisition is one conditional write. Two clients asking at the same moment are answered by the
 * database, not by whichever request arrived second.
 */

import type { Database } from '../db'

/** Long enough to survive a slow heartbeat, short enough that a vanished holder costs nothing. */
export const LEASE_MS = 60_000

export interface Lock {
  itemId: string
  userId: string
  sessionId: string
  holderName: string
  acquiredAt: string
  expiresAt: string
}

export interface Holder {
  userId: string
  sessionId: string
  name: string
}

interface Row {
  item_id: string
  user_id: string
  session_id: string
  holder_name: string
  acquired_at: string
  expires_at: string
}

const toLock = (row: Row): Lock => ({
  itemId: row.item_id,
  userId: row.user_id,
  sessionId: row.session_id,
  holderName: row.holder_name,
  acquiredAt: row.acquired_at,
  expiresAt: row.expires_at,
})

export async function lockOf(db: Database, itemId: string): Promise<Lock | undefined> {
  const row = await db.get<Row>('SELECT * FROM locks WHERE item_id = ?1', [itemId])
  return row ? toLock(row) : undefined
}

/** Every lease that has not lapsed — what a client draws as "somebody has this". */
export async function heldLocks(db: Database, now = new Date()): Promise<Lock[]> {
  const rows = await db.all<Row>('SELECT * FROM locks WHERE expires_at > ?1 ORDER BY item_id', [now.toISOString()])
  return rows.map(toLock)
}

/**
 * Take the card, or find out who has it.
 *
 * The `WHERE` on the upsert is the whole arbitration: it rewrites a row only when that row has
 * expired, or when it is already this session's. Anything else leaves the row alone, and the caller
 * reads back who holds it.
 */
export async function acquire(db: Database, itemId: string, holder: Holder, now = new Date()): Promise<Lock> {
  const stamp = now.toISOString()
  const expires = new Date(now.getTime() + LEASE_MS).toISOString()

  await db.run(
    `INSERT INTO locks (item_id, user_id, session_id, holder_name, acquired_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(item_id) DO UPDATE SET
       user_id = excluded.user_id,
       session_id = excluded.session_id,
       holder_name = excluded.holder_name,
       acquired_at = excluded.acquired_at,
       expires_at = excluded.expires_at
     WHERE locks.expires_at <= ?5 OR (locks.user_id = ?2 AND locks.session_id = ?3)`,
    [itemId, holder.userId, holder.sessionId, holder.name, stamp, expires],
  )

  const lock = await lockOf(db, itemId)
  if (!lock) throw new Error('the lease was written and could not be read back')
  return lock
}

/** Extend a lease this session already holds. Renewal never creates one. */
export async function renew(db: Database, itemId: string, sessionId: string, now = new Date()): Promise<Lock | undefined> {
  const expires = new Date(now.getTime() + LEASE_MS).toISOString()
  const result = await db.run('UPDATE locks SET expires_at = ?1 WHERE item_id = ?2 AND session_id = ?3', [
    expires,
    itemId,
    sessionId,
  ])
  return result.changes ? lockOf(db, itemId) : undefined
}

/** Let go. Idempotent: releasing a lease that is already gone is not a failure. */
export async function release(db: Database, itemId: string, sessionId: string): Promise<void> {
  await db.run('DELETE FROM locks WHERE item_id = ?1 AND session_id = ?2', [itemId, sessionId])
}

/**
 * Who holds this card, if anyone and if it is not this session.
 *
 * The one question the write path asks: a change from somebody who is not the holder is refused
 * with 423, which is a different sentence from a stale revision's 409.
 */
export async function heldByOther(
  db: Database,
  itemId: string,
  sessionId: string,
  now = new Date(),
): Promise<Lock | undefined> {
  const lock = await lockOf(db, itemId)
  if (!lock) return undefined
  if (lock.expiresAt <= now.toISOString()) return undefined
  return lock.sessionId === sessionId ? undefined : lock
}
