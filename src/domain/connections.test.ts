import { describe, expect, it } from 'vitest'
import { boardConnections } from './connections'
import type { Graph } from './derive'

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: id,
  typeId: 't-card',
  createdAt: 0,
  ...over,
})

const place = (itemId: string, boardId: string) => ({
  id: `p-${boardId}-${itemId}`,
  boardId,
  itemId,
  laneId: `l-${boardId}`,
})

function graph(over: Partial<Graph> = {}): Graph {
  return {
    items: [
      item('init', { typeId: 't-init' }),
      item('child'),
      item('blocker'),
      item('dependent'),
      item('elsewhere'),
      item('archived', { archived: true }),
      item('objective', { typeId: 't-objective' }),
    ],
    edges: [
      { id: 'h-1', kind: 'decomposition', from: 'init', to: 'child' },
      { id: 'h-2', kind: 'decomposition', from: 'init', to: 'elsewhere' },
      { id: 'h-3', kind: 'decomposition', from: 'init', to: 'archived' },
      { id: 'a-1', kind: 'attribution', from: 'objective', to: 'init' },
    ],
    links: [
      { id: 'd-1', from: 'blocker', to: 'dependent' },
      { id: 'd-2', from: 'elsewhere', to: 'dependent' },
    ],
    placements: [
      place('init', 'b-1'),
      place('child', 'b-1'),
      place('blocker', 'b-1'),
      place('dependent', 'b-1'),
      place('archived', 'b-1'),
      place('elsewhere', 'b-2'),
    ],
    lanes: [],
    ...over,
  }
}

describe('the edges a board can draw', () => {
  it('keeps hierarchy and dependency edges whose two ends are on this board', () => {
    expect(boardConnections(graph(), 'b-1')).toEqual([
      { id: 'h-1', kind: 'hierarchy', from: 'init', to: 'child' },
      { id: 'd-1', kind: 'dependency', from: 'blocker', to: 'dependent' },
    ])
  })

  it('drops an edge into another board, an archived item, or an attribution', () => {
    const ids = boardConnections(graph(), 'b-1').map((edge) => edge.id)
    expect(ids).not.toContain('h-2') // the child lives on b-2
    expect(ids).not.toContain('h-3') // the child is archived, so it is not drawn
    expect(ids).not.toContain('a-1') // attribution is initiative → objective, not item → item
    expect(ids).not.toContain('d-2') // the blocker lives on b-2
  })

  it('is empty for a board with no items of its own', () => {
    expect(boardConnections(graph(), 'b-empty')).toEqual([])
  })
})
