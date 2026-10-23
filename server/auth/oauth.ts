/**
 * OAuth 2.0, as much of it as this application needs.
 *
 * The flow is the authorisation code with PKCE, which is the one that does not put a secret in the
 * browser. The address comes from the provider's `userinfo` endpoint over TLS with the token that
 * endpoint issued to us, so no JavaScript Object Signing and Encryption library is needed and no
 * token is trusted without asking the provider what it means.
 *
 * Everything here uses Web Crypto and `fetch`, so it runs on Cloudflare and on Node unchanged.
 */

import type { Provider } from '../config'

/** An address the instance will not admit. Deliberately indistinguishable from an unknown one. */
export class NotAdmitted extends Error {
  constructor() {
    super('this instance is closed')
    this.name = 'NotAdmitted'
  }
}

export class AuthError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

const encoder = new TextEncoder()

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A value that cannot be guessed: state, a PKCE verifier, or a session token. */
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** SHA-256, hex. Used for the PKCE challenge's sibling jobs: session ids and address hashes. */
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The S256 challenge for a verifier — the only method worth offering. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier))
  return base64url(new Uint8Array(digest))
}

/** Where to send someone who has said which door they want to use. */
export function authorizeUrl(
  provider: Provider,
  input: { state: string; challenge: string; redirectUri: string },
): string {
  const url = new URL(provider.authorizeEndpoint)
  url.searchParams.set('client_id', provider.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', provider.scope)
  url.searchParams.set('state', input.state)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  // Choosing an account each time is what lets one browser hold two of them — which the tests that
  // matter (two people on one board) need.
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

export async function exchangeCode(
  provider: Provider,
  input: { code: string; verifier: string; redirectUri: string },
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code_verifier: input.verifier,
  })

  const response = await fetch(provider.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  })
  if (!response.ok) throw new AuthError('the provider refused the code')

  const token = (await response.json()) as { access_token?: unknown }
  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new AuthError('the provider returned no access token')
  }
  return token.access_token
}

export interface Profile {
  subject: string
  email: string
  emailVerified: boolean
  name: string
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Who the provider says this is. Microsoft sends a work address as `preferred_username` rather than
 * `email` for some tenants, so both are read; an address the provider will not vouch for is not
 * accepted at all, because it is what joins two doors to one person.
 */
export async function profile(provider: Provider, accessToken: string): Promise<Profile> {
  const response = await fetch(provider.userinfoEndpoint, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  })
  if (!response.ok) throw new AuthError('the provider did not say who this is')

  const raw = (await response.json()) as Record<string, unknown>
  const subject = text(raw.sub)
  const email = (text(raw.email) || text(raw.preferred_username)).toLowerCase()
  if (!subject) throw new AuthError('the provider named nobody')
  if (!email) throw new AuthError('the provider gave no address')

  return {
    subject,
    email,
    // Google says so explicitly; Microsoft's work accounts are tenant-verified and say nothing.
    // Only an explicit `false` is treated as unverified.
    emailVerified: raw.email_verified !== false,
    name: text(raw.name) || email,
  }
}
