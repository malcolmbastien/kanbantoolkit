/**
 * The doors in and out.
 *
 * Five routes: what this instance offers, where to start, where the provider comes back to, who is
 * signed in, and sign-out. The development switch is a sixth, and it does not exist unless the
 * instance asks for it by name.
 *
 * Nothing here trusts a provider without asking: the code is exchanged for a token, the token is
 * exchanged for a profile, and only a verified address can become an account.
 */

import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Database } from '../db'
import { devAuth, providers, publicUrl, salt } from '../config'
import type { Runtime } from '../runtime'
import { AuthError, authorizeUrl, exchangeCode, pkceChallenge, profile, randomToken, sha256 } from './oauth'
import { issueSession, revoke, SESSION_COOKIE, userById, userForToken } from './session'
import type { AuthUser } from './session'

/** How long a sign-in may sit half-finished before it is worthless. */
const STATE_MINUTES = 10
/** One address may start this many sign-ins an hour. */
const ATTEMPTS_PER_HOUR = 30

/** The state cookie is scoped to this subtree; the session cookie belongs to the instance. */
const STATE_COOKIE = 'fl_oauth'
const STATE_PATH = '/api/auth'

/** `maya.blake` → `Maya Blake`, so a development identity reads like a person rather than a login. */
function humanise(local: string): string {
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function secure(request: Request): boolean {
  return new URL(request.url).protocol === 'https:'
}

/**
 * Where to send the browser afterwards. Only a path on this instance, so a crafted link cannot turn
 * a sign-in into a redirect somewhere else.
 */
function nextPath(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  return value.slice(0, 300)
}

/** A sign-in attempt, counted so a flood is not free. */
async function overLimit(db: Database, address: string, env: unknown): Promise<boolean> {
  const ipHash = await sha256(`${address}:${salt(env)}`)
  const since = new Date(Date.now() - 3_600_000).toISOString()
  const recent = await db.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM auth_attempts WHERE ip_hash = ?1 AND at >= ?2',
    [ipHash, since],
  )
  await db.run('INSERT INTO auth_attempts (ip_hash) VALUES (?1)', [ipHash])
  return (recent?.n ?? 0) >= ATTEMPTS_PER_HOUR
}

/**
 * One person, however many doors they come through.
 *
 * An identity is the provider plus the subject it named. If that identity is new but the address is
 * already known — and the provider vouches for it — the doors are joined rather than a second
 * account being made. A first person owns the instance; an invited address arrives with its role.
 */
async function identify(db: Database, providerId: string, who: { subject: string; email: string; emailVerified: boolean; name: string }): Promise<AuthUser> {
  if (!who.emailVerified) throw new AuthError('that address has not been verified')

  const linked = await db.get<{ user_id: string }>(
    'SELECT user_id FROM identities WHERE provider = ?1 AND subject = ?2',
    [providerId, who.subject],
  )
  if (linked) {
    const user = await userById(db, linked.user_id)
    if (user) return user
  }

  const known = await db.get<{ id: string }>('SELECT id FROM users WHERE lower(email) = ?1', [who.email])
  const userId = known?.id ?? `u_${randomToken(12)}`
  if (!known) {
    await db.run('INSERT INTO users (id, name, email) VALUES (?1, ?2, ?3)', [userId, who.name, who.email])
  }

  const member = await db.get<{ user_id: string }>('SELECT user_id FROM members WHERE user_id = ?1', [userId])
  if (!member) {
    const invite = await db.get<{ role: string }>('SELECT role FROM invites WHERE email = ?1', [who.email])
    const count = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM members')
    const role = invite?.role ?? ((count?.n ?? 0) === 0 ? 'owner' : 'member')
    await db.run('INSERT INTO members (user_id, role) VALUES (?1, ?2)', [userId, role])
    if (invite) await db.run('DELETE FROM invites WHERE email = ?1', [who.email])
  }

  // The same person signing in twice at once should not make two identities.
  await db.run(
    'INSERT OR IGNORE INTO identities (provider, subject, user_id, email) VALUES (?1, ?2, ?3, ?4)',
    [providerId, who.subject, userId, who.email],
  )

  const user = await userById(db, userId)
  if (!user) throw new AuthError('the account could not be read back', 500)
  return user
}

export function authRoutes(runtime: Runtime) {
  const auth = new Hono<{ Bindings: object }>()

  /** What this instance offers. An instance with nothing configured offers nothing, and says so. */
  auth.get('/providers', (c) =>
    c.json({
      providers: providers(c.env).map(({ id, label }) => ({ id, label })),
      dev: devAuth(c.env),
    }),
  )

  auth.get('/start', async (c) => {
    const db = runtime.database(c.env)
    if (!db) return c.json({ error: 'not configured' }, 503)

    const provider = providers(c.env).find((candidate) => candidate.id === c.req.query('provider'))
    if (!provider) return c.json({ error: 'unknown provider' }, 404)
    if (await overLimit(db, runtime.clientIp(c.req.raw), c.env)) {
      return c.json({ error: 'too many attempts' }, 429)
    }

    const state = randomToken(16)
    const verifier = randomToken(32)
    await db.run('INSERT INTO oauth_states (state, provider, verifier, next) VALUES (?1, ?2, ?3, ?4)', [
      state,
      provider.id,
      verifier,
      nextPath(c.req.query('next')),
    ])

    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'Lax',
      path: STATE_PATH,
      maxAge: STATE_MINUTES * 60,
      secure: secure(c.req.raw),
    })

    return c.redirect(
      authorizeUrl(provider, {
        state,
        challenge: await pkceChallenge(verifier),
        redirectUri: `${publicUrl(c.env, c.req.raw)}/api/auth/callback`,
      }),
      302,
    )
  })

  auth.get('/callback', async (c) => {
    const db = runtime.database(c.env)
    if (!db) return c.json({ error: 'not configured' }, 503)

    const origin = publicUrl(c.env, c.req.raw)
    const state = c.req.query('state') ?? ''
    const cookie = getCookie(c, STATE_COOKIE)
    deleteCookie(c, STATE_COOKIE, { path: STATE_PATH })

    // Someone who chose "cancel" is back here with an error and no code, which is not a failure of
    // ours to explain in JSON.
    if (c.req.query('error')) return c.redirect(`${origin}/?auth=denied`, 302)

    // The state has to be the one this browser was given: that is what stops a crafted callback
    // completing a sign-in for somebody else.
    if (!state || !cookie || state !== cookie) return c.json({ error: 'this sign-in did not start here' }, 400)

    const pending = await db.get<{ provider: string; verifier: string; next: string }>(
      'SELECT provider, verifier, next FROM oauth_states WHERE state = ?1',
      [state],
    )
    // Single use, whether or not it is still valid.
    await db.run('DELETE FROM oauth_states WHERE state = ?1', [state])
    if (!pending) return c.json({ error: 'this sign-in has expired' }, 400)

    const provider = providers(c.env).find((candidate) => candidate.id === pending.provider)
    if (!provider) return c.json({ error: 'unknown provider' }, 404)
    if (await overLimit(db, runtime.clientIp(c.req.raw), c.env)) {
      return c.json({ error: 'too many attempts' }, 429)
    }

    const code = c.req.query('code')
    if (!code) return c.json({ error: 'no code' }, 400)

    try {
      const accessToken = await exchangeCode(provider, {
        code,
        verifier: pending.verifier,
        redirectUri: `${origin}/api/auth/callback`,
      })
      const who = await profile(provider, accessToken)
      const user = await identify(db, provider.id, who)
      const session = await issueSession(db, user.id)

      setCookie(c, SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: session.maxAge,
        secure: secure(c.req.raw),
      })

      return c.redirect(`${origin}${nextPath(pending.next)}`, 302)
    } catch (error) {
      if (error instanceof AuthError) return c.json({ error: error.message }, error.status as 400)
      return c.json({ error: 'sign-in failed' }, 502)
    }
  })

  auth.get('/session', async (c) => {
    const db = runtime.database(c.env)
    if (!db) return c.json({ user: null, dev: false })

    const token = getCookie(c, SESSION_COOKIE)
    const user = token ? await userForToken(db, token) : undefined
    return c.json({ user: user ?? null, dev: devAuth(c.env) })
  })

  auth.post('/signout', async (c) => {
    const db = runtime.database(c.env)
    const token = getCookie(c, SESSION_COOKIE)
    if (db && token) await revoke(db, token)
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.body(null, 204)
  })

  /**
   * The development switch: an identity without a provider. It exists because the tests that matter
   * need two people, and because a self-hoster configuring an instance needs to be someone before
   * any provider is registered.
   */
  auth.post('/dev', async (c) => {
    if (!devAuth(c.env)) return c.json({ error: 'not found' }, 404)
    const db = runtime.database(c.env)
    if (!db) return c.json({ error: 'not configured' }, 503)

    const body = (await c.req.json().catch(() => null)) as { email?: unknown; name?: unknown } | null
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!email.includes('@')) return c.json({ error: 'an address is required' }, 400)

    // A provider would tell us the person's name; the switch has only an address, so it makes a
    // plausible one from it — `maya.blake@…` becomes `Maya Blake` rather than `maya.blake`.
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : humanise(email.split('@')[0])
    const user = await identify(db, 'dev', { subject: email, email, emailVerified: true, name })
    const session = await issueSession(db, user.id)

    setCookie(c, SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: session.maxAge,
      secure: secure(c.req.raw),
    })
    return c.json({ user })
  })

  return auth
}
