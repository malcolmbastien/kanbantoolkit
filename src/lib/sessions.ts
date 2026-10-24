/**
 * Where a person is signed in — the list, and the ways out of it.
 *
 * Kept beside `auth.ts` rather than in it: signing in is part of the app's first paint, and a
 * profile dialog is not. Only the profile imports this, so only the profile carries it.
 */

import { useAuth } from './auth'

/** One of this person's sessions, as the server describes it. */
export interface SessionInfo {
  /** The session's public name — never the token's fingerprint. */
  id: string
  device: string
  createdAt: string
  lastSeenAt?: string
  expiresAt: string
  /** Whether this is the browser reading the list. */
  current: boolean
}

/** Where this person is signed in. Empty when there is no server, like everything else here. */
export async function mySessions(): Promise<SessionInfo[]> {
  try {
    const response = await fetch('/api/me/sessions', { headers: { accept: 'application/json' } })
    if (!response.ok) return []
    return ((await response.json()) as { sessions: SessionInfo[] }).sessions
  } catch {
    return []
  }
}

/** End one session. `false` when the server could not be asked. */
export async function revokeSession(id: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return response.ok
  } catch {
    return false
  }
}

/**
 * End every session, this one included. The local state is cleared only when the server agreed —
 * a sign-out that silently failed would leave a browser presenting a credential it thinks is gone.
 */
export async function signOutEverywhere(): Promise<boolean> {
  try {
    const response = await fetch('/api/me/signout-everywhere', { method: 'POST' })
    if (!response.ok) return false
  } catch {
    return false
  }
  useAuth.setState({ user: null })
  return true
}
