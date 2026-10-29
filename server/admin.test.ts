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
  // The instance is closed: a second person arrives because their domain is admitted.
  await db.run('UPDATE instance_settings SET allowed_domains = ?1', [JSON.stringify(['example.com'])])
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

describe('the directory', () => {
  it('searches, filters and pages by name', async () => {
    const { request, dev, adminCookie, db } = await world()
    await dev('linus@example.com')
    // The role filter reads a membership, and arrival is an account rather than a seat (task 162):
    // these two were invited as viewers, which is what the filter is looking for.
    await db.run(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       SELECT 'workspace', id, 'viewer' FROM users WHERE email IN ('grace@example.com', 'linus@example.com')`,
    )

    const list = async (query: string) =>
      (await (await request(`/api/admin/users${query}`, { headers: { cookie: adminCookie } })).json()) as {
        people: Array<{ name: string; role: string; status: string; email: string }>
        cursor: string | null
      }

    expect((await list('')).people.map((person) => person.name)).toEqual(['Ada', 'Grace', 'Linus'])
    expect((await list('?q=lin')).people.map((person) => person.name)).toEqual(['Linus'])
    // Both of them arrived through an open door, which admits a viewer and never an administrator.
    expect((await list('?role=viewer')).people.map((person) => person.name)).toEqual(['Grace', 'Linus'])
    expect((await list('?role=editor')).people).toEqual([])

    const first = await list('?limit=2')
    expect(first.people).toHaveLength(2)
    expect(first.cursor).toBeTruthy()

    const second = await list(`?limit=2&after=${encodeURIComponent(first.cursor!)}`)
    expect(second.people.map((person) => person.name)).toEqual(['Linus'])
    expect(second.cursor).toBeNull()
  })

  it('changes a role, and records it', async () => {
    const { db, request, adminCookie, id } = await world()
    const grace = await id('grace@example.com')

    const changed = await request(`/api/admin/users/${grace}/role`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ role: 'editor' }),
    })
    expect(changed.status).toBe(200)

    expect(
      (await db.get<{ role: string }>("SELECT role FROM workspace_members WHERE user_id = ?1", [grace]))?.role,
    ).toBe('editor')
    expect(await db.get("SELECT 1 AS seen FROM audit_events WHERE action = 'user.role' AND target_id = ?1", [grace])).toEqual({ seen: 1 })
  })

  it('deletes an account, and leaves the work that names it', async () => {
    const { db, request, adminCookie, id } = await world()
    const grace = await id('grace@example.com')

    expect((await request(`/api/admin/users/${grace}`, { method: 'DELETE', headers: { cookie: adminCookie } })).status).toBe(204)
    expect(await db.get('SELECT 1 FROM users WHERE id = ?1', [grace])).toBeUndefined()
    // The record of the deletion survives the row it is about.
    expect(await db.get("SELECT 1 AS seen FROM audit_events WHERE action = 'user.delete' AND target_id = ?1", [grace])).toEqual({ seen: 1 })
  })

  it('refuses to delete the person doing it, and to demote the last administrator', async () => {
    const { request, adminCookie, id } = await world()
    const ada = await id('ada@example.com')

    const self = await request(`/api/admin/users/${ada}`, { method: 'DELETE', headers: { cookie: adminCookie } })
    expect(self.status).toBe(409)
    expect(((await self.json()) as { error: string }).error).toContain('yourself')

    const demote = await request(`/api/admin/users/${ada}/role`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ role: 'viewer' }),
    })
    expect(demote.status).toBe(409)
    expect(((await demote.json()) as { error: string }).error).toContain('last administrator')
  })
})

describe('the drawer', () => {
  it('describes somebody: their sessions, what they were sent, and what happened to them', async () => {
    const { request, adminCookie, id } = await world()
    const grace = await id('grace@example.com')

    await request('/api/admin/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ email: 'grace@example.com', role: 'editor' }),
    })

    const detail = (await (await request(`/api/admin/users/${grace}`, { headers: { cookie: adminCookie } })).json()) as {
      person: { name: string; role: string }
      sessions: { live: number }
      invite?: { role: string }
      audit: Array<{ action: string }>
    }

    expect(detail.person.name).toBe('Grace')
    expect(detail.sessions.live).toBe(1)
    expect(detail.invite?.role).toBe('editor')
    expect(detail.audit.map((entry) => entry.action)).toContain('signin')
  })

  it('edits a name and an address without putting either in the trail', async () => {
    const { db, request, adminCookie, id } = await world()
    const grace = await id('grace@example.com')

    const changed = await request(`/api/admin/users/${grace}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: 'Grace Hopper', email: 'grace.hopper@example.com' }),
    })
    expect(changed.status).toBe(200)

    expect(await db.get('SELECT name, email FROM users WHERE id = ?1', [grace])).toEqual({
      name: 'Grace Hopper',
      email: 'grace.hopper@example.com',
    })

    const event = await db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'user.edit' AND target_id = ?1", [grace])
    expect(event?.data).toContain('email')
    // Field names, never values: a trail carrying addresses is a second directory.
    expect(event?.data).not.toContain('grace.hopper@example.com')
  })

  it('signs somebody out everywhere', async () => {
    const { db, request, adminCookie, id } = await world()
    const grace = await id('grace@example.com')

    const revoked = await request(`/api/admin/users/${grace}/sessions/revoke`, { method: 'POST', headers: { cookie: adminCookie } })
    expect(revoked.status).toBe(200)

    const live = await db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?1 AND revoked_at IS NULL',
      [grace],
    )
    expect(live?.n).toBe(0)
    expect(await db.get("SELECT 1 AS seen FROM audit_events WHERE action = 'session.revoke'")).toEqual({ seen: 1 })
  })

  it('erases the person and keeps the account the work points at', async () => {
    const { db, request, adminCookie, id } = await world()
    const grace = await id('grace@example.com')

    expect((await request(`/api/admin/users/${grace}/erase`, { method: 'POST', headers: { cookie: adminCookie } })).status).toBe(204)

    // The row is still there — a card that names this person still resolves — with nobody in it.
    const row = await db.get<{ name: string; email: string; status: string }>('SELECT name, email, status FROM users WHERE id = ?1', [grace])
    expect(row?.name).toBe('Erased person')
    expect(row?.email).toContain('@invalid')
    expect(row?.status).toBe('inactive')
    expect(await db.all('SELECT 1 FROM identities WHERE user_id = ?1', [grace])).toEqual([])
  })
})
