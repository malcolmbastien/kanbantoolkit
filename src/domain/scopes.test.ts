import { describe, expect, it } from 'vitest'
import { ACTIONS, can } from './roles'
import type { Action } from './roles'
import {
  SCOPE_ORDER,
  SCOPES,
  covers,
  describeScopes,
  isScope,
  refusedScopes,
  rolesScopes,
  scopeFor,
} from './scopes'
import type { Scope } from './scopes'

/**
 * The vocabulary, checked against the matrix.
 *
 * The two files are the two halves of one decision: `roles.ts` says what a *person* may do, this
 * table says which of those acts a *client* may ask for. A scope that reached nothing would be a
 * checkbox that lies; an action no scope reaches would be a thing no token can ever do — and the
 * second is the one that arrives silently when the matrix grows.
 */
describe('the scope vocabulary', () => {
  it('reaches every action in the matrix, and no action twice', () => {
    const reached = SCOPE_ORDER.flatMap((scope) => [...SCOPES[scope].actions])
    // Every action is reachable…
    expect(new Set(reached)).toEqual(new Set(ACTIONS))
    // …and exactly once, so no client is offered two doors to the same act.
    expect(reached.length).toBe(new Set(reached).size)
  })

  it('keeps the administrator-only board acts out of a scope an editor could reach', () => {
    // This is the decision the task asked for before any route: `boards:write` is one intent for a
    // client, and the role is what keeps an editor's token to creation.
    expect(scopeFor('editor', 'member', 'boards:write')).toBe(true)
    expect(SCOPES['boards:write'].actions).toContain('board.design')
    // …so the token names design, and an editor's role refuses it at use. Both halves are needed.
    expect(can('editor', 'board.design')).toBe(false)
    expect(can('admin', 'board.design')).toBe(true)
  })

  it('refuses a Viewer the writing scopes, at mint time', () => {
    expect(refusedScopes(['items:write'], 'viewer', 'member')).toEqual(['items:write'])
    expect(refusedScopes(['boards:write'], 'viewer', 'member')).toEqual(['boards:write'])
    expect(refusedScopes(['objectives:write'], 'viewer', 'member')).toEqual(['objectives:write'])
    // Commenting is its own scope precisely because a Viewer has it and nothing else in the
    // writing group: `items:write` must not become mintable because one of its actions is a note.
    expect(refusedScopes(['items:comment'], 'viewer', 'member')).toEqual([])
    expect(refusedScopes(['boards:read', 'items:read', 'items:comment'], 'viewer', 'member')).toEqual([])
  })

  it('lets an Editor reach the work and not the board, as the matrix does', () => {
    expect(refusedScopes(['items:write', 'boards:write'], 'editor', 'member')).toEqual([])
    // A scope is reachable if *any* of its actions is, and the role decides which of them land.
    expect(scopeFor('editor', 'member', 'boards:write')).toBe(true)
    expect(can('editor', 'board.create')).toBe(true)
    expect(can('editor', 'board.settings')).toBe(false)
    // The workspace's own administration is not an editor's at all.
    expect(refusedScopes(['workspace:admin'], 'editor', 'member')).toEqual(['workspace:admin'])
    expect(refusedScopes(['workspace:admin'], 'admin', 'member')).toEqual([])
  })

  it('answers instance administration from the other axis', () => {
    // A workspace administrator who does not run the instance may not mint an instance token.
    expect(refusedScopes(['instance:admin'], 'admin', 'member')).toEqual(['instance:admin'])
    expect(refusedScopes(['instance:admin'], 'admin', 'admin')).toEqual([])
    // …and an instance administrator is still bound by the workspace role for workspace scopes.
    expect(refusedScopes(['items:write'], 'viewer', 'admin')).toEqual(['items:write'])
  })

  it('covers only what it names, plus what a scope includes', () => {
    expect(covers(['items:read'], 'item.read')).toBe(true)
    expect(covers(['items:read'], 'item.write')).toBe(false)
    expect(covers([], 'board.read')).toBe(false)
    expect(covers(['boards:read', 'items:read'], 'board.read')).toBe(true)
    // Writing a card includes commenting on it — the one nesting in the table.
    expect(covers(['items:write'], 'item.comment')).toBe(true)
    expect(covers(['items:comment'], 'item.write')).toBe(false)
  })

  it('says what a person approved, in words', () => {
    expect(describeScopes(['boards:read'])).toBe('read boards')
    expect(describeScopes(['boards:read', 'items:read'])).toBe('read boards and read cards')
    expect(describeScopes(['boards:read', 'items:read', 'people:read'])).toBe(
      'read boards, read cards and read people',
    )
    expect(describeScopes([])).toBe('nothing')
  })

  it('offers a screen only the scopes that screen could grant', () => {
    expect(rolesScopes('viewer', 'member')).toEqual(['boards:read', 'items:read', 'people:read', 'items:comment'])
    expect(rolesScopes('admin', 'admin')).toEqual(SCOPE_ORDER)
    // Nothing outside the closed set, whatever a client sends.
    expect(isScope('boards:read')).toBe(true)
    expect(isScope('boards:*')).toBe(false)
    expect(isScope('')).toBe(false)
  })

  it('is exhaustive at the type level as well as at run time', () => {
    // A hand-built union of everything the table reaches; if `Action` grows and no scope names the
    // new member, this stops compiling rather than shipping an act no token can perform.
    type Covered = (typeof SCOPES)[Scope]['actions'][number]
    const checks: Record<Covered, true> = Object.fromEntries(ACTIONS.map((a: Action) => [a, true])) as Record<
      Covered,
      true
    >
    expect(Object.keys(checks).length).toBe(ACTIONS.length)
  })
})
