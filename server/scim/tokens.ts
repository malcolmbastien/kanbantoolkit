/**
 * The credential an identity provider calls with (task 168).
 *
 * It is deliberately *not* an `api_tokens` row. That table belongs to a person: its scopes are
 * checked against their role, and its writes are audited under their name. A SCIM token belongs to no
 * one — the directory acts — and what it may do is fixed and small: provision people and membership,
 * never read a board, never administer the instance.
 *
 * It carries one decision: the **workspace role** a provisioned person gets. An administrator chooses
 * it when minting (editor unless they said otherwise), and it is a workspace role only, because a
 * directory may make somebody an editor of this team and may not make them the administrator of the
 * deployment.
 *
 * Hashed at rest and shown once, exactly like a session: the same rule, the same reason.
 */

import type { Role } from '../../src/domain/roles'
import { TOUCH_MS } from '../auth/session'
import { randomToken, sha256 } from '../auth/oauth'
import type { Database } from '../db'

/** Recognisable in a log, so a leak can be found and a redaction written. */
export const SCIM_PREFIX = 'fls_'

export const SCIM_ROLES: readonly Role[] = ['viewer', 'editor', 'admin']

export interface ScimTokenRow {
  id: string
  name: string
  token_hash: string
  default_role: Role
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
  minted_by: string | null
}

/** What a screen sees. Never the hash, never the secret. */
export interface PublicScimToken {
  id: string
  name: string
  defaultRole: Role
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export const publicScimToken = (row: ScimTokenRow): PublicScimToken => ({
  id: row.id,
  name: row.name,
  defaultRole: row.default_role,
  lastUsedAt: row.last_used_at,
  revokedAt: row.revoked_at,
  createdAt: row.created_at,
})

/** Mint, and answer the secret exactly once. */
export async function mintScimToken(
  db: Database,
  input: { name: string; defaultRole: Role; mintedBy: string },
): Promise<{ secret: string; token: ScimTokenRow }> {
  const secret = `${SCIM_PREFIX}${randomToken(32)}`
  const token: ScimTokenRow = {
    id: `sct_${randomToken(9)}`,
    name: input.name,
    token_hash: await sha256(secret),
    default_role: input.defaultRole,
    last_used_at: null,
    revoked_at: null,
    created_at: new Date().toISOString(),
    minted_by: input.mintedBy,
  }
  await db.run(
    `INSERT INTO scim_tokens (id, name, token_hash, default_role, last_used_at, revoked_at, created_at, minted_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    [token.id, token.name, token.token_hash, token.default_role, token.last_used_at, token.revoked_at, token.created_at, token.minted_by],
  )
  return { secret, token }
}

export async function scimTokensOf(db: Database): Promise<ScimTokenRow[]> {
  return db.all<ScimTokenRow>('SELECT * FROM scim_tokens ORDER BY (revoked_at IS NULL), created_at DESC')
}

export async function revokeScimToken(db: Database, id: string): Promise<number> {
  const result = await db.run('UPDATE scim_tokens SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL', [
    new Date().toISOString(),
    id,
  ])
  return result.changes
}

/**
 * The token a bearer secret names, or nothing.
 *
 * A revoked token is "I do not know you" (401): it is not a person short of authority, it is a
 * credential that stopped existing. `last_used_at` is written at most hourly, the same courtesy a
 * session and an API token keep.
 */
export async function scimCallerForSecret(db: Database, secret: string): Promise<ScimTokenRow | undefined> {
  if (!secret.startsWith(SCIM_PREFIX)) return undefined
  const row = await db.get<ScimTokenRow>('SELECT * FROM scim_tokens WHERE token_hash = ?1', [await sha256(secret)])
  if (!row || row.revoked_at) return undefined

  const now = new Date()
  if (!row.last_used_at || now.getTime() - Date.parse(row.last_used_at) > TOUCH_MS) {
    await db.run('UPDATE scim_tokens SET last_used_at = ?1 WHERE id = ?2', [now.toISOString(), row.id])
  }
  return row
}
