import { describe, expect, it } from 'vitest'
import { ITERATIONS, MIN_LENGTH, WeakPassword, acceptable, dummyHash, hash, verify } from './password'

/**
 * The password format, and the promises that let it change later.
 *
 * These tests run the real KDF at the real cost, which is slow on purpose — the point of the cost is
 * that a guess is expensive. A handful of hashes is a second of the suite, and the alternative is a
 * test that passes against a cheaper function than the one that ships.
 */
describe('a stored password', () => {
  it('round-trips, and says no to the wrong password', async () => {
    const stored = await hash('correct horse battery staple')
    expect(await verify('correct horse battery staple', stored)).toBe(true)
    expect(await verify('Correct horse battery staple', stored)).toBe(false)
    expect(await verify('', stored)).toBe(false)
  })

  it('carries its own cost and salt, so two hashes of one password differ', async () => {
    const first = await hash('correct horse battery staple')
    const second = await hash('correct horse battery staple')
    expect(first).not.toBe(second)

    const [algorithm, iterations, salt, digest] = first.split('$')
    expect(algorithm).toBe('pbkdf2')
    expect(Number(iterations)).toBe(ITERATIONS)
    expect(salt).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(digest).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it('verifies a hash written at a lower cost, so raising the cost is safe', async () => {
    // The upgrade path: today's default changes; a hash written yesterday still opens the door.
    const old = await hash('correct horse battery staple', 100_000)
    expect(old.startsWith('pbkdf2$100000$')).toBe(true)
    expect(await verify('correct horse battery staple', old)).toBe(true)
  })

  it('fails closed on anything it cannot read', async () => {
    for (const broken of [
      '',
      'plaintext',
      'pbkdf2$600000$onlythree',
      'scrypt$600000$c2FsdA==$aGFzaA==',
      'pbkdf2$notanumber$c2FsdA==$aGFzaA==',
      'pbkdf2$0$c2FsdA==$aGFzaA==',
      'pbkdf2$99999999999$c2FsdA==$aGFzaA==',
      'pbkdf2$600000$$aGFzaA==',
      'pbkdf2$600000$c2FsdA==$dG9vc2hvcnQ=',
      'pbkdf2$600000$!!!!$!!!!',
    ]) {
      expect(await verify('correct horse battery staple', broken), broken).toBe(false)
    }
  })

  it('refuses a short password by rule, and an absurd one by length', async () => {
    expect(acceptable('short')).toBe(false)
    await expect(hash('short')).rejects.toBeInstanceOf(WeakPassword)

    // A megabyte is not a password, and hashing it would be the test's cost, not the app's.
    const megabyte = 'a'.repeat(1024 * 1024)
    expect(acceptable(megabyte)).toBe(false)
    await expect(hash(megabyte)).rejects.toBeInstanceOf(WeakPassword)
  })

  it('takes a passphrase of twelve spaces, because length is the only rule', async () => {
    // No composition rule: a phrase nobody would guess is stronger than an exclamation mark.
    const stored = await hash('            ')
    expect(await verify('            ', stored)).toBe(true)
  })

  it('hashes the same password the same way across Unicode forms', async () => {
    // "é" composed and decomposed are one password to a person, and must be one to the hash.
    const composed = 'café au lait, please'
    const decomposed = composed.normalize('NFD')
    expect(decomposed).not.toBe(composed)
    const stored = await hash(composed)
    expect(await verify(decomposed, stored)).toBe(true)
    expect(MIN_LENGTH).toBe(12)
  })

  it('offers a dummy hash that is a real hash, for an address that does not exist', async () => {
    // The caller verifies against this so an unknown address costs what a wrong password costs.
    const dummy = await dummyHash()
    expect(dummy.startsWith('pbkdf2$')).toBe(true)
    expect(await verify('anything', dummy)).toBe(false)
    // One per process: two calls are the same value, so the work is paid once.
    expect(await dummyHash()).toBe(dummy)
  })
})
