/**
 * Sessions: the credential that survives a reload and ends on sign-out.
 *
 * The token lives in an HttpOnly cookie; the table holds only its SHA-256, so a copy of the database
 * is not a set of working sessions. `SameSite=Lax` is enough because the callback is a top-level
 * navigation, and it keeps the credential off cross-site requests.
 */

import type { Database } from '../db'
import { randomToken, sha256 } from './oauth'

export const SESSION_COOKIE = 'fl_session'
/** Thirty days: long enough for a tool used daily, short enough to end on its own. */
export const SESSION_DAYS = 30

export interface AuthUser {
  id: string
  name: string
  email: string
  role: string
}

const USER_QUERY = `SELECT u.id, u.name, u.email, COALESCE(m.role, 'member') AS role
  FROM users u LEFT JOIN members m ON m.user_id = u.id WHERE u.id = ?1`

export async function userById(db: Database, id: string): Promise<AuthUser | undefined> {
  return db.get<AuthUser>(USER_QUERY, [id])
}

export async function issueSession(db: Database, userId: string): Promise<{ token: string; maxAge: number }> {
  const token = randomToken()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString()
  await db.run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?1, ?2, ?3)', [
    await sha256(token),
    userId,
    expiresAt,
  ])
  return { token, maxAge: SESSION_DAYS * 86_400 }
}

export async function userForToken(db: Database, token: string): Promise<AuthUser | undefined> {
  const id = await sha256(token)
  const session = await db.get<{ user_id: string; expires_at: string }>(
    'SELECT user_id, expires_at FROM sessions WHERE id = ?1',
    [id],
  )
  if (!session) return undefined

  if (session.expires_at <= new Date().toISOString()) {
    await db.run('DELETE FROM sessions WHERE id = ?1', [id])
    return undefined
  }
  return userById(db, session.user_id)
}

export async function revoke(db: Database, token: string): Promise<void> {
  await db.run('DELETE FROM sessions WHERE id = ?1', [await sha256(token)])
}
