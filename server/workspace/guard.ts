/**
 * Who may write to this workspace.
 *
 * Two answers, both of which have to be true: the request carries a session, and the person behind
 * it is a member of this instance. Reading and writing ask the same question, so they cannot drift
 * apart — and the refusal says which of the two failed rather than "no".
 */

import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { SESSION_COOKIE, userForToken } from '../auth/session'
import type { AuthUser } from '../auth/session'
import type { Database } from '../db'
import { schemaVersion } from '../migrate'
import type { Runtime } from '../runtime'
import { REQUIRED_SCHEMA } from './schema'

export interface Allowed {
  db: Database
  user: AuthUser
}

export async function guard(c: Context<{ Bindings: object }>, runtime: Runtime): Promise<Allowed | Response> {
  const db = runtime.database(c.env)
  if (!db) return c.json({ error: 'not configured' }, 503)

  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return c.json({ error: 'sign in to use this workspace' }, 401)

  const user = await userForToken(db, token)
  if (!user) return c.json({ error: 'sign in to use this workspace' }, 401)

  const member = await db.get('SELECT 1 AS member FROM members WHERE user_id = ?1', [user.id])
  if (!member) return c.json({ error: 'not a member of this workspace' }, 403)

  // A write into a database this code has not migrated would be a surprise later rather than now.
  // Reads are checked where they read (the full workspace), so the two-second change feed does not
  // pay for this on every poll.
  if (c.req.method !== 'GET' && (await schemaVersion(db)) < REQUIRED_SCHEMA) {
    return c.json({ error: 'this instance has not finished migrating' }, 503)
  }

  return { db, user }
}
