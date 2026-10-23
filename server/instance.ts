/**
 * The instance's posture: who may come in.
 *
 * Closed by default, and the answer is read on every sign-in rather than cached, because the moment
 * it matters is the moment an administrator opens or closes it.
 */

import type { Database } from './db'

export type Access = 'open' | 'closed'

const ROW = 'instance'

/** The posture, or `closed` when the question cannot be answered — the safe failure. */
export async function accessMode(db: Database): Promise<Access> {
  try {
    const row = await db.get<{ access: string }>('SELECT access FROM instance_settings WHERE id = ?1', [ROW])
    return row?.access === 'open' ? 'open' : 'closed'
  } catch {
    // An unmigrated database is not an open one.
    return 'closed'
  }
}

export async function setAccess(db: Database, access: Access): Promise<void> {
  await db.run(
    `INSERT INTO instance_settings (id, access, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (id) DO UPDATE SET access = excluded.access, updated_at = excluded.updated_at`,
    [ROW, access, new Date().toISOString()],
  )
}
