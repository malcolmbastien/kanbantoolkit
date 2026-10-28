/**
 * Where a person is signed in, and how a session ends.
 *
 * The interesting parts are not the listing. They are: a session id belongs to its owner and to
 * nobody else (a guessed id is a 404, not a refusal that confirms it exists); ending one session
 * leaves the others working; the two lifetimes are the two that were promised, and the choice is
 * stored on the row rather than imposed globally; and the cookie carries the name and the flags
 * that make it one a browser will protect.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { describeDevice, REMEMBERED_DAYS, SESSION_HOURS } from './auth/session'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

function database(): Database {
  const db = new DatabaseSync(':memory:')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

/** The session cookie a response sets, and the name it used — `fl_session` or `__Host-fl_session`. */
function sessionCookieOf(response: Response): { header: string; pair: string } {
  const header = response.headers.getSetCookie().find((entry) => entry.includes('fl_session'))
  if (!header) throw new Error('no session cookie was set')
  return { header, pair: header.split(';')[0] }
}

async function world(env: Record<string, string> = { AUTH_DEV: '1' }) {
  const db = database()
  const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
  const request = (path: string, init?: RequestInit) => app.request(path, init, env)

  const dev = (email: string, extra: { ua?: string; remember?: boolean } = {}) =>
    request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': extra.ua ?? 'Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0' },
      body: JSON.stringify({ email, ...(extra.remember ? { remember: true } : {}) }),
    })

  const signIn = async (email: string, extra: { ua?: string; remember?: boolean } = {}) => {
    const response = await dev(email, extra)
    if (response.status !== 200) throw new Error(`sign-in refused: ${response.status}`)
    const { header, pair } = sessionCookieOf(response)
    return { cookie: pair, header, response }
  }

  const id = async (email: string) =>
    (await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?1', [email]))!.id

  return { db, request, dev, signIn, id }
}

const listOf = async (request: (path: string, init?: RequestInit) => Response | Promise<Response>, cookie: string) =>
  ((await (await request('/api/me/sessions', { headers: { cookie } })).json()) as {
    sessions: Array<{ id: string; device: string; current: boolean; expiresAt: string; lastSeenAt?: string }>
  }).sessions

describe('the device a session names', () => {
  it('says the pair that matters, and admits when it does not know', () => {
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/126.0 Safari/537.36')).toBe(
      'Chrome on macOS',
    )
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0')).toBe(
      'Edge on Windows',
    )
    expect(describeDevice('Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0')).toBe('Firefox on Linux')
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1')).toBe(
      'Safari on iOS',
    )
    // A browser this does not know is not given a name it has not earned.
    expect(describeDevice('curl/8.4.0')).toBe('Unknown browser')
    expect(describeDevice(undefined)).toBe('Unknown device')
  })
})

describe('a person’s own sessions', () => {
  it('lists one row per session, says which is this one, and never returns the fingerprint', async () => {
    const { request, signIn } = await world()
    const first = await signIn('ada@example.com', { ua: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0' })
    await signIn('ada@example.com', { ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36' })

    const sessions = await listOf(request, first.cookie)
    expect(sessions).toHaveLength(2)
    expect(sessions.map((session) => session.device).sort()).toEqual(['Chrome on Windows', 'Firefox on Linux'])
    expect(sessions.filter((session) => session.current)).toHaveLength(1)

    // The id is a public name, not the SHA-256 of the token (64 hex characters).
    for (const session of sessions) expect(session.id).not.toMatch(/^[0-9a-f]{64}$/)
  })

  it('ends one and leaves the other working', async () => {
    const { request, signIn } = await world()
    const first = await signIn('ada@example.com', {
      ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
    })
    const second = await signIn('ada@example.com', {
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
    })

    const sessions = await listOf(request, first.cookie)
    const other = sessions.find((session) => !session.current)!

    const ended = await request(`/api/me/sessions/${other.id}`, { method: 'DELETE', headers: { cookie: first.cookie } })
    expect(ended.status).toBe(200)

    // The one that was ended is a credential no longer…
    expect((await request('/api/me', { headers: { cookie: second.cookie } })).status).toBe(401)
    // …and the one that was not is still a person.
    expect((await request('/api/me', { headers: { cookie: first.cookie } })).status).toBe(200)
  })

  it('ends every session, including the one asking — and says how many', async () => {
    const { db, request, signIn, id } = await world()
    const first = await signIn('ada@example.com', {
      ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
    })
    const second = await signIn('ada@example.com', {
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
    })

    const answer = await request('/api/me/signout-everywhere', { method: 'POST', headers: { cookie: first.cookie } })
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ revoked: 2 })

    for (const cookie of [first.cookie, second.cookie]) {
      expect((await request('/api/me', { headers: { cookie } })).status).toBe(401)
    }

    const user = await id('ada@example.com')
    const trail = await db.get<{ data: string }>(
      "SELECT data FROM audit_events WHERE action = 'session.revoke' AND target_id = ?1 ORDER BY id DESC LIMIT 1",
      [user],
    )
    expect(JSON.parse(trail!.data)).toMatchObject({ sessions: 2, everywhere: true })
  })

  it('cannot end a session that belongs to somebody else', async () => {
    const { db, request, signIn } = await world()
    const ada = await signIn('ada@example.com')
    // A second person, admitted by a domain the administrator listed — the roster is closed by
    // default, so a second identity needs a door of its own.
    await db.run("UPDATE instance_settings SET allowed_domains = '[\"example.com\"]'")
    await signIn('grace@example.com')

    const grace = await db.get<{ public_id: string }>(
      `SELECT s.public_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = 'grace@example.com'`,
    )

    const attempt = await request(`/api/me/sessions/${grace!.public_id}`, { method: 'DELETE', headers: { cookie: ada.cookie } })
    // 404, not a refusal: naming the difference would confirm that the id exists.
    expect(attempt.status).toBe(404)
    // And nothing happened to it.
    expect(
      await db.get('SELECT revoked_at FROM sessions WHERE public_id = ?1', [grace!.public_id]),
    ).toEqual({ revoked_at: null })
  })
})

describe('lifetimes', () => {
  const days = (expiresAt: string) => (Date.parse(expiresAt) - Date.now()) / 86_400_000

  it('is twelve hours by default, and thirty days when the sign-in asked', async () => {
    const { request, signIn } = await world()
    const ordinary = await signIn('ada@example.com', {
      ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
    })
    const remembered = await signIn('ada@example.com', {
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      remember: true,
    })

    const sessions = await listOf(request, ordinary.cookie)
    const short = sessions.find((session) => session.device === 'Firefox on Linux')!
    const long = sessions.find((session) => session.device === 'Chrome on Windows')!

    expect(days(short.expiresAt)).toBeGreaterThan(SESSION_HOURS / 24 - 0.05)
    expect(days(short.expiresAt)).toBeLessThan(SESSION_HOURS / 24 + 0.05)
    expect(days(long.expiresAt)).toBeGreaterThan(REMEMBERED_DAYS - 0.05)
    expect(days(long.expiresAt)).toBeLessThan(REMEMBERED_DAYS + 0.05)

    // The choice is on the row, so the two can sit in one list and each expire when it said.
    void remembered
  })

  it('writes last seen at most once an hour, so a board polling every two seconds is not a write', async () => {
    const { db, request, signIn } = await world()
    const { cookie } = await signIn('ada@example.com')
    const before = await db.get<{ last_seen_at: string }>('SELECT last_seen_at FROM sessions LIMIT 1')

    // Somebody using the app: three requests in the same minute.
    for (let i = 0; i < 3; i++) await request('/api/me', { headers: { cookie } })

    const after = await db.get<{ last_seen_at: string }>('SELECT last_seen_at FROM sessions LIMIT 1')
    expect(after!.last_seen_at).toBe(before!.last_seen_at)
  })
})

describe('the cookie', () => {
  it('is HttpOnly, SameSite=Lax, Path=/ and not Secure over plain http', async () => {
    const { signIn } = await world()
    const { header } = await signIn('ada@example.com')
    expect(header.toLowerCase()).toContain('httponly')
    expect(header.toLowerCase()).toContain('samesite=lax')
    expect(header.toLowerCase()).toContain('path=/')
    expect(header).not.toContain('Secure')
    expect(header).toContain('fl_session=')
    expect(header).not.toContain('__Host-')
  })

  it('takes the production prefix and Secure when the instance is https, even behind a proxy', async () => {
    // The request arrives over http — this is what a proxy does — while PUBLIC_URL says https.
    const { request, signIn } = await world({ AUTH_DEV: '1', PUBLIC_URL: 'https://kanbantoolkit.example' })
    const { header, cookie } = await signIn('ada@example.com')

    expect(header).toContain('__Host-fl_session=')
    expect(header).toContain('Secure')
    expect(header).toContain('Path=/')
    expect(header).not.toContain('Domain=')

    // And the same name is what the server reads: the session it just issued works.
    expect((await request('/api/me', { headers: { cookie } })).status).toBe(200)
  })
})
