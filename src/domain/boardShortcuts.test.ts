import { describe, expect, it } from 'vitest'
import {
  favouriteBoardList,
  noteVisit,
  pruneFavourites,
  pruneVisits,
  recentBoardList,
  RECENT_BOARDS_LIMIT,
  toggleFavourite,
  type BoardVisit,
} from './boardShortcuts'
import type { Board } from './types'

const board = (id: string, name: string, over: Partial<Board> = {}): Board => ({
  id,
  name,
  band: 'team',
  description: '',
  ...over,
})

const boards: Board[] = [
  board('b-atlas', 'Team Atlas'),
  board('b-nova', 'Team Nova'),
  board('b-lob', 'Digital line of business', { band: 'program' }),
  board('b-old', 'Old board', { archived: true }),
]

describe('the home’s shortcuts', () => {
  it('keeps one visit per board, newest first, and stays bounded', () => {
    let visits: BoardVisit[] = []
    visits = noteVisit(visits, 'b-atlas', 1)
    visits = noteVisit(visits, 'b-nova', 2)
    visits = noteVisit(visits, 'b-atlas', 3)
    expect(visits.map((visit) => visit.boardId)).toEqual(['b-atlas', 'b-nova'])
    expect(visits[0].at).toBe(3)

    // Twelve boards visited, and the list is the last eight.
    visits = []
    for (let i = 0; i < 12; i += 1) visits = noteVisit(visits, `b-${i}`, i)
    expect(visits).toHaveLength(RECENT_BOARDS_LIMIT)
    expect(visits[0].boardId).toBe('b-11')
    expect(visits.at(-1)?.boardId).toBe('b-4')
  })

  it('toggles a favourite without ever keeping a second copy', () => {
    expect(toggleFavourite([], 'b-atlas')).toEqual(['b-atlas'])
    expect(toggleFavourite(['b-atlas'], 'b-atlas')).toEqual([])
    expect(toggleFavourite(['b-atlas'], 'b-nova')).toEqual(['b-atlas', 'b-nova'])
  })

  it('lists favourites by name and leaves out boards that are gone or archived', () => {
    expect(favouriteBoardList(boards, ['b-nova', 'b-old', 'b-gone', 'b-atlas']).map((b) => b.name)).toEqual([
      'Team Atlas',
      'Team Nova',
    ])
    expect(favouriteBoardList(boards, [])).toEqual([])
  })

  it('lists recents in visit order without repeating a favourite or a dead board', () => {
    const visits: BoardVisit[] = [
      { boardId: 'b-nova', at: 4 },
      { boardId: 'b-atlas', at: 3 },
      { boardId: 'b-old', at: 2 },
      { boardId: 'b-gone', at: 1 },
      { boardId: 'b-lob', at: 0 },
    ]
    expect(recentBoardList(boards, visits, ['b-atlas']).map((b) => b.id)).toEqual(['b-nova', 'b-lob'])
    // A repeated id in stored state is still one row.
    expect(recentBoardList(boards, [...visits, { boardId: 'b-nova', at: 9 }], []).map((b) => b.id)).toEqual([
      'b-nova',
      'b-atlas',
      'b-lob',
    ])
  })

  it('prunes a saved state to boards that exist, keeping the latest visit', () => {
    const known = new Set(['b-atlas', 'b-nova'])
    expect(pruneFavourites(['b-atlas', 'b-gone', 'b-atlas', 'b-nova'], known)).toEqual(['b-atlas', 'b-nova'])
    expect(pruneFavourites([], known)).toEqual([])

    const visits: BoardVisit[] = [
      { boardId: 'b-atlas', at: 1 },
      { boardId: 'b-gone', at: 5 },
      { boardId: 'b-atlas', at: 3 },
      { boardId: 'b-nova', at: 2 },
    ]
    expect(pruneVisits(visits, known)).toEqual([
      { boardId: 'b-atlas', at: 3 },
      { boardId: 'b-nova', at: 2 },
    ])
  })

  it('ignores malformed visits rather than letting a bad file break the home', () => {
    const known = new Set(['b-atlas'])
    expect(
      pruneVisits(
        [
          { boardId: 'b-atlas', at: 1 },
          { boardId: 'b-atlas', at: 'x' } as unknown as BoardVisit,
          null as unknown as BoardVisit,
          { at: 2 } as unknown as BoardVisit,
        ],
        known,
      ),
    ).toEqual([{ boardId: 'b-atlas', at: 1 }])
  })
})
