import { describe, expect, it } from 'vitest'
import { ATTENTION_TILES, boardAttention, orderRows } from './attention'
import type { Graph } from './derive'
import { STALE_AFTER_DAYS } from './filters'
import type { Board, BoardFlow, Edge, IssueType, Item, Lane, Placement, Stage } from './types'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 17, 12)

const card = (id: string, patch: Partial<Item> = {}): Item => ({
  id,
  title: id,
  typeId: 't-story',
  createdAt: NOW - 60 * DAY,
  ...patch,
})

const CARDS = 'f-cards'
const INIT = 'f-initiatives'
/** A board's two flows, in the shape the model now names a tree with. */
const flows = (boardId = 'b'): BoardFlow[] => [
  { id: CARDS, boardId, kind: 'cards', name: 'Cards', order: 0 },
  { id: INIT, boardId, kind: 'initiatives', name: 'Initiatives', order: 0 },
]

const lane = (id: string, stage: Stage, boardId = 'b', flowId = CARDS): Lane => ({
  id,
  boardId,
  parentId: `root-${boardId}`,
  order: 0,
  name: `${stage} lane`,
  stage,
  flowId,
})

const root = (boardId = 'b', flowId = CARDS): Lane => ({
  id: `root-${boardId}`,
  boardId,
  parentId: null,
  order: 0,
  name: '',
  flowId,
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
  it('reads every signal from the work itself, and counts each one once', () => {
    const items = [
      // Everything at once: late, stuck, and with no owner.
      card('a', { dueDate: '2026-10-10' }),
      // Nothing to say about this one.
      card('b', { assignees: ['u-1'], priority: 'high', dueDate: '2026-12-01' }),
      // Finished work is not attention.
      card('c', { dueDate: '2026-10-01' }),
      // Filed away, so off the board.
      card('d', { archived: true, archivedAt: NOW - DAY }),
      // Backlog: uncommitted, so never stale — but still unowned.
      card('e'),
      // A hard stop somebody set, and its reason.
      card('blocked', { assignees: ['u-1'], blocked: true, blockedReason: 'Waiting on legal' }),
      // Waiting on another item that is not done.
      card('waits', { assignees: ['u-1'] }),
      card('dep', { assignees: ['u-1'] }),
    ]
    const graph = cardsBoard(
      items,
      [
        at('a', 'ip', NOW - 10 * DAY),
        at('b', 'ip', NOW - DAY),
        at('c', 'done', NOW - 30 * DAY),
        at('d', 'ip', NOW - 30 * DAY),
        at('e', 'backlog', NOW - 30 * DAY),
        at('blocked', 'ip', NOW - DAY),
        at('waits', 'ip', NOW - DAY),
        at('dep', 'ns', NOW - DAY),
      ],
    )
    // `from` is the item depended upon, `to` the one that waits.
    graph.links = [{ id: 'l1', from: 'dep', to: 'waits' }]

    const attention = boardAttention(graph, 'b', [], flows(), { now: NOW })
    expect(attention.population).toBe('cards')
    expect(attention.rows.map((r) => r.item.id)).toEqual(['a', 'e', 'blocked', 'waits', 'b', 'dep'])
    expect(attention.counts).toEqual({
      blocked: 1,
      waiting: 1,
      overdue: 1,
      stale: 1,
      unassigned: 2,
    })

    const a = attention.rows.find((r) => r.item.id === 'a')!
    expect(a.signals.map((s) => s.key)).toEqual(['overdue', 'stale', 'unassigned'])
    expect(a.status).toBe('inProgress lane')
    expect(a.ageDays).toBe(10)
    expect(a.signals.find((s) => s.key === 'overdue')?.tone).toBe('risk')
    expect(a.signals.find((s) => s.key === 'stale')?.tone).toBe('watch')
    expect(a.signals.find((s) => s.key === 'stale')?.why).toContain(`${STALE_AFTER_DAYS}-day`)

    // A blocked card says why, and waiting is read from the link — never stored on the item.
    const blocked = attention.rows.find((r) => r.item.id === 'blocked')!
    expect(blocked.signals.map((s) => s.key)).toEqual(['blocked'])
    expect(blocked.signals[0].why).toContain('Waiting on legal')
    expect(blocked.signals[0].tone).toBe('risk')
    const waits = attention.rows.find((r) => r.item.id === 'waits')!
    expect(waits.signals.map((s) => s.key)).toEqual(['waiting'])
    expect(waits.signals[0].why).toContain('not done')

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
    const stale = boardAttention(graph, 'b', [], flows(), { now: NOW }).rows.filter((r) => r.signals.some((s) => s.key === 'stale'))
    expect(stale.map((r) => r.item.id)).toEqual(['old'])
    expect(stale[0].ageDays).toBe(STALE_AFTER_DAYS)
  })

  it('judges overdue by the due date, and by nothing else', () => {
    const graph = cardsBoard(
      [card('late', { dueDate: '2026-10-16' }), card('soon', { dueDate: '2026-10-18' }), card('undated')],
      [at('late', 'ip'), at('soon', 'ip'), at('undated', 'ip')],
    )
    const rows = boardAttention(graph, 'b', [], flows(), { now: NOW }).rows
    const by = Object.fromEntries(rows.map((r) => [r.item.id, r.signals.map((s) => s.key)]))
    expect(by.late).toContain('overdue')
    expect(by.soon).not.toContain('overdue')
    expect(by.undated).not.toContain('overdue')
  })

  it('is one array: every count is the rows carrying that signal, and none exceeds Unfinished', () => {
    const graph = cardsBoard(
      [
        card('a', { dueDate: '2026-10-01' }),
        card('b', { assignees: ['u'], priority: 'low' }),
        card('c', { assignees: [], priority: 'medium' }),
        card('d', { assignees: ['u'], priority: 'urgent' }),
        card('e'),
      ],
      [at('a', 'ip', NOW - 20 * DAY), at('b', 'ip'), at('c', 'ns', NOW - 10 * DAY), at('d', 'backlog'), at('e', 'ip', NOW - 2 * DAY)],
    )
    const { rows, counts } = boardAttention(graph, 'b', [], flows(), { now: NOW })
    for (const tile of ATTENTION_TILES) {
      expect(counts[tile.key], tile.key).toBe(rows.filter((r) => r.signals.some((s) => s.key === tile.key)).length)
      expect(counts[tile.key], tile.key).toBeLessThanOrEqual(rows.length)
    }
  })

  it('orders by the number of signals, then the oldest known age, then the title', () => {
    const graph = cardsBoard(
      [
        card('A', { title: 'Alpha', dueDate: '2026-10-01' }),
        card('B', { title: 'Bravo', dueDate: '2026-10-01' }),
        card('C', { title: 'Charlie' }),
        card('D', { title: 'Delta', assignees: ['u'] }),
        card('E', { title: 'Echo', assignees: ['u'], priority: 'low', dueDate: '2026-12-01' }),
      ],
      [
        at('A', 'ip', NOW - 2 * DAY),
        at('B', 'ip', NOW - 10 * DAY),
        at('C', 'ip', NOW - DAY),
        at('D', 'ip'),
        at('E', 'ip', NOW - DAY),
      ],
    )
    // Alpha and Bravo are overdue, Charlie unassigned; Bravo is the oldest of those. Delta and
    // Echo carry nothing, and only Echo has a stamp to order by.
    const attention = boardAttention(graph, 'b', [], flows(), { now: NOW })
    expect(attention.rows.map((r) => r.item.id)).toEqual(['B', 'A', 'C', 'E', 'D'])
    expect(attention.rows.find((r) => r.item.id === 'C')?.signals).toHaveLength(1)
    expect(attention.rows.find((r) => r.item.id === 'D')?.ageDays).toBeUndefined()
    expect(attention.rows.find((r) => r.item.id === 'E')?.signals).toEqual([])
  })

  it('does not count a card placed on another board', () => {
    const graph = cardsBoard([card('a')], [at('a', 'ip', NOW - DAY, 'other')])
    expect(boardAttention(graph, 'b', [], flows(), { now: NOW }).rows).toEqual([])
  })

  it('says nothing at all for a board with no work on it', () => {
    const attention = boardAttention(cardsBoard([], []), 'b', [], flows(), { now: NOW })
    expect(attention.rows).toEqual([])
    expect(attention.counts).toEqual({ blocked: 0, waiting: 0, overdue: 0, stale: 0, unassigned: 0 })
  })
})

describe('a board with more than one cards flow', () => {
  it('says which flow a card is in, because "Backlog" is two answers', () => {
    const support: BoardFlow = { id: 'f-support', boardId: 'b', kind: 'cards', name: 'Support', order: 1 }
    const graph = cardsBoard(
      [card('a'), card('b')],
      [at('a', 'backlog'), at('b', 'support-backlog')],
      [root('b', 'f-support'), lane('support-backlog', 'backlog', 'b', 'f-support')],
    )
    const attention = boardAttention(graph, 'b', [], [...flows(), support], { now: NOW })
    const status = (id: string) => attention.rows.find((r) => r.item.id === id)!.status
    expect(status('a')).toBe('Cards · backlog lane')
    expect(status('b')).toBe('Support · backlog lane')
  })
})

describe('board attention on a coordination board', () => {
  const initiativeType: IssueType = { id: 't-initiative', name: 'Initiative', color: '#6366f1' }
  const program: Board = { id: 'p', name: 'Programme', band: 'program', description: '' }

  it('reads the board\'s own initiatives through the health rules', () => {
    const items = [
      card('init', { typeId: 't-initiative', dueDate: '2026-10-01' }),
      card('k1', { assignees: [], blocked: true }),
      card('k2', { assignees: [] }),
    ]
    const edges: Edge[] = [
      { id: 'e1', kind: 'decomposition', from: 'init', to: 'k1' },
      { id: 'e2', kind: 'decomposition', from: 'init', to: 'k2' },
    ]
    const graph: Graph = {
      items,
      edges,
      // k1 waits on k2: the initiative's work below has an open dependency.
      links: [{ id: 'l1', from: 'k2', to: 'k1' }],
      placements: [
        at('init', 'init-ip', NOW - 30 * DAY, 'p'),
        // The work below lives on a team board; only its stage and stamp are read here.
        at('k1', 'team-ip', NOW - 30 * DAY, 't'),
        at('k2', 'team-ip', NOW - 30 * DAY, 't'),
      ],
      lanes: [
        root('p', INIT),
        lane('init-ip', 'inProgress', 'p', INIT),
        root('t'),
        lane('team-ip', 'inProgress', 't'),
      ],
    }

    const attention = boardAttention(graph, 'p', [initiativeType], flows('p'), { boards: [program], now: NOW })
    expect(attention.population).toBe('initiatives')
    expect(attention.rows).toHaveLength(1)
    const row = attention.rows[0]
    expect(row.item.id).toBe('init')
    // Its section is derived from the work below, so it reads in the same words as the column.
    expect(row.status).toBe('In Progress')
    expect(row.stage).toBe('inProgress')
    expect(row.ageDays).toBe(30)
    expect(row.signals.map((s) => s.key)).toEqual(['blocked', 'waiting', 'overdue', 'stale', 'unassigned'])
    expect(row.signals.find((s) => s.key === 'blocked')?.why).toContain('blocked')
    expect(row.signals.find((s) => s.key === 'waiting')?.why).toContain('waits')
    expect(row.signals.find((s) => s.key === 'unassigned')?.why).toContain('no owner')

    expect(attention.counts).toEqual({
      blocked: 1,
      waiting: 1,
      overdue: 1,
      stale: 1,
      unassigned: 1,
    })
  })

  it('leaves finished initiatives out of the population', () => {
    const graph: Graph = {
      items: [card('done-init', { typeId: 't-initiative' })],
      edges: [],
      links: [],
      placements: [at('done-init', 'init-done', NOW - DAY, 'p')],
      lanes: [root('p', INIT), lane('init-done', 'done', 'p', 'initiatives')],
    }
    expect(boardAttention(graph, 'p', [initiativeType], flows('p'), { boards: [program], now: NOW }).rows).toEqual([])
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
