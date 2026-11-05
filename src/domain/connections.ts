/**
 * The edges a board can draw between the items it is showing.
 *
 * Two kinds, and only two: a **hierarchy** edge is a decomposition parent → child, and a
 * **dependency** is a link from the blocker to the item that waits on it. Attribution (an
 * initiative to an objective) is not an item-to-item relation and is not here; neither is a
 * boundary link whose other end lives on another board, because there is no item on this board to
 * connect it to. The view draws what the board renders, not what the model holds everywhere.
 */

import type { Graph } from './derive'
import type { Edge, Item, ItemLink, Placement } from './types'

export type ConnectionKind = 'hierarchy' | 'dependency'

export interface ConnectionEdge {
  id: string
  kind: ConnectionKind
  /** The parent (hierarchy) or blocker (dependency). */
  from: string
  /** The child (hierarchy) or dependent (dependency). */
  to: string
}

/**
 * The edges whose **both endpoints are on this board** and still drawn there.
 *
 * An archived item is not rendered, so an edge to it has no second end. A filtered or collapsed
 * item is still in this list — filtering is a view of the board, not a different graph — and the
 * overlay drops the line when the DOM has no card for it.
 */
export function boardConnections(graph: Graph, boardId: string): ConnectionEdge[] {
  const onBoard = new Set<string>()
  for (const placement of graph.placements as Placement[]) {
    if (placement.boardId === boardId) onBoard.add(placement.itemId)
  }
  const items = new Map<string, Item>()
  for (const item of graph.items) {
    if (onBoard.has(item.id) && !item.archived) items.set(item.id, item)
  }

  const edges: ConnectionEdge[] = []
  for (const edge of graph.edges as Edge[]) {
    if (edge.kind !== 'decomposition') continue
    if (!items.has(edge.from) || !items.has(edge.to)) continue
    edges.push({ id: edge.id, kind: 'hierarchy', from: edge.from, to: edge.to })
  }
  for (const link of graph.links as ItemLink[]) {
    if (!items.has(link.from) || !items.has(link.to)) continue
    edges.push({ id: link.id, kind: 'dependency', from: link.from, to: link.to })
  }
  return edges
}
