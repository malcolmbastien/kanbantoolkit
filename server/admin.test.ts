/**
 * Closing and opening a person's door, through the API.
 *
 * The judgement itself is tested in `src/domain/roster.test.ts`; this is about the change being one
 * batch — status, sessions and the record of it — and about the refusal arriving before any write.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { userForToken } from './auth/session'
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

/** The cookie a `Set-Cookie` header carries, as a browser would send it back. */
function cookie(response: Response | Promise<Response>): string {
  const header = (response as Response).headers?.get('set-cookie') ?? ''
  return `fl_session=${header.match(/fl_session=([^;]+)/)?.[1] ?? ''}`
}

async function world() {
  const db = database()
  const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
  const request = (path: string, init?: RequestInit) => app.request(path, init, { AUTH_DEV: '1' })

  const dev = (email: string) =>
    request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })

  const admin = await dev('ada@example.com')
  // The instance closes behind the first person; a second arrives because it is open.
  await db.run("UPDATE instance_settings SET access = 'open'")
  const other = await dev('grace@example.com')

  const id = async (email: string) =>
    (await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?1', [email]))!.id

  return { db, request, dev, adminCookie: cookie(admin), otherCookie: cookie(other), id }
}

describe('deactivating and reactivating a person', () => {
  it('ends every live session, and writes one event', async () => {
    const { db, request, dev, adminCookie, otherCookie, id } = await world()
    const grace = await id('grace@example.com')

    // A second session for the same person, as a second device would have.
    const again = cookie(await dev('grace@example.com'))
    const tokens = [otherCookie, again].map((entry) => entry.replace('fl_session=', ''))
    for (const token of tokens) expect(await userForToken(db, token)).toBeTruthy()

    const response = await request(`/api/admin/users/${grace}/deactivate`, { method: 'POST', headers: { cookie: adminCookie } })
    expect(response.status).toBe(204)

    for (const token of tokens) expect(await userForToken(db, token)).toBeUndefined()
    expect(await db.get('SELECT status FROM users WHERE id = ?1', [grace])).toEqual({ status: 'inactive' })
    expect(await db.all('SELECT action FROM audit_events WHERE target_id = ?1', [grace])).toEqual([
      { action: 'user.deactivate' },
    ])
  })

  it('opens it again, for the same account and the same history', async () => {
    const { db, request, adminCookie, otherCookie, id } = await world()
    const grace = await id('grace@example.com')
    await request(`/api/admin/users/${grace}/deactivate`, { method: 'POST', headers: { cookie: adminCookie } })

    const back = await request(`/api/admin/users/${grace}/activate`, { method: 'POST', headers: { cookie: adminCookie } })
    expect(back.status).toBe(204)

    // The old session stays revoked — a reactivation is a new door, not an old key.
    expect(await userForToken(db, otherCookie.replace('fl_session=', ''))).toBeUndefined()
    expect(await db.get('SELECT status FROM users WHERE id = ?1', [grace])).toEqual({ status: 'active' })
    expect((await db.all('SELECT action FROM audit_events WHERE target_id = ?1 ORDER BY id', [grace])).map((row) => row.action)).toEqual([
      'user.deactivate',
      'user.activate',
    ])
  })

  it('refuses to let a person deactivate themselves, before writing anything', async () => {
    const { db, request, adminCookie, id } = await world()
    const ada = await id('ada@example.com')

    const refused = await request(`/api/admin/users/${ada}/deactivate`, { method: 'POST', headers: { cookie: adminCookie } })
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { error: string }).error).toContain('yourself')
    expect(await db.get('SELECT status FROM users WHERE id = ?1', [ada])).toEqual({ status: 'active' })
  })

  it('keeps an invitation unspent for an inactive account', async () => {
    const { db, request, dev, adminCookie, id } = await world()
    const grace = await id('grace@example.com')
    await request(`/api/admin/users/${grace}/deactivate`, { method: 'POST', headers: { cookie: adminCookie } })

    await db.run("INSERT INTO invites (id, email, role, expires_at) VALUES ('inv-2', 'grace@example.com', 'editor', ?1)", [
      new Date(Date.now() + 86_400_000).toISOString(),
    ])

    // R6: the invitation does not quietly let an inactive account back in.
    expect((await dev('grace@example.com')).status).toBe(403)
    expect(await db.get("SELECT accepted_at FROM invites WHERE id = 'inv-2'")).toEqual({ accepted_at: null })
  })
})
