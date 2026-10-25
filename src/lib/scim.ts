/**
 * The SCIM token, from the browser's side (task 168).
 *
 * Only an instance administrator sees this, and only an administrator may mint one: it is a door
 * into the deployment rather than into a board. The secret is answered once — the server keeps a
 * hash — so the panel shows it and says so.
 */

import type { Role } from '@/domain/roles'

export interface ScimToken {
  id: string
  name: string
  defaultRole: Role
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export type ScimMintAnswer = { ok: true; secret: string; token: ScimToken } | { ok: false; error: string }

export async function scimTokens(): Promise<ScimToken[]> {
  try {
    const response = await fetch('/api/admin/scim/tokens', { headers: { accept: 'application/json' } })
    if (!response.ok) return []
    return ((await response.json()) as { tokens: ScimToken[] }).tokens
  } catch {
    return []
  }
}

export async function mintScim(name: string, defaultRole: Role): Promise<ScimMintAnswer> {
  try {
    const response = await fetch('/api/admin/scim/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, defaultRole }),
    })
    const body = (await response.json().catch(() => ({}))) as { secret?: string; token?: ScimToken; error?: string }
    if (!response.ok || !body.secret || !body.token) {
      return { ok: false, error: body.error ?? 'the token could not be made' }
    }
    return { ok: true, secret: body.secret, token: body.token }
  } catch {
    return { ok: false, error: 'the server could not be reached' }
  }
}

export async function revokeScim(id: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/admin/scim/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return response.ok
  } catch {
    return false
  }
}
