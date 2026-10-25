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
import type { Database, Statement } from '../db'
import { DEFAULT_WORKSPACE_NAME, devAuth, providers, publicUrl, salt, workspaceName } from '../config'
import type { Runtime } from '../runtime'
import { AuthError, NotAdmitted, authorizeUrl, exchangeCode, pkceChallenge, profile, randomToken, sha256 } from './oauth'
import { issueSession, revoke, sessionCookie, userById, userForToken, WORKSPACE_ID } from './session'
import { record } from '../audit'
import { admitsDomain, settings } from '../instance'
import { resolveWorkspace } from '../access'
import { byToken, stateOf } from '../invites'
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

/**
 * Where to send the browser afterwards. Only a path on this instance, so a crafted link cannot turn
 * a sign-in into a redirect somewhere else.
 */
function nextPath(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  return value.slice(0, 300)
}

/** The address, hashed with the instance's salt — the same form the limiter counts. */
async function addressHash(runtime: Runtime, env: unknown, request: Request): Promise<string> {
  return sha256(`${runtime.clientIp(request)}:${salt(env)}`)
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
/**
 * The instance's one workspace, as the installation leaves it (task 163).
 *
 * One deployment is one team, so the workspace is not something anybody signs up for: it is named
 * by the installation (`WORKSPACE_NAME`) and administered by the person whose arrival creates it.
 * A name a team has already chosen is never replaced — only the name the row was created with is,
 * which is what makes running this twice harmless.
 *
 * Returned as statements rather than executed, so the caller can put them in the same transaction
 * as the account that arrives with them: no moment at which a workspace exists with nobody in it.
 */
function installWorkspaceStatements(env: unknown): Statement[] {
  const name = workspaceName(env)
  return [
    {
      sql: `INSERT INTO workspaces (id, name) VALUES (?1, ?2)
            ON CONFLICT (id) DO UPDATE SET name = excluded.name WHERE workspaces.name = ?3`,
      params: [WORKSPACE_ID, name, DEFAULT_WORKSPACE_NAME],
    },
    {
      sql: `INSERT INTO workspace (id, name) VALUES (?1, ?2)
            ON CONFLICT (id) DO UPDATE SET name = excluded.name WHERE workspace.name = ?3`,
      params: [WORKSPACE_ID, name, DEFAULT_WORKSPACE_NAME],
    },
  ]
}

/** The seat that makes the arrival an administrator of the workspace they came to find. */
function seatOf(userId: string, role: string, invitedBy: string | null = null): Statement {
  return {
    sql: 'INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES (?1, ?2, ?3, ?4)',
    params: [WORKSPACE_ID, userId, role, invitedBy],
  }
}

/** Whether this deployment has its workspace — a deleted one is re-opened by an administrator. */
async function workspaceInstalled(db: Database): Promise<boolean> {
  return Boolean(await db.get('SELECT 1 AS seen FROM workspaces WHERE id = ?1', [WORKSPACE_ID]))
}

/**
 * A deleted workspace comes back the way it began: an **instance administrator** arrives and the
 * installation's name is applied again (task 163).
 *
 * Only an administrator, and only when there is no workspace at all: a plain member cannot
 * resurrect a team they were not invited into, and nobody — administrator or not — can make a
 * second one. Called on both ways through the door, because a returning identity is the common one
 * and it used to be the path that skipped everything.
 */
async function reopenWorkspaceIfNeeded(db: Database, env: unknown, userId: string): Promise<void> {
  if (await workspaceInstalled(db)) return
  const role = await db.get<{ role: string }>('SELECT role FROM instance_members WHERE user_id = ?1', [userId])
  if (role?.role !== 'admin') return
  await db.batch([...installWorkspaceStatements(env), seatOf(userId, 'admin')])
}

async function identify(
  db: Database,
  env: unknown,
  providerId: string,
  who: { subject: string; email: string; emailVerified: boolean; name: string },
  inviteToken?: string,
): Promise<AuthUser> {
  if (!who.emailVerified) throw new AuthError('that address has not been verified')

  // A known door is not a way past a closed account: the status is read with the identity, so a
  // deactivated person is refused on the identity they have been using.
  const linked = await db.get<{ user_id: string; status: string }>(
    `SELECT l.user_id, u.status FROM identities l JOIN users u ON u.id = l.user_id
     WHERE l.provider = ?1 AND l.subject = ?2`,
    [providerId, who.subject],
  )
  if (linked) {
    if (linked.status === 'inactive') throw new NotAdmitted()
    const user = await userById(db, linked.user_id)
    if (user) {
      await reopenWorkspaceIfNeeded(db, env, user.id)
      return user
    }
  }

  const known = await db.get<{ id: string; status: string }>(
    'SELECT id, status FROM users WHERE lower(email) = ?1',
    [who.email],
  )
  // An inactive account and an unknown address are refused with the same silence: the difference
  // between them is exactly what somebody probing the instance would like to learn.
  if (known?.status === 'inactive') throw new NotAdmitted()

  const userId = known?.id ?? `u_${randomToken(12)}`
  const identity = {
    sql: 'INSERT OR IGNORE INTO identities (provider, subject, user_id, email) VALUES (?1, ?2, ?3, ?4)',
    params: [providerId, who.subject, userId, who.email],
  }

  // Already on the roster: the door is open to them regardless of the posture. The role comes with
  // it, because an instance administrator is the one who may re-open a workspace that was deleted
  // (task 163) — a plain member cannot resurrect a team they were not invited into.
  const door = known
    ? await db.get<{ user_id: string; role: string }>(
        'SELECT user_id, role FROM instance_members WHERE user_id = ?1',
        [userId],
      )
    : undefined

  if (door) {
    // A workspace that was deleted comes back the way it began: an instance administrator arrives
    // and the installation's name is applied again. A plain member cannot re-open a team they were
    // not invited into, and nobody can make a second one (task 163).
    await db.run(identity.sql, identity.params)
    await reopenWorkspaceIfNeeded(db, env, userId)
    const user = await userById(db, userId)
    if (!user) throw new AuthError('the account could not be read back', 500)
    return user
  }

  // The link is the door. A token is accepted before the access check — that is what it is for —
  // but only for the address it was written for: a forwarded link still needs a sign-in as nobody
  // else. An invitation row on its own admits nobody, which is what makes the token worth having.
  const offered = inviteToken ? await byToken(db, inviteToken) : undefined
  const invite =
    offered && stateOf(offered) === 'valid' && offered.email.toLowerCase() === who.email.toLowerCase()
      ? offered
      : undefined

  // The first person to arrive owns the instance, whatever the setting says — there has to be
  // somebody who can open the door.
  const first = ((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM instance_members'))?.n ?? 0) === 0
  if (!first && !invite) {
    // Three ways in when the instance is closed: an invitation, a domain the administrator listed,
    // or nothing at all. A listed domain is a door, and it admits a viewer like an open instance.
    const posture = await settings(db)
    if (posture.access === 'closed' && !admitsDomain(posture, who.email)) throw new NotAdmitted()
  }

  // An open door admits a viewer. It never makes anybody an administrator: that is a decision
  // somebody makes about a person, not a consequence of arriving.
  const instanceRole = first ? 'admin' : 'member'
  const workspaceRole = invite
    ? invite.role === 'admin'
      ? 'admin'
      : invite.role === 'viewer'
        ? 'viewer'
        : 'editor'
    : 'admin'

  // One batch: no moment at which an account exists and nobody administers it.
  //
  // An account arrives with **no workspace** unless it is the deployment's first person, an
  // administrator re-opening one that was deleted, or somebody who was invited. By joining is an
  // invitation; by creating is a sign-up, and there is no sign-up (task 163) — a stranger who merely
  // signed in is an account, and the interface says so rather than seating them in a team.
  const joinsTheWorkspace = first || Boolean(invite)
  await db.batch([
    // The instance's one workspace, for its first person (task 163). Created here rather than
    // assumed: a deployment whose workspace was deleted starts again the same way it began — and it
    // is named by the *installation* (`WORKSPACE_NAME`), which is the only place a name can come
    // from when nobody signs up for anything.
    //
    // A name somebody has already chosen is never overwritten: only the name the row was created
    // with is replaced, which is what makes running this again harmless.
    // The workspace, and the person who arrives as its administrator, in the same transaction.
    ...(first ? installWorkspaceStatements(env) : []),
    ...(known ? [] : [{ sql: 'INSERT INTO users (id, name, email) VALUES (?1, ?2, ?3)', params: [userId, who.name, who.email] }]),
    { sql: 'INSERT INTO instance_members (user_id, role) VALUES (?1, ?2)', params: [userId, instanceRole] },
    ...(joinsTheWorkspace ? [seatOf(userId, workspaceRole, invite?.invited_by ?? null)] : []),
    ...(invite
      ? [
          { sql: 'UPDATE invites SET accepted_at = ?1 WHERE id = ?2', params: [new Date().toISOString(), invite.id] },
          {
            sql: `INSERT INTO audit_events (actor_id, action, target_type, target_id) VALUES (?1, 'invite.accepted', 'invite', ?2)`,
            params: [userId, invite.id],
          },
        ]
      : []),
    identity,
  ])

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
      await record(db, {
        action: 'signin.refused',
        targetType: 'provider',
        targetId: provider.id,
        data: { reason: 'rate limited' },
        ipHash: await addressHash(runtime, c.env, c.req.raw),
      })
      return c.json({ error: 'too many attempts' }, 429)
    }

    const state = randomToken(16)
    const verifier = randomToken(32)
    await db.run(
      'INSERT INTO oauth_states (state, provider, verifier, next, invite, remember) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
      [
        state,
        provider.id,
        verifier,
        nextPath(c.req.query('next')),
        // A sign-in that carries an invitation is remembered with it, so the callback can accept it.
        (c.req.query('invite') ?? '').slice(0, 200) || null,
        // …and so is the choice of lifetime: the session is issued by the callback, after the
        // browser has been away and back.
        c.req.query('remember') === '1' ? 1 : 0,
      ],
    )

    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'Lax',
      path: STATE_PATH,
      maxAge: STATE_MINUTES * 60,
      // The same rule the session uses: https as configured, not as the request happened to arrive.
      secure: sessionCookie(c.env, c.req.raw).secure,
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

    const pending = await db.get<{
      provider: string
      verifier: string
      next: string
      invite: string | null
      remember: number
    }>('SELECT provider, verifier, next, invite, remember FROM oauth_states WHERE state = ?1', [state])
    // Single use, whether or not it is still valid.
    await db.run('DELETE FROM oauth_states WHERE state = ?1', [state])
    if (!pending) return c.json({ error: 'this sign-in has expired' }, 400)

    const provider = providers(c.env).find((candidate) => candidate.id === pending.provider)
    if (!provider) return c.json({ error: 'unknown provider' }, 404)
    if (await overLimit(db, runtime.clientIp(c.req.raw), c.env)) {
      await record(db, {
        action: 'signin.refused',
        targetType: 'provider',
        targetId: provider.id,
        data: { reason: 'rate limited' },
        ipHash: await addressHash(runtime, c.env, c.req.raw),
      })
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
      const user = await identify(db, c.env, provider.id, who, pending.invite ?? undefined)
      const ipHash = await addressHash(runtime, c.env, c.req.raw)
      const session = await issueSession(db, user.id, {
        userAgent: c.req.header('user-agent'),
        ipHash,
        remember: pending.remember === 1,
      })
      await record(db, { actorId: user.id, action: 'signin', targetType: 'provider', targetId: provider.id, ipHash })

      const cookie = sessionCookie(c.env, c.req.raw)
      setCookie(c, cookie.name, session.token, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: session.maxAge,
        secure: cookie.secure,
      })

      return c.redirect(`${origin}${nextPath(pending.next)}`, 302)
    } catch (error) {
      // One answer for an unknown address and for a closed door: no difference to probe — and the
      // trail keeps the fact without keeping the address that tried.
      if (error instanceof NotAdmitted) {
        await record(db, {
          action: 'signin.refused',
          targetType: 'provider',
          targetId: provider.id,
          data: { reason: 'not admitted' },
          ipHash: await addressHash(runtime, c.env, c.req.raw),
        })
        return c.redirect(`${origin}/?auth=denied`, 302)
      }
      if (error instanceof AuthError) return c.json({ error: error.message }, error.status as 400)
      return c.json({ error: 'sign-in failed' }, 502)
    }
  })

  /**
   * Who you are, and what this instance will let you do.
   *
   * The client reads this to hide or disable controls — a courtesy, never the enforcement. The
   * server asks its own questions on every request and never trusts a value that came from here.
   */
  auth.get('/session', async (c) => {
    const db = runtime.database(c.env)
    if (!db) {
      return c.json({ user: null, instanceRole: null, workspaces: [], access: 'closed', dev: false, live: 'poll' })
    }

    const token = getCookie(c, sessionCookie(c.env, c.req.raw).name)
    const user = token ? await userForToken(db, token) : undefined
    if (!user) {
      return c.json({
        user: null,
        instanceRole: null,
        workspaces: [],
        access: (await settings(db)).access,
        dev: devAuth(c.env),
        live: runtime.live ? 'socket' : 'poll',
      })
    }

    // The same door every request goes through (task 122.2): the workspace this person may open, and
    // the effective role — direct or through an active group. The payload says it so the interface
    // can enable or hide a control; the server decides again on every request.
    //
    // No workspace is invented for an instance administrator when none exists: after a workspace is
    // deleted, the honest answer is that there is nothing to open.
    const resolved = await resolveWorkspace(db, user.id, user.instanceRole === 'admin', undefined)
    const workspaces = resolved ? [{ id: resolved.id, role: resolved.role }] : []

    return c.json({
      user: { id: user.id, name: user.name, email: user.email },
      instanceRole: user.instanceRole,
      workspaces,
      access: (await settings(db)).access,
      dev: devAuth(c.env),
      // Which transport to open: the socket where the deployment has one, the poll where it does
      // not. The client falls back to polling anyway, so this is a hint rather than a promise.
      live: runtime.live ? 'socket' : 'poll',
    })
  })

  auth.post('/signout', async (c) => {
    const db = runtime.database(c.env)
    const cookie = sessionCookie(c.env, c.req.raw)
    const token = getCookie(c, cookie.name)
    if (db && token) {
      const leaving = await userForToken(db, token)
      await revoke(db, token)
      if (leaving) {
        await record(db, { actorId: leaving.id, action: 'signout', ipHash: await addressHash(runtime, c.env, c.req.raw) })
      }
    }
    deleteCookie(c, cookie.name, { path: '/' })
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

    const body = (await c.req.json().catch(() => null)) as {
      email?: unknown
      name?: unknown
      invite?: unknown
      remember?: unknown
    } | null
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!email.includes('@')) return c.json({ error: 'an address is required' }, 400)

    // A provider would tell us the person's name; the switch has only an address, so it makes a
    // plausible one from it — `maya.blake@…` becomes `Maya Blake` rather than `maya.blake`.
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : humanise(email.split('@')[0])
    const ipHash = await addressHash(runtime, c.env, c.req.raw)
    let user
    try {
      const invite = typeof body?.invite === 'string' ? body.invite : undefined
      user = await identify(db, c.env, 'dev', { subject: email, email, emailVerified: true, name }, invite)
    } catch (error) {
      if (error instanceof NotAdmitted) {
        // The development door records a refusal like any other door.
        await record(db, {
          action: 'signin.refused',
          targetType: 'provider',
          targetId: 'dev',
          data: { reason: 'not admitted' },
          ipHash,
        })
        return c.json({ error: 'this instance is closed' }, 403)
      }
      throw error
    }
    const session = await issueSession(db, user.id, {
      userAgent: c.req.header('user-agent'),
      ipHash,
      // The same question a provider's sign-in is asked, and answered the same way.
      remember: body?.remember === true,
    })
    await record(db, { actorId: user.id, action: 'signin', targetType: 'provider', targetId: 'dev', ipHash })

    const cookie = sessionCookie(c.env, c.req.raw)
    setCookie(c, cookie.name, session.token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: session.maxAge,
      secure: cookie.secure,
    })
    return c.json({ user })
  })

  return auth
}
