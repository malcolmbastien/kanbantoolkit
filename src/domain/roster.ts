/**
 * Who may do what to whom.
 *
 * The rules that keep an instance administrable are not about HTTP and not about the database: they
 * are a judgement over a small snapshot of the roster, so they can be read, tested and shown in the
 * interface without a request. `mayAdminister` is that judgement, and it is the only one — the
 * routes call it before they write, and a screen can call it to disable a button.
 *
 * Two things are protected: the person doing it, and the last person who could undo it. Everything
 * else is a decision an administrator is allowed to make.
 */

export interface RosterPerson {
  id: string
  /** Whether they may sign in at all. */
  active: boolean
  /** Whether they administer the instance. */
  instanceAdmin: boolean
  /** Whether they administer this workspace. */
  workspaceAdmin: boolean
}

/** The acts that can be refused. `activate` is not among them: opening a door is never refused. */
export type RosterOperation = 'deactivate' | 'delete' | 'demote' | 'remove'

export interface Roster {
  actor: RosterPerson
  target: RosterPerson
  /** How many *active* instance administrators there are, the target included. */
  instanceAdmins: number
  /** How many *active* workspace administrators there are, the target included. */
  workspaceAdmins: number
}

export type Verdict = { ok: true } | { ok: false; reason: string }

const SELF = 'You cannot deactivate or delete yourself. Ask another administrator.'
const LAST_INSTANCE = 'This is the last administrator of the instance. Make somebody else one first.'
const LAST_WORKSPACE = 'This is the last administrator of this workspace. Make somebody else one first.'

/**
 * The one judgement.
 *
 * Order matters: being unable to act on yourself is a clearer sentence than a count, and it is true
 * whether or not you are the last administrator.
 */
export function mayAdminister(roster: Roster, operation: RosterOperation): Verdict {
  const { actor, target, instanceAdmins, workspaceAdmins } = roster

  if (actor.id === target.id && (operation === 'deactivate' || operation === 'delete')) {
    return { ok: false, reason: SELF }
  }

  // A demotion only matters to a count if the person is currently one of them. Someone already
  // deactivated is not holding a door open, so the count does not protect them.
  if (target.active && target.instanceAdmin && instanceAdmins <= 1) {
    return { ok: false, reason: LAST_INSTANCE }
  }

  if (target.active && target.workspaceAdmin && workspaceAdmins <= 1) {
    return { ok: false, reason: LAST_WORKSPACE }
  }

  return { ok: true }
}
