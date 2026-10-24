import { describe, expect, it } from 'vitest'
import { ACCOUNT_ACTIONS, ACTIONS, can, canAccount, ROLES } from './roles'
import type { AccountAction, Action, InstanceRole, Role } from './roles'

/**
 * The matrix told a second way — as "what each action needs" rather than "what each role has".
 *
 * Two tellings of one table is the point: written straight from the document's rows, this catches a
 * boolean typo in the record that a test derived from the record could not.
 */
const NEEDS: Record<Action, Role[]> = {
  'board.read': ['viewer', 'editor', 'admin'],
  'board.search': ['viewer', 'editor', 'admin'],
  'item.read': ['viewer', 'editor', 'admin'],
  'item.comment': ['viewer', 'editor', 'admin'],
  'people.read': ['viewer', 'editor', 'admin'],

  'board.create': ['editor', 'admin'],
  'item.write': ['editor', 'admin'],
  'item.move': ['editor', 'admin'],
  'item.attribute': ['editor', 'admin'],

  'board.design': ['admin'],
  'board.settings': ['admin'],
  'board.delete': ['admin'],
  'item.delete': ['admin'],
  'objective.write': ['admin'],
  'template.manage': ['admin'],
  'workspace.settings': ['admin'],
  'workspace.members': ['admin'],
  'workspace.share': ['admin'],
  'workspace.import': ['admin'],
  'workspace.restore': ['admin'],
}

describe('who may do what', () => {
  // V1: one assertion per pair, named as the pair.
  for (const action of ACTIONS) {
    for (const role of ROLES) {
      it(`${role.id} × ${action}`, () => {
        expect(can(role.id, action)).toBe(NEEDS[action].includes(role.id))
      })
    }
  }

  it('decides every action, so a new one cannot arrive without a row', () => {
    expect(Object.keys(NEEDS).sort()).toEqual([...ACTIONS].sort())
  })

  it('answers no to a role it has never heard of', () => {
    expect(can('nonsense', 'item.read')).toBe(false)
    expect(can('', 'board.design')).toBe(false)
  })

  it('names three roles, each with a label and a sentence', () => {
    expect(ROLES).toHaveLength(3)
    expect(ROLES.map((role) => role.id)).toEqual(['viewer', 'editor', 'admin'])
    for (const role of ROLES) {
      expect(role.label.trim().length).toBeGreaterThan(0)
      expect(role.description.trim().length).toBeGreaterThan(20)
    }
  })

  it('never lets a higher role do less than a lower one', () => {
    for (const action of ACTIONS) {
      if (can('viewer', action)) expect(can('editor', action)).toBe(true)
      if (can('editor', action)) expect(can('admin', action)).toBe(true)
    }
  })

  it('keeps the work and the board apart', () => {
    // The two rows the document argues about, asserted where they are made.
    expect(can('editor', 'item.write')).toBe(true)
    expect(can('editor', 'board.design')).toBe(false)
    expect(can('editor', 'item.attribute')).toBe(true)
    expect(can('editor', 'objective.write')).toBe(false)
    expect(can('admin', 'board.design')).toBe(true)
    expect(can('admin', 'objective.write')).toBe(true)
  })
})

/**
 * The account's matrix, told the same second way.
 *
 * One instance role grants everything here and the other grants nothing: being a member of the
 * deployment is not a grant of anything at this level. A new account action without a row fails
 * `decides every account action`, which is the point of writing it out.
 */
const ACCOUNT_NEEDS: Record<AccountAction, InstanceRole[]> = {
  'account.rename': ['admin'],
  'account.billing': ['admin'],
  'account.admins': ['admin'],
  'account.delete': ['admin'],
  'workspace.delete': ['admin'],
}

describe('what an Account Admin may do', () => {
  for (const action of ACCOUNT_ACTIONS) {
    for (const role of ['admin', 'member'] as const) {
      it(`${role} × ${action}`, () => {
        expect(canAccount(role, action)).toBe(ACCOUNT_NEEDS[action].includes(role))
      })
    }
  }

  it('decides every account action, so a new one cannot arrive without a row', () => {
    expect(Object.keys(ACCOUNT_NEEDS).sort()).toEqual([...ACCOUNT_ACTIONS].sort())
  })

  it('grants nothing to a role it has never heard of', () => {
    expect(canAccount('owner', 'account.delete')).toBe(false)
    expect(canAccount('', 'account.billing')).toBe(false)
  })
})
