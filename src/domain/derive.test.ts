import { describe, expect, it } from 'vitest'
import {
  attributedObjectives,
  blockingDeps,
  blockingSummary,
  decompositionChildren,
  decompositionParent,
  depth,
  dependencyState,
  openDescendants,
  statusOf,
  type Graph,
} from './derive'
import { laneCardCount, leafCount, leafLanes, maxDepth } from './lanes'
import { createSeed } from './seed'
import type { FlowState } from './types'

const graphOf = (s: FlowState): Graph => ({
  items: s.items,
  edges: s.edges,
  placements: s.placements,
  lanes: s.lanes,
})
const laneByName = (s: FlowState, boardId: string, name: string) =>
  s.lanes.find((l) => l.boardId === boardId && l.name === name)!

describe('generic hierarchy — parent / child', () => {
  const s = createSeed()
  const g = graphOf(s)

  it('depth is derived from the parent chain', () => {
    expect(depth('it-onboarding', g)).toBe(0)
    expect(depth('it-signup', g)).toBe(1)
    expect(depth('st-form', g)).toBe(2)
  })

  it('a card has at most one parent', () => {
    expect(decompositionParent('st-form', s.edges)).toBe('it-signup')
    expect(decompositionChildren('it-signup', s.edges)).toContain('st-form')
  })
})

describe('LeanKit lanes', () => {
  const s = createSeed()

  it('vertical leaves include the split sub-columns', () => {
    const cols = leafLanes(s.lanes, 'b-core', 'vertical')
    expect(cols.map((l) => l.name)).toEqual(['Backlog', 'Dev', 'Test', 'Review', 'Done'])
    expect(maxDepth(s.lanes, 'b-core', 'vertical')).toBe(1)
    expect(leafCount(s.lanes, laneByName(s, 'b-core', 'In Progress').id)).toBe(2)
  })

  it('counts cards in a lane subtree', () => {
    const inProgress = laneByName(s, 'b-core', 'In Progress')
    // Dev + Test cards
    expect(laneCardCount(s.lanes, s.placements, inProgress.id, 'vertical')).toBeGreaterThan(0)
  })
})

describe('dependency state is computed from cells', () => {
  const s = createSeed()
  const g = graphOf(s)

  it('unresolved blocker + not-started dependent = Open / planning risk', () => {
    expect(statusOf('it-api', g).resolved).toBe(false)
    expect(statusOf('st-profile-schema', g).started).toBe(false)
    expect(dependencyState('it-api', 'st-profile-schema', g)).toBe('OpenPlanningRisk')
  })

  it('flips to Satisfied once the blocker moves to a done column — dependent untouched', () => {
    const s2 = createSeed()
    const done = laneByName(s2, 'b-platform', 'Done')
    s2.placements = s2.placements.map((p) =>
      p.itemId === 'it-api' && p.boardId === 'b-platform' ? { ...p, columnLaneId: done.id } : p,
    )
    expect(dependencyState('it-api', 'st-profile-schema', graphOf(s2))).toBe('Satisfied')
  })

  it('the blocker carries a cross-board badge', () => {
    expect(blockingSummary('it-api', g).count).toBe(2)
  })

  it('shows one blocker badge on the dependent', () => {
    expect(blockingDeps('st-profile-schema', g).length).toBe(1)
  })
})

describe('composition pressure and attribution', () => {
  const s = createSeed()
  const g = graphOf(s)

  it('a feature shows its open descendants', () => {
    // 17 children, one (Design signup form) is in Done.
    expect(decompositionChildren('it-signup', s.edges).length).toBe(17)
    expect(openDescendants('it-signup', g).length).toBe(16)
  })

  it('a story attributed to two objectives is one unit of work', () => {
    const objs = attributedObjectives('st-form', s.edges, s.objectives)
    expect(objs.map((o) => o.id).sort()).toEqual(['obj-activation', 'obj-ttv'])
  })
})
