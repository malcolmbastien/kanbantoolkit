/**
 * The API, tested where it now lives — on the portable handler, against a real SQLite database
 * built from the real migrations.
 *
 * The endpoint existed before this task in `worker/index.ts`, reaching for D1 directly, and only its
 * parser was tested. Moving it onto the seam is the moment to give the endpoint itself a test, and
 * to run it the way a self-hosted instance would: same SQL, same schema, no Workers runtime.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Database } from './db'
import { fromSqlite } from './sqlite'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

/** A real database, made from the real migrations: the schema is part of what is being tested. */
function database(): Database {
  const db = new DatabaseSync(':memory:')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

function app(db: Database = database()) {
  return createApp({
    database: () => db,
    clientIp: () => '203.0.113.7',
    salt: () => 'test',
  })
}

/** An instance whose database has not been configured — the deployment `wrangler.jsonc` ships. */
function unconfigured() {
  return createApp({
    database: () => undefined,
    clientIp: () => '203.0.113.7',
    salt: () => 'test',
  })
}

const report = {
  message: 'Cannot read properties of undefined',
  stack: 'TypeError: ...\n    at dropCardAt (index.js:1:1)',
  url: '/?board=b-atlas&item=init-signup&q=acme',
  view: 'board',
  release: 'd2861aa',
  ua: 'Mozilla/5.0',
}

const post = (handler: ReturnType<typeof createApp>, body: string) =>
  handler.request('/api/errors', { method: 'POST', body })

const json = (body: unknown) => post(app(), JSON.stringify(body))

describe('the error endpoint, on the portable handler', () => {
  it('accepts a report, stores it, and keeps only the path', async () => {
    const db = database()
    const response = await post(app(db), JSON.stringify(report))

    expect(response.status).toBe(204)
    const rows = await db.all<{ message: string; url: string; ip_hash: string }>(
      'SELECT message, url, ip_hash FROM errors',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].message).toBe('Cannot read properties of undefined')
    // Board ids, item ids and search terms live in the query, and none of them travel.
    expect(rows[0].url).toBe('/')
    // The address is stored as a salted hash, never as itself.
    expect(rows[0].ip_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[0].ip_hash).not.toContain('203.0.113.7')
  })

  it('refuses what is not a report', async () => {
    expect((await json({})).status).toBe(400)
    expect((await json({ message: '   ' })).status).toBe(400)
    expect((await json([report])).status).toBe(400)
    expect((await post(app(), 'not json')).status).toBe(400)
  })

  it('refuses a body that is not a report at all', async () => {
    const response = await post(app(), 'x'.repeat(9 * 1024))
    expect(response.status).toBe(413)
  })

  it('stops listening after thirty reports an hour from one address', async () => {
    const handler = app()
    for (let i = 0; i < 30; i++) {
      expect((await post(handler, JSON.stringify(report))).status).toBe(204)
    }
    expect((await post(handler, JSON.stringify(report))).status).toBe(429)
  })

  it('says it is not configured rather than failing like a broken app', async () => {
    const response = await post(unconfigured(), JSON.stringify(report))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'not configured' })

    const health = await unconfigured().request('/api/health')
    expect(health.status).toBe(503)
    expect(await health.json()).toEqual({ ok: false, database: 'not configured' })
  })

  it('answers a method it does not have, and a path it does not know', async () => {
    expect((await app().request('/api/errors')).status).toBe(405)
    expect((await app().request('/api/nothing')).status).toBe(404)
  })

  it('reports health by asking the database', async () => {
    const response = await app().request('/api/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, database: 'ok' })
  })
})
