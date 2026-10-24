/**
 * Reading the trail: who may, what they see, and what a row says.
 *
 * The two scopes are the interesting part. An instance administrator reads the whole history; a
 * workspace administrator reads the events their own routes wrote — `workspace.*` — and none of the
 * instance's. An editor reads neither.
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

  const dev = (email: string, invite?: string) =>
    request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, ...(invite ? { invite } : {}) }),
    })

  const ada = await dev('ada@example.com')
  const adaCookie = cookieOf(ada)

  const invited = (await (await request('/api/admin/invites', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adaCookie },
    body: JSON.stringify({ email: 'grace@example.com', role: 'editor' }),
  })).json()) as { url: string }
  const grace = await dev('grace@example.com', new URL(invited.url).searchParams.get('invite')!)
  const graceCookie = cookieOf(grace)

  const id = async (email: string) =>
    (await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?1', [email]))!.id

  // A workspace-scoped event, so the two scopes have something to differ about.
  const graceId = await id('grace@example.com')
  await request(`/api/admin/workspace/members/${graceId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: adaCookie },
    body: JSON.stringify({ role: 'admin' }),
  })

  return { db, request, adaCookie, graceCookie, id, graceId }
}

describe('the audit screen', () => {
  it('gives an instance administrator the whole trail, newest first', async () => {
    const { request, adaCookie } = await world()
    const body = (await (await request('/api/admin/audit', { headers: { cookie: adaCookie } })).json()) as {
      events: Array<{ action: string; at: string; actorName?: string; targetName?: string }>
      cursor: string | null
      scope: string
    }

    const actions = body.events.map((event) => event.action)
    expect(body.scope).toBe('instance')
    expect(actions).toContain('signin')
    expect(actions).toContain('invite.create')
    expect(actions).toContain('workspace.role')
    // Newest first.
    expect([...body.events].map((event) => event.at)).toEqual([...body.events].map((event) => event.at).sort().reverse())

    const role = body.events.find((event) => event.action === 'workspace.role')
    expect(role?.actorName).toBe('Ada')
    expect(role?.targetName).toBe('Grace')
  })

  it('gives a workspace administrator only what their workspace did', async () => {
    const { request, graceCookie } = await world()
    const body = (await (await request('/api/admin/audit', { headers: { cookie: graceCookie } })).json()) as {
      events: Array<{ action: string }>
      scope: string
    }

    expect(body.scope).toBe('workspace')
    expect(body.events.every((event) => event.action.startsWith('workspace.'))).toBe(true)
    expect(body.events.map((event) => event.action)).toContain('workspace.role')
  })

  it('narrows by action and by date, and pages', async () => {
    const { request, adaCookie } = await world()

    const filtered = (await (await request('/api/admin/audit?action=signin', { headers: { cookie: adaCookie } })).json()) as {
      events: Array<{ action: string }>
    }
    expect(filtered.events.every((event) => event.action.startsWith('signin'))).toBe(true)

    const future = (await (await request('/api/admin/audit?from=2999-01-01T00:00:00.000Z', { headers: { cookie: adaCookie } })).json()) as {
      events: unknown[]
    }
    expect(future.events).toEqual([])

    const first = (await (await request('/api/admin/audit?limit=2', { headers: { cookie: adaCookie } })).json()) as {
      events: Array<{ id: number }>
      cursor: string | null
    }
    expect(first.events).toHaveLength(2)
    const second = (await (await request(`/api/admin/audit?limit=2&after=${encodeURIComponent(first.cursor!)}`, { headers: { cookie: adaCookie } })).json()) as {
      events: Array<{ id: number }>
    }
    expect(second.events.every((event) => event.id < first.events[1].id)).toBe(true)
  })

  it('shows a workspace administrator none of the instance’s events', async () => {
    const { request, graceCookie } = await world()
    const answer = await request('/api/admin/audit?action=instance.access', { headers: { cookie: graceCookie } })
    expect(((await answer.json()) as { events: unknown[] }).events).toEqual([])
  })

  it('reads one event with its data, and refuses one out of scope', async () => {
    const { db, request, adaCookie, graceCookie } = await world()
    const signin = await db.get<{ id: number }>("SELECT id FROM audit_events WHERE action = 'signin' LIMIT 1")

    const one = await request(`/api/admin/audit/${signin!.id}`, { headers: { cookie: adaCookie } })
    expect(((await one.json()) as { action: string }).action).toBe('signin')
    // A workspace administrator cannot read an instance-level event by guessing its id.
    expect((await request(`/api/admin/audit/${signin!.id}`, { headers: { cookie: graceCookie } })).status).toBe(404)
  })

  it('is a door an editor cannot open', async () => {
    const { request, db, graceCookie } = await world()
    await db.run("UPDATE workspace_members SET role = 'editor' WHERE user_id = (SELECT id FROM users WHERE email = 'grace@example.com')")
    expect((await request('/api/admin/audit', { headers: { cookie: graceCookie } })).status).toBe(403)
  })
})

describe('the health screen', () => {
  it('counts what the directory counts, and says whether the schema is current', async () => {
    const { request, adaCookie } = await world()
    const body = (await (await request('/api/admin/health', { headers: { cookie: adaCookie } })).json()) as {
      schema: number
      expected: number
      database: string
      counts: { accounts: number; admins: number; members: number }
    }

    expect(body.schema).toBe(body.expected)
    expect(body.database).toBe('ok')
    expect(body.counts).toMatchObject({ accounts: 2, admins: 1, members: 2 })
  })

  it('reads the inbox task 107 promised, and opens one without a query or an address', async () => {
    const { db, request, adaCookie } = await world()
    await db.run(
      `INSERT INTO errors (message, stack, url, view, release, ua, ip_hash) VALUES
       ('Cannot read properties of undefined', 'TypeError: ...', '/', 'board', 'abc1234', 'Mozilla/5.0', 'hash')`,
    )

    const list = (await (await request('/api/admin/errors', { headers: { cookie: adaCookie } })).json()) as {
      errors: Array<{ id: number; message: string; url: string }>
    }
    expect(list.errors[0].message).toContain('Cannot read')
    expect(list.errors[0].url).toBe('/')

    const detail = (await (await request(`/api/admin/errors/${list.errors[0].id}`, { headers: { cookie: adaCookie } })).json()) as {
      stack: string
      url: string
    }
    expect(detail.stack).toContain('TypeError')
    // Only the path was ever stored, so only the path can be shown.
    expect(detail.url).toBe('/')
  })

  it('is a door an editor cannot open', async () => {
    const { request, db, graceCookie } = await world()
    await db.run("UPDATE workspace_members SET role = 'editor' WHERE user_id = (SELECT id FROM users WHERE email = 'grace@example.com')")
    expect((await request('/api/admin/health', { headers: { cookie: graceCookie } })).status).toBe(403)
  })
})
