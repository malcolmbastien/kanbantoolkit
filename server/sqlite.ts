/**
 * SQLite over a file — the self-hosted implementation of `Database`.
 *
 * D1 is SQLite over a binding; this is SQLite over a disk. The four calls are the same because the
 * statements are the same, which is the whole reason the schema is written in plain SQL rather than
 * in one vendor's dialect.
 *
 * Node's own `node:sqlite` is used rather than a native package: it is synchronous, it is there,
 * and it adds no dependency to install or compile on a self-hoster's machine.
 */

import { DatabaseSync } from 'node:sqlite'
import type { Database } from './db'

/** What both SQLite and D1 accept as a bound value. */
type Value = string | number | bigint | null | Uint8Array

const values = (params: unknown[] = []) => params as Value[]

export type SqliteDatabase = Database & { exec(sql: string): void }

export function openSqlite(path: string): SqliteDatabase {
  // A file on a disk is a real database: it should enforce what the schema says.
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  return fromSqlite(db)
}

/**
 * The same interface over a connection the caller already holds — a file, or `:memory:` in a test
 * that wants the real schema without a file to clean up.
 */
export function fromSqlite(db: DatabaseSync): SqliteDatabase {
  return {
    exec(sql: string) {
      db.exec(sql)
    },
    async all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      return db.prepare(sql).all(...values(params)) as T[]
    },
    async get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined> {
      return db.prepare(sql).get(...values(params)) as T | undefined
    },
    async run(sql: string, params?: unknown[]): Promise<{ changes: number }> {
      const result = db.prepare(sql).run(...values(params))
      return { changes: Number(result.changes) }
    },
    async batch(statements) {
      db.exec('BEGIN')
      try {
        for (const statement of statements) db.prepare(statement.sql).run(...values(statement.params))
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}
