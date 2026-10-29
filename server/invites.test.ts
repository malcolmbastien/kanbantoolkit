/**
 * The link: minted once, spent once, and only for the address it names.
 *
 * The sign-in is where a newcomer is accepted — it is the moment the provider vouches for the
 * address — so a token presented there is spent and the person arrives at the invited role. The
 * `POST /api/invite/:token` door is for somebody who already has a session, which is how an open
 * instance hands out the role an administrator meant them to have.
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

  const admin = await dev('ada@example.com')
  const adminCookie = cookieOf(admin)

  const invite = async (email: string, role = 'editor', name?: string) => {
    const response = await request('/api/admin/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ email, role, ...(name ? { name } : {}) }),
    })
    const body = (await response.json()) as { invite: { id: string }; url: string }
    return { response, id: body.invite.id, token: new URL(body.url).searchParams.get('invite')! }
  }

  return { db, request, dev, adminCookie, invite }
}

describe('an invitation is a link', () => {
  it('is returned once, and stored only as a hash', async () => {
    const { db, invite } = await world()
    const created = await invite('grace@example.com', 'editor')

    expect(created.response.status).toBe(201)
    expect(created.token).toBeTruthy()

    const row = await db.get<{ token_hash: string }>("SELECT token_hash FROM invites WHERE email = 'grace@example.com'")
    expect(row?.token_hash).not.toBe(created.token)
    expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('says who it is for only in a mask, and what it is worth', async () => {
    const { request, invite } = await world()
    const { token } = await invite('grace@example.com', 'viewer')

    const answer = await request(`/api/invite/${token}`)
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({
      email: 'g****@example.com',
      role: 'viewer',
      expiresAt: expect.any(String),
    })
  })

  it('keeps a name the link does not reveal, and uses it when the person accepts', async () => {
    const { db, request, adminCookie, invite } = await world()
    const { token } = await invite('grace@example.com', 'editor', 'Grace Hopper')

    // The list says who the invitation is for, so an administrator can tell two links apart.
    const listed = (await (await request('/api/admin/invites', { headers: { cookie: adminCookie } })).json()) as {
      invites: Array<{ name?: string }>
    }
    expect(listed.invites[0].name).toBe('Grace Hopper')

    // The public view masks the address and says nothing about the name: a forwarded link must not
    // identify the person it was made for.
    const publicView = (await (await request(`/api/invite/${token}`)).json()) as Record<string, unknown>
    expect(publicView).not.toHaveProperty('name')
    expect(JSON.stringify(publicView)).not.toContain('Grace')

    const accepted = await request(`/api/invite/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct horse battery staple' }),
    })
    expect(accepted.status).toBe(200)
    expect(await db.get("SELECT name FROM users WHERE email = 'grace@example.com'")).toEqual({ name: 'Grace Hopper' })
  })

  it('lets the person’s own name win over the one the invitation carries', async () => {
    const { db, request, invite } = await world()
    const { token } = await invite('grace@example.com', 'editor', 'G. Hopper')

    const accepted = await request(`/api/invite/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Grace Hopper', password: 'correct horse battery staple' }),
    })
    expect(accepted.status).toBe(200)
    expect(await db.get("SELECT name FROM users WHERE email = 'grace@example.com'")).toEqual({ name: 'Grace Hopper' })
  })

  it('admits the invited address, at the invited role, and is then spent', async () => {
    const { db, request, dev, invite } = await world()
    const { token } = await invite('grace@example.com', 'editor')

    expect((await dev('grace@example.com', token)).status).toBe(200)

    const grace = await db.get<{ role: string }>(
      `SELECT w.role FROM workspace_members w JOIN users u ON u.id = w.user_id WHERE u.email = 'grace@example.com'`,
    )
    expect(grace?.role).toBe('editor')
    expect(await db.get("SELECT accepted_at FROM invites WHERE email = 'grace@example.com'")).toMatchObject({
      accepted_at: expect.any(String),
    })

    // The link is spent: a second attempt is not admitted, and the public view says why.
    expect((await dev('someone@example.com', token)).status).toBe(403)
    expect((await request(`/api/invite/${token}`)).status).toBe(410)
  })

  it('grants nothing to another address holding the link', async () => {
    const { db, dev, invite } = await world()
    const { token } = await invite('grace@example.com', 'editor')

    expect((await dev('mallory@example.com', token)).status).toBe(403)
    expect(await db.get("SELECT 1 FROM users WHERE email = 'mallory@example.com'")).toBeUndefined()
    // And the invitation is still there for the person it was written for.
    expect(await db.get("SELECT accepted_at FROM invites WHERE email = 'grace@example.com'")).toEqual({ accepted_at: null })
  })

  it('stops working when it is revoked, or when a new link replaces it', async () => {
    const { request, adminCookie, invite } = await world()
    const first = await invite('grace@example.com')

    expect(
      (await request(`/api/admin/invites/${first.id}`, { method: 'DELETE', headers: { cookie: adminCookie } })).status,
    ).toBe(204)
    expect((await request(`/api/invite/${first.token}`)).status).toBe(410)

    const second = await invite('linus@example.com')
    const resent = await request(`/api/admin/invites/${second.id}/resend`, { method: 'POST', headers: { cookie: adminCookie } })
    const { url } = (await resent.json()) as { url: string }
    const fresh = new URL(url).searchParams.get('invite')!

    expect((await request(`/api/invite/${second.token}`)).status).toBe(410)
    expect((await request(`/api/invite/${fresh}`)).status).toBe(200)
  })

  it('stops working when it expires', async () => {
    const { db, request, invite } = await world()
    const { token } = await invite('grace@example.com')
    await db.run("UPDATE invites SET expires_at = '2020-01-01T00:00:00.000Z' WHERE email = 'grace@example.com'")

    expect((await request(`/api/invite/${token}`)).status).toBe(410)
  })

  it('gives a role to somebody who already has a session, through the second door', async () => {
    const { db, request, dev, adminCookie, invite } = await world()
    const { token } = await invite('grace@example.com', 'editor')

    // The instance is closed, but grace's domain is admitted: she is in before she opens the link —
    // as a viewer.
    await db.run('UPDATE instance_settings SET allowed_domains = ?1', [JSON.stringify(['example.com'])])
    const signedIn = await dev('grace@example.com')
    const graceCookie = cookieOf(signedIn)

    const accepted = await request(`/api/invite/${token}`, { method: 'POST', headers: { cookie: graceCookie } })
    expect(accepted.status).toBe(200)

    expect(
      (await db.get<{ role: string }>(`SELECT w.role FROM workspace_members w JOIN users u ON u.id = w.user_id WHERE u.email = 'grace@example.com'`))?.role,
    ).toBe('editor')

    // And a different person cannot use it, even signed in.
    expect(
      (await request(`/api/invite/${token}`, { method: 'POST', headers: { cookie: adminCookie } })).status,
    ).toBe(410)
  })

  it('answers the same way whether or not the address already has an account', async () => {
    const { request, adminCookie } = await world()
    const create = (email: string) =>
      request('/api/admin/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ email }),
      })

    const known = await create('ada@example.com')
    const unknown = await create('nobody@example.com')
    expect(known.status).toBe(unknown.status)
    expect(Object.keys((await known.json()) as Record<string, unknown>)).toEqual(
      Object.keys((await unknown.json()) as Record<string, unknown>),
    )
  })
})

describe('the list of invitations', () => {
  it('says who invited whom, and who it became', async () => {
    const { request, dev, adminCookie, invite } = await world()
    const { token } = await invite('grace@example.com', 'viewer')

    const pending = (await (await request('/api/admin/invites', { headers: { cookie: adminCookie } })).json()) as {
      invites: Array<{ email: string; state: string; invitedByName?: string; acceptedName?: string }>
    }
    expect(pending.invites[0]).toMatchObject({
      email: 'grace@example.com',
      state: 'valid',
      invitedByName: 'Ada',
    })

    await dev('grace@example.com', token)

    const accepted = (await (await request('/api/admin/invites', { headers: { cookie: adminCookie } })).json()) as {
      invites: Array<{ state: string; acceptedName?: string }>
    }
    // The row does not disappear: the record of who invited whom is half the reason to keep it.
    expect(accepted.invites[0]).toMatchObject({ state: 'used', acceptedName: 'Grace' })
  })
})
