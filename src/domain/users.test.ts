import { describe, expect, it } from 'vitest'
import { FORMER_MEMBER, initialsOf, nameOfUser, userById } from './users'
import type { User } from './types'

/**
 * What a person is called, and what is left of them when their account is gone.
 *
 * Removing a member deletes the account (task 144) and leaves the work that names them. The name on
 * that work is "Former member"; the id is never shown, because a card that says `u_9f3a` is a card
 * that has forgotten it was written by a person.
 */

const users: User[] = [
  { id: 'u-1', name: 'Maya Blake' },
  { id: 'u-2', name: 'Cher' },
]

const SOURCES = import.meta.glob('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('names', () => {
  it('resolves a person, and calls a missing one what they are', () => {
    expect(nameOfUser(users, 'u-1')).toBe('Maya Blake')
    expect(nameOfUser(users, 'u-gone')).toBe(FORMER_MEMBER)
    expect(nameOfUser(users, undefined)).toBeUndefined()
    expect(userById(users, 'u-2')).toEqual({ id: 'u-2', name: 'Cher' })
  })

  it('gives initials from the first and last words', () => {
    expect(initialsOf('Maya Blake')).toBe('MB')
    expect(initialsOf('Cher')).toBe('CH')
    expect(initialsOf('  ')).toBe('?')
  })

  it('never renders an id in place of a name', () => {
    // The shape that leaked it before: `u?.name ?? id`, and `{name ?? id}` in a chip. A surface
    // that falls back to a *person's* id shows a stranger a database key. (A board id falling back
    // to its id is a different, harmless kind of unknown.)
    const offenders = Object.entries(SOURCES)
      .filter(([, text]) => /\bu\?\.name\s*\?\?\s*id\b/.test(text) || /\?\?\s*id\}/.test(text))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })
})
