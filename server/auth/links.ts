/**
 * A link that signs you in, and a link that lets you set a password (task 154.7).
 *
 * One mechanism, two intentions. The token is random, single-use, good for fifteen minutes, and
 * stored **hashed** — the table never holds a working link, exactly as the session table never holds a
 * working session.
 *
 * The row holds an address rather than a user id on purpose: the account is looked up when the link
 * is used, so a link minted for somebody who has since been removed simply finds nothing.
 */

import type { Database } from '../db'
import { randomToken, sha256 } from './oauth'

export type Purpose = 'signin' | 'reset'

/** How long a link lives. Long enough to switch to a mail client, short enough to be uninteresting. */
export const LINK_MINUTES = 15

export interface Minted {
  token: string
  expiresAt: string
}

/**
 * Mint a link for an address.
 *
 * Expired rows are swept here rather than by a job: an instance has no scheduler, and the moment
 * somebody asks for a link is the moment the table is worth tidying.
 */
export async function mintLink(db: Database, email: string, purpose: Purpose, ipHash?: string): Promise<Minted> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + LINK_MINUTES * 60_000).toISOString()
  const token = randomToken(32)

  await db.run('DELETE FROM magic_links WHERE expires_at < ?1', [now.toISOString()])
  await db.run(
    'INSERT INTO magic_links (id, email, token_hash, purpose, expires_at, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    [`ml_${randomToken(9)}`, email.trim().toLowerCase(), await sha256(token), purpose, expiresAt, ipHash ?? null],
  )

  return { token, expiresAt }
}

/**
 * Spend a link, or nothing.
 *
 * A used one, an expired one and a made-up one are the same answer — `undefined` — because the caller
 * turns that into one sentence and the difference between them is what a guesser would like to learn.
 */
export async function consumeLink(db: Database, token: string): Promise<{ email: string; purpose: Purpose } | undefined> {
  const hash = await sha256(token)
  const row = await db.get<{ email: string; purpose: Purpose; expires_at: string; used_at: string | null }>(
    'SELECT email, purpose, expires_at, used_at FROM magic_links WHERE token_hash = ?1',
    [hash],
  )
  if (!row || row.used_at || row.expires_at < new Date().toISOString()) return undefined

  // The update is the claim: two requests racing for one link cannot both see `used_at` as null.
  const claimed = await db.run('UPDATE magic_links SET used_at = ?1 WHERE token_hash = ?2 AND used_at IS NULL', [
    new Date().toISOString(),
    hash,
  ])
  if (!claimed.changes) return undefined

  return { email: row.email, purpose: row.purpose }
}
