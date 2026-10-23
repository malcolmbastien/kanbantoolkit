import { describe, expect, it } from 'vitest'
import { mayAdminister } from './roster'
import type { Roster, RosterOperation, RosterPerson } from './roster'

const person = (over: Partial<RosterPerson> = {}): RosterPerson => ({
  id: 'u-target',
  active: true,
  instanceAdmin: false,
  workspaceAdmin: false,
  ...over,
})

const roster = (over: Partial<Roster> = {}): Roster => ({
  actor: person({ id: 'u-actor', instanceAdmin: true }),
  target: person(),
  instanceAdmins: 2,
  workspaceAdmins: 2,
  ...over,
})

const OPERATIONS: RosterOperation[] = ['deactivate', 'delete', 'demote', 'remove']

describe('who may do what to whom', () => {
  it('lets an administrator act on somebody who is not the last of anything', () => {
    for (const operation of OPERATIONS) expect(mayAdminister(roster(), operation)).toEqual({ ok: true })
  })

  it('will not let a person deactivate or delete themselves', () => {
    const self = roster({ target: person({ id: 'u-actor', instanceAdmin: true }) })

    expect(mayAdminister(self, 'deactivate')).toEqual({ ok: false, reason: expect.stringContaining('yourself') })
    expect(mayAdminister(self, 'delete')).toEqual({ ok: false, reason: expect.stringContaining('yourself') })
    // Demoting yourself is allowed when somebody else can still open the door.
    expect(mayAdminister(self, 'demote')).toEqual({ ok: true })
  })

  it('protects the last administrator of the instance from all four', () => {
    const last = roster({ target: person({ instanceAdmin: true }), instanceAdmins: 1 })
    for (const operation of OPERATIONS) {
      expect(mayAdminister(last, operation)).toEqual({ ok: false, reason: expect.stringContaining('instance') })
    }
  })

  it('protects the last administrator of the workspace', () => {
    const last = roster({ target: person({ workspaceAdmin: true }), workspaceAdmins: 1 })
    for (const operation of OPERATIONS) {
      expect(mayAdminister(last, operation)).toEqual({ ok: false, reason: expect.stringContaining('workspace') })
    }
  })

  it('does not protect somebody who is already inactive — they hold no door open', () => {
    const gone = roster({ target: person({ active: false, instanceAdmin: true }), instanceAdmins: 1 })
    expect(mayAdminister(gone, 'delete')).toEqual({ ok: true })
  })

  it('names the person over the count when both apply', () => {
    const both = roster({
      actor: person({ id: 'u-me', instanceAdmin: true }),
      target: person({ id: 'u-me', instanceAdmin: true }),
      instanceAdmins: 1,
    })
    expect(mayAdminister(both, 'deactivate').ok).toBe(false)
    expect((mayAdminister(both, 'deactivate') as { reason: string }).reason).toContain('yourself')
  })
})
