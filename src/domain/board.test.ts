import { describe, expect, it } from 'vitest'
import {
  activeBoards,
  boardsByBand,
  lanesFromTemplate,
  templateAddLane,
  templateChildren,
  templateFromBoard,
  templateMoveLane,
  templateRemoveLane,
  templateRenameLane,
  templateSetLanePolicy,
  templateSetLaneWip,
  templateSetOrientation,
  templateSplitLane,
} from './board'
import { createSeed } from './seed'
import type { TemplateLane } from './types'

const names = (groups: ReturnType<typeof boardsByBand>) => groups.flatMap((g) => g.boards.map((b) => b.name))

describe('board workspace — grouping, ordering and the name filter', () => {
  const s = createSeed()

  it('groups by flight level top-down, then by name', () => {
    const groups = boardsByBand(s.boards)
    expect(groups.map((g) => g.band)).toEqual(['portfolio', 'program', 'team'])
    expect(groups.map((g) => g.boards.map((b) => b.name))).toEqual([
      ['Company Strategy'],
      ['Digital line of business', 'Growth value stream', 'Product Delivery'],
      ['Team Atlas', 'Team Nova'],
    ])
  })

  it('lists every board exactly once — the aggregation graph is a DAG, not a tree', () => {
    // Team Atlas is linked by two programs, so a nested rendering would have to
    // duplicate it or pick one parent.
    const ids = boardsByBand(s.boards).flatMap((g) => g.boards.map((b) => b.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(s.boards.length)
  })

  it('filters by name, ignoring case and surrounding space', () => {
    expect(names(boardsByBand(s.boards, 'team'))).toEqual(['Team Atlas', 'Team Nova'])
    expect(names(boardsByBand(s.boards, '  ATLAS '))).toEqual(['Team Atlas'])
    expect(boardsByBand(s.boards, 'zzz')).toEqual([])
  })

  it('hides archived boards', () => {
    const archived = s.boards.map((b) => (b.id === 'b-atlas' ? { ...b, archived: true } : b))
    expect(names(boardsByBand(archived))).not.toContain('Team Atlas')
    expect(names(boardsByBand(archived))).toContain('Team Nova')
  })

  it('activeBoards is the pool every board-choosing surface filters through', () => {
    const archived = s.boards.map((b) => (b.id === 'b-atlas' ? { ...b, archived: true } : b))
    expect(activeBoards(archived).map((b) => b.id)).not.toContain('b-atlas')
    expect(activeBoards(archived)).toHaveLength(s.boards.length - 1)
  })

  it('includeArchived brings retired boards back into the list', () => {
    const archived = s.boards.map((b) => (b.id === 'b-atlas' ? { ...b, archived: true } : b))
    const withArchived = names(boardsByBand(archived, '', true))
    expect(withArchived).toContain('Team Atlas')
    expect(withArchived).toHaveLength(s.boards.length)
  })
})

describe('board templates — a design, not its work', () => {
  const s = createSeed()
  const atlas = () => s.boards.find((b) => b.id === 'b-atlas')!

  it('the seeded Scrum template keeps its five columns over four stages', () => {
    const scrum = s.boardTemplates.find((t) => t.name === 'Scrum')!
    const top = scrum.lanes.filter((l) => l.parentKey === null).sort((a, b) => a.order - b.order)
    expect(top.map((l) => l.name)).toEqual([
      'Product Backlog',
      'Ready to Start',
      'In Progress',
      'Ready for Delivery',
      'Done',
    ])
    expect(top.map((l) => l.stage)).toEqual(['backlog', 'notStarted', 'inProgress', 'done', 'done'])
    const kids = (key: string) =>
      scrum.lanes.filter((l) => l.parentKey === key).sort((a, b) => a.order - b.order).map((l) => l.name)
    expect(kids('k1')).toEqual(['Backlog Refinement', 'Current Sprint'])
    expect(kids('k4')).toEqual(['Working on', 'Ready for Review', 'Review'])
    // It is a usable design: instantiating it yields those columns and nothing else.
    const lanes = lanesFromTemplate(scrum, 'b', 'root', (() => { let n = 0; return () => `id${++n}` })())
    expect(lanes.filter((l) => l.parentId === 'root')).toHaveLength(5)
    expect(lanes.filter((l) => l.stage === 'done')).toHaveLength(2)
  })

  it('captures the lane tree below the root, keyed rather than ided', () => {
    const t = templateFromBoard('t1', 'Team flow', atlas(), s.lanes)
    expect(t.band).toBe('team')
    expect(t.lanes.map((l) => l.name)).toEqual(['Backlog', 'Not Started', 'In Progress', 'Dev', 'Test', 'Done'])
    // No real lane ids — they are minted per instantiation.
    expect(t.lanes.every((l) => Boolean(l.key) && !('id' in l))).toBe(true)
    // The root is structural: top-level columns point at it, nothing points at the root's id.
    expect(t.lanes.filter((l) => l.parentKey === null).map((l) => l.name)).toEqual([
      'Backlog',
      'Not Started',
      'In Progress',
      'Done',
    ])
    const ip = t.lanes.find((l) => l.name === 'In Progress')!
    expect(t.lanes.filter((l) => l.parentKey === ip.key).map((l) => l.name)).toEqual(['Dev', 'Test'])
    // Stages and WIP limits ride along.
    expect(t.lanes.find((l) => l.name === 'Done')?.stage).toBe('done')
    expect(t.lanes.find((l) => l.name === 'Not Started')?.wipLimit).toBe(1)
  })

  it('carries no work and no org-specific wiring', () => {
    const t = templateFromBoard('t1', 'Team flow', atlas(), s.lanes)
    expect(JSON.stringify(t)).not.toMatch(/linkedBoardIds|itemId|placement/)
    expect(t).not.toHaveProperty('items')
    expect(t).not.toHaveProperty('linkedBoardIds')
  })

  it('instantiates with fresh, unique ids and the structure intact', () => {
    const t = templateFromBoard('t1', 'Team flow', atlas(), s.lanes)
    const before = JSON.stringify(t)

    let n = 0
    const lanes = lanesFromTemplate(t, 'new-board', 'root-1', () => `id-${++n}`)
    expect(new Set(lanes.map((l) => l.id)).size).toBe(lanes.length)
    expect(lanes.every((l) => l.boardId === 'new-board')).toBe(true)
    expect(lanes.map((l) => l.name)).toEqual(t.lanes.map((l) => l.name))
    expect(lanes.map((l) => l.stage)).toEqual(t.lanes.map((l) => l.stage))
    expect(lanes.map((l) => l.wipLimit)).toEqual(t.lanes.map((l) => l.wipLimit))
    // The root parents the top-level columns; Dev/Test keep In Progress as their parent.
    expect(lanes.filter((l) => l.parentId === 'root-1').map((l) => l.name)).toEqual([
      'Backlog',
      'Not Started',
      'In Progress',
      'Done',
    ])
    const ip = lanes.find((l) => l.name === 'In Progress')!
    expect(lanes.filter((l) => l.parentId === ip.id).map((l) => l.name)).toEqual(['Dev', 'Test'])
    // The template is untouched, so it can be used again.
    expect(JSON.stringify(t)).toBe(before)
  })
})

describe('editing a template’s design', () => {
  const scrum = () => createSeed().boardTemplates.find((t) => t.id === 'tpl-scrum')!
  /** Fresh keys, as the editor mints them. */
  const keys = () => {
    let n = 0
    return () => `new${++n}`
  }
  const childNames = (lanes: TemplateLane[], parentKey: string) =>
    templateChildren({ ...scrum(), lanes }, parentKey).map((l) => l.name)

  it('splits a leaf into columns or rows, and adds to an existing split', () => {
    const t = scrum()
    const split = templateSplitLane(t, 'k0', 'columns', keys())
    expect(childNames(split, 'k0')).toEqual(['Column 1', 'Column 2'])
    expect(split.find((l) => l.key === 'k0')?.orientation).toBe('columns')

    const rows = templateSplitLane(t, 'k0', 'rows', keys())
    expect(childNames(rows, 'k0')).toEqual(['Row 1', 'Row 2'])

    // A container gains a lane…
    expect(childNames(templateAddLane(t, 'k1', keys()), 'k1')).toEqual([
      'Backlog Refinement',
      'Current Sprint',
      'Column 3',
    ])
    // …and only a leaf splits.
    expect(templateSplitLane(t, 'k1', 'columns', keys())).toEqual(t.lanes)
  })

  it('renames, sets WIP and policy, and flips orientation', () => {
    const t = scrum()
    expect(templateRenameLane(t, 'k5', 'Doing').find((l) => l.key === 'k5')?.name).toBe('Doing')
    expect(templateSetLaneWip(t, 'k5', 2).find((l) => l.key === 'k5')?.wipLimit).toBe(2)
    expect(templateSetLaneWip(t, 'k5', undefined).find((l) => l.key === 'k5')?.wipLimit).toBeUndefined()
    expect(templateSetLanePolicy(t, 'k5', 'One at a time.').find((l) => l.key === 'k5')?.description).toBe(
      'One at a time.',
    )
    expect(templateSetOrientation(t, 'k4', 'rows').find((l) => l.key === 'k4')?.orientation).toBe('rows')
  })

  it('reorders sub-lanes within their parent, and leaves the columns fixed', () => {
    const t = scrum()
    expect(childNames(templateMoveLane(t, 'k5', 1), 'k4')).toEqual(['Ready for Review', 'Working on', 'Review'])
    // Already first, and already last: no-ops.
    expect(childNames(templateMoveLane(t, 'k5', -1), 'k4')).toEqual(['Working on', 'Ready for Review', 'Review'])
    expect(childNames(templateMoveLane(t, 'k7', 1), 'k4')).toEqual(['Working on', 'Ready for Review', 'Review'])
    // Top-level columns are fixed in place, as on a board.
    expect(templateMoveLane(t, 'k0', 1)).toEqual(t.lanes)
  })

  it('removes a sub-lane and its subtree, renumbering the rest', () => {
    const t = scrum()
    const next = templateRemoveLane(t, 'k6')
    expect(childNames(next, 'k4')).toEqual(['Working on', 'Review'])
    expect(templateChildren({ ...t, lanes: next }, 'k4').map((l) => l.order)).toEqual([0, 1])

    // A container takes its whole subtree with it — via a sub-lane that has one.
    const nested = templateSplitLane(t, 'k5', 'rows', keys())
    const withoutWorkingOn = templateRemoveLane({ ...t, lanes: nested }, 'k5')
    expect(withoutWorkingOn.some((l) => l.key === 'k5' || l.key === 'new1' || l.key === 'new2')).toBe(false)
    // A top-level column stays, split or not.
    expect(templateRemoveLane(t, 'k0')).toEqual(t.lanes)
    expect(templateRemoveLane(t, 'k4')).toEqual(t.lanes)
  })

  it('keeps every key unique through the edits', () => {
    const next = templateSplitLane(scrum(), 'k0', 'rows', keys())
    expect(new Set(next.map((l) => l.key)).size).toBe(next.length)
  })
})
