/**
 * Machine credentials (task 148).
 *
 * A token is a **bearer** credential: whoever holds it is the person it was minted for, until it is
 * revoked or expires. Three consequences, and all three are promises of this file:
 *
 * - the secret is shown once and stored as SHA-256, so a database read is not a set of working
 *   credentials (R1). There is no route anywhere that returns it a second time;
 * - it carries **scopes**, never a role: the role is read from `workspace_members` on every request,
 *   so a demotion tightens every token its owner holds (`access.ts` asks both questions);
 * - it is expiring and revocable, and the row is kept after either — an expired credential is
 *   history somebody may need to read, not a row to forget.
 *
 * `last_used_at` is written at most hourly, like a session's `last_seen_at`: a tool polling every two
 * seconds must not be a write every two seconds. That granularity is the honest one for the question
 * the list screen answers ("is anything still using this?"), and it is the same TOUCH_MS the session
 * table keeps.
 */

import { isScope, type Scope } from '../src/domain/scopes'
import { randomToken, sha256 } from './auth/oauth'
import { TOUCH_MS, userById } from './auth/session'
import type { AuthUser } from './auth/session'
import type { Database } from './db'

/**
 * The prefix is a courtesy to every log, proxy and secret scanner on the way: a value beginning
 * `flt_` is recognisably a Flowline token, so a leak can be found and a redaction can be written.
 */
export const TOKEN_PREFIX = 'flt_'

/** R3: ninety days unless the person minting it chose otherwise. */
export const DEFAULT_DAYS = 90

/** A device code lives ten minutes: long enough to read a screen, short enough to be useless later. */
export const DEVICE_MINUTES = 10

export type Origin = 'self' | 'admin' | 'device'

export interface TokenRow {
  id: string
  user_id: string
  name: string
  scopes: string
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
  origin: Origin
  minted_by: string | null
}

/** What the API answers with. Never the hash, never the secret. */
export interface PublicToken {
  id: string
  name: string
  scopes: Scope[]
  origin: Origin
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
  revokedAt: string | null
}

const now = () => new Date().toISOString()

export function expiryFrom(days: number | null | undefined): string | null {
  if (days === null) return null
  const span = days ?? DEFAULT_DAYS
  return new Date(Date.now() + span * 86_400_000).toISOString()
}

/** The scopes a row may hold: only the closed vocabulary, once each, in a stable order. */
export function parseScopes(text: string | null | undefined): Scope[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return [...new Set(parsed.filter(isScope))]
}

export function publicToken(row: TokenRow): PublicToken {
  return {
    id: row.id,
    name: row.name,
    scopes: parseScopes(row.scopes),
    origin: row.origin,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }
}

export interface MintInput {
  userId: string
  name: string
  scopes: readonly Scope[]
  /** Days until it expires; `null` means never. */
  expiresInDays?: number | null
  origin?: Origin
  mintedBy?: string
}

/**
 * Mint, and answer the secret exactly once.
 *
 * Validation of *who may hold what* is the caller's (it needs the person's role, which this module
 * does not fetch); the row itself is written here so the hash, the prefix and the expiry arithmetic
 * exist in one place.
 */
export async function mintToken(
  db: Database,
  input: MintInput,
): Promise<{ secret: string; token: TokenRow }> {
  const secret = `${TOKEN_PREFIX}${randomToken(32)}`
  const token: TokenRow = {
    id: `tok_${randomToken(12)}`,
    user_id: input.userId,
    name: input.name,
    scopes: JSON.stringify([...new Set(input.scopes)]),
    expires_at: expiryFrom(input.expiresInDays),
    last_used_at: null,
    revoked_at: null,
    created_at: now(),
    origin: input.origin ?? 'self',
    minted_by: input.mintedBy ?? input.userId,
  }

  await db.run(
    `INSERT INTO api_tokens (id, user_id, name, token_hash, scopes, expires_at, last_used_at, revoked_at, created_at, origin, minted_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    [
      token.id,
      token.user_id,
      token.name,
      await sha256(secret),
      token.scopes,
      token.expires_at,
      token.last_used_at,
      token.revoked_at,
      token.created_at,
      token.origin,
      token.minted_by,
    ],
  )

  return { secret, token }
}

/** This person's tokens, live first, newest first. Revoked and expired rows stay, marked. */
export async function tokensOf(db: Database, userId: string): Promise<TokenRow[]> {
  return db.all<TokenRow>(
    `SELECT * FROM api_tokens
      WHERE user_id = ?1
      ORDER BY (revoked_at IS NULL), created_at DESC`,
    [userId],
  )
}

/**
 * The caller a bearer secret names, or nothing.
 *
 * `expires_at <= now` and `revoked_at` are the two ways a token stops being a credential, and both
 * answer "I do not know you" (401) rather than "you may not" (403): an expired token is not a person
 * with insufficient authority.
 */
export async function callerForSecret(
  db: Database,
  secret: string,
): Promise<{ tokenId: string; user: AuthUser; scopes: Scope[] } | undefined> {
  if (!secret.startsWith(TOKEN_PREFIX)) return undefined

  const row = await db.get<TokenRow>('SELECT * FROM api_tokens WHERE token_hash = ?1', [await sha256(secret)])
  if (!row) return undefined
  if (row.revoked_at) return undefined

  const at = now()
  if (row.expires_at && row.expires_at <= at) return undefined

  const user = await userById(db, row.user_id)
  if (!user) return undefined

  // Written at most hourly (R4): a poll every two seconds must not be a write every two.
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > TOUCH_MS) {
    await db.run('UPDATE api_tokens SET last_used_at = ?1 WHERE id = ?2', [at, row.id])
  }

  return { tokenId: row.id, user, scopes: parseScopes(row.scopes) }
}

/**
 * Revoke one token. Zero means "no live token with that id" — for this owner when `userId` is given,
 * for anybody when it is not (the administrator's route, R5).
 */
export async function revokeToken(db: Database, id: string, userId?: string): Promise<number> {
  const result = userId
    ? await db.run('UPDATE api_tokens SET revoked_at = ?1 WHERE id = ?2 AND user_id = ?3 AND revoked_at IS NULL', [
        now(),
        id,
        userId,
      ])
    : await db.run('UPDATE api_tokens SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL', [now(), id])
  return result.changes
}
