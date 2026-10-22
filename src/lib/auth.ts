/**
 * Accounts, from the browser's side.
 *
 * Every call here fails soft. An instance with no server is the static tier, and a board that works
 * offline must not grow a broken sign-in because the API is not there — so "no answer" means "no
 * accounts", which is exactly how the app behaved before task 117.
 */

export interface AuthProvider {
  id: string
  label: string
}

export interface AuthUser {
  id: string
  name: string
  email: string
  role: string
}

export interface AuthState {
  providers: AuthProvider[]
  user: AuthUser | null
  dev: boolean
}

const NONE: AuthState = { providers: [], user: null, dev: false }

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

  const session = await read<{ user: AuthUser | null }>('/api/auth/session')
  return { providers: offered.providers, user: session?.user ?? null, dev: offered.dev === true }
}

/** Leaving for the provider, and coming back to the place that asked. */
export function startSignIn(provider: string): void {
  const next = window.location.pathname + window.location.search
  window.location.assign(
    `/api/auth/start?provider=${encodeURIComponent(provider)}&next=${encodeURIComponent(next)}`,
  )
}

export async function signOut(): Promise<void> {
  try {
    await fetch('/api/auth/signout', { method: 'POST' })
  } catch {
    // A server that is not there holds no session to end.
  }
}

/** The development identity switch, for the tests and for an instance with no provider yet. */
export async function devSignIn(email: string, name?: string): Promise<AuthUser | null> {
  try {
    const response = await fetch('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name }),
    })
    if (!response.ok) return null
    return ((await response.json()) as { user: AuthUser }).user
  } catch {
    return null
  }
}
