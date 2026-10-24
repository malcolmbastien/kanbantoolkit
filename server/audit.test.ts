/**
 * The trail: what it keeps, what it forgets, and what it refuses to do.
 *
 * Three properties are worth a test each. A record survives the account it names. Retention removes
 * only what has expired. And a refusal is recorded without recording the address that tried.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { pruneAudit, record } from './audit'
import type { Database } from './db'
import { fromSqlite } from './sqlite'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

function database(): Database {
  const db = new DatabaseSync(':memory:')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

describe('the trail', () => {
  it('survives the account it names', async () => {
    const db = database()
    await db.run("INSERT INTO users (id, name, email) VALUES ('u-1', 'Ada', 'ada@example.com')")
    await record(db, { actorId: 'u-1', action: 'user.activate', targetType: 'user', targetId: 'u-1' })

    await db.run("DELETE FROM users WHERE id = 'u-1'")

    // Readable, with nobody's name on it: the event outlives the person.
    expect(await db.get('SELECT action, actor_id FROM audit_events')).toEqual({ action: 'user.activate', actor_id: null })
  })

  it('forgets only what is older than the window', async () => {
    const db = database()
    const now = new Date('2026-10-23T12:00:00Z')
    await db.run("INSERT INTO audit_events (at, action) VALUES ('2026-04-01T00:00:00.000Z', 'signin')")
    await db.run("INSERT INTO audit_events (at, action) VALUES ('2026-10-20T00:00:00.000Z', 'signin')")

    expect(await pruneAudit(db, { now, days: 90 })).toBe(1)
    expect(await db.all('SELECT action FROM audit_events')).toHaveLength(1)
    // And the ninety-day default is the one the document names.
    expect(await pruneAudit(db, { now: new Date('2027-01-20T00:00:00Z') })).toBe(1)
  })

  it('refuses to be edited', async () => {
    const db = database()
    await record(db, { action: 'signin' })
    await expect(db.run("UPDATE audit_events SET action = 'signout'")).rejects.toThrow(/append-only/)
  })

  it('records a refused sign-in without the address that tried', async () => {
    const db = database()
    const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
    const request = (path: string, init?: RequestInit) => app.request(path, init, { AUTH_DEV: '1' })

    const dev = (email: string) =>
      request('/api/auth/dev', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })

    await dev('ada@example.com')
    expect((await dev('uninvited@example.com')).status).toBe(403)

    const refused = await db.get<{ action: string; data: string; ip_hash: string | null }>(
      "SELECT action, data, ip_hash FROM audit_events WHERE action = 'signin.refused'",
    )
    expect(refused?.action).toBe('signin.refused')
    expect(refused?.data).not.toContain('uninvited@example.com')
    // The address is there, hashed, and it is not the address.
    expect(refused?.ip_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('records an import with the import', async () => {
    const db = database()
    const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
    const request = (path: string, init?: RequestInit) => app.request(path, init, { AUTH_DEV: '1' })

    const signed = await request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com' }),
    })
    const cookie = `fl_session=${((signed as Response).headers.get('set-cookie') ?? '').match(/fl_session=([^;]+)/)?.[1]}`

    await request('/api/workspace/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        boards: [{ id: 'b-1', name: 'Atlas', band: 'team', description: '' }],
        items: [],
      }),
    })

    const imported = await db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'workspace.import'")
    expect(imported?.data).toContain('"boards":1')
  })
})
