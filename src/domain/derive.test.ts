import { describe, expect, it } from 'vitest'
import {
  attributedObjectives,
  blockedBelow,
  checklistItems,
  checklistProgress,
  dependentSummary,
  decompositionChildren,
  decompositionParent,
  depth,
  dependencyState,
  isArchived,
  isBlocked,
  initiativeOf,
  openDescendants,
  openDependenciesOf,
  rollupOf,
  statusOf,
  waitsOn,
  type Graph,
} from './derive'
import { bucketLaneId, effectiveStage, isLeaf, laneCardCount, leafLanes, rootLane, topLevelLanes, wipState } from './lanes'
import { createSeed } from './seed'
import type { FlowState, Item } from './types'

const graphOf = (s: FlowState): Graph => ({ items: s.items, edges: s.edges, links: s.links, placements: s.placements, lanes: s.lanes })
const laneByName = (s: FlowState, boardId: string, name: string) =>
  s.lanes.find((l) => l.boardId === boardId && l.name === name)!

describe('generic hierarchy — parent / child', () => {
  const s = createSeed()
  const g = graphOf(s)

  it('depth is derived from the parent chain', () => {
    expect(depth('init-onboarding', g)).toBe(0)
    expect(depth('init-signup', g)).toBe(1)
    expect(depth('st-signup-form', g)).toBe(2)
  })

  it('a card has at most one parent', () => {
    expect(decompositionParent('st-signup-form', s.edges)).toBe('init-signup')
    expect(decompositionChildren('init-signup', s.edges)).toContain('st-signup-form')
  })
})

describe('recursive LeanKit lanes', () => {
  const s = createSeed()

  it('every board root is a column split with the standard typed columns', () => {
    expect(rootLane(s.lanes, 'b-atlas')?.orientation).toBe('columns')
    expect(rootLane(s.lanes, 'b-portfolio')?.orientation).toBe('columns')
    expect(topLevelLanes(s.lanes, 'b-atlas').length).toBe(4)
    expect(topLevelLanes(s.lanes, 'b-portfolio').length).toBe(4)
  })

  it('In Progress is refined into Dev / Test on team boards', () => {
    const inProgress = laneByName(s, 'b-atlas', 'In Progress')
    expect(isLeaf(s.lanes, inProgress.id)).toBe(false)
    const leaves = leafLanes(s.lanes, 'b-atlas').map((l) => l.name)
    expect(leaves).toContain('Dev')
    expect(leaves).toContain('Test')
  })

  it('wip counts walk the subtree', () => {
    const ns = laneByName(s, 'b-atlas', 'Not Started')
    expect(laneCardCount(s.lanes, s.placements, ns.id)).toBeGreaterThan(0)
  })
})

describe('dependency state is computed from cells', () => {
  const s = createSeed()
  const g = graphOf(s)

  it('unresolved dependency + not-started dependent = Open / planning risk', () => {
    expect(statusOf('init-gateway', g).resolved).toBe(false)
    expect(statusOf('st-email', g).started).toBe(false)
    expect(dependencyState('init-gateway', 'st-email', g)).toBe('OpenPlanningRisk')
  })

  it('unresolved dependency + in-progress dependent = Open / live blockage', () => {
    expect(dependencyState('init-gateway', 'st-sso', g)).toBe('OpenLiveBlockage')
  })

  it('flips to Satisfied once the dependency moves to a done lane — dependents untouched', () => {
    const s2 = createSeed()
    const done = laneByName(s2, 'b-nova', 'Done')
    s2.placements = s2.placements.map((p) =>
      p.itemId === 'init-gateway' && p.boardId === 'b-nova' ? { ...p, laneId: done.id } : p,
    )
    expect(dependencyState('init-gateway', 'st-email', graphOf(s2))).toBe('Satisfied')
  })

  it('the dependency carries a cross-team dependents count', () => {
    expect(dependentSummary('init-gateway', g).count).toBe(2)
  })

  it('shows one open dependency on the dependent', () => {
    expect(openDependenciesOf('st-email', g).length).toBe(1)
  })
})

describe('blocked is an explicit status, not derived from links', () => {
  const s = createSeed()
  const g = graphOf(s)

  it('reads the status set on the item', () => {
    expect(isBlocked('st-sso', g)).toBe(true)
    expect(isBlocked('st-email', g)).toBe(false)
  })

  it('blocking an item does not change its cell or dependency state', () => {
    const s2 = createSeed()
    const before = statusOf('st-email', graphOf(s2))
    s2.items = s2.items.map((i) => (i.id === 'st-email' ? { ...i, blocked: true } : i))
    const after = statusOf('st-email', graphOf(s2))
    expect({ ...after }).toEqual({ ...before })
    // A link into an unblocked item stays open — the status is orthogonal.
    expect(dependencyState('init-gateway', 'st-email', graphOf(s2))).toBe('OpenPlanningRisk')
  })

  it('a blockage on a leaf rolls up to its initiative and its top-level parent', () => {
    expect(blockedBelow('st-sso', g)).toBe(0) // a leaf has nothing below it
    expect(blockedBelow('init-signup', g)).toBe(1)
    expect(blockedBelow('init-onboarding', g)).toBe(1)
    expect(blockedBelow('init-gateway', g)).toBe(1) // st-ratelimit
  })
})

describe('archive — filed away, still in the data', () => {
  const s = createSeed()
  const g = graphOf(s)

  it('reads the archived flag', () => {
    expect(isArchived(s.items.find((i) => i.id === 'init-legacy'))).toBe(true)
    expect(isArchived(s.items.find((i) => i.id === 'init-signup'))).toBe(false)
    expect(isArchived(undefined)).toBe(false)
  })

  it('archived leaves still count toward rollup but not toward open pressure', () => {
    expect(rollupOf('init-legacy', g).bucket).toBe('done')
    expect(openDescendants('init-legacy', g).length).toBe(0)
    expect(blockedBelow('init-legacy', g)).toBe(0)
  })
})

describe('composition pressure and attribution', () => {
  const s = createSeed()
  const g = graphOf(s)

  it('a team initiative shows its open descendants', () => {
    // 5 children, one (Design signup screens) is in Done.
    expect(decompositionChildren('init-signup', s.edges).length).toBe(5)
    expect(openDescendants('init-signup', g).length).toBe(4)
  })

  it('an initiative can map to several OKRs', () => {
    const edges = [...s.edges, { id: 'x1', kind: 'attribution' as const, from: 'obj-efficiency', to: 'init-signup' }]
    const objs = attributedObjectives('init-signup', edges, s.objectives)
    expect(objs.map((o) => o.id).sort()).toEqual(['obj-activation', 'obj-efficiency'])
  })

  it('initiativeOf walks up to the nearest initiative; cards have no OKRs', () => {
    const initiativeTypeId = s.issueTypes.find((t) => t.name === 'Initiative')?.id
    expect(initiativeOf('st-signup-form', g, initiativeTypeId)?.id).toBe('init-signup')
    expect(initiativeOf('init-signup', g, initiativeTypeId)?.id).toBe('init-signup')
    // OKR attribution is initiative-only.
    expect(attributedObjectives('st-signup-form', s.edges, s.objectives)).toEqual([])
  })
})

describe('rollup — a parent status is determined by the lowest-level work', () => {
  const s = createSeed()
  const g = graphOf(s)

  it('all committed, some started → inProgress; a Backlog leaf forces Backlog', () => {
    expect(rollupOf('init-signup', g).bucket).toBe('inProgress')
    expect(rollupOf('init-signup', g).percent).toBe(20)
    expect(rollupOf('init-onboarding', g).bucket).toBe('inProgress')
    // Platform work is all Backlog (uncommitted).
    expect(rollupOf('init-gateway', g).bucket).toBe('backlog')
    expect(rollupOf('init-platform', g).bucket).toBe('backlog')
  })

  it('a committed parent cannot have uncommitted children — the rule is derived', () => {
    const s2 = createSeed()
    const backlog = laneByName(s2, 'b-atlas', 'Backlog')
    s2.placements = s2.placements.map((p) =>
      p.itemId === 'st-email' && p.boardId === 'b-atlas' ? { ...p, laneId: backlog.id } : p,
    )
    expect(rollupOf('init-signup', graphOf(s2)).bucket).toBe('backlog')
    expect(rollupOf('init-onboarding', graphOf(s2)).bucket).toBe('backlog')
  })

  it('moving the last Backlog leaf out returns the ancestors to a committed stage', () => {
    const s2 = createSeed()
    const backlog = laneByName(s2, 'b-nova', 'Backlog')
    const notStarted = laneByName(s2, 'b-nova', 'Not Started')
    // API gateway's three leaves all start in Backlog, so it and its parent are Backlog.
    expect(rollupOf('init-gateway', graphOf(s2)).bucket).toBe('backlog')
    expect(rollupOf('init-platform', graphOf(s2)).bucket).toBe('backlog')

    s2.placements = s2.placements.map((p) =>
      p.boardId === 'b-nova' && p.laneId === backlog.id ? { ...p, laneId: notStarted.id } : p,
    )

    // The last Backlog leaf is gone — ancestors recalculate back to committed.
    expect(rollupOf('init-gateway', graphOf(s2)).bucket).toBe('notStarted')
    expect(rollupOf('init-platform', graphOf(s2)).bucket).toBe('notStarted')
  })

  it('all committed leaves done → the parent rolls up to done', () => {
    const s2 = createSeed()
    const done = laneByName(s2, 'b-atlas', 'Done')
    const children = ['st-signup-design', 'st-signup-form', 'st-email', 'st-sso', 'df-signup']
    s2.placements = s2.placements.map((p) =>
      p.boardId === 'b-atlas' && children.includes(p.itemId) ? { ...p, laneId: done.id } : p,
    )
    const roll = rollupOf('init-signup', graphOf(s2))
    expect(roll.bucket).toBe('done')
    expect(roll.percent).toBe(100)
  })

  it('a derived board maps a rollup bucket onto its typed column', () => {
    expect(bucketLaneId(s.lanes, 'b-portfolio', 'backlog')).toBe(laneByName(s, 'b-portfolio', 'Backlog').id)
    expect(bucketLaneId(s.lanes, 'b-portfolio', 'notStarted')).toBe(laneByName(s, 'b-portfolio', 'Not Started').id)
    expect(bucketLaneId(s.lanes, 'b-portfolio', 'done')).toBe(laneByName(s, 'b-portfolio', 'Done').id)
  })
})

describe('WIP limit state', () => {
  it('is null below the limit, "at" at the limit, "over" past it', () => {
    expect(wipState(0, undefined)).toBeNull()
    expect(wipState(1, 2)).toBeNull()
    expect(wipState(2, 2)).toBe('at')
    expect(wipState(3, 2)).toBe('over')
  })
})

describe('typed stage columns (Backlog / Not Started / In Progress / Done)', () => {  const s = createSeed()

  it('every seeded board includes Backlog as the first typed column', () => {
    expect(s.boards.length).toBeGreaterThan(0)
    for (const board of s.boards) {
      const tops = topLevelLanes(s.lanes, board.id)
      expect(tops.map((t) => t.name)).toEqual(['Backlog', 'Not Started', 'In Progress', 'Done'])
      expect(tops.map((t) => t.stage)).toEqual(['backlog', 'notStarted', 'inProgress', 'done'])
    }
  })

  it('split sub-columns inherit their column type', () => {
    const dev = laneByName(s, 'b-atlas', 'Dev')
    const test = laneByName(s, 'b-atlas', 'Test')
    expect(effectiveStage(s.lanes, dev.id)).toBe('inProgress')
    expect(effectiveStage(s.lanes, test.id)).toBe('inProgress')
  })

  it('leaf status reads from the stage (a Done-column leaf resolves)', () => {
    expect(statusOf('st-signup-design', graphOf(s)).resolved).toBe(true)
  })
})

describe('boundary waiting — local cards waiting on an external item', () => {
  const s = createSeed()

  it('is true for a local card with a still-open dependency on the external item', () => {
    const g = graphOf(s)
    // st-email and st-sso both depend on init-gateway (a Team Nova initiative).
    expect(waitsOn('st-email', 'init-gateway', g)).toBe(true)
    expect(waitsOn('st-sso', 'init-gateway', g)).toBe(true)
    // Not the other direction, and not for an unrelated item.
    expect(waitsOn('init-gateway', 'st-email', g)).toBe(false)
    expect(waitsOn('st-email', 'init-onboarding', g)).toBe(false)
  })
})

describe('checklist — sub-tasks inside a card', () => {
  const card = (checklist?: Item['checklist']): Item => ({ id: 'x', title: 'X', typeId: 't-story', createdAt: 0, checklist })

  it('reports progress and tolerates a missing checklist', () => {
    expect(checklistProgress(undefined)).toEqual({ done: 0, total: 0 })
    expect(checklistItems(card())).toEqual([])
    const c = card([
      { id: 'a', text: 'One', done: true },
      { id: 'b', text: 'Two', done: false },
      { id: 'c', text: 'Three', done: true },
    ])
    expect(checklistProgress(c)).toEqual({ done: 2, total: 3 })
  })
})
