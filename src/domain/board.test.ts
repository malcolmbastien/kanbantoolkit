import { describe, expect, it } from 'vitest'
import { activeBoards, boardsByBand, lanesFromTemplate, templateFromBoard } from './board'
import { createSeed } from './seed'

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
