import { describe, expect, it } from 'vitest'
import { personFor } from './identity'
import type { User } from '@/domain/types'

const maya: User = { id: 'u-mb', name: 'Maya Blake' }
const ada: User = { id: 'u_9f2', name: 'Ada Lovelace' }

describe('the person an account is, in a workspace', () => {
  it('is the record with the same id — an invited person is one row, not two', () => {
    // The name differs because the account's own name is the provider's, and the workspace's was
    // written by whoever invited them. The id is the fact.
    expect(personFor({ id: 'u_9f2', name: 'A. Lovelace' }, [maya, ada])).toEqual(ada)
  })

  it('falls back to the name, which is all a seeded demo person has', () => {
    // The demo's people predate their accounts: "sign in as maya.blake@example.com" has only a
    // name to match, and the case and the spacing are not the person.
    expect(personFor({ id: 'u_new', name: ' maya BLAKE ' }, [maya, ada])?.id).toBe('u-mb')
  })

  it('prefers the id when two people share a name', () => {
    const namesake: User = { id: 'u_other', name: 'Maya Blake' }
    expect(personFor({ id: 'u_other', name: 'Maya Blake' }, [maya, namesake])?.id).toBe('u_other')
  })

  it('is nobody when this workspace has no such person, or when nobody is signed in', () => {
    expect(personFor({ id: 'u_x', name: 'Grace Hopper' }, [maya, ada])).toBeUndefined()
    expect(personFor(null, [maya])).toBeUndefined()
    expect(personFor({ id: 'u-mb', name: 'Maya Blake' }, [])).toBeUndefined()
  })
})
