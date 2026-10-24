import type { User } from './types'

/**
 * The initials shown when a user has no photo: the first letters of the first
 * and last words, e.g. 'Riley Kim' → 'RK', 'Cher' → 'CH'.
 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function userById(users: User[], id: string): User | undefined {
  return users.find((u) => u.id === id)
}

/**
 * What to call somebody, when the only thing left is their id.
 *
 * A removed member's account is deleted (task 144), and the work they did keeps naming them: a log
 * entry, a comment, a card they were assigned. Those sentences stay exactly as written — only the
 * name on them changes, and it changes to this. An unknown id is never rendered raw: a card that
 * says "u_9f3a" is a card that has forgotten it was written by a person.
 */
export const FORMER_MEMBER = 'Former member'

export function nameOfUser(users: User[], id: string | undefined): string | undefined {
  if (!id) return undefined
  return userById(users, id)?.name ?? FORMER_MEMBER
}
