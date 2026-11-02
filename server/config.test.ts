/**
 * The salt, and the one rule that makes it a secret.
 *
 * The salt is what stops a reporter's address being recovered from the hash stored beside an error
 * report. It used to have a published default — `change-me` in `compose.yaml`, `kanbantoolkit` in
 * this module — which an operator could ship without noticing, so the values this repository
 * publishes are exactly the ones that must never be used. Task 201.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isProduction, salt, saltProblem } from './config'

/** A value no repository has ever published. */
const SECRET = 'a3f9c1d47b6e8052f1c9a4d7e0b3f6825c8d1a4e7f0b3c6d9a2e5f8b1c4d7a0e'

/** The strings an operator can find in this repository and paste into a configuration. */
const PLACEHOLDERS = ['change-me', 'kanbantoolkit', 'replace-with-a-secret']

describe('the salt', () => {
  it('is the configured secret, trimmed of the whitespace an environment line carries', () => {
    expect(salt({ ERROR_SALT: `  ${SECRET}\n` })).toBe(SECRET)
  })

  it('stops an instance that has not been given one', () => {
    for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'production', ERROR_SALT: '' }, { NODE_ENV: 'production', ERROR_SALT: '   ' }]) {
      expect(() => salt(env)).toThrow(/ERROR_SALT/)
    }
  })

  it('stops an instance given a value this project publishes', () => {
    for (const placeholder of PLACEHOLDERS) {
      expect(() => salt({ NODE_ENV: 'production', ERROR_SALT: placeholder })).toThrow(/ERROR_SALT/)
    }
  })

  it('says which variable is wrong and why, before the instance serves anything', () => {
    expect(saltProblem({ NODE_ENV: 'production' })).toMatch(/ERROR_SALT is not set/)
    expect(saltProblem({ NODE_ENV: 'production', ERROR_SALT: 'change-me' })).toMatch(/publishes as a placeholder/)
    expect(saltProblem({ NODE_ENV: 'production', ERROR_SALT: SECRET })).toBeUndefined()
    expect(saltProblem({ NODE_ENV: 'development', ERROR_SALT: SECRET })).toBeUndefined()
  })

  it('still starts in development, with a salt of its own rather than a published one', () => {
    const development = salt({ NODE_ENV: 'development' })

    expect(development).not.toBe('kanbantoolkit')
    for (const placeholder of PLACEHOLDERS) expect(development).not.toBe(placeholder)
    expect(development).toMatch(/^[0-9a-f]{64}$/)
    // One per process, so every write in this run counts the same address the same way.
    expect(salt({ NODE_ENV: 'development' })).toBe(development)
  })

  it('never falls back to a published placeholder, even when one is set in development', () => {
    for (const placeholder of PLACEHOLDERS) {
      expect(salt({ NODE_ENV: 'development', ERROR_SALT: placeholder })).not.toBe(placeholder)
    }
  })

  it('reads production from the image’s own signal, and nothing else', () => {
    expect(isProduction({ NODE_ENV: 'production' })).toBe(true)
    expect(isProduction({ NODE_ENV: 'Production' })).toBe(true)
    expect(isProduction({ NODE_ENV: 'development' })).toBe(false)
    expect(isProduction({})).toBe(false)
  })

  it('the Compose file ships no salt of its own', () => {
    const compose = readFileSync(new URL('../compose.yaml', import.meta.url), 'utf8')

    // The environment line is how an operator's value reaches the container; the default after `:-`
    // is what the image would then hash addresses with, so there must not be one.
    expect(compose).toMatch(/^\s*ERROR_SALT:\s*\$\{ERROR_SALT:-\}\s*$/m)
    for (const placeholder of PLACEHOLDERS) {
      expect(compose).not.toMatch(new RegExp(`ERROR_SALT[^\\n]*${placeholder}`, 'i'))
    }
  })
})
