import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decompositionChildren, decompositionParent, checklistProgress, rollupOf, statusOf } from './domain/derive'
import { boardCardTypeId, buildRefs, cardTypes, defaultCardTypeId, searchItems } from './domain/board'
import { childrenOf, effectiveStage, isLeaf, laneCardCount, leafLanes, rootLane } from './domain/lanes'
import { migratePersisted, migrateState, useStore } from './store'

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

  it('management board aggregates the team boards chosen for it', () => {
    const mgmt = () => s().boards.find((b) => b.id === 'b-portfolio')!
    expect(mgmt().teamBoardIds).toContain('b-atlas')
    s().removeManagementTeam('b-portfolio', 'b-atlas')
    expect(mgmt().teamBoardIds ?? []).not.toContain('b-atlas')
    s().addManagementTeam('b-portfolio', 'b-atlas')
    expect(mgmt().teamBoardIds).toContain('b-atlas')
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

  it('boards carry a Kanban flight level that can be changed', () => {
    expect(s().boards.find((b) => b.id === 'b-portfolio')?.level).toBe('portfolio')
    expect(s().boards.find((b) => b.id === 'b-atlas')?.level).toBe('team')
    s().setBoardLevel('b-atlas', 'project')
    expect(s().boards.find((b) => b.id === 'b-atlas')?.level).toBe('project')
    const before = s().boards.length
    s().addBoard('Fresh')
    expect(s().boards.length).toBe(before + 1)
    expect(s().boards[s().boards.length - 1].level).toBe('team')
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

  it('migrateState backfills Board.level', () => {
    const migrated = migrateState({ boards: [{ id: 'x', name: 'X' }] }) as { boards: { level?: string }[] }
    expect(migrated.boards[0].level).toBe('team')
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
