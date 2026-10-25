/**
 * What a machine credential may be asked to do.
 *
 * A **scope** is a group of the matrix's actions (`src/domain/roles.ts`), named for a client rather
 * than for the code: an agent says "read boards and cards", not `board.read`. The grouping is the
 * design decision this file exists for, and it is deliberately coarse — a client does not care that
 * splitting a lane is `board.design` and opening a board is `board.read` — but not so coarse that it
 * smuggles an administrator's powers into a token an editor can mint.
 *
 * Two rules, and they are both checked at *use*, never at mint alone:
 *
 * 1. a token reaches only the actions its scopes name (`covers`);
 * 2. a token never reaches past its owner's role, because `requireWorkspace` asks the matrix about
 *    the person's role on every request. A demotion tightens every token its owner holds, without
 *    anybody remembering to go and revoke them.
 *
 * Minting refuses a scope the person could not exercise at all (`mintable`) — a Viewer cannot hold
 * `items:write` — because a credential that can do nothing is a credential somebody will debug at
 * 2 a.m. A scope *partly* past the role is allowed: an editor's `boards:write` token can create a
 * board and cannot redesign one, which is the editor's own limit rather than a lie.
 *
 * The vocabulary is closed and complete: every action in the matrix belongs to exactly one scope,
 * and a test asserts it, so a new action cannot arrive reachable by no token or by every token.
 */

import { can, type Action, type Role } from './roles'

/** The closed set. A new scope is a decision about every client, so it is written here once. */
export type Scope =
  | 'boards:read'
  | 'boards:write'
  | 'items:read'
  | 'items:comment'
  | 'items:write'
  | 'objectives:write'
  | 'people:read'
  | 'workspace:admin'
  | 'instance:admin'

export interface ScopeInfo {
  /** What the scope reaches, in the matrix's words. */
  actions: readonly Action[]
  /**
   * Scopes this one includes, for the one case where the acts genuinely nest: writing a card
   * includes commenting on it. Direct lists stay disjoint — an action is *named* once — so a
   * completeness check still means something, and this is the only way one scope widens another.
   */
  includes?: readonly Scope[]
  /** A few words for a checkbox. */
  label: string
  /** What it lets a tool do, in the consent screen's voice. */
  does: string
}

/**
 * The table.
 *
 * `boards:write` holds the administrator-only acts as well as creation, because they are one thing
 * to a client — "the board's shape and lifecycle" — and the role decides which of them land. The
 * alternative, a `board:design` scope beside `board:settings`, would be four checkboxes for one
 * intent and a consent screen nobody reads.
 *
 * `instance:admin` reaches no workspace action at all: it is the instance's own administration
 * (people, invitations, the audit trail), which the matrix does not describe because it is not
 * something a workspace role grants.
 */
export const SCOPES: Record<Scope, ScopeInfo> = {
  'boards:read': {
    actions: ['board.read', 'board.search'],
    label: 'read boards',
    does: 'see the boards and search them',
  },
  'boards:write': {
    actions: ['board.create', 'board.design', 'board.settings', 'board.delete', 'template.manage'],
    label: 'change boards',
    does: 'create boards, and change their design, settings and templates where your role allows',
  },
  'items:read': {
    actions: ['item.read'],
    label: 'read cards',
    does: 'read cards and initiatives',
  },
  'items:comment': {
    actions: ['item.comment'],
    label: 'comment on cards',
    does: 'leave notes on cards',
  },
  'items:write': {
    actions: ['item.write', 'item.move', 'item.attribute', 'item.delete'],
    includes: ['items:comment'],
    label: 'change cards',
    does: 'create and edit cards, move them, comment on them, block them and delete them',
  },
  'objectives:write': {
    actions: ['objective.write'],
    label: 'change objectives',
    does: 'create and change objectives and key results',
  },
  'people:read': {
    actions: ['people.read'],
    label: 'read people',
    does: 'see who is on the team',
  },
  'workspace:admin': {
    actions: [
      'workspace.settings',
      'workspace.members',
      'workspace.share',
      'workspace.import',
      'workspace.restore',
      'workspace.delete',
    ],
    label: 'administer the workspace',
    does: 'change the workspace, its people, its data and its end',
  },
  'instance:admin': {
    actions: [],
    label: 'administer this instance',
    does: 'manage the accounts, invitations and access rules of this instance',
  },
}

/** Every scope, in the order a consent screen should list them: reading first. */
export const SCOPE_ORDER: readonly Scope[] = [
  'boards:read',
  'items:read',
  'people:read',
  'items:comment',
  'boards:write',
  'items:write',
  'objectives:write',
  'workspace:admin',
  'instance:admin',
]

export function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && value in SCOPES
}

/** Whether a set of scopes reaches an action. An empty set reaches nothing. */
export function covers(scopes: readonly Scope[], action: Action): boolean {
  return scopes.some((scope) => reaches(scope, action))
}

/**
 * Whether a credential holding `held` satisfies a route that needs `needed` — the same scope, or one
 * that includes it. (A route that needs `items:comment` is answered by `items:write`.)
 */
export function grants(held: readonly Scope[], needed: Scope, seen = new Set<Scope>()): boolean {
  return held.some((scope) => {
    if (scope === needed) return true
    if (seen.has(scope)) return false
    seen.add(scope)
    return (SCOPES[scope].includes ?? []).some((included) => grants([included], needed, seen))
  })
}

/** One scope and everything it includes, walked without repeating a node. */
function reaches(scope: Scope, action: Action, seen = new Set<Scope>()): boolean {
  if (seen.has(scope)) return false
  seen.add(scope)
  const info = SCOPES[scope]
  if (info.actions.includes(action)) return true
  return (info.includes ?? []).some((included) => reaches(included, action, seen))
}

/**
 * A scope a person could act through, at all.
 *
 * `instance:admin` is the one decided by the other axis: it is not a workspace authority, so the
 * workspace role has nothing to say about it and the instance role decides.
 */
export function scopeFor(role: Role, instanceRole: 'admin' | 'member', scope: Scope): boolean {
  if (scope === 'instance:admin') return instanceRole === 'admin'
  return SCOPES[scope].actions.some((action) => can(role, action))
}

/**
 * Which of the requested scopes the person cannot hold.
 *
 * Empty means yes. The answer names the scopes rather than a boolean so a screen can say which
 * checkbox to untick, and the caller can refuse before the row exists.
 */
export function refusedScopes(
  scopes: readonly Scope[],
  role: Role,
  instanceRole: 'admin' | 'member',
): Scope[] {
  return scopes.filter((scope) => !scopeFor(role, instanceRole, scope))
}

/**
 * The consent screen's sentence: "read boards and cards", or a list long enough that it needs commas.
 *
 * Written once and read by the browser, the audit data and the tests, so the words a person approved
 * and the words on the screen cannot drift.
 */
export function describeScopes(scopes: readonly Scope[]): string {
  const parts = scopes.map((scope) => SCOPES[scope].label)
  if (parts.length === 0) return 'nothing'
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** The scopes a role could mint, for a screen that offers the ones worth offering. */
export function rolesScopes(role: Role, instanceRole: 'admin' | 'member'): Scope[] {
  return SCOPE_ORDER.filter((scope) => scopeFor(role, instanceRole, scope))
}
