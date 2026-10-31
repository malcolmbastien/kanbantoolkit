/**
 * How long the change feed is kept.
 *
 * The feed is the cursor a second device reads from, so retention has to outlast any absence a
 * person could reasonably have — a laptop closed for a fortnight, a phone in a drawer for a month.
 * Thirty days is the default; `CHANGE_RETENTION_DAYS` makes it an operator's decision, in the same
 * style as `API_RATE_LIMIT`.
 *
 * A pruned cursor is not answered with silence. `GET /changes` reports `expired` when the client's
 * cursor is older than the oldest row this workspace still has, and the client reloads the
 * workspace rather than missing changes quietly.
 */

import type { Database } from '../db'

/** Long enough for a reasonable absence; short enough that the feed is not a second history. */
export const CHANGE_RETENTION_DAYS = 30

export function changeRetentionDays(env: unknown): number {
  const raw = (env as Record<string, unknown> | undefined)?.CHANGE_RETENTION_DAYS
  const value = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : CHANGE_RETENTION_DAYS
}

/** Remove feed rows older than the window. Returns how many went. */
export async function pruneChanges(db: Database, options: { now?: Date; days?: number } = {}): Promise<number> {
  const now = options.now ?? new Date()
  const cutoff = new Date(now.getTime() - (options.days ?? CHANGE_RETENTION_DAYS) * 86_400_000).toISOString()
  const result = await db.run('DELETE FROM changes WHERE at < ?1', [cutoff])
  return result.changes
}
