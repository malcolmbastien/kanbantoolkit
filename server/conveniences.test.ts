/**
 * Three conveniences: a domain door, a bulk operation judged whole, and the directory as a file.
 *
 * Each is small and each has one thing that must not go wrong. The domain must match exactly, or
 * `notexample.com` walks in on `example.com`'s invitation. The bulk must refuse as a whole, or nobody
 * can tell which half happened. The file must carry no secret, because a spreadsheet gets forwarded.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
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

const cookieOf = (response: Response | Promise<Response>) =>
  `fl_session=${((response as Response).headers.get('set-cookie') ?? '').match(/fl_session=([^;]+)/)?.[1] ?? ''}`

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

  const ada = await dev('ada@example.com')
  const id = async (email: string) =>
    (await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?1', [email]))!.id

  return { db, request, dev, adaCookie: cookieOf(ada), id }
}

describe('an allowed domain', () => {
  it('admits a verified address from it as a viewer, and a lookalike not at all', async () => {
    const { db, request, dev, adaCookie } = await world()

    const changed = await request('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adaCookie },
      body: JSON.stringify({ allowedDomains: ['Example.COM', 'example.com'] }),
    })
    expect(changed.status).toBe(200)
    expect(((await changed.json()) as { allowedDomains: string[] }).allowedDomains).toEqual(['example.com'])

    // The instance is still closed; the domain is a door, not a change of posture.
    expect(await db.get("SELECT access FROM instance_settings WHERE id = 'instance'")).toEqual({ access: 'closed' })

    expect((await dev('grace@example.com')).status).toBe(200)
    // Admitted as an **account**: the domain is a way in, and a workspace is still an invitation or
    // a sign-up (task 162), so the door grants no seat.
    expect(await db.get("SELECT 1 AS seen FROM users WHERE email = 'grace@example.com'")).toEqual({ seen: 1 })
    expect(
      await db.get(
        `SELECT 1 AS seen FROM workspace_members w JOIN users u ON u.id = w.user_id WHERE u.email = 'grace@example.com'`,
      ),
    ).toBeUndefined()

    // Not a suffix, not a substring.
    expect((await dev('mallory@notexample.com')).status).toBe(403)
    expect((await dev('mallory@example.com.evil.test')).status).toBe(403)

    const event = await db.get("SELECT 1 AS seen FROM audit_events WHERE action = 'instance.domains'")
    expect(event).toEqual({ seen: 1 })
  })

  it('refuses a list that is not a list of domains', async () => {
    const { request, adaCookie } = await world()
    const bad = await request('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adaCookie },
      body: JSON.stringify({ allowedDomains: ['https://example.com'] }),
    })
    expect(bad.status).toBe(400)
  })
})

describe('a bulk operation', () => {
  it('refuses the whole selection when one row is protected, and changes nothing', async () => {
    const { db, request, dev, adaCookie, id } = await world()
    await db.run("UPDATE instance_settings SET allowed_domains = '[\"example.com\"]'")
    await dev('grace@example.com')
    const ada = await id('ada@example.com')
    const grace = await id('grace@example.com')

    const refused = await request('/api/admin/users/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adaCookie },
      body: JSON.stringify({ ids: [grace, ada], operation: 'deactivate' }),
    })
    expect(refused.status).toBe(409)
    const refusal = (await refused.json()) as { error: string }
    // Named, so the operator knows which row stopped the selection.
    expect(refusal.error).toContain('Ada')
    expect(refusal.error).toContain('yourself')

    // Not even the row that would have been allowed.
    expect(await db.get('SELECT status FROM users WHERE id = ?1', [grace])).toEqual({ status: 'active' })
  })

  it('changes the whole selection when it can, and says how many', async () => {
    const { db, request, dev, adaCookie, id } = await world()
    await db.run("UPDATE instance_settings SET allowed_domains = '[\"example.com\"]'")
    await dev('grace@example.com')
    await dev('linus@example.com')
    const grace = await id('grace@example.com')
    const linus = await id('linus@example.com')

    const changed = await request('/api/admin/users/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adaCookie },
      body: JSON.stringify({ ids: [grace, linus], operation: 'deactivate' }),
    })
    expect(changed.status).toBe(200)
    expect(await changed.json()).toEqual({ changed: 2 })
    expect(await db.all("SELECT id FROM users WHERE status = 'inactive' ORDER BY id")).toHaveLength(2)

    const promoted = await request('/api/admin/users/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adaCookie },
      body: JSON.stringify({ ids: [grace], operation: 'role', role: 'editor' }),
    })
    expect(await promoted.json()).toEqual({ changed: 1 })
    expect(await db.get('SELECT role FROM workspace_members WHERE user_id = ?1', [grace])).toEqual({ role: 'editor' })
  })
})

describe('the directory as a file', () => {
  it('has the documented columns, quotes what needs it, and carries no secret', async () => {
    const { db, request, dev, adaCookie } = await world()
    await db.run("UPDATE instance_settings SET allowed_domains = '[\"example.com\"]'")
    await dev('grace@example.com')
    // A name with a comma is a name, not a broken file.
    await db.run("UPDATE users SET name = 'Ada, Countess' WHERE email = 'ada@example.com'")

    const response = await request('/api/admin/users.csv', { headers: { cookie: adaCookie } })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('content-disposition')).toMatch(/flowline-people-\d{4}-\d{2}-\d{2}\.csv/)

    const text = await response.text()
    const [header, first] = text.split('\r\n')
    expect(header).toBe('name,email,role,status,last active,joined')
    expect(first).toContain('"Ada, Countess"')
    expect(text).toContain('grace@example.com')

    // Nothing that could authenticate anybody.
    expect(text).not.toMatch(/token|session|ip_hash|hash/i)
  })
})
