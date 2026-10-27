import { useEffect } from 'react'
import { useAuth, type AuthUser } from './auth'
import { useStore } from '@/store'
import type { User } from '@/domain/types'

/**
 * Who this browser's work belongs to.
 *
 * The account and the workspace's own people are two records that describe one person — and on an
 * instance they are usually the same record: an invited person's `users` row *is* the account's row,
 * so the ids match. The demo's people predate their accounts, though: they have names and no
 * addresses, so a sign-in that arrives by address has only the name to go on. Id first, because it
 * is the record; name second, because on a seeded workspace it is the only thing there is.
 */
export function personFor(
  account: Pick<AuthUser, 'id' | 'name'> | null | undefined,
  people: User[],
): User | undefined {
  if (!account) return undefined
  const name = account.name.trim().toLowerCase()
  return (
    people.find((person) => person.id === account.id) ??
    people.find((person) => person.name.trim().toLowerCase() === name)
  )
}

/**
 * Keep the store's "me" in step with the session.
 *
 * Set from the session on load, and not only when somebody presses Sign in: a reload used to begin
 * with the account known and the person forgotten, which is exactly the state in which "My work" is
 * empty for a person who is signed in. An account with no person in this workspace clears the pick
 * rather than leaving somebody else's work under the words "my work".
 *
 * With no account, this says nothing at all: the demo's own picker is the only identity there is,
 * and it must survive every render.
 */
export function useSignedInPerson(): void {
  const loaded = useAuth((s) => s.loaded)
  const account = useAuth((s) => s.user)
  const people = useStore((s) => s.users)
  const meUserId = useStore((s) => s.meUserId)

  useEffect(() => {
    // Nothing to say until the instance has answered, and nothing to say without an account.
    if (!loaded || !account) return
    const next = personFor(account, people)?.id
    if (next !== meUserId) useStore.getState().setUser(next)
  }, [loaded, account, people, meUserId])
}
