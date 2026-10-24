/**
 * The workspace's own door.
 *
 * The interesting parts are the boundary and the guard: a workspace administrator may change a role
 * here and nothing at the instance level, and the last one of them cannot be removed or demoted —
 * including by themselves, because leaving is only allowed while somebody remains.
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

  // An editor, admitted through an invitation so they are not a viewer.
  const invited = (await (await request('/api/admin/invites', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adaCookie },
    body: JSON.stringify({ email: 'grace@example.com', role: 'editor' }),
  })).json()) as { url: string }
  const token = new URL(invited.url).searchParams.get('invite')!
  const grace = await dev('grace@example.com', token)

  const id = async (email: string) =>
    (await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?1', [email]))!.id

  return { db, request, dev, adaCookie, graceCookie: cookieOf(grace), id }
}

describe('workspace members', () => {
  it('lists the people in it, with their roles', async () => {
    const { request, adaCookie } = await world()
    const body = (await (await request('/api/admin/workspace', { headers: { cookie: adaCookie } })).json()) as {
      workspace: { name: string }
      members: Array<{ name: string; role: string }>
    }

    expect(body.workspace.name).toBe('Flowline')
    expect(body.members.map((member) => `${member.name}:${member.role}`).sort()).toEqual(['Ada:admin', 'Grace:editor'])
  })

  it('changes a role, and removes somebody, effective on the next request', async () => {
    const { request, adaCookie, graceCookie, id } = await world()
    const grace = await id('grace@example.com')

    expect(
      (await request(`/api/admin/workspace/members/${grace}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: adaCookie },
        body: JSON.stringify({ role: 'viewer' }),
      })).status,
    ).toBe(200)

    // The editor is a viewer now, on the next request, with the same cookie.
    expect(
      (await request('/api/workspace/items/i-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: graceCookie },
        body: JSON.stringify({ baseRev: 0, item: { id: 'i-1', title: 'Mine', typeId: 't', createdAt: 1 } }),
      })).status,
    ).toBe(403)

    expect((await request(`/api/admin/workspace/members/${grace}`, { method: 'DELETE', headers: { cookie: adaCookie } })).status).toBe(204)
    // Removed, not deactivated: the account can still sign in, and sees no workspace.
    expect((await request('/api/workspace', { headers: { cookie: graceCookie } })).status).toBe(404)
  })

  it('will not let the last workspace administrator demote themselves or leave', async () => {
    const { request, adaCookie, id } = await world()
    const ada = await id('ada@example.com')

    const demote = await request(`/api/admin/workspace/members/${ada}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adaCookie },
      body: JSON.stringify({ role: 'editor' }),
    })
    expect(demote.status).toBe(409)

    const leave = await request(`/api/admin/workspace/members/${ada}`, { method: 'DELETE', headers: { cookie: adaCookie } })
    expect(leave.status).toBe(409)
    expect(((await leave.json()) as { error: string }).error).toContain('last administrator')
  })

  it('is a door an editor cannot open', async () => {
    const { request, graceCookie } = await world()
    expect((await request('/api/admin/workspace', { headers: { cookie: graceCookie } })).status).toBe(403)
  })

  it('invites into the workspace, and the invitation says so', async () => {
    const { request, adaCookie } = await world()

    const created = await request('/api/admin/workspace/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adaCookie },
      body: JSON.stringify({ email: 'linus@example.com', role: 'viewer' }),
    })
    expect(created.status).toBe(201)

    const list = (await (await request('/api/admin/invites', { headers: { cookie: adaCookie } })).json()) as {
      invites: Array<{ email: string; scope: string }>
    }
    expect(list.invites.find((invite) => invite.email === 'linus@example.com')?.scope).toBe('workspace')
  })
})
