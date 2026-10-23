/**
 * Accounts: the registry, the doors, the session, and the rule that one person stays one person.
 *
 * The OAuth flow is exercised against a fake provider, because a test that needs Google to be up is
 * not a test. The fake speaks the two endpoints the flow actually uses — the token exchange and
 * `userinfo` — so everything between them is the real code.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import { issueSession, revoke, userForToken } from './auth/session'
import { providers } from './config'
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

const OIDC = {
  AUTH_OIDC_CLIENT_ID: 'test-client',
  AUTH_OIDC_CLIENT_SECRET: 'test-secret',
  AUTH_OIDC_AUTHORIZE_ENDPOINT: 'https://idp.test/authorize',
  AUTH_OIDC_TOKEN_ENDPOINT: 'https://idp.test/token',
  AUTH_OIDC_USERINFO_ENDPOINT: 'https://idp.test/userinfo',
  AUTH_OIDC_LABEL: 'Test IdP',
}

function instance(env: Record<string, string> = {}) {
  const db = database()
  const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
  return {
    db,
    request: (path: string, init?: RequestInit) => app.request(path, init, env),
  }
}

/** The first cookie pair of a `Set-Cookie` header, as the browser would send it back. */
function cookie(response: Response, name: string): string | undefined {
  const header = response.headers.get('set-cookie')
  if (!header) return undefined
  const match = header.match(new RegExp(`${name}=([^;]+)`))
  return match?.[1]
}

function fakeProvider(profile: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith('/token')) return new Response(JSON.stringify({ access_token: 'access' }), { status: 200 })
    if (url.endsWith('/userinfo')) return new Response(JSON.stringify(profile), { status: 200 })
    return new Response('not this endpoint', { status: 404 })
  })
}

/** Walk the whole flow and hand back the session token, the way a browser would. */
async function signIn(env: Record<string, string>, profile: Record<string, unknown>, fake = instance(env)) {
  const fetchMock = fakeProvider(profile)
  vi.stubGlobal('fetch', fetchMock)
  try {
    const start = await fake.request('/api/auth/start?provider=oidc&next=/board')
    const state = cookie(start, 'fl_oauth')!
    const callback = await fake.request(`/api/auth/callback?code=code-1&state=${state}`, {
      headers: { cookie: `fl_oauth=${state}` },
    })
    return { ...fake, start, callback, token: cookie(callback, 'fl_session'), state }
  } finally {
    vi.unstubAllGlobals()
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the provider registry', () => {
  it('offers nothing until something is configured', () => {
    expect(providers({})).toEqual([])
  })

  it('offers Google when its client is configured, and not before', () => {
    expect(providers({ AUTH_GOOGLE_CLIENT_ID: 'id' })).toEqual([])
    const [google] = providers({ AUTH_GOOGLE_CLIENT_ID: 'id', AUTH_GOOGLE_CLIENT_SECRET: 'secret' })
    expect(google.id).toBe('google')
    expect(google.authorizeEndpoint).toContain('accounts.google.com')
  })

  it('lets a self-hoster bring an identity provider of its own', () => {
    const [oidc] = providers(OIDC)
    expect(oidc.id).toBe('oidc')
    expect(oidc.label).toBe('Test IdP')
    expect(oidc.authorizeEndpoint).toBe('https://idp.test/authorize')
  })

  it('is honest about what this instance offers', async () => {
    const { request } = instance({ AUTH_DEV: '1' })
    const answer = await request('/api/auth/providers')
    expect(await answer.json()).toEqual({ providers: [], dev: true })
  })
})

describe('signing in', () => {
  it('sends the browser to the provider with a state and a challenge', async () => {
    const { start } = await signIn(OIDC, { sub: 's1', email: 'ada@example.com', name: 'Ada' })
    const location = new URL(start.headers.get('location')!)

    expect(start.status).toBe(302)
    expect(location.origin + location.pathname).toBe('https://idp.test/authorize')
    expect(location.searchParams.get('state')).toBeTruthy()
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost/api/auth/callback')
  })

  it('issues a session, and says who is signed in', async () => {
    const { request, token } = await signIn(OIDC, { sub: 's1', email: 'Ada@Example.com', name: 'Ada' })
    expect(token).toBeTruthy()

    const session = await request('/api/auth/session', { headers: { cookie: `fl_session=${token}` } })
    const body = (await session.json()) as { user: { email: string; name: string; role: string } }
    expect(body.user.email).toBe('ada@example.com')
    expect(body.user.name).toBe('Ada')
    // The first person to arrive owns the instance, on both axes.
    expect(body.user.role).toBe('admin')
    expect((body.user as unknown as { instanceRole: string }).instanceRole).toBe('admin')
  })

  it('keeps one person as one account across two doors', async () => {
    // One instance, so the second sign-in meets the account the first one made.
    const sameInstance = instance(OIDC)
    const first = await signIn(OIDC, { sub: 's1', email: 'ada@example.com', name: 'Ada' }, sameInstance)
    const firstName = await first.request('/api/auth/session', { headers: { cookie: `fl_session=${first.token}` } })

    // The same address, arriving through a provider that names it with a different subject.
    const second = await signIn(OIDC, { sub: 's2', email: 'ada@example.com', name: 'Ada Lovelace' }, sameInstance)
    const secondName = await second.request('/api/auth/session', { headers: { cookie: `fl_session=${second.token}` } })

    const a = (await firstName.json()) as { user: { id: string } }
    const b = (await secondName.json()) as { user: { id: string } }
    expect(b.user.id).toBe(a.user.id)
  })

  it('refuses an address the provider will not vouch for', async () => {
    const { callback } = await signIn(OIDC, { sub: 's1', email: 'ada@example.com', email_verified: false })
    expect(callback.status).toBe(400)
  })

  it('refuses a callback this browser did not start', async () => {
    const fake = instance(OIDC)
    const start = await fake.request('/api/auth/start?provider=oidc')
    const state = cookie(start, 'fl_oauth')!

    const wrong = await fake.request(`/api/auth/callback?code=code-1&state=${state}`, {
      headers: { cookie: 'fl_oauth=someone-else' },
    })
    expect(wrong.status).toBe(400)

    const noCookie = await fake.request(`/api/auth/callback?code=code-1&state=${state}`)
    expect(noCookie.status).toBe(400)
  })

  it('spends a state once', async () => {
    const { request, state } = await signIn(OIDC, { sub: 's1', email: 'ada@example.com', name: 'Ada' })
    const replay = await request(`/api/auth/callback?code=code-1&state=${state}`, {
      headers: { cookie: `fl_oauth=${state}` },
    })
    expect(replay.status).toBe(400)
  })

  it('ends the session on sign-out', async () => {
    const { request, token } = await signIn(OIDC, { sub: 's1', email: 'ada@example.com', name: 'Ada' })
    const out = await request('/api/auth/signout', { method: 'POST', headers: { cookie: `fl_session=${token}` } })
    expect(out.status).toBe(204)

    const session = await request('/api/auth/session', { headers: { cookie: `fl_session=${token}` } })
    expect(((await session.json()) as { user: unknown }).user).toBeNull()
  })

  it('stops a flood from one address', async () => {
    const { request } = instance(OIDC)
    for (let i = 0; i < 30; i++) {
      expect((await request('/api/auth/start?provider=oidc')).status).toBe(302)
    }
    expect((await request('/api/auth/start?provider=oidc')).status).toBe(429)
  })
})

describe('invitations', () => {
  it('accepts an invitation on first sign-in, with the role it gave', async () => {
    const { db, request } = instance(OIDC)
    // Somebody has already signed in, so this instance has an owner.
    await db.run("INSERT INTO users (id, name, email) VALUES ('u_owner', 'Owner', 'owner@example.com')")
    await db.run("INSERT INTO instance_members (user_id, role) VALUES ('u_owner', 'admin')")
    await db.run("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('workspace', 'u_owner', 'admin')")
    await db.run("INSERT INTO invites (id, email, role, expires_at) VALUES ('inv-1', 'ada@example.com', 'admin', ?1)", [
      new Date(Date.now() + 86_400_000).toISOString(),
    ])

    const fetchMock = fakeProvider({ sub: 's1', email: 'ada@example.com', name: 'Ada' })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const start = await request('/api/auth/start?provider=oidc')
      const state = cookie(start, 'fl_oauth')!
      const callback = await request(`/api/auth/callback?code=code-1&state=${state}`, {
        headers: { cookie: `fl_oauth=${state}` },
      })
      const token = cookie(callback, 'fl_session')!
      const session = await request('/api/auth/session', { headers: { cookie: `fl_session=${token}` } })
      expect(((await session.json()) as { user: { role: string } }).user.role).toBe('admin')

      // The invitation is spent, not left behind for the next arrival — and kept as the record of
      // how this person arrived.
      expect(await db.get("SELECT accepted_at FROM invites WHERE id = 'inv-1'")).toMatchObject({
        accepted_at: expect.any(String),
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('the development switch', () => {
  it('does not exist unless the instance asks for it', async () => {
    const { request } = instance({})
    const response = await request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com' }),
    })
    expect(response.status).toBe(404)
  })

  it('is an identity without a provider, for the tests that need two people', async () => {
    const { request } = instance({ AUTH_DEV: '1' })

    const ada = await request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com', name: 'Ada' }),
    })
    const token = cookie(ada, 'fl_session')!
    const session = await request('/api/auth/session', { headers: { cookie: `fl_session=${token}` } })
    expect(((await session.json()) as { user: { name: string } }).user.name).toBe('Ada')

    const grace = await request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'grace.hopper@example.com' }),
    })
    expect(cookie(grace, 'fl_session')).not.toBe(token)
    // With no name given, the address is read as one: this is a person, not a login string.
    const graceSession = await request('/api/auth/session', { headers: { cookie: `fl_session=${cookie(grace, 'fl_session')}` } })
    expect(((await graceSession.json()) as { user: { name: string } }).user.name).toBe('Grace Hopper')
  })
})

describe('the two axes', () => {
  it('refuses an account status the database does not know', async () => {
    const db = database()
    await db.run("INSERT INTO users (id, name, email) VALUES ('u-1', 'Ada', 'ada@example.com')")
    await expect(db.run("UPDATE users SET status = 'banned' WHERE id = 'u-1'")).rejects.toThrow()
  })

  it('lets somebody be on the roster without being on this workspace', async () => {
    const db = database()
    await db.run("INSERT INTO users (id, name, email) VALUES ('u-1', 'Ada', 'ada@example.com')")
    await db.run("INSERT INTO instance_members (user_id, role) VALUES ('u-1', 'member')")

    expect(await db.get("SELECT 1 AS member FROM instance_members WHERE user_id = 'u-1'")).toEqual({ member: 1 })
    expect(await db.get("SELECT 1 AS member FROM workspace_members WHERE user_id = 'u-1'")).toBeUndefined()
  })

  it('makes the first person the administrator of both axes, and the second a member', async () => {
    const { db, request } = instance({ AUTH_DEV: '1' })

    for (const email of ['first@example.com', 'second@example.com']) {
      await request('/api/auth/dev', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    }

    // Exactly one administrator on each axis, and it is the same person.
    expect(await db.all("SELECT user_id FROM instance_members WHERE role = 'admin'")).toHaveLength(1)
    expect(await db.all("SELECT user_id FROM workspace_members WHERE role = 'admin'")).toHaveLength(1)

    const second = await db.get<{ role: string }>(
      "SELECT w.role FROM workspace_members w JOIN users u ON u.id = w.user_id WHERE u.email = 'second@example.com'",
    )
    expect(second?.role).toBe('editor')
  })
})

describe('sessions and the trail', () => {
  it('keeps a revoked session as a record, and refuses it as a credential', async () => {
    const db = database()
    await db.run("INSERT INTO users (id, name, email) VALUES ('u-1', 'Ada', 'ada@example.com')")
    const paused = await issueSession(db, 'u-1', { userAgent: 'a browser', ipHash: 'abc' })

    expect(await userForToken(db, paused.token)).toBeTruthy()
    await revoke(db, paused.token)

    expect(await userForToken(db, paused.token)).toBeUndefined()
    // Gone as a credential, still there as a fact — with what it was used from.
    const row = await db.get<{ revoked_at: string | null; user_agent: string }>(
      'SELECT revoked_at, user_agent FROM sessions LIMIT 1',
    )
    expect(row?.revoked_at).toBeTruthy()
    expect(row?.user_agent).toBe('a browser')
  })

  it('records a sign-in, without any of the workspace in it', async () => {
    const { db, request } = instance({ AUTH_DEV: '1' })
    await request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com', name: 'Ada' }),
    })

    const events = await db.all<{ action: string; target_id: string; data: string | null }>(
      'SELECT action, target_id, data FROM audit_events',
    )
    expect(events).toHaveLength(1)
    expect(events[0].action).toBe('signin')
    expect(events[0].target_id).toBe('dev')
    expect(events[0].data).toBeNull()
  })

  it('refuses to change or remove what the trail says', async () => {
    const { db, request } = instance({ AUTH_DEV: '1' })
    await request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com' }),
    })

    await expect(db.run("UPDATE audit_events SET action = 'nothing'")).rejects.toThrow(/append-only/)
    await expect(db.run('DELETE FROM audit_events')).rejects.toThrow(/append-only/)
  })
})
