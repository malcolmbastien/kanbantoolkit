import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decompositionParent, statusOf } from './domain/derive'
import { childrenOf, isLeaf, leafLanes, rootLane } from './domain/lanes'
import { migrateState, useStore } from './store'

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
    const bravo = s().lanes.find((l) => l.boardId === 'b-core' && l.name === 'Team Bravo')!
    const target = childrenOf(s().lanes, bravo.id).find((l) => isLeaf(s().lanes, l.id))!
    const before = s().placements.filter((p) => p.laneId === target.id).length
    s().splitLane(target.id, 'rows')
    const kids = childrenOf(s().lanes, target.id)
    expect(kids.length).toBe(2)
    expect(isLeaf(s().lanes, target.id)).toBe(false)
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

  it('a WIP limit soft-blocks with a required reason', () => {
    const done = laneByName('b-platform', 'Done')
    s().setLaneWip(done.id, 1)
    expect(s().moveCard('st-sdk', 'b-platform', done.id).ok).toBe(true) // 0 -> 1 (at limit)
    const blocked = s().moveCard('it-analytics', 'b-platform', done.id) // 1 -> 2 (over)
    expect(blocked.ok).toBe(false)
    const ok = s().moveCard('it-analytics', 'b-platform', done.id, 'Unblocking release')
    expect(ok.ok).toBe(true)
  })

  it('custom types can be added, renamed and recoloured', () => {
    const before = s().issueTypes.length
    s().addIssueType('Risk', '#ef4444')
    const added = s().issueTypes[s().issueTypes.length - 1]
    expect(s().issueTypes.length).toBe(before + 1)
    s().updateIssueType(added.id, { name: 'Threat' })
    expect(s().issueTypes.find((t) => t.id === added.id)?.name).toBe('Threat')
  })

  it('can build the sketch design: Doing is a row-split holding a column row + a Projects row', () => {
    s().addBoard('Sketch')
    const boardId = s().boardId
    const root = s().lanes.find((l) => l.boardId === boardId && l.parentId === null)!
    const cols = () => childrenOf(s().lanes, root.id)

    s().renameLane(cols()[0].id, 'To Do')
    s().addLane(root.id)
    s().addLane(root.id)
    s().renameLane(cols()[1].id, 'Doing')
    s().renameLane(cols()[2].id, 'Done')
    expect(cols().map((c) => c.name)).toEqual(['To Do', 'Doing', 'Done'])

    // Split "Doing" into two rows: (Build/Test/Deploy) and (Projects -> Research/Validate).
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
    expect(isLeaf(s().lanes, rows[0].id)).toBe(false)
    // Cell semantics can be configured: mark Done as a done column.
    const doneCol = cols()[2]
    s().splitLane(doneCol.id, 'columns', 2)
    s().setLaneFlags(doneCol.id, { isDone: true })
    expect(s().lanes.find((l) => l.id === doneCol.id)?.isDone).toBe(true)

    const leaves = leafLanes(s().lanes, boardId)
    expect(leaves.length).toBeGreaterThanOrEqual(7)
  })

  it('a rows container can gain another child after its existing rows', () => {
    const root = rootLane(s().lanes, 'b-core')! // root is split into rows (Team Alpha, Team Bravo)
    const before = childrenOf(s().lanes, root.id).length
    s().addLane(root.id)
    const kids = childrenOf(s().lanes, root.id)
    expect(kids.length).toBe(before + 1)
    expect(kids[kids.length - 1].name).toBe(`Row ${before + 1}`)
    expect(s().lanes.find((l) => l.id === root.id)?.orientation).toBe('rows')
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

  it('Save commits layout edits; Cancel reverts them', () => {
    const root = rootLane(s().lanes, s().boardId)!
    const beforeLanes = s().lanes.length
    const beforeBoards = s().boards.length

    // Cancel: a new board and an added lane are discarded.
    s().beginEdit()
    s().addBoard('Throwaway')
    s().addLane(rootLane(s().lanes, s().boardId)!.id)
    expect(s().boards.length).toBe(beforeBoards + 1)
    expect(s().lanes.length).toBeGreaterThan(beforeLanes)
    const originalBoard = 'b-core'
    s().cancelEdit()
    expect(s().boards.length).toBe(beforeBoards)
    expect(s().lanes.length).toBe(beforeLanes)
    expect(s().boardId).toBe(originalBoard)

    // Save: the added lane is kept.
    s().beginEdit()
    s().addLane(root.id)
    const afterAdd = s().lanes.length
    s().saveEdit()
    expect(s().lanes.length).toBe(afterAdd)
    expect(s().editMode).toBe(false)
    expect(s().draft).toBeNull()
  })
})
