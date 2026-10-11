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

describe('store actions (recursive lanes)', () => {
  beforeEach(() => s().resetDemo())

  it('one parent: setParent replaces any existing parent', () => {
    s().setParent('st-form', 'it-tour')
    expect(decompositionParent('st-form', s().edges)).toBe('it-tour')
    s().setParent('st-form', 'it-signup')
    expect(decompositionParent('st-form', s().edges)).toBe('it-signup')
  })

  it('splitting a leaf into a container moves its cards into the first sub-lane', () => {
    const bravo = s().lanes.find((l) => l.boardId === 'b-core' && l.name === 'Team Bravo' && isLeaf(s().lanes, l.id))!
    const before = s().placements.filter((p) => p.laneId === bravo.id).length
    s().splitLane(bravo.id, 'rows')
    const kids = childrenOf(s().lanes, bravo.id)
    expect(kids.length).toBe(2)
    expect(isLeaf(s().lanes, bravo.id)).toBe(false)
    expect(s().placements.filter((p) => p.laneId === kids[0].id).length).toBe(before)
  })

  it('addLane appends a sibling to a container', () => {
    const alpha = s().lanes.find((l) => l.boardId === 'b-core' && l.name === 'Team Alpha')!
    const before = childrenOf(s().lanes, alpha.id).length
    s().addLane(alpha.id)
    expect(childrenOf(s().lanes, alpha.id).length).toBe(before + 1)
  })

  it('dependency self-cleans when the blocker moves to a done lane', () => {
    const done = laneByName('b-platform', 'Done')
    expect(statusOf('st-profile-schema', graph()).resolved).toBe(false)
    s().moveCard('it-api', 'b-platform', done.id)
    expect(statusOf('it-api', graph()).resolved).toBe(true)
  })

  it('WIP limits are visual only — they never block a move', () => {
    const done = laneByName('b-platform', 'Done')
    s().setLaneWip(done.id, 1)
    s().moveCard('st-sdk', 'b-platform', done.id)
    s().moveCard('it-analytics', 'b-platform', done.id) // over the limit, still allowed
    expect(s().placements.find((p) => p.itemId === 'it-analytics' && p.boardId === 'b-platform')?.laneId).toBe(done.id)
  })

  it('custom types can be added, renamed and recoloured', () => {
    const before = s().issueTypes.length
    s().addIssueType('Risk', '#ef4444')
    const added = s().issueTypes[s().issueTypes.length - 1]
    expect(s().issueTypes.length).toBe(before + 1)
    s().updateIssueType(added.id, { name: 'Threat' })
    expect(s().issueTypes.find((t) => t.id === added.id)?.name).toBe('Threat')
  })

  it('can build the sketch design from the fixed three typed columns', () => {
    s().addBoard('Sketch')
    const boardId = s().boardId
    const root = rootLane(s().lanes, boardId)!
    const cols = () => childrenOf(s().lanes, root.id)

    // A new board starts as the canonical three typed columns.
    expect(cols().map((c) => c.name)).toEqual(['Not Started', 'In Progress', 'Done'])
    expect(cols().map((c) => c.stage)).toEqual(['notStarted', 'inProgress', 'done'])

    s().renameLane(cols()[0].id, 'To Do')
    s().renameLane(cols()[1].id, 'Doing')
    s().renameLane(cols()[2].id, 'Done')

    // Refine "Doing" into rows: (Build/Test/Deploy) and (Projects -> Research/Validate).
    s().splitLane(cols()[1].id, 'rows', 2)
    const rows = childrenOf(s().lanes, cols()[1].id)
    s().splitLane(rows[0].id, 'columns', 3)
    const built = childrenOf(s().lanes, rows[0].id)
    s().renameLane(rows[1].id, 'Projects')
    s().splitLane(rows[1].id, 'columns', 2)
    const proj = childrenOf(s().lanes, rows[1].id)

    expect(s().lanes.find((l) => l.id === cols()[1].id)?.orientation).toBe('rows')
    expect(built.length).toBe(3)
    expect(proj.length).toBe(2)
    // The refined columns still carry the In Progress stage by inheritance.
    expect(effectiveStage(s().lanes, built[0].id)).toBe('inProgress')
    expect(leafLanes(s().lanes, boardId).length).toBeGreaterThanOrEqual(7)
  })

  it('a nested rows container can gain a child; the top level is fixed at three', () => {
    const doing = s().lanes.find((l) => l.boardId === 'b-design' && l.name === 'Doing')!
    const before = childrenOf(s().lanes, doing.id).length
    s().addLane(doing.id)
    expect(childrenOf(s().lanes, doing.id).length).toBe(before + 1)

    const root = rootLane(s().lanes, 'b-design')!
    const topBefore = childrenOf(s().lanes, root.id).length
    s().addLane(root.id) // top-level columns are fixed
    expect(childrenOf(s().lanes, root.id).length).toBe(topBefore)
    expect(topBefore).toBe(3)
  })

  it('boards carry a Kanban flight level that can be changed', () => {
    expect(s().boards.find((b) => b.id === 'b-portfolio')?.level).toBe('portfolio')
    expect(s().boards.find((b) => b.id === 'b-core')?.level).toBe('project')
    s().setBoardLevel('b-core', 'team')
    expect(s().boards.find((b) => b.id === 'b-core')?.level).toBe('team')
    // a new board defaults to Team level
    const before = s().boards.length
    s().addBoard('Fresh')
    expect(s().boards.length).toBe(before + 1)
    expect(s().boards[s().boards.length - 1].level).toBe('team')
  })

  it('migrateState backfills Board.level on state persisted before it existed', () => {
    const old = {
      boards: [
        { id: 'b-portfolio', name: 'Portfolio' },
        { id: 'b-core', name: 'Core' },
        { id: 'unknown', name: 'Custom' },
      ],
      lanes: [],
      placements: [],
    }
    const migrated = migrateState(old) as { boards: { id: string; level?: string }[] }
    expect(migrated.boards.find((b) => b.id === 'b-portfolio')?.level).toBe('portfolio')
    expect(migrated.boards.find((b) => b.id === 'b-core')?.level).toBe('project')
    expect(migrated.boards.find((b) => b.id === 'unknown')?.level).toBe('team')
  })

  it('migratePersisted reseeds boards for a schema change (v<6)', () => {
    const stale = { boards: [{ id: 'b-core', name: 'Core', level: 'project' }], lanes: [], placements: [] }
    const reseeded = migratePersisted(stale, 5) as { boards: { id: string }[]; lanes: unknown[] }
    expect(reseeded.boards.length).toBeGreaterThanOrEqual(5)
    expect(reseeded.boards.some((b) => b.id === 'b-team-alpha')).toBe(true)
    expect(reseeded.lanes.length).toBeGreaterThan(0)
    // v6+ keeps the persisted boards (just backfills level)
    const kept = migratePersisted(stale, 6) as { boards: { id: string }[] }
    expect(kept.boards.length).toBe(1)
  })

  it('management board aggregates the team boards chosen for it', () => {
    const mgmt = () => s().boards.find((b) => b.id === 'b-portfolio')!
    expect(mgmt().teamBoardIds).toContain('b-core') // seeded
    s().removeManagementTeam('b-portfolio', 'b-core')
    expect(mgmt().teamBoardIds ?? []).not.toContain('b-core')
    s().addManagementTeam('b-portfolio', 'b-core')
    expect(mgmt().teamBoardIds).toContain('b-core')

    s().setBoardDerived('b-core', true)
    expect(s().boards.find((b) => b.id === 'b-core')?.derived).toBe(true)
  })

  it('links a team initiative under a management initiative', () => {
    const before = s().items.length
    s().linkTeamInitiative('it-onboarding', 'b-team-alpha', 'Linked initiative')
    expect(s().items.length).toBe(before + 1)
    const created = s().items[s().items.length - 1]
    expect(s().edges.some((e) => e.kind === 'decomposition' && e.from === 'it-onboarding' && e.to === created.id)).toBe(true)
    expect(s().placements.some((p) => p.itemId === created.id && p.boardId === 'b-team-alpha')).toBe(true)
  })

  it('Save commits layout edits; Cancel reverts them', () => {
    const beforeBoards = s().boards.length
    const doing = s().lanes.find((l) => l.boardId === 'b-design' && l.name === 'Doing')!
    const beforeDoingKids = childrenOf(s().lanes, doing.id).length

    // Cancel discards a new board.
    s().beginEdit()
    s().addBoard('Throwaway')
    expect(s().boards.length).toBe(beforeBoards + 1)
    s().cancelEdit()
    expect(s().boards.length).toBe(beforeBoards)
    expect(s().boardId).toBe('b-core')

    // Save keeps a nested-lane change.
    s().beginEdit()
    s().addLane(doing.id)
    const afterKids = childrenOf(s().lanes, doing.id).length
    expect(afterKids).toBe(beforeDoingKids + 1)
    s().saveEdit()
    expect(childrenOf(s().lanes, doing.id).length).toBe(afterKids)
    expect(s().editMode).toBe(false)
    expect(s().draft).toBeNull()
  })
})
