import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decompositionChildren, decompositionParent, checklistProgress, rollupOf, statusOf } from './domain/derive'
import { boardCardTypeId, boardCardTypes, buildRefs, cardTypes, defaultCardTypeId, descendantBoards, searchItems } from './domain/board'
import { childrenOf, effectiveStage, isLeaf, laneCardCount, leafLanes, rootLane } from './domain/lanes'
import { migratePersisted, migrateState, persistedSlice, useStore } from './store'

vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
})

const s = () => useStore.getState()
const graph = () => {
  const st = s()
  return { items: st.items, edges: st.edges, links: st.links, placements: st.placements, lanes: st.lanes }
}
const laneByName = (boardId: string, name: string) =>
  s().lanes.find((l) => l.boardId === boardId && l.name === name)!

describe('store actions', () => {
  beforeEach(() => s().resetDemo())

  it('one parent: setParent replaces any existing parent', () => {
    s().setParent('st-signup-form', 'init-welcome')
    expect(decompositionParent('st-signup-form', s().edges)).toBe('init-welcome')
    s().setParent('st-signup-form', 'init-signup')
    expect(decompositionParent('st-signup-form', s().edges)).toBe('init-signup')
  })

  it('splitting a leaf into a container moves its cards into the first sub-lane', () => {
    const ns = laneByName('b-atlas', 'Not Started')
    const before = s().placements.filter((p) => p.laneId === ns.id).length
    s().splitLane(ns.id, 'rows')
    const kids = childrenOf(s().lanes, ns.id)
    expect(kids.length).toBe(2)
    expect(isLeaf(s().lanes, ns.id)).toBe(false)
    expect(s().placements.filter((p) => p.laneId === kids[0].id).length).toBe(before)
  })

  it('a nested container can gain a child; the top level is fixed', () => {
    const ip = laneByName('b-atlas', 'In Progress') // a columns container
    const before = childrenOf(s().lanes, ip.id).length
    s().addLane(ip.id)
    expect(childrenOf(s().lanes, ip.id).length).toBe(before + 1)

    const root = rootLane(s().lanes, 'b-atlas')!
    const topBefore = childrenOf(s().lanes, root.id).length
    s().addLane(root.id) // top-level columns are fixed
    expect(childrenOf(s().lanes, root.id).length).toBe(topBefore)
    expect(topBefore).toBe(4)
  })

  it('dependency self-cleans when the dependency moves to a done lane', () => {
    const done = laneByName('b-nova', 'Done')
    expect(statusOf('st-email', graph()).resolved).toBe(false)
    s().moveCard('init-gateway', 'b-nova', done.id)
    expect(statusOf('init-gateway', graph()).resolved).toBe(true)
  })

  it('WIP limits are visual only — they never block a move', () => {
    const done = laneByName('b-nova', 'Done')
    s().setLaneWip(done.id, 1)
    s().moveCard('st-ratelimit', 'b-nova', done.id)
    s().moveCard('st-gateway-contract', 'b-nova', done.id) // over the limit, still allowed
    expect(s().placements.find((p) => p.itemId === 'st-gateway-contract' && p.boardId === 'b-nova')?.laneId).toBe(done.id)
  })

  it('custom types can be added, renamed and recoloured', () => {
    const before = s().issueTypes.length
    s().addIssueType('Risk', '#ef4444')
    const added = s().issueTypes[s().issueTypes.length - 1]
    expect(s().issueTypes.length).toBe(before + 1)
    s().updateIssueType(added.id, { name: 'Threat' })
    expect(s().issueTypes.find((t) => t.id === added.id)?.name).toBe('Threat')
  })

  it('an aggregating board links the boards chosen for it, and refuses cycles', () => {
    const vstream = () => s().boards.find((b) => b.id === 'b-portfolio')!
    expect(vstream().linkedBoardIds).toContain('b-atlas')
    s().removeLinkedBoard('b-portfolio', 'b-atlas')
    expect(vstream().linkedBoardIds ?? []).not.toContain('b-atlas')
    s().addLinkedBoard('b-portfolio', 'b-atlas')
    expect(vstream().linkedBoardIds).toContain('b-atlas')

    // A cycle is refused: the strategy board already aggregates (transitively) the
    // value stream, so the value stream cannot link it back.
    s().addLinkedBoard('b-portfolio', 'b-strategy')
    expect(s().boards.find((b) => b.id === 'b-portfolio')?.linkedBoardIds ?? []).not.toContain('b-strategy')
    // Self-links are refused too.
    s().addLinkedBoard('b-portfolio', 'b-portfolio')
    expect(s().boards.find((b) => b.id === 'b-portfolio')?.linkedBoardIds ?? []).not.toContain('b-portfolio')
  })

  it('descendantBoards walks the aggregation graph transitively', () => {
    expect(descendantBoards(s().boards, 'b-strategy').map((b) => b.id).sort()).toEqual([
      'b-atlas',
      'b-lob',
      'b-nova',
      'b-portfolio',
    ])
  })

  it('links a team initiative under a management initiative', () => {
    const before = s().items.length
    s().linkTeamInitiative('init-onboarding', 'b-nova', 'Linked initiative')
    expect(s().items.length).toBe(before + 1)
    const created = s().items[s().items.length - 1]
    expect(s().edges.some((e) => e.kind === 'decomposition' && e.from === 'init-onboarding' && e.to === created.id)).toBe(true)
    expect(s().placements.some((p) => p.itemId === created.id && p.boardId === 'b-nova')).toBe(true)
  })

  it('can build a custom layout from the standard typed columns', () => {
    s().addBoard('Sketch')
    const boardId = s().boardId
    const root = rootLane(s().lanes, boardId)!
    const cols = () => childrenOf(s().lanes, root.id)
    expect(cols().map((c) => c.name)).toEqual(['Backlog', 'Not Started', 'In Progress', 'Done'])
    expect(cols().map((c) => c.stage)).toEqual(['backlog', 'notStarted', 'inProgress', 'done'])

    s().renameLane(cols()[2].id, 'Doing')
    s().splitLane(cols()[2].id, 'rows', 2)
    const rows = childrenOf(s().lanes, cols()[2].id)
    s().splitLane(rows[0].id, 'columns', 3)
    expect(childrenOf(s().lanes, rows[0].id).length).toBe(3)
    expect(effectiveStage(s().lanes, childrenOf(s().lanes, rows[0].id)[0].id)).toBe('inProgress')
    expect(leafLanes(s().lanes, boardId).length).toBeGreaterThanOrEqual(7)
  })

  it('boards carry a flight-level band that can be changed', () => {
    expect(s().boards.find((b) => b.id === 'b-strategy')?.band).toBe('portfolio')
    expect(s().boards.find((b) => b.id === 'b-portfolio')?.band).toBe('program')
    expect(s().boards.find((b) => b.id === 'b-atlas')?.band).toBe('team')
    s().setBoardBand('b-atlas', 'program')
    expect(s().boards.find((b) => b.id === 'b-atlas')?.band).toBe('program')
    const before = s().boards.length
    s().addBoard('Fresh')
    expect(s().boards.length).toBe(before + 1)
    expect(s().boards[s().boards.length - 1].band).toBe('team')
  })

  it('blocking is an explicit status recorded in the item log', () => {    expect(s().items.find((i) => i.id === 'st-email')?.blocked ?? false).toBe(false)
    s().blockItem('st-email', 'Waiting on gateway')
    const b = s().items.find((i) => i.id === 'st-email')!
    expect(b.blocked).toBe(true)
    expect(b.blockedReason).toBe('Waiting on gateway')
    expect(b.log?.some((e) => e.kind === 'blocked' && e.note === 'Waiting on gateway')).toBe(true)

    s().unblockItem('st-email')
    const u = s().items.find((i) => i.id === 'st-email')!
    expect(u.blocked).toBe(false)
    expect(u.blockedReason).toBeUndefined()
    expect(u.log?.some((e) => e.kind === 'unblocked')).toBe(true)

    s().addLogNote('st-email', 'note text')
    expect(s().items.find((i) => i.id === 'st-email')!.log?.some((e) => e.kind === 'noted' && e.note === 'note text')).toBe(true)
  })

  it('links are the only item-to-item dependency relationships', () => {
    const before = s().links.length
    s().addDependency('st-signup-form', 'st-signup-design')
    expect(s().links.length).toBe(before + 1)
    const link = s().links[s().links.length - 1]
    expect(link).toMatchObject({ from: 'st-signup-form', to: 'st-signup-design' })
    expect('status' in link).toBe(false) // links are immediate — no approval state
    // Duplicates are ignored.
    s().addDependency('st-signup-form', 'st-signup-design')
    expect(s().links.length).toBe(before + 1)
  })

  it('migrateState moves legacy dependency edges into links, dropping rejected ones', () => {
    const legacy = {
      boards: [],
      edges: [
        { id: 'e1', kind: 'decomposition', from: 'p', to: 'c' },
        { id: 'e2', kind: 'dependency', from: 'a', to: 'b', dep: { status: 'confirmed', reason: 'r' } },
        { id: 'e3', kind: 'attribution', from: 'o', to: 'c' },
        { id: 'e4', kind: 'dependency', from: 'x', to: 'y', dep: { status: 'rejected' } },
      ],
    }
    const migrated = migrateState(legacy) as {
      edges: { id: string }[]
      links: { id: string; from: string; to: string; reason?: string }[]
    }
    expect(migrated.edges.map((e) => e.id)).toEqual(['e1', 'e3'])
    expect(migrated.links).toHaveLength(1)
    expect(migrated.links[0]).toMatchObject({ id: 'e2', from: 'a', to: 'b', reason: 'r' })
    expect('status' in migrated.links[0]).toBe(false)
  })

  it('migrateState strips the removed link status from existing links', () => {
    const state = {
      links: [
        { id: 'l1', from: 'a', to: 'b', status: 'confirmed', reason: 'r' },
        { id: 'l2', from: 'c', to: 'd', status: 'rejected' },
      ],
    }
    const migrated = migrateState(state) as { links: { id: string; from: string; to: string; reason?: string }[] }
    expect(migrated.links.map((l) => l.id)).toEqual(['l1'])
    expect(migrated.links[0]).toMatchObject({ from: 'a', to: 'b', reason: 'r' })
    expect('status' in migrated.links[0]).toBe(false)
  })

  it('archiving a parent cascades to its subtree and keeps the data linked', () => {
    const before = rollupOf('init-signup', graph()).percent
    s().archiveItem('init-signup')
    for (const id of ['init-signup', 'st-signup-design', 'st-signup-form', 'st-email', 'st-sso', 'df-signup']) {
      expect(s().items.find((i) => i.id === id)?.archived).toBe(true)
    }
    // Still in the hierarchy (so it appears in linked-issue lists), and rollup is unaffected.
    expect(decompositionChildren('init-signup', s().edges).length).toBe(5)
    expect(rollupOf('init-signup', graph()).percent).toBe(before)
    expect(s().items.find((i) => i.id === 'init-signup')!.log?.some((e) => e.kind === 'archived')).toBe(true)

    s().unarchiveItem('init-signup')
    expect(s().items.find((i) => i.id === 'init-signup')?.archived).toBe(false)
    expect(s().items.find((i) => i.id === 'st-email')?.archived).toBe(false)
    expect(s().items.find((i) => i.id === 'init-signup')!.log?.some((e) => e.kind === 'unarchived')).toBe(true)
  })

  it('moving into Done stamps resolvedAt; moving out clears it', () => {
    const done = laneByName('b-atlas', 'Done')
    const ns = laneByName('b-atlas', 'Not Started')
    s().moveCard('st-email', 'b-atlas', done.id)
    expect(typeof s().items.find((i) => i.id === 'st-email')?.resolvedAt).toBe('number')
    s().moveCard('st-email', 'b-atlas', ns.id)
    expect(s().items.find((i) => i.id === 'st-email')?.resolvedAt ?? null).toBeNull()
  })

  it('Archive done archives the board\'s resolved cards', () => {
    s().archiveDoneOnBoard('b-atlas')
    expect(s().items.find((i) => i.id === 'st-signup-design')?.archived).toBe(true)
    // a card that is not Done is untouched
    expect(s().items.find((i) => i.id === 'st-email')?.archived ?? false).toBe(false)
  })

  it('auto-archive files Done items older than the threshold', () => {
    const done = laneByName('b-atlas', 'Done')
    s().moveCard('st-email', 'b-atlas', done.id)
    s().setItemFields('st-email', { resolvedAt: Date.now() - 40 * 86_400_000 })
    s().setAutoArchiveDays(30)
    s().runAutoArchive()
    expect(s().items.find((i) => i.id === 'st-email')?.archived).toBe(true)
    // a Done item without an old resolvedAt is left alone
    expect(s().items.find((i) => i.id === 'st-signup-design')?.archived ?? false).toBe(false)
  })

  it('moves sub-lanes within their top-level parent; top-level columns are fixed', () => {
    const root = rootLane(s().lanes, 'b-atlas')!
    const topNames = () => childrenOf(s().lanes, root.id).map((l) => l.name)
    // Top-level columns cannot move.
    expect(topNames()).toEqual(['Backlog', 'Not Started', 'In Progress', 'Done'])
    s().moveLane(laneByName('b-atlas', 'Not Started').id, -1)
    expect(topNames()).toEqual(['Backlog', 'Not Started', 'In Progress', 'Done'])

    // Sub-columns move within their top-level parent.
    const ip = laneByName('b-atlas', 'In Progress')
    const colNames = () => childrenOf(s().lanes, ip.id).map((l) => l.name)
    expect(colNames()).toEqual(['Dev', 'Test'])
    s().moveLane(laneByName('b-atlas', 'Dev').id, 1) // right
    expect(colNames()).toEqual(['Test', 'Dev'])
    s().moveLane(laneByName('b-atlas', 'Dev').id, 1) // already last → no-op
    expect(colNames()).toEqual(['Test', 'Dev'])
  })

  it('adds a column to a column split and a row to a row split', () => {
    const ip = laneByName('b-atlas', 'In Progress')
    const before = childrenOf(s().lanes, ip.id).length
    s().addLane(ip.id)
    const cols = childrenOf(s().lanes, ip.id)
    expect(cols.length).toBe(before + 1)
    expect(cols[cols.length - 1].name).toBe('Column 3')

    const ns = laneByName('b-atlas', 'Not Started')
    s().splitLane(ns.id, 'rows')
    expect(childrenOf(s().lanes, ns.id).map((r) => r.name)).toEqual(['Row 1', 'Row 2'])
    s().addLane(ns.id)
    expect(childrenOf(s().lanes, ns.id).map((r) => r.name)).toEqual(['Row 1', 'Row 2', 'Row 3'])
  })

  it('inserts a lane after a sibling and duplicates a subtree', () => {
    const ip = laneByName('b-atlas', 'In Progress')
    const colNames = () => childrenOf(s().lanes, ip.id).map((l) => l.name)
    expect(colNames()).toEqual(['Dev', 'Test'])

    s().insertLaneAfter(laneByName('b-atlas', 'Dev').id)
    expect(colNames()).toEqual(['Dev', 'Column 3', 'Test'])

    s().duplicateLane(laneByName('b-atlas', 'Dev').id)
    expect(colNames()).toEqual(['Dev', 'Dev copy', 'Column 3', 'Test'])

    // top-level columns are neither insertable nor cloneable
    const root = rootLane(s().lanes, 'b-atlas')!
    const topBefore = childrenOf(s().lanes, root.id).map((l) => l.name)
    s().insertLaneAfter(laneByName('b-atlas', 'Not Started').id)
    s().duplicateLane(laneByName('b-atlas', 'Not Started').id)
    expect(childrenOf(s().lanes, root.id).map((l) => l.name)).toEqual(topBefore)
  })

  it('duplicates a container with its sub-lanes (structure, not cards)', () => {
    const ns = laneByName('b-atlas', 'Not Started')
    s().splitLane(ns.id, 'columns')
    const c1 = childrenOf(s().lanes, ns.id)[0]
    s().splitLane(c1.id, 'rows')
    const sub = childrenOf(s().lanes, c1.id).length

    s().duplicateLane(c1.id)
    const cols = childrenOf(s().lanes, ns.id)
    expect(cols.length).toBe(3)
    const clone = cols[1]
    expect(clone.name).toBe(`${c1.name} copy`)
    expect(clone.id).not.toBe(c1.id)
    expect(childrenOf(s().lanes, clone.id).length).toBe(sub)
  })

  it('toggles container collapse (view state)', () => {
    const ip = laneByName('b-atlas', 'In Progress')
    expect(s().collapsedLanes[ip.id] ?? false).toBe(false)
    s().toggleCollapse(ip.id)
    expect(s().collapsedLanes[ip.id]).toBe(true)
    s().toggleCollapse(ip.id)
    expect(s().collapsedLanes[ip.id]).toBe(false)
  })

  it('a new card gets a non-initiative type (cards workflow, not initiatives)', () => {
    const typeId = defaultCardTypeId(s().issueTypes)!
    const lane = laneByName('b-atlas', 'Backlog')
    s().addCard({ boardId: 'b-atlas', typeId, laneId: lane.id, title: 'New card' })
    const created = s().items[s().items.length - 1]
    expect(s().issueTypes.find((t) => t.id === created.typeId)?.name).not.toBe('Initiative')
    expect(s().placements.some((p) => p.itemId === created.id && p.boardId === 'b-atlas' && p.laneId === lane.id)).toBe(true)
  })

  it('default card type is a board property; Initiative is never a card type', () => {
    const types = s().issueTypes
    expect(cardTypes(types).some((t) => t.name === 'Initiative')).toBe(false)
    expect(boardCardTypeId(s().boards.find((b) => b.id === 'b-atlas'), types)).toBe('t-story')

    s().setBoardDefaultCardType('b-atlas', 't-bug')
    expect(boardCardTypeId(s().boards.find((b) => b.id === 'b-atlas'), types)).toBe('t-bug')

    // Initiative is rejected as a default → falls back to the first card type
    s().setBoardDefaultCardType('b-atlas', 't-initiative')
    expect(boardCardTypeId(s().boards.find((b) => b.id === 'b-atlas'), types)).toBe('t-story')
  })

  it('OKRs attach to strategic initiatives only', () => {
    // A card can't be attributed…
    s().setAttribution('st-signup-form', 'obj-efficiency', true)
    expect(s().edges.some((e) => e.kind === 'attribution' && e.to === 'st-signup-form')).toBe(false)
    // …nor a team or value-stream initiative (they inherit through the decomposition).
    s().setAttribution('init-signup', 'obj-efficiency', true)
    expect(s().edges.some((e) => e.kind === 'attribution' && e.to === 'init-signup')).toBe(false)
    s().setAttribution('init-onboarding', 'obj-efficiency', true)
    expect(s().edges.some((e) => e.kind === 'attribution' && e.to === 'init-onboarding')).toBe(false)
    // …but a strategic initiative (an Initiative on a portfolio board) can.
    s().setAttribution('init-explore', 'obj-efficiency', true)
    expect(s().edges.some((e) => e.kind === 'attribution' && e.from === 'obj-efficiency' && e.to === 'init-explore')).toBe(true)
  })

  it('deleting a card removes its placements, parent edge, links and attribution', () => {
    s().deleteItem('st-signup-form')
    expect(s().items.some((i) => i.id === 'st-signup-form')).toBe(false)
    expect(s().placements.some((p) => p.itemId === 'st-signup-form')).toBe(false)
    // its parent edge and its attribution edges are gone
    expect(s().edges.some((e) => e.to === 'st-signup-form' || e.from === 'st-signup-form')).toBe(false)
    // its link (st-signup-form → st-tour) is gone, but the other endpoint survives
    expect(s().links.some((l) => l.from === 'st-signup-form' || l.to === 'st-signup-form')).toBe(false)
    expect(s().items.some((i) => i.id === 'st-tour')).toBe(true)
  })

  it('deleting a parent leaves its children parentless', () => {
    s().deleteItem('init-signup')
    expect(s().items.some((i) => i.id === 'init-signup')).toBe(false)
    expect(decompositionParent('st-signup-form', s().edges)).toBeUndefined()
    expect(decompositionParent('st-email', s().edges)).toBeUndefined()
    expect(decompositionChildren('init-onboarding', s().edges)).not.toContain('init-signup')
  })

  it('WIP enforcement mode is a board property; block rejects a move that would exceed', () => {
    expect(s().boards.find((b) => b.id === 'b-atlas')?.wipEnforcement ?? 'visualize').toBe('visualize')
    s().setBoardWipEnforcement('b-atlas', 'block')
    expect(s().boards.find((b) => b.id === 'b-atlas')?.wipEnforcement).toBe('block')

    // Not Started has a WIP limit of 1 and already holds one card.
    const ns = laneByName('b-atlas', 'Not Started')
    const before = s().placements.find((p) => p.itemId === 'st-signup-form')?.laneId
    s().moveCard('st-signup-form', 'b-atlas', ns.id)
    expect(s().placements.find((p) => p.itemId === 'st-signup-form')?.laneId).toBe(before) // blocked

    // Visualize allows the same move.
    s().setBoardWipEnforcement('b-atlas', 'visualize')
    s().moveCard('st-signup-form', 'b-atlas', ns.id)
    expect(s().placements.find((p) => p.itemId === 'st-signup-form')?.laneId).toBe(ns.id)
  })

  it('global search matches by title or ref, and nothing on an empty query', () => {
    const refs = buildRefs(s().items, s().issueTypes)
    expect(searchItems(s().items, refs, 'gateway').map((i) => i.id)).toContain('init-gateway')
    const ref = refs.get('st-email')!
    expect(searchItems(s().items, refs, ref.toLowerCase()).map((i) => i.id)).toContain('st-email')
    expect(searchItems(s().items, refs, '   ')).toEqual([])
    expect(searchItems(s().items, refs, 'zzzzzz')).toEqual([])
  })

  it('filters: the panel and the item panel share one slot; type toggles are additive', () => {
    s().openItem('st-email')
    expect(s().selectedItemId).toBe('st-email')

    s().toggleFilters()
    expect(s().showFilters).toBe(true)
    expect(s().selectedItemId).toBe(null) // opening filters dismissed the card

    s().toggleFilterType('t-bug')
    s().toggleFilterType('t-spike')
    expect([...s().filters.typeIds].sort()).toEqual(['t-bug', 't-spike'])
    s().toggleFilterType('t-bug')
    expect(s().filters.typeIds).toEqual(['t-spike'])

    s().setFilters({ blocked: true, unassigned: true })
    expect(s().filters).toEqual({ typeIds: ['t-spike'], blocked: true, overdue: false, unassigned: true })

    s().openItem('st-email')
    expect(s().showFilters).toBe(false) // opening a card dismissed the panel
    expect(s().selectedItemId).toBe('st-email')

    s().clearFilters()
    expect(s().filters).toEqual({ typeIds: [], blocked: false, overdue: false, unassigned: false })
  })

  it('checklists live inside a card and never count as work', () => {
    const done = laneByName('b-atlas', 'Done')
    const before = laneCardCount(s().lanes, s().placements, done.id)
    const rollBefore = rollupOf('init-signup', graph()).total
    const placementsBefore = s().placements.length
    const check = (id: string) => s().items.find((i) => i.id === id)!.checklist!

    s().addChecklistItem('st-signup-design', 'Write copy')
    s().addChecklistItem('st-signup-design', 'Wire the API')
    expect(check('st-signup-design').map((c) => c.text)).toEqual(['Write copy', 'Wire the API'])

    // A blank add is ignored.
    s().addChecklistItem('st-signup-design', '   ')
    expect(check('st-signup-design').length).toBe(2)

    // Check/uncheck.
    s().toggleChecklistItem('st-signup-design', check('st-signup-design')[0].id)
    expect(check('st-signup-design')[0].done).toBe(true)
    expect(checklistProgress(s().items.find((i) => i.id === 'st-signup-design'))).toEqual({ done: 1, total: 2 })

    // Reorder.
    s().moveChecklistItem('st-signup-design', check('st-signup-design')[0].id, 1)
    expect(check('st-signup-design').map((c) => c.text)).toEqual(['Wire the API', 'Write copy'])

    // Delete.
    s().removeChecklistItem('st-signup-design', check('st-signup-design')[0].id)
    expect(check('st-signup-design').map((c) => c.text)).toEqual(['Write copy'])

    // Never schedulable: lane counts, rollup and placements are unchanged.
    expect(laneCardCount(s().lanes, s().placements, done.id)).toBe(before)
    expect(rollupOf('init-signup', graph()).total).toBe(rollBefore)
    expect(s().placements.length).toBe(placementsBefore)
  })

  it('boundary: toggling selects an external dependency; changing board clears it', () => {
    s().toggleBoundary('init-gateway')
    expect(s().boundaryId).toBe('init-gateway')
    s().toggleBoundary('init-gateway')
    expect(s().boundaryId).toBe(null)

    s().toggleBoundary('init-gateway')
    s().selectBoard('b-nova')
    expect(s().boundaryId).toBe(null)
  })

  it('multi-select: shift+click seeds from the open card; bulk actions apply', () => {
    s().selectBoard('b-atlas')
    // A card is open; shift+click a second → group of two, panel closed.
    s().openItem('st-email')
    s().toggleMultiSelect('st-sso')
    expect([...s().multiSelect].sort()).toEqual(['st-email', 'st-sso'])
    expect(s().selectedItemId).toBe(null)

    // Shift+click again removes it from the group.
    s().toggleMultiSelect('st-email')
    expect(s().multiSelect).toEqual(['st-sso'])

    // Bulk: type, assign (additive), move.
    s().setItemsType(['st-sso'], 't-bug')
    expect(s().items.find((i) => i.id === 'st-sso')?.typeId).toBe('t-bug')
    s().addItemsAssignee(['st-sso'], 'Zoe Zimmer')
    s().addItemsAssignee(['st-sso'], 'Zoe Zimmer') // deduped, same person
    s().addItemsAssignee(['st-sso'], 'Riley Kim') // an existing user, reused
    const st = () => s().items.find((i) => i.id === 'st-sso')!
    const names = (st().assignees ?? []).map((id) => s().users.find((u) => u.id === id)?.name)
    expect(names).toEqual(['Zoe Zimmer', 'Riley Kim'])
    s().clearItemsAssignees(['st-sso'])
    expect(st().assignees).toBeUndefined()

    const done = laneByName('b-atlas', 'Done')
    s().moveCardsToLane(['st-sso'], done.id)
    expect(s().placements.find((p) => p.itemId === 'st-sso' && p.boardId === 'b-atlas')?.laneId).toBe(done.id)
    expect(s().items.find((i) => i.id === 'st-sso')?.resolvedAt).toBeTruthy() // entering Done starts the clock

    // Initiative is never a card type.
    s().setItemsType(['st-sso'], 't-initiative')
    expect(s().items.find((i) => i.id === 'st-sso')?.typeId).toBe('t-bug')

    // Opening a card clears the group.
    s().openItem('st-email')
    expect(s().multiSelect).toEqual([])
  })

  it('bulk delete and archive act on the whole selection', () => {
    s().toggleMultiSelect('st-email')
    s().toggleMultiSelect('st-sso')
    s().deleteItems(['st-email', 'st-sso'])
    expect(s().items.some((i) => i.id === 'st-email')).toBe(false)
    expect(s().items.some((i) => i.id === 'st-sso')).toBe(false)
    expect(s().multiSelect).toEqual([])
    expect(s().links.some((l) => l.from === 'st-email' || l.to === 'st-email')).toBe(false)

    s().toggleMultiSelect('st-signup-form')
    s().archiveItems(['st-signup-form'])
    expect(s().items.find((i) => i.id === 'st-signup-form')?.archived).toBe(true)
    expect(s().multiSelect).toEqual([])
  })

  it('confirm requests are held in view state until resolved', () => {
    let confirmed = false
    s().askConfirm({ title: 'Delete?', confirmLabel: 'Delete', danger: true, onConfirm: () => { confirmed = true } })
    expect(s().confirm?.title).toBe('Delete?')
    s().confirm!.onConfirm()
    s().closeConfirm()
    expect(confirmed).toBe(true)
    expect(s().confirm).toBe(null)
  })

  it('lane policy (description) is stored on the lane', () => {
    const ns = laneByName('b-atlas', 'Not Started')
    s().setLaneDescription(ns.id, 'Pull one at a time.')
    expect(s().lanes.find((l) => l.id === ns.id)?.description).toBe('Pull one at a time.')
    s().setLaneDescription(ns.id, undefined)
    expect(s().lanes.find((l) => l.id === ns.id)?.description).toBeUndefined()
  })

  it('persists collapsed columns, while selection/filters stay view-only', () => {
    const ip = laneByName('b-atlas', 'In Progress')
    s().toggleCollapse(ip.id)
    expect(persistedSlice(s()).collapsedLanes).toEqual({ [ip.id]: true })
    expect(persistedSlice(s()).lanes).toBeDefined() // the design is persisted

    s().setSearch('x')
    s().openItem('st-email')
    s().toggleMultiSelect('st-sso')
    const slice = persistedSlice(s())
    expect(slice.search).toBeUndefined()
    expect(slice.selectedItemId).toBeUndefined()
    expect(slice.multiSelect).toBeUndefined()
  })

  it('migrateState splits the old targetDate into a target end date', () => {
    const legacy = { items: [{ id: 'x', targetDate: '2026-05-01' }, { id: 'y' }] }
    const migrated = migrateState(legacy) as { items: { id: string; targetEndDate?: string; targetDate?: string }[] }
    expect(migrated.items[0].targetEndDate).toBe('2026-05-01')
    expect('targetDate' in migrated.items[0]).toBe(false)
    expect(migrated.items[1].targetEndDate).toBeUndefined()
  })

  it('migrateState turns a single assignee into a user-backed list', () => {
    const legacy = { items: [{ id: 'x', assignee: 'Maya Blake' }, { id: 'y' }] }
    const migrated = migrateState(legacy) as {
      items: { id: string; assignees?: string[]; assignee?: string }[]
      users: { id: string; name: string }[]
    }
    expect(migrated.users).toEqual([{ id: 'u-maya-blake', name: 'Maya Blake' }])
    expect(migrated.items[0].assignees).toEqual(['u-maya-blake'])
    expect('assignee' in migrated.items[0]).toBe(false)
    expect(migrated.items[1].assignees).toBeUndefined()
  })

  it('board card types: the allowed set restricts new cards and repairs the default', () => {
    const atlas = () => s().boards.find((b) => b.id === 'b-atlas')
    // Unrestricted by default.
    expect(boardCardTypes(atlas(), s().issueTypes).map((t) => t.id)).toEqual(['t-story', 't-bug', 't-spike', 't-task'])

    s().setBoardCardTypes('b-atlas', ['t-bug', 't-spike'])
    expect(atlas()?.cardTypeIds).toEqual(['t-bug', 't-spike'])
    // t-story was the default and is no longer allowed → repaired to the first allowed.
    expect(atlas()?.defaultCardTypeId).toBe('t-bug')
    expect(boardCardTypeId(atlas(), s().issueTypes)).toBe('t-bug')

    // An empty list clears the restriction.
    s().setBoardCardTypes('b-atlas', [])
    expect(atlas()?.cardTypeIds).toBeUndefined()
    expect(boardCardTypes(atlas(), s().issueTypes)).toHaveLength(4)
  })

  it('justify mode holds a move until a reason is given, then records it', () => {
    const ns = laneByName('b-atlas', 'Not Started') // limit 1, already holds a card
    s().setBoardWipEnforcement('b-atlas', 'justify')
    s().moveCard('st-signup-form', 'b-atlas', ns.id)
    // Held: no move yet, but a prompt was raised.
    expect(s().placements.find((p) => p.itemId === 'st-signup-form' && p.boardId === 'b-atlas')?.laneId).not.toBe(ns.id)
    expect(s().wipPrompt?.laneName).toBe('Not Started')
    expect(s().wipPrompt?.limit).toBe(1)

    s().confirmWipPrompt('Signed off by the PO')
    expect(s().wipPrompt).toBe(null)
    expect(s().placements.find((p) => p.itemId === 'st-signup-form' && p.boardId === 'b-atlas')?.laneId).toBe(ns.id)
    const item = s().items.find((i) => i.id === 'st-signup-form')!
    expect(item.lastMoveReason).toBe('Signed off by the PO')
    expect(item.log?.some((e) => e.kind === 'limit' && e.note === 'Signed off by the PO')).toBe(true)
  })

  it('justify mode: cancelling the prompt drops the move', () => {
    const ns = laneByName('b-atlas', 'Not Started')
    s().setBoardWipEnforcement('b-atlas', 'justify')
    const before = s().placements.find((p) => p.itemId === 'st-signup-form' && p.boardId === 'b-atlas')?.laneId
    s().moveCard('st-signup-form', 'b-atlas', ns.id)
    s().cancelWipPrompt()
    expect(s().wipPrompt).toBe(null)
    expect(s().placements.find((p) => p.itemId === 'st-signup-form' && p.boardId === 'b-atlas')?.laneId).toBe(before)
  })

  it('bulk size, target dates, block/unblock and assignee removal', () => {
    s().setItemsSize(['st-email', 'st-sso'], 8)
    expect(s().items.find((i) => i.id === 'st-email')?.size).toBe(8)
    expect(s().items.find((i) => i.id === 'st-sso')?.size).toBe(8)

    s().setItemsTargetStart(['st-email'], '2026-01-05')
    s().setItemsTargetEnd(['st-email'], '2026-02-05')
    expect(s().items.find((i) => i.id === 'st-email')?.targetStartDate).toBe('2026-01-05')
    expect(s().items.find((i) => i.id === 'st-email')?.targetEndDate).toBe('2026-02-05')
    s().setItemsTargetEnd(['st-email'], undefined)
    expect(s().items.find((i) => i.id === 'st-email')?.targetEndDate).toBeUndefined()

    s().blockItems(['st-email', 'st-sso'], 'Waiting on legal')
    expect(s().items.find((i) => i.id === 'st-email')?.blocked).toBe(true)
    expect(s().items.find((i) => i.id === 'st-email')?.blockedReason).toBe('Waiting on legal')
    expect(s().items.find((i) => i.id === 'st-email')?.log?.some((e) => e.kind === 'blocked')).toBe(true)
    s().unblockItems(['st-email', 'st-sso'])
    expect(s().items.find((i) => i.id === 'st-sso')?.blocked).toBe(false)

    s().addItemsAssignee(['st-email'], 'Maya Blake')
    const uid = s().users.find((u) => u.name === 'Maya Blake')!.id
    expect(s().items.find((i) => i.id === 'st-email')?.assignees).toEqual([uid])
    s().removeItemsAssignee(['st-email'], uid)
    expect(s().items.find((i) => i.id === 'st-email')?.assignees).toBeUndefined()
  })

  it('migrateState turns the old board level into a band', () => {
    const migrated = migrateState({
      boards: [
        { id: 'x', name: 'X' }, // no level → operational
        { id: 'y', name: 'Y', level: 'portfolio', teamBoardIds: ['x'] }, // → coordination
        { id: 'z', name: 'Z', level: 'project' }, // → coordination (it was inert)
        { id: 't', name: 'T', level: 'team' }, // → operational
      ],
    }) as { boards: { id: string; band: string; level?: string; linkedBoardIds?: string[] }[] }
    expect(migrated.boards.map((b) => b.band)).toEqual(['team', 'program', 'program', 'team'])
    expect(migrated.boards[1].linkedBoardIds).toEqual(['x'])
    expect('level' in migrated.boards[1]).toBe(false)
  })

  it('migratePersisted reseeds boards for a schema change (v<9)', () => {
    const stale = { boards: [{ id: 'b-portfolio', name: 'P', level: 'portfolio' }], lanes: [], placements: [] }
    const reseeded = migratePersisted(stale, 8) as { boards: { id: string }[]; lanes: unknown[] }
    expect(reseeded.boards.length).toBeGreaterThanOrEqual(3)
    expect(reseeded.boards.some((b) => b.id === 'b-atlas')).toBe(true)
    expect(reseeded.lanes.length).toBeGreaterThan(0)
    // v9+ keeps the persisted boards
    const kept = migratePersisted(stale, 9) as { boards: { id: string }[] }
    expect(kept.boards.length).toBe(1)
  })
})
