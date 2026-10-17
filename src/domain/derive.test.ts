import { describe, expect, it } from 'vitest'
import {
  attributedObjectives,
  okrCoverage,
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
  lineageOf,
  openDescendants,
  openDependenciesOf,
  rollupOf,
  statusOf,
  withChecklistEntry,
  withChecklistEntryText,
  withToggledChecklistEntry,
  withoutChecklistEntry,
  uncommittedBelow,
  waitsOn,
  type Graph,
} from './derive'
import { effectiveStage, inheritedWipState, isLeaf, laneCardCount, leafLanes, rootLane, strongestWip, topLevelLanes, wipState } from './lanes'
import { createFixture } from './fixture'
import type { Edge, FlowState, Item, Lane } from './types'

const graphOf = (s: FlowState): Graph => ({ items: s.items, edges: s.edges, links: s.links, placements: s.placements, lanes: s.lanes })
const laneByName = (s: FlowState, boardId: string, name: string) =>
  s.lanes.find((l) => l.boardId === boardId && l.name === name)!

describe('generic hierarchy — parent / child', () => {
  const s = createFixture()
  const g = graphOf(s)

  it('adds up the work below, counting an unsized leaf as one point', () => {
    const item = (id: string, extra: Partial<Item> = {}): Item => ({ id, title: id, typeId: 't-story', createdAt: 0, ...extra })
    const edge = (from: string, to: string): Edge => ({ id: `${from}-${to}`, kind: 'decomposition', from, to })
    const g: Graph = {
      items: [
        item('init', { typeId: 't-initiative', size: 21 }),
        item('epic', { size: 5 }),
        item('a', { size: 2 }),
        item('b'), // unsized: one point, so a size and a count never disagree
        item('c', { size: 8 }),
        item('lonely', { typeId: 't-initiative', size: 13 }),
      ],
      edges: [edge('init', 'epic'), edge('epic', 'a'), edge('epic', 'b'), edge('init', 'c')],
      links: [],
      placements: [],
      lanes: [],
    }
    // Two levels deep: the sum is of the leaves, whatever the shape above them.
    expect(rollupOf('init', g).size).toBe(2 + 1 + 8)
    // An item's own size is not "below" it.
    expect(rollupOf('epic', g).size).toBe(3)
    expect(rollupOf('a', g).size).toBe(0)
    // And an initiative with nothing under it reads 0 — not its own claim of 13.
    expect(rollupOf('lonely', g).size).toBe(0)
  })

  it('depth is derived from the parent chain', () => {
    expect(depth('init-activation', g)).toBe(0)
    expect(depth('init-growth', g)).toBe(1)
    expect(depth('init-onboarding', g)).toBe(2)
    expect(depth('init-signup', g)).toBe(3)
    expect(depth('st-signup-form', g)).toBe(4)
  })

  it('a card has at most one parent', () => {
    expect(decompositionParent('st-signup-form', s.edges)).toBe('init-signup')
    expect(decompositionChildren('init-signup', s.edges)).toContain('st-signup-form')
  })
})

describe('recursive LeanKit lanes', () => {
  const s = createFixture()

  it('every board root is a column split with the standard typed columns', () => {
    expect(rootLane(s.lanes, 'b-atlas', 'cards')?.orientation).toBe('columns')
    expect(rootLane(s.lanes, 'b-portfolio', 'cards')?.orientation).toBe('columns')
    expect(topLevelLanes(s.lanes, 'b-atlas', 'cards').length).toBe(4)
    expect(topLevelLanes(s.lanes, 'b-portfolio', 'cards').length).toBe(4)
  })

  it('In Progress is refined into Dev / Test on team boards', () => {
    const inProgress = laneByName(s, 'b-atlas', 'In Progress')
    expect(isLeaf(s.lanes, inProgress.id)).toBe(false)
    const leaves = leafLanes(s.lanes, 'b-atlas', 'cards').map((l) => l.name)
    expect(leaves).toContain('Dev')
    expect(leaves).toContain('Test')
  })

  it('wip counts walk the subtree', () => {
    const ns = laneByName(s, 'b-atlas', 'Not Started')
    expect(laneCardCount(s.lanes, s.placements, ns.id)).toBeGreaterThan(0)
  })
})

describe('dependency state is computed from cells', () => {
  const s = createFixture()
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
    const s2 = createFixture()
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
  const s = createFixture()
  const g = graphOf(s)

  it('reads the status set on the item', () => {
    expect(isBlocked('st-sso', g)).toBe(true)
    expect(isBlocked('st-email', g)).toBe(false)
  })

  it('blocking an item does not change its cell or dependency state', () => {
    const s2 = createFixture()
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
  const s = createFixture()
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
  const s = createFixture()
  const g = graphOf(s)

  it('a team initiative shows its open descendants', () => {
    // 5 children, one (Design signup screens) is in Done.
    expect(decompositionChildren('init-signup', s.edges).length).toBe(5)
    expect(openDescendants('init-signup', g).length).toBe(4)
  })

  it('a strategic initiative can map to several OKRs', () => {
    const edges = [...s.edges, { id: 'x1', kind: 'attribution' as const, from: 'obj-efficiency', to: 'init-activation' }]
    const objs = attributedObjectives('init-activation', edges, s.objectives)
    expect(objs.map((o) => o.id).sort()).toEqual(['obj-activation', 'obj-efficiency'])
  })

  it('okrCoverage reports unmapped initiatives and unserved OKRs', () => {
    const strategic = ['init-activation', 'init-efficiency', 'init-explore'].map(
      (id) => s.items.find((i) => i.id === id)!,
    )
    const { unmapped, unserved } = okrCoverage(strategic, s.objectives, s.edges)
    expect(unmapped.map((i) => i.id)).toEqual(['init-explore'])
    expect(unserved.map((o) => o.id)).toEqual(['obj-reliability'])
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
  const s = createFixture()
  const g = graphOf(s)

  it('all committed, some started → inProgress; all uncommitted → backlog', () => {
    expect(rollupOf('init-signup', g).bucket).toBe('inProgress')
    expect(rollupOf('init-signup', g).percent).toBe(20)
    expect(rollupOf('init-onboarding', g).bucket).toBe('inProgress')
    // Platform work is all Backlog (uncommitted).
    expect(rollupOf('init-gateway', g).bucket).toBe('backlog')
    expect(rollupOf('init-platform', g).bucket).toBe('backlog')
  })

  it('a child stream under way lifts the parent out of Backlog', () => {
    // Customer Growth decomposes into Onboarding Redesign (already under way) and
    // Platform Consolidation (entirely uncommitted). The parent is in progress — one
    // uncommitted stream must not drag the whole initiative back to Backlog.
    expect(rollupOf('init-onboarding', g).bucket).toBe('inProgress')
    expect(rollupOf('init-platform', g).bucket).toBe('backlog')
    expect(rollupOf('init-growth', g).bucket).toBe('inProgress')
  })

  it('progress is acknowledged even while part of the work is still uncommitted', () => {
    const s2 = createFixture()
    const backlog = laneByName(s2, 'b-atlas', 'Backlog')
    s2.placements = s2.placements.map((p) =>
      p.itemId === 'st-email' && p.boardId === 'b-atlas' ? { ...p, laneId: backlog.id } : p,
    )
    // st-email went back to Backlog, but its siblings are already under way.
    expect(rollupOf('init-signup', graphOf(s2)).bucket).toBe('inProgress')
    expect(rollupOf('init-onboarding', graphOf(s2)).bucket).toBe('inProgress')
  })

  it('moving the last Backlog leaf out returns the ancestors to a committed stage', () => {
    const s2 = createFixture()
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

  it('committed work sitting over uncommitted leaves is flagged, not blocked', () => {
    // Customer Growth is under way, but Platform Consolidation's three leaves are all
    // still in Backlog — so part of the commitment isn't committed.
    expect(rollupOf('init-growth', g).bucket).toBe('inProgress')
    expect(uncommittedBelow('init-growth', g)).toBe(3)

    // Nothing is claimed while the item itself is still uncommitted…
    expect(rollupOf('init-platform', g).bucket).toBe('backlog')
    expect(uncommittedBelow('init-platform', g)).toBe(0)

    // …and nothing is flagged when every leaf is committed.
    expect(rollupOf('init-signup', g).bucket).toBe('inProgress')
    expect(uncommittedBelow('init-signup', g)).toBe(0)
  })

  it('flags a Not Started initiative too, once part of its work is uncommitted', () => {
    const s2 = createFixture()
    const ns = laneByName(s2, 'b-atlas', 'Not Started')
    const backlog = laneByName(s2, 'b-atlas', 'Backlog')
    s2.placements = s2.placements.map((p) => {
      if (p.boardId !== 'b-atlas') return p
      return { ...p, laneId: p.itemId === 'st-email' ? backlog.id : ns.id }
    })
    expect(rollupOf('init-signup', graphOf(s2)).bucket).toBe('notStarted')
    expect(uncommittedBelow('init-signup', graphOf(s2))).toBe(1)
  })

  it('all committed leaves done → the parent rolls up to done', () => {
    const s2 = createFixture()
    const done = laneByName(s2, 'b-atlas', 'Done')
    const children = ['st-signup-design', 'st-signup-form', 'st-email', 'st-sso', 'df-signup']
    s2.placements = s2.placements.map((p) =>
      p.boardId === 'b-atlas' && children.includes(p.itemId) ? { ...p, laneId: done.id } : p,
    )
    const roll = rollupOf('init-signup', graphOf(s2))
    expect(roll.bucket).toBe('done')
    expect(roll.percent).toBe(100)
  })

  it('reads 100% without being done when one leaf is still unplanned', () => {
    // The Done stamp is `bucket === 'done'`, so this is the case that would make it lie:
    // every committed leaf finished, so the percentage reads 100, while one leaf sits in
    // Backlog. Completion is counted against every leaf, not against the committed ones.
    const s2 = createFixture()
    const done = laneByName(s2, 'b-atlas', 'Done')
    const backlog = laneByName(s2, 'b-atlas', 'Backlog')
    const finished = ['st-signup-design', 'st-signup-form', 'st-email', 'st-sso']
    s2.placements = s2.placements.map((p) => {
      if (p.boardId !== 'b-atlas') return p
      if (finished.includes(p.itemId)) return { ...p, laneId: done.id }
      if (p.itemId === 'df-signup') return { ...p, laneId: backlog.id }
      return p
    })
    const roll = rollupOf('init-signup', graphOf(s2))
    expect(roll.percent).toBe(100)
    expect(roll.bucket).not.toBe('done')
  })
})

describe('WIP limit state', () => {
  it('is null below the limit, "at" at the limit, "over" past it', () => {
    expect(wipState(0, undefined)).toBeNull()
    expect(wipState(1, 2)).toBeNull()
    expect(wipState(2, 2)).toBe('at')
    expect(wipState(3, 2)).toBe('over')
  })

  it('a descendant inherits the state of the column above it — the children exist inside it', () => {
    // In Progress (3/3) → Dev (1/2), Test (no limit): both children are inside a full column.
    const inProgress: Lane = { id: 'l-ip', boardId: 'b', parentId: null, order: 0, name: 'In Progress', workflow: 'cards', stage: 'inProgress', wipLimit: 3 }
    const dev: Lane = { id: 'l-dev', boardId: 'b', parentId: 'l-ip', order: 0, name: 'Dev', workflow: 'cards' }
    const test: Lane = { id: 'l-test', boardId: 'b', parentId: 'l-ip', order: 1, name: 'Test', workflow: 'cards' }
    const lanes: Lane[] = [inProgress, dev, test]
    const counts = (id: string) => (id === 'l-ip' ? 3 : id === 'l-dev' ? 1 : 2)
    expect(inheritedWipState(lanes, 'l-dev', counts)).toBe('at')
    expect(inheritedWipState(lanes, 'l-test', counts)).toBe('at')
    expect(inheritedWipState(lanes, 'l-ip', counts)).toBeNull() // the column itself reads its own limit

    // One card more: the column is over, and everything under it says so.
    expect(inheritedWipState(lanes, 'l-dev', (id) => (id === 'l-ip' ? 4 : counts(id)))).toBe('over')
  })

  it('the strongest state wins down the chain — over outranks at, and deeper at-limit ancestors count', () => {
    const grand: Lane = { id: 'g', boardId: 'b', parentId: null, order: 0, name: 'G', workflow: 'cards', stage: 'inProgress', wipLimit: 2 }
    const mid: Lane = { id: 'm', boardId: 'b', parentId: 'g', order: 0, name: 'M', workflow: 'cards', wipLimit: 1 }
    const leaf: Lane = { id: 'x', boardId: 'b', parentId: 'm', order: 0, name: 'X', workflow: 'cards' }
    const lanes: Lane[] = [grand, mid, leaf]
    // Grand is at (2/2) and mid is over (2/1): the leaf reads over, not merely at.
    expect(inheritedWipState(lanes, 'x', (id) => (id === 'g' ? 2 : id === 'm' ? 2 : 0))).toBe('over')
    // Grand over and mid under its own limit: still over.
    expect(inheritedWipState(lanes, 'x', (id) => (id === 'g' ? 3 : id === 'm' ? 1 : 0))).toBe('over')
    // An unbounded chain is nothing.
    expect(inheritedWipState([{ ...grand, wipLimit: undefined }, { ...mid, wipLimit: undefined }, leaf], 'x', () => 9)).toBeNull()
  })

  it('two states at once compose — at inside over is over', () => {
    expect(strongestWip('at', 'over')).toBe('over')
    expect(strongestWip('over', null)).toBe('over')
    expect(strongestWip('at', null)).toBe('at')
    expect(strongestWip(null, null)).toBeNull()
  })
})

describe('typed stage columns (Backlog / Not Started / In Progress / Done)', () => {  const s = createFixture()

  it('every seeded board includes Backlog as the first typed column', () => {
    expect(s.boards.length).toBeGreaterThan(0)
    for (const board of s.boards) {
      const tops = topLevelLanes(s.lanes, board.id, 'cards')
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
  const s = createFixture()

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

describe('lineage — the chain a card rolls up through', () => {
  const s = createFixture()
  const g = graphOf(s)

  it('walks from the root down to the item', () => {
    expect(lineageOf('st-email', g).map((i) => i.id)).toEqual([
      'init-activation',
      'init-growth',
      'init-onboarding',
      'init-signup',
      'st-email',
    ])
  })

  it('an item with no parent is its own lineage', () => {
    expect(lineageOf('init-activation', g).map((i) => i.id)).toEqual(['init-activation'])
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

  it('adds, ticks and removes an entry without touching the others', () => {
    const start = card([{ id: 'a', text: 'One', done: true }])
    const added = withChecklistEntry(start, { id: 'b', text: 'Two', done: false })
    expect(added.checklist).toEqual([
      { id: 'a', text: 'One', done: true },
      { id: 'b', text: 'Two', done: false },
    ])

    // Ticking is a toggle, and it leaves the entries it was not asked about alone.
    const ticked = withToggledChecklistEntry(added, 'b')
    expect(ticked.checklist?.[1].done).toBe(true)
    expect(ticked.checklist?.[0]).toEqual({ id: 'a', text: 'One', done: true })
    expect(withToggledChecklistEntry(ticked, 'b').checklist?.[1].done).toBe(false)

    expect(withoutChecklistEntry(ticked, 'a').checklist).toEqual([{ id: 'b', text: 'Two', done: true }])

    // Every edit tolerates a card that has no checklist yet, and an entry that is not there.
    expect(withChecklistEntry(card(), { id: 'x', text: 'X', done: false }).checklist).toHaveLength(1)
    expect(withoutChecklistEntry(card(), 'nope').checklist).toEqual([])
    expect(withToggledChecklistEntry(card(), 'nope').checklist).toEqual([])

    // ...and none of them mutates what it was given.
    expect(start.checklist).toEqual([{ id: 'a', text: 'One', done: true }])
  })

  it('renames an entry, and clearing its text removes it', () => {
    const c = card([
      { id: 'a', text: 'One', done: false },
      { id: 'b', text: 'Two', done: true },
    ])
    expect(withChecklistEntryText(c, 'a', '  Renamed  ').checklist).toEqual([
      { id: 'a', text: 'Renamed', done: false },
      { id: 'b', text: 'Two', done: true },
    ])
    // Renaming keeps the tick: the words changed, not the state.
    expect(withChecklistEntryText(c, 'b', 'Still two').checklist?.[1]).toEqual({ id: 'b', text: 'Still two', done: true })

    // Clearing the line is how you delete it — the same gesture as the remove button.
    expect(withChecklistEntryText(c, 'a', '   ').checklist).toEqual([{ id: 'b', text: 'Two', done: true }])
    // An entry that is not there is left alone, and the original is untouched.
    expect(withChecklistEntryText(c, 'nope', 'X').checklist).toEqual(c.checklist)
    expect(c.checklist?.[0].text).toBe('One')
  })
})
