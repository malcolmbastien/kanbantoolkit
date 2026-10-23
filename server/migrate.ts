/**
 * The server's schema, moved forward the way the browser's is.
 *
 * One rule, the same one `PERSIST_VERSION` keeps: a migration transforms what is there. Nothing is
 * dropped and reseeded, and the number only ever goes up. A file that has run is never run again —
 * the file records itself, so a database migrated by `wrangler d1 migrations apply` and one migrated
 * by the Node runner agree without either trusting the other's bookkeeping.
 *
 * The runner is deliberately small: read what has run, apply what has not, in order, and say which.
 * It is the Node side of the discipline. On Cloudflare the files are applied at deploy, and the code
 * refuses to serve a database that is behind rather than guessing (`requireSchema`).
 */

import type { Database } from './db'

/** One migration file, named for the version it brings. */
export interface Migration {
  version: number
  name: string
  sql: string
}

/** A database that can run a whole file. Only the Node driver can; D1 is migrated by wrangler. */
export type Migratable = Database & { exec(sql: string): void }

const TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`

/** The highest migration this database has run. Zero when it has never been migrated. */
export async function schemaVersion(db: Database): Promise<number> {
  try {
    const row = await db.get<{ version: number | null }>('SELECT MAX(version) AS version FROM schema_migrations')
    return row?.version ?? 0
  } catch {
    // No table yet: this database has not been migrated at all.
    return 0
  }
}

/**
 * Apply what has not been applied. Returns the versions it ran, so a caller can say so honestly
 * rather than printing "migrated" over a no-op.
 */
export async function migrate(db: Migratable, migrations: Migration[]): Promise<{ applied: number[]; version: number }> {
  db.exec(TABLE)

  const done = new Set(
    (await db.all<{ version: number }>('SELECT version FROM schema_migrations')).map((row) => row.version),
  )

  const pending = [...migrations].filter((migration) => !done.has(migration.version)).sort((a, b) => a.version - b.version)
  for (const migration of pending) {
    // One file, one transaction: a migration that fails half way leaves the version where it was,
    // and the next attempt starts the file again rather than from the middle of it.
    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw new Error(`migration ${migration.name} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { applied: pending.map((migration) => migration.version), version: await schemaVersion(db) }
}
