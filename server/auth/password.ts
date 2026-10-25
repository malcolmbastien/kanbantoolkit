/**
 * A password, and the only thing ever stored about it.
 *
 * One algorithm, and one that both runtimes actually have: **PBKDF2-HMAC-SHA256 through WebCrypto**
 * (`crypto.subtle.deriveBits`). Argon2id or scrypt would be better and neither is available on both
 * — Workers has no scrypt, and adding a native module would put a compiled binary between a
 * self-hoster and their own server. This is the trade, recorded rather than hidden.
 *
 * What makes the trade survivable is the stored format:
 *
 *     pbkdf2$<iterations>$<salt-base64>$<hash-base64>
 *
 * The cost is *in the hash*, so a later release can raise it and every old password keeps verifying —
 * and the moment a person signs in with an old hash, the caller can re-hash at the current cost. The
 * salt is per password and random; two people with the same password have two different hashes.
 *
 * Nothing here logs, and nothing throws with the password in the message. The minimum length lives
 * here too, so there is one place that decides what a password is — no composition rules, because a
 * composition rule produces `Password1!` and rejects a passphrase.
 *
 * **The cost is real CPU, and Cloudflare's free plan allows 10 ms per request.** 600 000 iterations
 * is well past that: a Worker deployment that offers passwords needs the paid plan, or a front door
 * that does the hashing elsewhere. This is recorded here because it is the one place the choice of
 * algorithm meets the runtime's bill — task 154.3 decides which deployments get the door.
 */

/** The cost, today. Raising it is a one-line change that old hashes survive. */
export const ITERATIONS = 600_000

/** A password is twelve characters or more. No maximum a person could hit; one that stops a flood. */
export const MIN_LENGTH = 12
const MAX_BYTES = 1024

/** What a password is, said once: long enough, and bounded so an absurd input is refused cheaply. */
export function acceptable(password: string): boolean {
  return password.normalize('NFKC').length >= MIN_LENGTH && new TextEncoder().encode(password).length <= MAX_BYTES
}

/** The refusal a caller turns into a sentence. It says what to do, and never what was typed. */
export class WeakPassword extends Error {
  constructor() {
    super(`a password needs at least ${MIN_LENGTH} characters`)
    this.name = 'WeakPassword'
  }
}

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function bytesOf(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

/** PBKDF2 over the normalised password, so the same keystrokes hash the same way on every device. */
async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256)
  return new Uint8Array(bits)
}

/** A hash for storage. The iterations are a parameter so a raise can be tested, not so callers vary it. */
export async function hash(password: string, iterations: number = ITERATIONS): Promise<string> {
  if (!acceptable(password)) throw new WeakPassword()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const derived = await derive(password, salt, iterations)
  return `pbkdf2$${iterations}$${base64(salt)}$${base64(derived)}`
}

/** Comparing two byte strings without returning early: the time it takes says nothing about the bytes. */
function same(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index]
  return difference === 0
}

/**
 * Whether the password matches the stored hash.
 *
 * A stored value this code cannot read is a `false`, not a throw: a malformed row must fail closed,
 * and a caller does not want to distinguish "wrong password" from "broken row" in its answer to a
 * stranger. The iteration count comes from the string, so a hash written by an older release
 * verifies with the cost it was written at.
 */
export async function verify(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false

  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) return false

  let salt: Uint8Array
  let expected: Uint8Array
  try {
    salt = bytesOf(parts[2])
    expected = bytesOf(parts[3])
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length !== 32) return false

  const derived = await derive(password, salt, iterations)
  return same(derived, expected)
}

/**
 * A hash to verify against when there is no account, so an unknown address costs what a wrong
 * password costs. The caller awaits it and ignores the answer.
 */
let dummy: Promise<string> | undefined
export function dummyHash(): Promise<string> {
  // Generated once per process and never stored: it exists to burn the same CPU, not to be compared.
  dummy ??= hash('a password nobody will ever type, hashed so the timing is honest')
  return dummy
}
