/**
 * Invitations: a link somebody hands over, which works once.
 *
 * The table holds the SHA-256 of the token and never the token itself, so a copy of the database is
 * not a set of working invitations. The plaintext is returned exactly once — from the create call —
 * and then exists only in whatever the administrator does with it.
 *
 * Hashing before lookup is also what makes the comparison constant-time in the only sense that
 * matters here: the time a lookup takes does not depend on how close a guess was to the token.
 */

import type { Database, Statement } from './db'
import { randomToken, sha256 } from './auth/oauth'
import type { Role } from '../src/domain/roles'

export interface Invite {
  id: string
  email: string
  /** The name the inviter gave, if any. The invitee's own name wins when they give one. */
  name: string | null
  role: Role
  invited_by: string | null
  created_at: string
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
}

export type InviteState = 'valid' | 'used' | 'expired' | 'revoked'

/** Fourteen days: long enough for a holiday, short enough that a forwarded link dies. */
export const INVITE_DAYS = 14

export function stateOf(invite: Invite, now = new Date()): InviteState {
  if (invite.accepted_at) return 'used'
  if (invite.revoked_at) return 'revoked'
  if (invite.expires_at <= now.toISOString()) return 'expired'
  return 'valid'
}

/** `ada@example.com` → `a**@example.com`: enough to recognise, not enough to leak. */
export function mask(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(2, local.length - 1))}@${domain}`
}

const COLUMNS = 'id, email, name, role, invited_by, created_at, expires_at, accepted_at, revoked_at'

export async function byToken(db: Database, token: string): Promise<Invite | undefined> {
  if (!token) return undefined
  return db.get<Invite>(`SELECT ${COLUMNS} FROM invites WHERE token_hash = ?1`, [await sha256(token)])
}

export async function byId(db: Database, id: string): Promise<Invite | undefined> {
  return db.get<Invite>(`SELECT ${COLUMNS} FROM invites WHERE id = ?1`, [id])
}

export async function pending(db: Database): Promise<Invite[]> {
  return db.all<Invite>(`SELECT ${COLUMNS} FROM invites ORDER BY created_at DESC LIMIT 200`)
}

/** Is there already a live invitation for this address? One live token per address, not two. */
export async function liveFor(db: Database, email: string, now = new Date()): Promise<Invite | undefined> {
  return db.get<Invite>(
    `SELECT ${COLUMNS} FROM invites
     WHERE email = ?1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?2
     ORDER BY created_at DESC LIMIT 1`,
    [email, now.toISOString()],
  )
}

/**
 * Mint one. Returns the plaintext token — the only time it exists — and leaves the hash in the row.
 */
export async function createInvite(
  db: Database,
  input: {
    email: string
    /** The person's name, when the administrator knows it. Optional, and never required. */
    name?: string
    role: Role
    invitedBy: string
    days?: number
    now?: Date
    scope?: 'instance' | 'workspace'
    audit?: (id: string) => Statement
  },
): Promise<{ invite: Invite; token: string }> {
  const now = input.now ?? new Date()
  const token = randomToken(32)
  const id = `inv_${randomToken(9)}`
  const days = Math.min(Math.max(input.days ?? INVITE_DAYS, 1), 90)
  const name = input.name?.trim().slice(0, 120) || null

  const insert = {
    sql: `INSERT INTO invites (id, email, name, role, token_hash, invited_by, expires_at, scope) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    params: [
      id,
      input.email.trim().toLowerCase(),
      name,
      input.role,
      await sha256(token),
      input.invitedBy,
      new Date(now.getTime() + days * 86_400_000).toISOString(),
      input.scope ?? 'instance',
    ],
  }
  const auditRow = input.audit?.(id)
  await db.batch(auditRow ? [insert, auditRow] : [insert])

  const invite = await byId(db, id)
  if (!invite) throw new Error('the invitation was written and could not be read back')
  return { invite, token }
}

/**
 * Mint a new token for the same invitation, and let the old one die.
 *
 * Replacing the hash is the whole of it: the previous link no longer matches anything, so a resend
 * is a new door and the old one is shut — no second row, no second live token for one address.
 */
export async function resendInvite(
  db: Database,
  id: string,
  now = new Date(),
  audit?: Statement,
): Promise<{ invite: Invite; token: string } | undefined> {
  const existing = await byId(db, id)
  if (!existing) return undefined

  const token = randomToken(32)
  const expires = new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString()
  const update = {
    sql: 'UPDATE invites SET token_hash = ?1, expires_at = ?2 WHERE id = ?3',
    params: [await sha256(token), expires, id],
  }
  await db.batch(audit ? [update, audit] : [update])

  const invite = await byId(db, id)
  return invite ? { invite, token } : undefined
}

export async function revokeInvite(db: Database, id: string, audit?: Statement): Promise<void> {
  const update = {
    sql: 'UPDATE invites SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL',
    params: [new Date().toISOString(), id],
  }
  await db.batch(audit ? [update, audit] : [update])
}
