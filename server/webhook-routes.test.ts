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

const cookie = (response: Response) =>
  `fl_session=${(response.headers.get('set-cookie') ?? '').match(/fl_session=([^;]+)/)?.[1] ?? ''}`

async function world() {
  const db = database()
  const app = createApp({ database: () => db, clientIp: () => '203.0.113.9' })
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, { AUTH_DEV: '1' })

  const signIn = async (email: string) =>
    cookie(
      await request('/api/auth/dev', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    )

  const adminCookie = await signIn('ada@example.com')
  await db.run('UPDATE instance_settings SET allowed_domains = ?1', [JSON.stringify(['example.com'])])
  const editorCookie = await signIn('grace@example.com')
  const grace = (await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?1', ['grace@example.com']))!
  await db.run(
    "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('workspace', ?1, 'editor') ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'editor'",
    [grace.id],
  )

  return { db, request, adminCookie, editorCookie }
}

describe('the admin webhook door', () => {
  it('creates an endpoint, shows its secret once, lists it without one, and deletes it', async () => {
    const { request, adminCookie } = await world()
    const created = await request('/api/admin/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ url: 'https://receiver.example/events', eventTypes: ['item.created'] }),
    })
    expect(created.status).toBe(201)
    const endpoint = (await created.json()) as { id: string; secret: string; eventTypes: string[]; active: boolean }
    expect(endpoint.secret).toMatch(/^[0-9a-f]{64}$/)
    expect(endpoint.eventTypes).toEqual(['item.created'])
    expect(endpoint.active).toBe(true)

    const list = (await (await request('/api/admin/webhooks', { headers: { cookie: adminCookie } })).json()) as {
      endpoints: Array<{ id: string; secret?: string; url: string }>
    }
    expect(list.endpoints).toHaveLength(1)
    expect(list.endpoints[0]).toMatchObject({ id: endpoint.id, url: 'https://receiver.example/events' })
    expect(list.endpoints[0].secret).toBeUndefined()

    const paused = await request(`/api/admin/webhooks/${endpoint.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ active: false }),
    })
    expect(paused.status).toBe(200)
    expect(((await paused.json()) as { active: boolean }).active).toBe(false)

    const test = await request(`/api/admin/webhooks/${endpoint.id}/test`, {
      method: 'POST',
      headers: { cookie: adminCookie },
    })
    expect(test.status).toBe(202)
    const deliveries = (await (
      await request(`/api/admin/webhooks/${endpoint.id}/deliveries`, { headers: { cookie: adminCookie } })
    ).json()) as { deliveries: Array<{ eventType: string; status: string }> }
    expect(deliveries.deliveries[0]).toMatchObject({ eventType: 'webhook.test', status: 'pending' })

    expect((await request(`/api/admin/webhooks/${endpoint.id}`, { method: 'DELETE', headers: { cookie: adminCookie } })).status).toBe(204)
    expect(((await (await request('/api/admin/webhooks', { headers: { cookie: adminCookie } })).json()) as { endpoints: unknown[] }).endpoints).toEqual([])
  })

  it('refuses an editor, and refuses a URL that is not http', async () => {
    const { request, adminCookie, editorCookie } = await world()
    expect((await request('/api/admin/webhooks', { headers: { cookie: editorCookie } })).status).toBe(403)
    const bad = await request('/api/admin/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ url: 'ftp://receiver.example/events' }),
    })
    expect(bad.status).toBe(400)
  })
})
