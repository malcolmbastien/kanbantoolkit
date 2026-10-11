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
  rollupOf,
  statusOf,
  type Graph,
} from './derive'
import { bucketLaneId, childrenOf, effectiveStage, isLeaf, laneCardCount, leafLanes, rootLane, topLevelLanes } from './lanes'
import { createSeed } from './seed'
import type { FlowState } from './types'

const graphOf = (s: FlowState): Graph => ({ items: s.items, edges: s.edges, placements: s.placements, lanes: s.lanes })
const laneByName = (s: FlowState, boardId: string, name: string) =>
  s.lanes.find((l) => l.boardId === boardId && l.name === name)!

describe('generic hierarchy — parent / child', () => {
  const s = createSeed()
  const g = graphOf(s)

  it('depth is derived from the parent chain', () => {
    expect(depth('it-dt', g)).toBe(0)
    expect(depth('it-onboarding', g)).toBe(1)
    expect(depth('it-signup', g)).toBe(2)
    expect(depth('st-form', g)).toBe(3)
  })

  it('a card has at most one parent', () => {
    expect(decompositionParent('st-form', s.edges)).toBe('it-signup')
    expect(decompositionChildren('it-signup', s.edges)).toContain('st-form')
  })
})

describe('recursive LeanKit lanes', () => {
  const s = createSeed()

  it('every board root is a column split with the standard typed columns', () => {
    expect(rootLane(s.lanes, 'b-core')?.orientation).toBe('columns')
    expect(rootLane(s.lanes, 'b-portfolio')?.orientation).toBe('columns')
    expect(topLevelLanes(s.lanes, 'b-core').length).toBe(4)
    expect(topLevelLanes(s.lanes, 'b-portfolio').length).toBe(4)
  })

  it('In Progress is refined per team (Dev/Test nested under Team Alpha)', () => {
    const inProgress = s.lanes.find((l) => l.boardId === 'b-core' && l.name === 'In Progress')!
    expect(isLeaf(s.lanes, inProgress.id)).toBe(false)
    const leaves = leafLanes(s.lanes, 'b-core').map((l) => l.name)
    expect(leaves).toContain('Dev')
    expect(leaves).toContain('Test')
  })

  it('wip counts walk the subtree', () => {
    const ns = topLevelLanes(s.lanes, 'b-core')[0]
    expect(laneCardCount(s.lanes, s.placements, ns.id)).toBeGreaterThan(0)
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

  it('flips to Satisfied once the blocker moves to a done lane — dependent untouched', () => {
    const s2 = createSeed()
    const done = laneByName(s2, 'b-platform', 'Done')
    s2.placements = s2.placements.map((p) =>
      p.itemId === 'it-api' && p.boardId === 'b-platform' ? { ...p, laneId: done.id } : p,
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
    expect(decompositionChildren('it-signup', s.edges).length).toBe(17)
    expect(openDescendants('it-signup', g).length).toBe(16)
  })

  it('a story attributed to two objectives is one unit of work', () => {
    const objs = attributedObjectives('st-form', s.edges, s.objectives)
    expect(objs.map((o) => o.id).sort()).toEqual(['obj-activation', 'obj-ttv'])
  })
})

describe('rollup — a parent status is determined by the lowest-level work', () => {
  const s = createSeed()
  const g = graphOf(s)

  it('all leaves done → done; none started → notStarted; some started → inProgress', () => {
    expect(rollupOf('it-beta', g).bucket).toBe('done')
    expect(rollupOf('it-beta', g).percent).toBe(100)
    expect(rollupOf('it-research', g).bucket).toBe('notStarted')
    expect(rollupOf('it-onboarding', g).bucket).toBe('inProgress')
  })

  it('rollup counts walk down to the deepest leaves', () => {
    // Beta Launch -> Closed beta -> Ship beta (one leaf, done)
    expect(rollupOf('it-beta', g).total).toBe(1)
    expect(rollupOf('it-beta', g).done).toBe(1)
  })

  it('a derived board maps a rollup bucket onto its start / done lanes', () => {
    const requested = s.lanes.find((l) => l.boardId === 'b-portfolio' && l.name === 'Not Started')!
    const done = s.lanes.find((l) => l.boardId === 'b-portfolio' && l.name === 'Done')!
    expect(bucketLaneId(s.lanes, 'b-portfolio', 'notStarted')).toBe(requested.id)
    expect(bucketLaneId(s.lanes, 'b-portfolio', 'done')).toBe(done.id)
    expect(bucketLaneId(s.lanes, 'b-portfolio', 'inProgress')).toBeDefined()
    expect(bucketLaneId(s.lanes, 'b-portfolio', 'backlog')).toBe(
      s.lanes.find((l) => l.boardId === 'b-portfolio' && l.name === 'Backlog')!.id,
    )
  })

  it('Backlog is uncommitted and pulls its ancestors back to Backlog', () => {
    const s2 = createSeed()
    expect(rollupOf('it-data', graphOf(s2)).bucket).toBe('backlog')

    // Move one of New signup flow's cards into a Backlog cell.
    const backlogTop = s2.lanes.find((l) => l.boardId === 'b-core' && l.name === 'Backlog')!
    const backlogLeaf = childrenOf(s2.lanes, backlogTop.id)[0]
    s2.placements = s2.placements.map((p) =>
      p.itemId === 'st-email' && p.boardId === 'b-core' ? { ...p, laneId: backlogLeaf.id } : p,
    )
    // The committed initiative can no longer be committed while it has a Backlog child…
    expect(rollupOf('it-signup', graphOf(s2)).bucket).toBe('backlog')
    // …and neither can its parent initiative.
    expect(rollupOf('it-onboarding', graphOf(s2)).bucket).toBe('backlog')
  })
})

describe('typed stage columns (Backlog / Not Started / In Progress / Done)', () => {
  const s = createSeed()

  it('a team board has the standard typed top-level columns', () => {
    const tops = topLevelLanes(s.lanes, 'b-team-alpha')
    expect(tops.map((t) => t.name)).toEqual(['Backlog', 'Not Started', 'In Progress', 'Done'])
    expect(tops.map((t) => t.stage)).toEqual(['backlog', 'notStarted', 'inProgress', 'done'])
  })

  it('split sub-columns inherit their column type', () => {
    const dev = s.lanes.find((l) => l.boardId === 'b-team-alpha' && l.name === 'Dev')!
    const test = s.lanes.find((l) => l.boardId === 'b-team-alpha' && l.name === 'Test')!
    expect(effectiveStage(s.lanes, dev.id)).toBe('inProgress')
    expect(effectiveStage(s.lanes, test.id)).toBe('inProgress')
    const done = s.lanes.find((l) => l.boardId === 'b-team-alpha' && l.name === 'Done')!
    expect(effectiveStage(s.lanes, done.id)).toBe('done')
  })

  it('leaf status reads from the stage (a Done-column leaf resolves)', () => {
    // st-design is placed on Done columns; effective stage there is done.
    const g = graphOf(s)
    expect(statusOf('st-design', g).resolved).toBe(true)
  })
})
