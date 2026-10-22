/**
 * D1, seen through the interface the rest of the application uses.
 *
 * This file is the only place a D1 type appears, because this is the only place that knows it is
 * talking to Cloudflare. Everything it returns is plain rows and a count.
 */

import type { Database, Statement } from '../server/db'

export function d1(db: D1Database): Database {
  const statement = (sql: string, params: unknown[] = []) => db.prepare(sql).bind(...params)

  return {
    async all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const { results } = await statement(sql, params).all<T>()
      return results
    },
    async get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined> {
      return (await statement(sql, params).first<T>()) ?? undefined
    },
    async run(sql: string, params?: unknown[]): Promise<{ changes: number }> {
      const { meta } = await statement(sql, params).run()
      return { changes: meta.changes ?? 0 }
    },
    async batch(statements: Statement[]): Promise<void> {
      // One round trip, as one unit — the same promise the file implementation keeps with a
      // transaction.
      await db.batch(statements.map((s) => db.prepare(s.sql).bind(...(s.params ?? []))))
    },
  }
}
