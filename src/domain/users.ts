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
