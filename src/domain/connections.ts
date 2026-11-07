/**
 * The edges a board can draw between the items it is showing.
 *
 * Two kinds, and only two: a **hierarchy** edge is a decomposition parent → child, and a
 * **dependency** is a link from the blocker to the item that waits on it. Attribution (an
 * initiative to an objective) is not an item-to-item relation and is not here; neither is a
 * boundary link whose other end lives on another board, because there is no item on this board to
 * connect it to. The view draws what the board renders, not what the model holds everywhere.
 */

import { boundaryEntries } from './boundary'
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
 * The edges between items the board draws.
 *
 * Hierarchy and on-board dependencies need both ends rendered here. A **boundary** dependency is
 * the other case: its dependent is placed here and the external item is drawn in the boundary band
 * below the cards, so it is the same graph seen at its edge. The overlay still drops any edge whose
 * two ends are not both in the DOM — a folded band or a filtered card has no element to connect.
 *
 * An archived item is not rendered, so an edge to it has no second end. A filtered or collapsed
 * item is still in this list — filtering is a view of the board, not a different graph — and the
 * overlay drops the line when the DOM has no card for it.
 *
 * `rendered` is the set of item ids the surface actually drew. A portfolio's strategy map and a
 * programme's bands draw initiatives that live on other boards, so their cards have no placement
 * here; the overlay passes what it found in the DOM rather than asking placement, which is what
 * keeps the lens drawing what a reader can see. Without it, the board's own placements are the
 * population, which is the team board's case.
 */
export function boardConnections(
  graph: Graph,
  boardId: string,
  rendered?: ReadonlySet<string>,
): ConnectionEdge[] {
  const onBoard = rendered ?? new Set(
    (graph.placements as Placement[]).filter((p) => p.boardId === boardId).map((p) => p.itemId),
  )
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

  // The boundary band is the other end of the same graph: the external item has no placement here,
  // but it is drawn on the board, and its dependent is a card this board owns. `boundaryEntries`
  // already applies the edge rules (not archived, dependent on this board, dependency elsewhere),
  // so this does not invent a second definition of what crosses the boundary.
  for (const entry of boundaryEntries(graph, boardId)) {
    for (const dependent of entry.dependents) {
      edges.push({
        id: `boundary:${entry.dependency.id}:${dependent.id}`,
        kind: 'dependency',
        from: entry.dependency.id,
        to: dependent.id,
      })
    }
  }
  return edges
}
