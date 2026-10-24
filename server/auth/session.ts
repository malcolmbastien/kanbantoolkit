/**
 * Sessions: the credential that survives a reload and ends on sign-out.
 *
 * The token lives in an HttpOnly cookie; the table holds only its SHA-256, so a copy of the database
 * is not a set of working sessions. `SameSite=Lax` is enough because the callback is a top-level
 * navigation, and it keeps the credential off cross-site requests.
 *
 * Two lifetimes, and the difference is asked for rather than imposed: twelve hours by default — a
 * work tool on a shared machine should not stay open until somebody remembers to close it — and
 * thirty days when the sign-in said it was the person's own browser. The choice is stored on the
 * row, because a remembered session and a default one sit beside each other in the same list and
 * must expire when each said it would.
 *
 * A session is *revoked*, not deleted. A row that disappears cannot be shown, and "sign out
 * everywhere" is a list somebody reads; only rows older than the audit window are pruned, and then
 * lazily, on the next listing.
 */

import type { Database } from '../db'
import { httpsConfigured } from '../config'
import { randomToken, sha256 } from './oauth'

export const SESSION_COOKIE = 'fl_session'
/** Twelve hours: a working day, not a working month. */
export const SESSION_HOURS = 12
/** Thirty days, when the browser was told to remember. */
export const REMEMBERED_DAYS = 30

/** How stale `last_seen_at` may be before it is worth a write — the R3 promise, in one number. */
export const TOUCH_MS = 60 * 60_000

/** Revoked and expired rows are kept this long, so the trail can still explain a sign-out. */
const KEEP_DAYS = 90

export interface AuthUser {
  id: string
  name: string
  email: string
  /** What they may do in this workspace: viewer | editor | admin. */
  role: string
  /** Whether they may sign in here at all: admin | member. */
  instanceRole: string
}

// The two axes, read together: the door from `instance_members`, the authority from
// `workspace_members`. The workspace id is the settings row's until 122.1 gives it a table.
export const WORKSPACE_ID = 'workspace'

const USER_QUERY = `SELECT u.id, u.name, u.email,
    COALESCE(w.role, 'viewer') AS role,
    COALESCE(i.role, 'member') AS instanceRole
  FROM users u
  LEFT JOIN instance_members i ON i.user_id = u.id
  LEFT JOIN workspace_members w ON w.user_id = u.id AND w.workspace_id = '${WORKSPACE_ID}'
  WHERE u.id = ?1`

export async function userById(db: Database, id: string): Promise<AuthUser | undefined> {
  return db.get<AuthUser>(USER_QUERY, [id])
}

/**
 * The cookie a session travels in.
 *
 * In production the name is `__Host-fl_session`: the prefix is a promise the browser then enforces
 * — Secure, `Path=/`, no Domain — which is exactly the shape this cookie needs. Development keeps
 * the plain name, because `__Host-` cannot travel over http and a local instance is an http one.
 *
 * "Production" is `PUBLIC_URL` being https, not the request: behind a proxy the request arrives as
 * http while the browser is on https, and the cookie must still be issued Secure (R6).
 */
export function sessionCookieName(env: unknown, url: string): string {
  const https = httpsConfigured(env) || url.toLowerCase().startsWith('https:')
  return https ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE
}

export function sessionCookie(env: unknown, request: Request): { name: string; secure: boolean } {
  const name = sessionCookieName(env, request.url)
  return { name, secure: name !== SESSION_COOKIE }
}

export interface IssuedSession {
  token: string
  /** Seconds, for the cookie. */
  maxAge: number
}

export async function issueSession(
  db: Database,
  userId: string,
  details: { userAgent?: string; ipHash?: string; remember?: boolean } = {},
): Promise<IssuedSession> {
  const token = randomToken()
  const now = Date.now()
  const lifetime = details.remember ? REMEMBERED_DAYS * 86_400_000 : SESSION_HOURS * 3_600_000
  await db.run(
    `INSERT INTO sessions (id, public_id, user_id, expires_at, user_agent, ip_hash, last_seen_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    [
      await sha256(token),
      randomToken(9),
      userId,
      new Date(now + lifetime).toISOString(),
      details.userAgent ?? null,
      details.ipHash ?? null,
      new Date(now).toISOString(),
    ],
  )
  return { token, maxAge: Math.floor(lifetime / 1000) }
}

export async function userForToken(db: Database, token: string): Promise<AuthUser | undefined> {
  const id = await sha256(token)
  const session = await db.get<{ user_id: string; expires_at: string; revoked_at: string | null; last_seen_at: string | null }>(
    'SELECT user_id, expires_at, revoked_at, last_seen_at FROM sessions WHERE id = ?1',
    [id],
  )
  if (!session) return undefined

  const now = new Date()
  // A revoked session is gone as a credential but kept as a record: somebody has to be able to see
  // that it existed, and "sign out everywhere" is a list rather than a deletion.
  if (session.revoked_at) return undefined
  if (session.expires_at <= now.toISOString()) return undefined

  // Written at most hourly: a poll every two seconds must not be a write every two.
  if (!session.last_seen_at || now.getTime() - Date.parse(session.last_seen_at) > TOUCH_MS) {
    await db.run('UPDATE sessions SET last_seen_at = ?1 WHERE id = ?2', [now.toISOString(), id])
  }

  return userById(db, session.user_id)
}

export async function revoke(db: Database, token: string): Promise<void> {
  await db.run('UPDATE sessions SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL', [
    new Date().toISOString(),
    await sha256(token),
  ])
}

export interface SessionRecord {
  /** The public name of the session — never the row id, which is the token's fingerprint. */
  id: string
  userAgent: string | null
  createdAt: string
  lastSeenAt: string | null
  expiresAt: string
}

/** A live session: not revoked, not expired. Expired rows are somebody else's bookkeeping. */
export async function sessionsOf(db: Database, userId: string): Promise<SessionRecord[]> {
  const rows = await db.all<{
    public_id: string
    user_agent: string | null
    created_at: string
    last_seen_at: string | null
    expires_at: string
  }>(
    `SELECT public_id, user_agent, created_at, last_seen_at, expires_at
       FROM sessions
      WHERE user_id = ?1 AND revoked_at IS NULL AND expires_at > ?2
      ORDER BY last_seen_at DESC, created_at DESC`,
    [userId, new Date().toISOString()],
  )
  return rows.map((row) => ({
    id: row.public_id,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
  }))
}

/**
 * Revoke one of *this person's* sessions, named by its public id.
 *
 * The answer is a count, and it is allowed to be zero: a session id belonging to somebody else
 * finds nothing, which is exactly what the caller is told (a 404, not a refusal that would confirm
 * the id exists).
 */
export async function revokeSessionById(db: Database, userId: string, publicId: string): Promise<number> {
  const result = await db.run(
    'UPDATE sessions SET revoked_at = ?1 WHERE user_id = ?2 AND public_id = ?3 AND revoked_at IS NULL',
    [new Date().toISOString(), userId, publicId],
  )
  return result.changes
}

/** Every live session this person holds. The answer is how many ended. */
export async function revokeAllFor(db: Database, userId: string): Promise<number> {
  const result = await db.run('UPDATE sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL', [
    new Date().toISOString(),
    userId,
  ])
  return result.changes
}

/** The row id (the token hash) a token names, for comparing a caller to a list. */
export async function sessionIdOf(token: string | undefined): Promise<string | undefined> {
  return token ? sha256(token) : undefined
}

/**
 * Forget rows nobody can use any more, once they are older than the audit window.
 *
 * Revoked and expired rows are kept so a list can explain itself ("signed out on Tuesday") and so
 * an audit entry points at something. Past ninety days they explain nothing, and they are removed
 * lazily — on a listing, rather than by a job an instance would have to run.
 */
export async function pruneSessions(db: Database): Promise<void> {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString()
  await db.run('DELETE FROM sessions WHERE COALESCE(revoked_at, expires_at) < ?1', [cutoff])
}

/**
 * What a person sees in the list: not a user-agent string — "Mozilla/5.0 (Macintosh; Intel Mac OS
 * X 14_5) AppleWebKit/537.36…" is a hundred characters that answer nothing — but "Chrome on macOS".
 *
 * Only the pairs that matter, and one honest fallback. A browser this does not recognise is
 * "Unknown browser", because inventing a name is worse than admitting the limit.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ''
  if (!ua) return 'Unknown device'

  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Unknown browser'

  const system = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : undefined

  return system ? `${browser} on ${system}` : browser
}
