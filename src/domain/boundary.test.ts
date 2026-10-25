import { describe, expect, it } from 'vitest'
import { boundaryEntries, boundaryInStage, externalWaits } from './boundary'
import type { Graph } from './derive'
import type { Item, ItemLink, Lane, Placement } from './types'

/**
 * Boundary work is derived, and these are the rules that keep it so.
 *
 * The fail that matters: a boundary entry must never write. Nothing here mutates its input, and the
 * assertions below check the arrays as they were — because the whole point of a lens is that it
 * cannot change another board's work.
 */

const lane = (id: string, boardId: string, stage: Lane['stage']): Lane => ({
  id,
  boardId,
  parentId: null,
  order: 0,
  name: id,
  workflow: 'cards',
  stage,
})

const item = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  title: id,
  typeId: 't-card',
  createdAt: 0,
  ...extra,
})

const place = (itemId: string, laneId: string, boardId: string): Placement => ({
  id: `p-${itemId}`,
  boardId,
  itemId,
  laneId,
  rank: 0,
})

const link = (from: string, to: string): ItemLink => ({ id: `l-${from}-${to}`, from, to })

const lanes: Lane[] = [
  lane('a-backlog', 'a', 'backlog'),
  lane('a-doing', 'a', 'inProgress'),
  lane('a-done', 'a', 'done'),
  lane('b-backlog', 'b', 'backlog'),
  lane('b-doing', 'b', 'inProgress'),
  lane('b-done', 'b', 'done'),
]

/**
 * A small workspace with every state on the edge of board A:
 *
 *   a-1 (backlog) → ext-live (doing)      planning risk
 *   a-2 (doing)   → ext-live (doing)      live blockage — the entry reads by its worst news
 *   a-3 (backlog) → ext-done (done)       satisfied
 *   a-closed (done) → ext-closed (doing)  closed
 *   a-1 → ext-archived                    ignored: the dependency is filed away
 *   a-1 → ext-own                         ignored: it lives on this board already
 *   a-4 → a-5                             ignored: an internal dependency, not a boundary one
 */
function graph(): Graph {
  return {
    items: [
      item('a-1', { title: 'Alpha' }),
      item('a-2', { title: 'Bravo' }),
      item('a-3', { title: 'Charlie' }),
      item('a-4', { title: 'Delta' }),
      item('a-5', { title: 'Echo' }),
      item('a-closed', { title: 'Foxtrot' }),
      item('ext-live', { title: 'Zulu platform' }),
      item('ext-done', { title: 'Yankee contract' }),
      item('ext-closed', { title: 'Xray audit' }),
      item('ext-archived', { title: 'Whiskey', archived: true }),
      item('ext-own', { title: 'Victor' }),
    ],
    lanes,
    placements: [
      place('a-1', 'a-backlog', 'a'),
      place('a-2', 'a-doing', 'a'),
      place('a-3', 'a-backlog', 'a'),
      place('a-4', 'a-backlog', 'a'),
      place('a-5', 'a-backlog', 'a'),
      place('a-closed', 'a-done', 'a'),
      place('ext-live', 'b-doing', 'b'),
      place('ext-done', 'b-done', 'b'),
      place('ext-closed', 'b-doing', 'b'),
      place('ext-archived', 'b-backlog', 'b'),
      place('ext-own', 'a-backlog', 'a'),
    ],
    links: [
      link('ext-live', 'a-1'),
      link('ext-live', 'a-2'),
      link('ext-done', 'a-3'),
      link('ext-closed', 'a-closed'),
      link('ext-archived', 'a-1'),
      link('ext-own', 'a-1'),
      link('a-5', 'a-4'),
    ],
    edges: [],
  }
}

describe('the boundary workflow', () => {
  it('is one entry per external dependency, naming every dependent on this board', () => {
    const entries = boundaryEntries(graph(), 'a')
    const live = entries.find((entry) => entry.dependency.id === 'ext-live')!
    expect(live.dependents.map((dependent) => dependent.id)).toEqual(['a-1', 'a-2'])
    expect(entries.filter((entry) => entry.dependency.id === 'ext-live')).toHaveLength(1)
  })

  it('reads by its worst state, and keeps satisfied and closed entries', () => {
    const entries = boundaryEntries(graph(), 'a')
    // a-1's link is a planning risk and a-2's is a live blockage: the entry is the blockage.
    expect(entries.map((entry) => [entry.dependency.id, entry.state])).toEqual([
      ['ext-live', 'OpenLiveBlockage'],
      ['ext-done', 'Satisfied'],
      ['ext-closed', 'Closed'],
    ])
  })

  it('takes the stage from the dependency’s own rollup, not from a placement here', () => {
    const entries = boundaryEntries(graph(), 'a')
    expect(entries.find((entry) => entry.dependency.id === 'ext-live')!.stage).toBe('inProgress')
    expect(entries.find((entry) => entry.dependency.id === 'ext-done')!.stage).toBe('done')
    expect(boundaryInStage(entries, 'done').map((entry) => entry.dependency.id)).toEqual(['ext-done'])
  })

  it('ignores archived work, its own board, and dependencies that cross no edge', () => {
    const ids = boundaryEntries(graph(), 'a').map((entry) => entry.dependency.id)
    expect(ids).not.toContain('ext-archived')
    expect(ids).not.toContain('ext-own')
    // a-4 waits on a-5, both here: that is not the boundary.
    expect(ids).not.toContain('a-5')
  })

  it('orders within a column by state, then by title', () => {
    const g = graph()
    // Two closed entries, so the tie-break is visible.
    g.items.push(item('ext-closed-2', { title: 'Xylophone' }))
    g.placements.push(place('ext-closed-2', 'b-doing', 'b'))
    g.links.push(link('ext-closed-2', 'a-closed'))

    // "Xray audit" sorts before "Xylophone" — the tie-break is the title, not insertion order.
    const closed = boundaryInStage(boundaryEntries(g, 'a'), 'inProgress')
    expect(closed.map((entry) => entry.dependency.id)).toEqual(['ext-live', 'ext-closed', 'ext-closed-2'])
  })

  it('writes nothing: the graph it was handed is the graph it was handed', () => {
    const g = graph()
    const before = {
      items: [...g.items],
      lanes: [...g.lanes],
      links: [...g.links],
      placements: [...g.placements],
    }
    boundaryEntries(g, 'a')
    expect(g.items).toEqual(before.items)
    expect(g.lanes).toEqual(before.lanes)
    expect(g.links).toEqual(before.links)
    expect(g.placements).toEqual(before.placements)
  })

  it('is empty for a board with nothing crossing its edge', () => {
    expect(boundaryEntries(graph(), 'b')).toEqual([])
  })
})

describe('what one card is still waiting on', () => {
  it('names open external dependencies, and only those', () => {
    const waits = externalWaits('a-1', graph(), 'a')
    // ext-live is open; ext-archived and ext-own are not waiting-ons at all.
    expect(waits.map((wait) => wait.dependency.id)).toEqual(['ext-live'])
  })

  it('leaves a satisfied link off the card, because it is no longer waiting', () => {
    expect(externalWaits('a-3', graph(), 'a')).toEqual([])
  })
})
