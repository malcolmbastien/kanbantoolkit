import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decompositionParent, statusOf } from './domain/derive'
import { childrenOf, effectiveStage, isLeaf, leafLanes, rootLane } from './domain/lanes'
import { migratePersisted, migrateState, useStore } from './store'

vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
})

const s = () => useStore.getState()
const graph = () => {
  const st = s()
  return { items: st.items, edges: st.edges, placements: st.placements, lanes: st.lanes }
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

  it('dependency self-cleans when the blocker moves to a done lane', () => {
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
