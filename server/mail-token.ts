/**
 * The tokens a digest's links carry.
 *
 * An email is opened on a device that may not have a session, so a link has to name the person and
 * the act without being a bearer credential for anything else. A token is a signed statement —
 * `workspace`, `user`, `action` — and the signature is HMAC-SHA256 with the instance's own salt. It
 * grants exactly one ability: turn email off, or open the profile. It cannot read a card, write one,
 * or name somebody else, because the payload is the claim and the signature makes changing it
 * detectable.
 *
 * No expiry: an unsubscribe link in a year-old message should still work. The alternative — a link
 * that stops working — is an unsubscribe that quietly does not unsubscribe.
 */

import { salt } from './config'

export type MailAction = 'unsubscribe' | 'preferences'

export interface MailToken {
  workspaceId: string
  userId: string
  action: MailAction
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function unhex(value: string): Uint8Array | undefined {
  if (!/^[0-9a-f]*$/i.test(value) || value.length % 2 !== 0) return undefined
  const bytes = new Uint8Array(value.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

async function key(env: unknown) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(salt(env)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function mailToken(
  env: unknown,
  workspaceId: string,
  userId: string,
  action: MailAction,
): Promise<string> {
  const payload = encoder.encode(JSON.stringify({ w: workspaceId, u: userId, a: action, v: 1 }))
  const signature = await crypto.subtle.sign('HMAC', await key(env), payload)
  return `${hex(payload)}.${hex(new Uint8Array(signature))}`
}

/** The claim a token makes, or nothing when it was changed, truncated or made elsewhere. */
export async function readMailToken(env: unknown, token: string): Promise<MailToken | undefined> {
  const [body, mac] = token.split('.')
  if (!body || !mac) return undefined
  const payload = unhex(body)
  const signature = unhex(mac)
  if (!payload || !signature) return undefined
  // `verify` is the constant-time comparison; a hand-written one would be a timing oracle.
  const valid = await crypto.subtle.verify('HMAC', await key(env), signature, payload)
  if (!valid) return undefined

  try {
    const parsed = JSON.parse(decoder.decode(payload)) as Record<string, unknown>
    if (typeof parsed.w !== 'string' || typeof parsed.u !== 'string') return undefined
    if (parsed.a !== 'unsubscribe' && parsed.a !== 'preferences') return undefined
    return { workspaceId: parsed.w, userId: parsed.u, action: parsed.a }
  } catch {
    return undefined
  }
}
