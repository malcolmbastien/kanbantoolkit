/**
 * The error log's retention.
 *
 * The report endpoint caps how fast one address may write; it cannot cap how many addresses or how
 * long the table lives. This is the second half of that rule: the same 90-day window as the audit
 * trail, and one statement that removes what is older.
 */
import type { Database } from './db'

export const ERROR_RETENTION_DAYS = 90

export async function pruneErrors(
  db: Database,
  options: { now?: Date; days?: number } = {},
): Promise<number> {
  const cutoff = new Date(
    (options.now ?? new Date()).getTime() - (options.days ?? ERROR_RETENTION_DAYS) * 86_400_000,
  ).toISOString()
  const result = await db.run('DELETE FROM errors WHERE at < ?1', [cutoff])
  return result.changes
}
