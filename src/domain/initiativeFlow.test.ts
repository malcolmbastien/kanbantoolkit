import { describe, expect, it } from 'vitest'
import { initiativeFlowReading } from './initiativeFlow'
import type { Graph } from './derive'
import type { Edge, Item, Lane, Placement, Stage } from './types'
import type { StageMove } from './metrics'

const DAY = 86_400_000
const T = Date.UTC(2026, 9, 17, 12)

const lane = (id: string, stage: Stage): Lane => ({
  id,
  boardId: 'b-1',
  parentId: null,
  order: 0,
  name: stage,
  flowId: 'f-cards',
  stage,
})

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  title: id,
  typeId: 't-story',
  createdAt: T - 30 * DAY,
  ...over,
})

const placement = (itemId: string, laneId: string, laneEnteredAt: number, boardId = 'b-1'): Placement => ({
  id: `p-${itemId}`,
  boardId,
  itemId,
  laneId,
  laneEnteredAt,
})

const childEdge = (to: string): Edge => ({ id: `e-${to}`, kind: 'decomposition', from: 'i-1', to })
const move = (at: number, to: Stage, from?: Stage): StageMove => ({ at, to, ...(from ? { from } : {}) })

function graph(leaves: Item[], over: Partial<Graph> = {}): Graph {
  return {
    items: [item('i-1', { typeId: 't-initiative', title: 'Initiative' }), ...leaves],
    edges: leaves.map((leaf) => childEdge(leaf.id)),
    links: [],
    placements: [
      placement('l-backlog', 'l-backlog', T - 28 * DAY),
      placement('l-not-started', 'l-not-started', T - 20 * DAY),
      placement('l-progress', 'l-progress', T - 10 * DAY),
      placement('l-done', 'l-done', T - 2 * DAY),
    ],
    lanes: [lane('l-backlog', 'backlog'), lane('l-not-started', 'notStarted'), lane('l-progress', 'inProgress'), lane('l-done', 'done')],
    ...over,
  }
}

const leaves = [
  item('l-backlog'),
  item('l-not-started', { assignees: ['u-1'] }),
  item('l-progress'),
  item('l-done'),
]

const history = new Map<string, StageMove[]>([
  ['l-progress', [move(T - 10 * DAY, 'inProgress', 'backlog')]],
  ['l-done', [move(T - 2 * DAY, 'done', 'inProgress')]],
])

describe('an initiative’s flow reading', () => {
  it('reads progress, the leaf distribution and the derived section', () => {
    const g = graph(leaves)
    const reading = initiativeFlowReading(g.items[0], g, history, T)
    expect(reading.section).toBe('inProgress')
    expect(reading.percent).toBe(25)
    expect(reading.leaves).toEqual({ total: 4, backlog: 1, notStarted: 1, inProgress: 1, done: 1 })
    expect(reading.openMs).toBe(30 * DAY)
  })

  it('names the oldest open leaf with the clock it could use', () => {
    const g = graph(leaves)
    const reading = initiativeFlowReading(g.items[0], g, history, T)
    expect(reading.oldest).toMatchObject({ id: 'l-backlog', clock: 'column', ms: 28 * DAY })
  })

  it('counts the health rules’ blocked and unowned work, not a score of its own', () => {
    const g = graph(leaves.map((leaf) => (leaf.id === 'l-progress' ? { ...leaf, blocked: true } : leaf)))
    const reading = initiativeFlowReading(g.items[0], g, history, T)
    expect(reading.blocked).toBe(1)
    expect(reading.unowned).toBe(1)
    expect(reading.waiting).toBe(0)
  })

  it('stops at the archive and ignores a child move after it', () => {
    const g = graph(leaves)
    g.items[0] = { ...g.items[0], archivedAt: T - 5 * DAY }
    const reading = initiativeFlowReading(g.items[0], g, history, T)
    expect(reading.stop).toBe(T - 5 * DAY)
    expect(reading.openMs).toBe(25 * DAY)
    expect(reading.lastMoveAt).toBe(T - 10 * DAY)
  })

  it('says the last movement is unknown when child history was not loaded', () => {
    const g = graph(leaves)
    const reading = initiativeFlowReading(g.items[0], g, undefined, T)
    expect(reading.lastMoveKnown).toBe(false)
    expect(reading.lastMoveAt).toBeUndefined()
    // The leaves' own placements still carry an age, so the leaf reading survives the missing log.
    expect(reading.oldest?.id).toBe('l-backlog')
  })

  it('has no distribution and no oldest leaf when nothing sits below it', () => {
    const g: Graph = {
      items: [item('i-1', { typeId: 't-initiative' })],
      edges: [],
      links: [],
      placements: [],
      lanes: [],
    }
    const reading = initiativeFlowReading(g.items[0], g, new Map(), T)
    expect(reading.leaves.total).toBe(0)
    expect(reading.percent).toBe(0)
    expect(reading.oldest).toBeUndefined()
  })

  it('counts a leaf on another board and reads its age from that placement', () => {
    const g = graph(leaves, {
      placements: [
        placement('l-backlog', 'l-backlog', T - 20 * DAY, 'b-other'),
        placement('l-not-started', 'l-not-started', T - 10 * DAY),
        placement('l-progress', 'l-progress', T - 10 * DAY),
        placement('l-done', 'l-done', T - 2 * DAY),
      ],
    })
    const reading = initiativeFlowReading(g.items[0], g, new Map(), T)
    expect(reading.oldest).toMatchObject({ id: 'l-backlog', ms: 20 * DAY, clock: 'column' })
  })

  it('marks history that begins after creation rather than shortening the age silently', () => {
    const g = graph(leaves)
    const reading = initiativeFlowReading(g.items[0], g, history, T)
    expect(reading.historyFrom).toBe(T - 10 * DAY)
  })
})
