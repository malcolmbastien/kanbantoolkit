/**
 * Accounts, from the browser's side.
 *
 * Every call here fails soft. An instance with no server is the static tier, and a board that works
 * offline must not grow a broken sign-in because the API is not there — so "no answer" means "no
 * accounts", which is exactly how the app behaved before task 117.
 */

import { create } from 'zustand'

export interface AuthProvider {
  id: string
  label: string
}

export interface AuthUser {
  id: string
  name: string
  email: string
  /** What they may do in this workspace: viewer | editor | admin. */
  role: string
  /** Whether they may sign in here at all: admin | member. */
  instanceRole: string
}

export interface AuthState {
  providers: AuthProvider[]
  user: AuthUser | null
  /** Whether this instance lets anybody in, or only the people it invited. */
  access: 'open' | 'closed'
  /** Which transport the live feed uses here: a socket where the deployment has one, else polling. */
  live: 'socket' | 'poll'
  dev: boolean
  /** Whether this instance has been asked what it offers. Until it has, nothing is drawn. */
  loaded: boolean
}

const NONE: AuthState = { providers: [], user: null, access: 'closed', live: 'poll', dev: false, loaded: false }

/**
 * Who this instance says you are, in one place.
 *
 * The write path reads it rather than the account control owning it: whether a change is sent is a
 * fact about the session, not about a component.
 */
export const useAuth = create<AuthState>(() => NONE)

async function read<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, { headers: { accept: 'application/json' } })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

export async function loadAuth(): Promise<AuthState> {
  const offered = await read<{ providers?: AuthProvider[]; dev?: boolean }>('/api/auth/providers')
  if (!offered?.providers) return NONE

  const session = await read<{
    user: { id: string; name: string; email: string; avatarUrl?: string } | null
    instanceRole: string | null
    workspaces: Array<{ id: string; role: string }>
    access?: string
    live?: string
  }>('/api/auth/session')

  const next: AuthState = {
    providers: offered.providers,
    access: session?.access === 'open' ? 'open' : 'closed',
    live: session?.live === 'socket' ? 'socket' : 'poll',
    user: session?.user
      ? {
          ...session.user,
          instanceRole: session.instanceRole ?? 'member',
          // The role in the workspace this instance has. Data for the interface; the server decides.
          role: session.workspaces[0]?.role ?? 'viewer',
        }
      : null,
    dev: offered.dev === true,
    loaded: true,
  }
  useAuth.setState(next)
  return next
}

/**
 * The invitation this page was opened with, if it was opened with one.
 *
 * Read once, at load, because the address bar is rewritten to the current view a moment after the
 * app starts — and a link that works only until the URL settles is a link that fails for the person
 * who clicked it.
 */
const INVITE =
  typeof window === 'undefined' ? undefined : (new URLSearchParams(window.location.search).get('invite') ?? undefined)

function inviteToken(): string | undefined {
  return INVITE
}

/**
 * Leaving for the provider, and coming back to the place that asked — carrying the link, if any,
 * and the choice of how long this browser should stay signed in.
 */
export function startSignIn(provider: string, remember = false): void {
  const next = window.location.pathname + window.location.search
  const invite = inviteToken()
  window.location.assign(
    `/api/auth/start?provider=${encodeURIComponent(provider)}&next=${encodeURIComponent(next)}` +
      (invite ? `&invite=${encodeURIComponent(invite)}` : '') +
      (remember ? '&remember=1' : ''),
  )
}

export async function signOut(): Promise<void> {
  try {
    await fetch('/api/auth/signout', { method: 'POST' })
  } catch {
    // A server that is not there holds no session to end.
  }
  useAuth.setState({ user: null })
}

/** The development identity switch, for the tests and for an instance with no provider yet. */
export async function devSignIn(email: string, name?: string, remember = false): Promise<AuthUser | null> {
  try {
    const response = await fetch('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        name,
        ...(inviteToken() ? { invite: inviteToken() } : {}),
        ...(remember ? { remember: true } : {}),
      }),
    })
    if (!response.ok) return null
    return ((await response.json()) as { user: AuthUser }).user
  } catch {
    return null
  }
}
