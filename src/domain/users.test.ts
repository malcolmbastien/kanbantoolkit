import { describe, expect, it } from 'vitest'
import { initialsOf, userById } from './users'

describe('initialsOf', () => {
  it('takes the first and last word', () => {
    expect(initialsOf('Riley Kim')).toBe('RK')
    expect(initialsOf('Maya  Blake')).toBe('MB')
    expect(initialsOf('Ana Sofia Reyes')).toBe('AR')
  })

  it('handles a single word and blanks', () => {
    expect(initialsOf('Cher')).toBe('CH')
    expect(initialsOf('   ')).toBe('?')
  })
})

describe('userById', () => {
  const users = [{ id: 'u1', name: 'A B' }]

  it('finds a user by id', () => {
    expect(userById(users, 'u1')?.name).toBe('A B')
    expect(userById(users, 'nope')).toBeUndefined()
  })
})
