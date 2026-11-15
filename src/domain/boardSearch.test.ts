import { describe, expect, it } from 'vitest'
import {
  BOARD_SEARCH_PAGE_SIZE,
  pageOf,
  searchBoard,
  sortBoardSearchHits,
  type BoardSearchInput,
  type BoardSearchNote,
} from './boardSearch'
import { NO_FILTERS, type CardFilters } from './filters'
import type { Edge, Item, ItemLink, IssueType, Lane, Placement } from './types'

const T = Date.UTC(2026, 9, 15, 9, 0, 0)

const types: IssueType[] = [
  { id: 't-card', name: 'Card', color: '#3b82f6' },
  { id: 't-bug', name: 'Bug', color: '#ef4444' },
  { id: 't-initiative', name: 'Initiative', color: '#8b5cf6' },
]

const lanes: Lane[] = [
  { id: 'l-backlog', boardId: 'b-1', parentId: null, order: 0, name: 'Backlog', flowId: 'f-1', stage: 'backlog' },
  { id: 'l-dev', boardId: 'b-1', parentId: null, order: 1, name: 'Dev', flowId: 'f-1', stage: 'inProgress' },
  { id: 'l-done', boardId: 'b-1', parentId: null, order: 2, name: 'Done', flowId: 'f-1', stage: 'done' },
  { id: 'l-other', boardId: 'b-2', parentId: null, order: 0, name: 'Backlog', flowId: 'f-2', stage: 'backlog' },
]

const card = (id: string, title: string, over: Partial<Item> = {}): Item => ({
  id,
  title,
  typeId: 't-card',
  createdAt: T,
  ...over,
})

const items: Item[] = [
  card('i-title', 'Gateway rewrite', { createdAt: T + 3 }),
  card('i-description', 'Another card', { createdAt: T + 2, description: 'Move the gateway to the edge' }),
  card('i-link', 'Fourth card', { createdAt: T + 1, externalLabel: 'ATLAS-431 gateway' }),
  card('i-note', 'Fifth card', {
    createdAt: T,
    log: [{ id: 'n-1', at: T, kind: 'noted', note: 'The gateway retry budget' }],
  }),
  card('i-blocked', 'Blocked gateway', { blocked: true, priority: 'urgent', assignees: ['u-ada'], typeId: 't-bug' }),
  card('i-other-board', 'Gateway elsewhere', {}),
  card('i-archived', 'Archived gateway', { archived: true }),
]

const placements: Placement[] = [
  { id: 'p-1', boardId: 'b-1', itemId: 'i-title', laneId: 'l-backlog', rank: 0 },
  { id: 'p-2', boardId: 'b-1', itemId: 'i-description', laneId: 'l-dev', rank: 1 },
  { id: 'p-3', boardId: 'b-1', itemId: 'i-link', laneId: 'l-dev', rank: 2 },
  { id: 'p-4', boardId: 'b-1', itemId: 'i-note', laneId: 'l-done', rank: 3 },
  { id: 'p-5', boardId: 'b-1', itemId: 'i-blocked', laneId: 'l-backlog', rank: 4 },
  { id: 'p-6', boardId: 'b-2', itemId: 'i-other-board', laneId: 'l-other', rank: 0 },
  { id: 'p-7', boardId: 'b-1', itemId: 'i-archived', laneId: 'l-done', rank: 5 },
]

const edges: Edge[] = []
const links: ItemLink[] = []

const input = (over: Partial<BoardSearchInput> = {}): BoardSearchInput => ({
  boardId: 'b-1',
  query: 'gateway',
  items,
  placements,
  lanes,
  edges,
  links,
  issueTypes: types,
  filters: NO_FILTERS,
  now: T,
  ...over,
})

const ids = (hits: { item: Item }[]) => hits.map((hit) => hit.item.id)

describe('searching one board’s live work', () => {
  it('finds the title, description, link and note, and never another board’s card', () => {
    const hits = searchBoard(input())
    expect(ids(hits)).toEqual(['i-title', 'i-blocked', 'i-description', 'i-link', 'i-note'])
    expect(hits.find((hit) => hit.item.id === 'i-description')?.match.field).toBe('description')
    expect(hits.find((hit) => hit.item.id === 'i-link')?.match.field).toBe('link')
    expect(hits.find((hit) => hit.item.id === 'i-note')?.match.field).toBe('note')
    // Archived work is the Archive's, and another board's work is not this board's.
    expect(ids(hits)).not.toContain('i-other-board')
    expect(ids(hits)).not.toContain('i-archived')
  })

  it('reads a note the server answered with, only for a card on this board', () => {
    const remoteItem = card('i-remote', 'A card whose note matters')
    const notes: BoardSearchNote[] = [
      { itemId: 'i-remote', entry: { id: 'remote-1', at: T, kind: 'noted', note: 'gateway retry budget' } },
      { itemId: 'i-other-board', entry: { id: 'remote-2', at: T, kind: 'noted', note: 'gateway elsewhere' } },
    ]
    const hits = searchBoard(
      input({
        notes,
        items: [...items, remoteItem],
        placements: [...placements, { id: 'p-remote', boardId: 'b-1', itemId: 'i-remote', laneId: 'l-dev', rank: 8 }],
      }),
    )
    expect(hits.find((hit) => hit.item.id === 'i-remote')?.match.field).toBe('note')
    expect(ids(hits)).not.toContain('i-other-board')
  })

  it('narrows by the board’s filters, and by the search-only stage', () => {
    const bugOnly: CardFilters = { ...NO_FILTERS, typeIds: ['t-bug'] }
    expect(ids(searchBoard(input({ filters: bugOnly })))).toEqual(['i-blocked'])

    const urgent: CardFilters = { ...NO_FILTERS, priorities: ['urgent'] }
    expect(ids(searchBoard(input({ filters: urgent })))).toEqual(['i-blocked'])

    const assigned: CardFilters = { ...NO_FILTERS, assigneeIds: ['u-ada'] }
    expect(ids(searchBoard(input({ filters: assigned })))).toEqual(['i-blocked'])

    expect(ids(searchBoard(input({ stage: 'done' })))).toEqual(['i-note'])
    expect(ids(searchBoard(input({ stage: 'inProgress' })))).toEqual(['i-description', 'i-link'])
  })

  it('reads the title first, then the body, the link and the note', () => {
    expect(searchBoard(input()).map((hit) => hit.match.field)).toEqual([
      'title',
      'title',
      'description',
      'link',
      'note',
    ])
  })

  it('sorts by relevance, title or newest, with board order breaking ties', () => {
    const hits = searchBoard(input())
    expect(ids(sortBoardSearchHits(hits, 'title'))).toEqual([
      'i-description',
      'i-blocked',
      'i-note',
      'i-link',
      'i-title',
    ])
    expect(ids(sortBoardSearchHits(hits, 'newest'))).toEqual([
      'i-title',
      'i-description',
      'i-link',
      'i-note',
      'i-blocked',
    ])
  })

  it('pages a result set, clamping a page beyond the end', () => {
    const hits = searchBoard(input())
    const first = pageOf(hits, 0, 2)
    expect(ids(first.rows)).toEqual(['i-title', 'i-blocked'])
    expect(first).toMatchObject({ page: 1, pages: 3, total: 5 })
    const last = pageOf(hits, 2, 2)
    expect(ids(last.rows)).toEqual(['i-note'])
    expect(pageOf(hits, 99, 2).page).toBe(3)
    expect(pageOf([], 4).pages).toBe(1)
    expect(BOARD_SEARCH_PAGE_SIZE).toBe(50)
  })

  it('returns nothing for a query with no match, an empty query, or a board with no work', () => {
    expect(searchBoard(input({ query: 'nothing here' }))).toEqual([])
    expect(searchBoard(input({ query: '   ' }))).toEqual([])
    expect(searchBoard(input({ boardId: 'b-empty' }))).toEqual([])
  })

  it('reads an initiative’s derived section rather than a lane', () => {
    const initiative = card('i-initiative', 'Gateway programme', { typeId: 't-initiative' })
    const child = card('i-child', 'Gateway card')
    const withInitiative: Item[] = [...items, initiative, child]
    const withPlacements: Placement[] = [
      ...placements,
      { id: 'p-i', boardId: 'b-1', itemId: 'i-initiative', laneId: 'l-dev', rank: 6 },
      { id: 'p-c', boardId: 'b-1', itemId: 'i-child', laneId: 'l-dev', rank: 7 },
    ]
    const hits = searchBoard(
      input({ items: withInitiative, placements: withPlacements, query: 'Gateway programme' }),
    )
    expect(hits[0]).toMatchObject({ status: 'In Progress', stage: 'inProgress' })
  })
})
