import { describe, expect, it } from 'vitest'
import { activeBoards, boardsByBand } from './board'
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
