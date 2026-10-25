/**
 * Machine credentials, from the browser's side (task 148).
 *
 * Like every other call here it fails soft: an instance with no server has no tokens to mint, and a
 * profile dialog must not break because the API is the static tier. What it must never do is invent
 * a secret or swallow a refusal: a scope the person cannot hold comes back as the server's sentence,
 * and the screen shows it.
 */

import type { Role } from '@/domain/roles'
import { rolesScopes, type Scope } from '@/domain/scopes'

export interface TokenInfo {
  id: string
  name: string
  scopes: Scope[]
  /** How the credential arrived: the person, an administrator for them, or a device approval. */
  origin: 'self' | 'admin' | 'device'
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
  revokedAt: string | null
}

export interface MintRequest {
  name: string
  scopes: Scope[]
  /** Days; `null` is never. Omitted means the server's default (90). */
  expiresInDays?: number | null
}

export type MintAnswer = { ok: true; secret: string; token: TokenInfo } | { ok: false; error: string; scopes?: Scope[] }

/** The paths, once: the same shape with or without an owner in it. */
const paths = (userId?: string) =>
  userId
    ? {
        list: `/api/admin/users/${encodeURIComponent(userId)}/tokens`,
        revoke: (id: string) => `/api/admin/users/${encodeURIComponent(userId)}/tokens/${encodeURIComponent(id)}`,
      }
    : {
        list: '/api/tokens',
        revoke: (id: string) => `/api/tokens/${encodeURIComponent(id)}`,
      }

/** This person's tokens, or somebody else's when an administrator is looking (R5). */
export async function tokensFor(userId?: string): Promise<TokenInfo[]> {
  try {
    const response = await fetch(paths(userId).list, { headers: { accept: 'application/json' } })
    if (!response.ok) return []
    return ((await response.json()) as { tokens: TokenInfo[] }).tokens
  } catch {
    return []
  }
}

/** Mint. The answer's `secret` is the only time anybody will see it. */
export async function mintFor(userId: string | undefined, request: MintRequest): Promise<MintAnswer> {
  try {
    const response = await fetch(paths(userId).list, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    const body = (await response.json().catch(() => ({}))) as {
      secret?: string
      token?: TokenInfo
      error?: string
      scopes?: Scope[]
    }
    if (!response.ok || !body.secret || !body.token) {
      return { ok: false, error: body.error ?? 'the token could not be created', scopes: body.scopes }
    }
    return { ok: true, secret: body.secret, token: body.token }
  } catch {
    return { ok: false, error: 'the server could not be reached' }
  }
}

/** Revoke. `false` when the server refused or could not be asked — the row stays on screen. */
export async function revokeFor(userId: string | undefined, id: string): Promise<boolean> {
  try {
    const response = await fetch(paths(userId).revoke(id), { method: 'DELETE' })
    return response.ok
  } catch {
    return false
  }
}

/* ---- The device approval (R7, R10) ------------------------------------------------------- */

export interface Approval {
  name: string
  scopes: Scope[]
  approved: boolean
  /** The code's own expiry — minutes away. */
  expiresAt: string
  /** How long the credential will last, in days; `null` is never. */
  expiresInDays: number | null
  /** The scopes this person could not grant, so the screen can say so before the press. */
  refused: Scope[]
}

/** What a code is, before anybody approves anything. `undefined` when it is unknown or spent. */
export async function approvalOf(code: string): Promise<Approval | { error: string }> {
  try {
    const response = await fetch(`/api/tokens/device/${encodeURIComponent(code)}`, {
      headers: { accept: 'application/json' },
    })
    const body = (await response.json().catch(() => ({}))) as Approval & { error?: string }
    if (!response.ok) return { error: body.error ?? 'that code is not valid' }
    return body
  } catch {
    return { error: 'the server could not be reached' }
  }
}

/** Approve. `scopes` may narrow the request and never widen it. */
export async function approveDevice(code: string, scopes?: Scope[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch('/api/tokens/device/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_code: code, ...(scopes ? { scopes } : {}) }),
    })
    if (response.ok) return { ok: true }
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    return { ok: false, error: body.error ?? 'the approval was refused' }
  } catch {
    return { ok: false, error: 'the server could not be reached' }
  }
}

/** The scopes a mint form may offer: what this person could actually hold, at mint time. */
export function scopeChoices(role: string | undefined, instanceRole: string | undefined): Scope[] {
  return rolesScopes((role ?? 'viewer') as Role, instanceRole === 'admin' ? 'admin' : 'member')
}
