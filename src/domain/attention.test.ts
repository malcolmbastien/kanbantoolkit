import { describe, expect, it } from 'vitest'
import { ATTENTION_TILES, boardAttention, orderRows } from './attention'
import type { Graph } from './derive'
import { STALE_AFTER_DAYS } from './filters'
import type { Board, Edge, IssueType, Item, Lane, Placement, Stage } from './types'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 17, 12)

const card = (id: string, patch: Partial<Item> = {}): Item => ({
  id,
  title: id,
  typeId: 't-story',
  createdAt: NOW - 60 * DAY,
  ...patch,
})

const lane = (id: string, stage: Stage, boardId = 'b', workflow: 'cards' | 'initiatives' = 'cards'): Lane => ({
  id,
  boardId,
  parentId: `root-${boardId}`,
  order: 0,
  name: `${stage} lane`,
  stage,
  workflow,
})

const root = (boardId = 'b', workflow: 'cards' | 'initiatives' = 'cards'): Lane => ({
  id: `root-${boardId}`,
  boardId,
  parentId: null,
  order: 0,
  name: '',
  workflow,
})

const at = (itemId: string, laneId: string, enteredAt?: number, boardId = 'b'): Placement => ({
  id: `p-${boardId}-${itemId}`,
  boardId,
  itemId,
  laneId,
  ...(enteredAt !== undefined ? { laneEnteredAt: enteredAt } : {}),
})

/** A board with one cell per stage, plus whatever the caller adds. */
function cardsBoard(items: Item[], placements: Placement[], lanes: Lane[] = []): Graph {
  return {
    items,
    edges: [],
    links: [],
    placements,
    lanes: [
      root(),
      lane('backlog', 'backlog'),
      lane('ns', 'notStarted'),
      lane('ip', 'inProgress'),
      lane('done', 'done'),
      ...lanes,
    ],
  }
}

describe('board attention on a cards board', () => {
  it('reads every signal from the work itself, and counts the population once', () => {
    const items = [
      // Everything at once: late, stuck, and with no owner, priority or size.
      card('a', { targetEndDate: '2026-10-10' }),
      // Nothing to say about this one.
      card('b', { size: 3, assignees: ['u-1'], priority: 'high', targetEndDate: '2026-12-01' }),
      // Finished work is not attention.
      card('c', { targetEndDate: '2026-10-01' }),
      // Filed away, so off the board.
      card('d', { archived: true, archivedAt: NOW - DAY }),
      // Backlog: uncommitted, so never stale — but still unowned and unestimated.
      card('e'),
    ]
    const graph = cardsBoard(
      items,
      [
        at('a', 'ip', NOW - 10 * DAY),
        at('b', 'ip', NOW - DAY),
        at('c', 'done', NOW - 30 * DAY),
        at('d', 'ip', NOW - 30 * DAY),
        at('e', 'backlog', NOW - 30 * DAY),
      ],
    )

    const attention = boardAttention(graph, 'b', [], { now: NOW })
    expect(attention.population).toBe('cards')
    expect(attention.rows.map((r) => r.item.id)).toEqual(['a', 'e', 'b'])
    expect(attention.counts).toEqual({
      unfinished: 3,
      overdue: 1,
      stale: 1,
      unassigned: 2,
      noPriority: 2,
      noEstimate: 2,
    })

    const a = attention.rows.find((r) => r.item.id === 'a')!
    expect(a.signals.map((s) => s.key)).toEqual(['overdue', 'stale', 'unassigned', 'noPriority', 'noEstimate'])
    expect(a.status).toBe('inProgress lane')
    expect(a.ageDays).toBe(10)
    expect(a.signals.find((s) => s.key === 'overdue')?.tone).toBe('risk')
    expect(a.signals.find((s) => s.key === 'stale')?.tone).toBe('watch')
    expect(a.signals.find((s) => s.key === 'stale')?.why).toContain(`${STALE_AFTER_DAYS}-day`)

    // The clean row is still in the array — it is the population — but carries no chips.
    expect(attention.rows.find((r) => r.item.id === 'b')?.signals).toEqual([])
  })

  it('never calls a card stale without a stamp, and never pulls Backlog backwards', () => {
    const graph = cardsBoard(
      [card('old'), card('short'), card('unknown'), card('backlog')],
      [
        at('old', 'ip', NOW - STALE_AFTER_DAYS * DAY),
        at('short', 'ip', NOW - (STALE_AFTER_DAYS - 1) * DAY),
        at('unknown', 'ip'),
        at('backlog', 'backlog', NOW - 40 * DAY),
      ],
      [],
    )
    const stale = boardAttention(graph, 'b', [], { now: NOW }).rows.filter((r) => r.signals.some((s) => s.key === 'stale'))
    expect(stale.map((r) => r.item.id)).toEqual(['old'])
    expect(stale[0].ageDays).toBe(STALE_AFTER_DAYS)
  })

  it('judges overdue by the target date, and "no estimate" by whether there is one at all', () => {
    const graph = cardsBoard(
      [card('late', { targetEndDate: '2026-10-16' }), card('soon', { targetEndDate: '2026-10-18' }), card('zero', { size: 0 })],
      [at('late', 'ip'), at('soon', 'ip'), at('zero', 'ip')],
    )
    const rows = boardAttention(graph, 'b', [], { now: NOW }).rows
    const by = Object.fromEntries(rows.map((r) => [r.item.id, r.signals.map((s) => s.key)]))
    expect(by.late).toContain('overdue')
    expect(by.soon).not.toContain('overdue')
    // Zero is an estimate of nothing; only an absent size is "no estimate".
    expect(by.zero).not.toContain('noEstimate')
    expect(by.late).toContain('noEstimate')
  })

  it('is one array: every count is the rows carrying that signal, and none exceeds Unfinished', () => {
    const graph = cardsBoard(
      [
        card('a', { targetEndDate: '2026-10-01' }),
        card('b', { assignees: ['u'], priority: 'low', size: 1 }),
        card('c', { assignees: [], priority: 'medium', size: 2 }),
        card('d', { assignees: ['u'], priority: 'urgent', size: 0 }),
        card('e'),
      ],
      [at('a', 'ip', NOW - 20 * DAY), at('b', 'ip'), at('c', 'ns', NOW - 10 * DAY), at('d', 'backlog'), at('e', 'ip', NOW - 2 * DAY)],
    )
    const { rows, counts } = boardAttention(graph, 'b', [], { now: NOW })
    expect(counts.unfinished).toBe(rows.length)
    for (const tile of ATTENTION_TILES) {
      if (tile.key === 'unfinished') continue
      expect(counts[tile.key]).toBe(rows.filter((r) => r.signals.some((s) => s.key === tile.key)).length)
    }
    for (const key of Object.keys(counts) as (keyof typeof counts)[]) expect(counts[key]).toBeLessThanOrEqual(counts.unfinished)
  })

  it('orders by the number of signals, then the oldest known age, then the title', () => {
    const graph = cardsBoard(
      [
        card('A', { title: 'Alpha', size: 1, targetEndDate: '2026-10-01' }),
        card('B', { title: 'Bravo', size: 1, targetEndDate: '2026-10-01' }),
        card('C', { title: 'Charlie', size: 1 }),
        card('D', { title: 'Delta', size: 1, assignees: ['u'] }),
        card('E', { title: 'Echo', assignees: ['u'], priority: 'low', size: 1, targetEndDate: '2026-12-01' }),
      ],
      [
        at('A', 'ip', NOW - 2 * DAY),
        at('B', 'ip', NOW - 10 * DAY),
        at('C', 'ip', NOW - DAY),
        at('D', 'ip'),
        at('E', 'ip', NOW - DAY),
      ],
    )
    // Both carry three signals; Bravo is older. Charlie carries two, Delta one with no stamp.
    const attention = boardAttention(graph, 'b', [], { now: NOW })
    expect(attention.rows.map((r) => r.item.id)).toEqual(['B', 'A', 'C', 'D', 'E'])
    expect(attention.rows.find((r) => r.item.id === 'C')?.signals).toHaveLength(2)
    expect(attention.rows.find((r) => r.item.id === 'D')?.ageDays).toBeUndefined()
    expect(attention.rows.find((r) => r.item.id === 'E')?.signals).toEqual([])
  })

  it('does not count a card placed on another board', () => {
    const graph = cardsBoard([card('a')], [at('a', 'ip', NOW - DAY, 'other')])
    expect(boardAttention(graph, 'b', [], { now: NOW }).counts.unfinished).toBe(0)
  })

  it('says nothing at all for a board with no work on it', () => {
    const attention = boardAttention(cardsBoard([], []), 'b', [], { now: NOW })
    expect(attention.rows).toEqual([])
    expect(attention.counts).toEqual({ unfinished: 0, overdue: 0, stale: 0, unassigned: 0, noPriority: 0, noEstimate: 0 })
  })
})

describe('board attention on a coordination board', () => {
  const initiativeType: IssueType = { id: 't-initiative', name: 'Initiative', color: '#6366f1' }
  const program: Board = { id: 'p', name: 'Programme', band: 'program', description: '' }

  it('reads the board\'s own initiatives through the health rules, and offers no estimate tile', () => {
    const items = [
      card('init', { typeId: 't-initiative', targetEndDate: '2026-10-01' }),
      card('k1', { assignees: [] }),
      card('k2', { assignees: [] }),
    ]
    const edges: Edge[] = [
      { id: 'e1', kind: 'decomposition', from: 'init', to: 'k1' },
      { id: 'e2', kind: 'decomposition', from: 'init', to: 'k2' },
    ]
    const graph: Graph = {
      items,
      edges,
      links: [],
      placements: [
        at('init', 'init-ip', NOW - 30 * DAY, 'p'),
        // The work below lives on a team board; only its stage and stamp are read here.
        at('k1', 'team-ip', NOW - 30 * DAY, 't'),
        at('k2', 'team-ip', NOW - 30 * DAY, 't'),
      ],
      lanes: [
        root('p', 'initiatives'),
        lane('init-ip', 'inProgress', 'p', 'initiatives'),
        root('t'),
        lane('team-ip', 'inProgress', 't'),
      ],
    }

    const attention = boardAttention(graph, 'p', [initiativeType], { boards: [program], now: NOW })
    expect(attention.population).toBe('initiatives')
    expect(attention.hasEstimate).toBe(false)
    expect(attention.rows).toHaveLength(1)
    const row = attention.rows[0]
    expect(row.item.id).toBe('init')
    // Its section is derived from the work below, so it reads in the same words as the column.
    expect(row.status).toBe('In Progress')
    expect(row.stage).toBe('inProgress')
    expect(row.ageDays).toBe(30)
    expect(row.signals.map((s) => s.key)).toEqual(['overdue', 'stale', 'unassigned', 'noPriority'])
    expect(row.signals.find((s) => s.key === 'unassigned')?.why).toContain('no owner')

    expect(attention.counts).toEqual({
      unfinished: 1,
      overdue: 1,
      stale: 1,
      unassigned: 1,
      noPriority: 1,
      // An initiative has no estimate by design: absent, not zero.
      noEstimate: 0,
    })
  })

  it('leaves finished initiatives out of the population', () => {
    const graph: Graph = {
      items: [card('done-init', { typeId: 't-initiative' })],
      edges: [],
      links: [],
      placements: [at('done-init', 'init-done', NOW - DAY, 'p')],
      lanes: [root('p', 'initiatives'), lane('init-done', 'done', 'p', 'initiatives')],
    }
    expect(boardAttention(graph, 'p', [initiativeType], { boards: [program], now: NOW }).counts.unfinished).toBe(0)
  })
})

describe('ordering', () => {
  it('is stable and deterministic when two rows agree on every key', () => {
    const rows = [
      { item: card('b', { title: 'beta' }), status: '', signals: [] },
      { item: card('a', { title: 'Alpha' }), status: '', signals: [] },
      { item: card('c', { title: 'ALPHA' }), status: '', signals: [] },
    ]
    expect(orderRows(rows).map((r) => r.item.title)).toEqual(['Alpha', 'ALPHA', 'beta'])
  })
})
