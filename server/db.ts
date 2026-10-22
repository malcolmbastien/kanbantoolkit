/**
 * The database, as the application sees it.
 *
 * D1 is SQLite, so the schema and the statements are SQLite and none of this is vendor-shaped.
 * Two implementations exist — one over D1 in `worker/d1.ts`, one over a file in
 * `server/index.node.ts` — and neither leaks: a route asks for rows and gets them, whichever
 * machine is answering.
 *
 * The interface is deliberately the four calls the application actually makes. It is not an ORM:
 * types are declared where a statement is written, which is affordable at this size and would not
 * be at ten times it. See `docs/server-runtime.md`.
 */

export interface Statement {
  sql: string
  params?: unknown[]
}

export interface Database {
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>
  /** Several statements as one unit, so a migration or a write applies whole or not at all. */
  batch(statements: Statement[]): Promise<void>
}
