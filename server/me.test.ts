/**
 * The profile a person owns: what they may change, what is ignored, and what is refused.
 *
 * The interesting tests are the negative ones. An endpoint that edits "your" account is exactly the
 * place where a forged field would be worth trying, so the fields that must not move are asserted to
 * not move.
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

async function me() {
  const db = database()
  const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
  const request = (path: string, init?: RequestInit) => app.request(path, init, { AUTH_DEV: '1' })

  const signed = await request('/api/auth/dev', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ada@example.com', name: 'Ada' }),
  })
  const cookie = `fl_session=${((signed as Response).headers.get('set-cookie') ?? '').match(/fl_session=([^;]+)/)?.[1]}`

  const patch = (body: unknown) =>
    request('/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    })

  const read = () => request('/api/me', { headers: { cookie } })

  return { db, request, cookie, patch, read }
}

describe('a profile the person owns', () => {
  it('changes the four things that are theirs', async () => {
    const { patch, read } = await me()
    const avatar = `data:image/png;base64,${'A'.repeat(200)}`

    expect((await patch({ name: 'Ada Lovelace', timezone: 'Europe/London', language: 'en', avatarUrl: avatar })).status).toBe(204)

    expect(await (await read()).json()).toMatchObject({
      name: 'Ada Lovelace',
      timezone: 'Europe/London',
      language: 'en',
      avatarUrl: avatar,
    })
  })

  it('ignores the fields that are somebody else’s decision', async () => {
    const { db, patch, read } = await me()

    await patch({ name: 'Ada', email: 'someone@else.com', instanceRole: 'admin', role: 'admin', status: 'inactive' })

    const body = (await (await read()).json()) as { email: string; instanceRole: string }
    expect(body.email).toBe('ada@example.com')
    expect(body.instanceRole).toBe('admin') // unchanged: it was already the first person
    const row = await db.get("SELECT email, status FROM users WHERE email = 'ada@example.com'")
    expect(row).toEqual({ email: 'ada@example.com', status: 'active' })
  })

  it('refuses a time zone or a language it does not know', async () => {
    const { patch } = await me()
    expect((await patch({ timezone: 'Mars/Olympus' })).status).toBe(400)
    expect((await patch({ language: 'english' })).status).toBe(400)
  })

  it('refuses a picture that is too large, or not a picture', async () => {
    const { patch } = await me()

    const huge = `data:image/png;base64,${'A'.repeat(400 * 1024)}`
    expect((await patch({ avatarUrl: huge })).status).toBe(422)
    expect((await patch({ avatarUrl: 'data:text/html;base64,AAAA' })).status).toBe(422)
    expect((await patch({ avatarUrl: 'data:image/png;base64,not base64 at all!!' })).status).toBe(422)
  })

  it('lists the ways in, and keeps the last one', async () => {
    const { db, request, cookie } = await me()
    await db.run("INSERT INTO identities (provider, subject, user_id, email) VALUES ('oidc', 'g-1', (SELECT id FROM users WHERE email = 'ada@example.com'), 'ada@example.com')")

    const list = (await (await request('/api/me/identities', { headers: { cookie } })).json()) as {
      identities: Array<{ provider: string; subject: string }>
    }
    expect(list.identities.map((identity) => identity.provider).sort()).toEqual(['dev', 'oidc'])

    expect(
      (await request('/api/me/identities/oidc/g-1', { method: 'DELETE', headers: { cookie } })).status,
    ).toBe(204)

    // The last door cannot be removed: an account nobody can enter is a person locked out by a click.
    const last = list.identities.find((identity) => identity.provider === 'dev')!
    expect(
      (await request(`/api/me/identities/dev/${last.subject}`, { method: 'DELETE', headers: { cookie } })).status,
    ).toBe(409)
  })

  it('answers nobody without a session', async () => {
    const { request } = await me()
    expect((await request('/api/me')).status).toBe(401)
  })
})
