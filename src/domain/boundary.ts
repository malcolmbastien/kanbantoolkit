/**
 * Boundary work: what this board is waiting on from somewhere else (task 174).
 *
 * A **boundary dependency** is a link that leaves the board: a card here depends on an item that is
 * placed on another board. The dependency is not moved, copied or placed here — it has a home, a
 * column and a rollup of its own, and this module reads them.
 *
 * Two decisions this file makes, and they are the ones the task asked to write down:
 *
 * - **Every state is included, not only the open ones.** A satisfied dependency still had cards on
 *   this board waiting for it; if it disappeared the moment it was satisfied, the workflow would end
 *   at Done with nothing in it and a reader could never see what they were waiting for last week.
 *   The link state travels on the card (`Open · live blockage`, `Satisfied`, `Closed`), so a cleared
 *   dependency is read where it ended rather than vanishing.
 * - **A boundary card is a lens.** It cannot be moved here, and it does not exist as a placement on
 *   this board: moving external work from this surface would make the board a second editor of
 *   another team's state. The stage is the dependency's own rollup, read from its home board.
 *
 * Nothing here writes. `boundaryEntries` is derived from the same graph every other view reads, which
 * is why it cannot leak into placements, WIP counts, card counts or a rollup.
 */

import { dependencyState, isArchived, isOpen, rollupOf, type DependencyState, type Graph } from './derive'
import type { Item, ItemLink, Stage } from './types'

export interface BoundaryEntry {
  /** The external item: one entry per dependency, however many cards here wait on it. */
  dependency: Item
  /** Every card on this board that waits on it — open, satisfied or closed, in board order. */
  dependents: Item[]
  /** The strongest state among this board's links to it, so the entry reads by its worst news. */
  state: DependencyState
  /** The dependency's own rollup, read where it lives. */
  stage: Stage
  /** The board it is placed on, for the card's "where it lives" line. */
  homeBoardId?: string
}

/**
 * Worst first: a live blockage is the thing to read before a planning risk, and a cleared link is
 * the quietest. This is also the order within a column (R5) — the state, then the title.
 */
const STATE_ORDER: DependencyState[] = ['OpenLiveBlockage', 'OpenPlanningRisk', 'Satisfied', 'Closed']

export function boundaryStateRank(state: DependencyState): number {
  const index = STATE_ORDER.indexOf(state)
  return index === -1 ? STATE_ORDER.length : index
}

/** The links that cross this board's edge, grouped by the external item they come from. */
function crossingLinks(graph: Graph, boardId: string): { links: ItemLink[]; onBoard: Set<string> } {
  const onBoard = new Set(
    graph.placements.filter((placement) => placement.boardId === boardId).map((placement) => placement.itemId),
  )
  const links: ItemLink[] = []
  for (const link of graph.links) {
    // The dependent is on this board, the dependency is not: that is what "boundary" means.
    if (!onBoard.has(link.to) || onBoard.has(link.from)) continue
    const dependent = graph.items.find((item) => item.id === link.to)
    const dependency = graph.items.find((item) => item.id === link.from)
    if (!dependent || !dependency) continue
    if (isArchived(dependent) || isArchived(dependency)) continue
    links.push(link)
  }
  return { links, onBoard }
}

/**
 * The boundary workflow's entries: one per external dependency that at least one card on this board
 * waits on, in the order a reader wants them.
 */
export function boundaryEntries(graph: Graph, boardId: string): BoundaryEntry[] {
  const { links } = crossingLinks(graph, boardId)
  const byDependency = new Map<string, { link: ItemLink[]; dependents: Map<string, Item> }>()

  for (const link of links) {
    const group = byDependency.get(link.from) ?? { link: [], dependents: new Map<string, Item>() }
    group.link.push(link)
    const dependent = graph.items.find((item) => item.id === link.to)
    if (dependent) group.dependents.set(dependent.id, dependent)
    byDependency.set(link.from, group)
  }

  const entries: BoundaryEntry[] = []
  for (const [dependencyId, group] of byDependency) {
    const dependency = graph.items.find((item) => item.id === dependencyId)
    if (!dependency) continue

    // Strongest state among the links from this board: one live blockage makes the entry a live
    // blockage, even if another card's link to it is merely a planning risk.
    const state = group.link
      .map((link) => dependencyState(link.from, link.to, graph))
      .sort((a, b) => boundaryStateRank(a) - boundaryStateRank(b))[0] ?? 'Closed'

    const dependents = [...group.dependents.values()].sort(
      (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
    )

    entries.push({
      dependency,
      dependents,
      state,
      stage: rollupOf(dependency.id, graph).bucket,
      homeBoardId: graph.placements.find((placement) => placement.itemId === dependency.id)?.boardId,
    })
  }

  return entries.sort(
    (a, b) =>
      boundaryStateRank(a.state) - boundaryStateRank(b.state) ||
      a.dependency.title.localeCompare(b.dependency.title) ||
      a.dependency.id.localeCompare(b.dependency.id),
  )
}

/** The entries in one column, in the workflow's documented order. */
export function boundaryInStage(entries: BoundaryEntry[], stage: Stage): BoundaryEntry[] {
  return entries.filter((entry) => entry.stage === stage)
}

/**
 * The external items *one card* is still waiting on, for the chip it wears in the cards workflow.
 *
 * Only open links: a satisfied dependency is not something the card is waiting for any more, and a
 * chip saying so would be a lie. The boundary workflow still shows the satisfied entry, because the
 * workflow is a history of the edge as well as a list of what blocks today.
 */
export function externalWaits(
  itemId: string,
  graph: Graph,
  boardId: string,
): Array<{ dependency: Item; state: DependencyState }> {
  const onBoard = new Set(graph.placements.filter((p) => p.boardId === boardId).map((p) => p.itemId))
  const seen = new Set<string>()
  const out: Array<{ dependency: Item; state: DependencyState }> = []
  for (const link of graph.links) {
    if (link.to !== itemId || onBoard.has(link.from) || seen.has(link.from)) continue
    const dependency = graph.items.find((item) => item.id === link.from)
    if (!dependency || isArchived(dependency)) continue
    const state = dependencyState(link.from, link.to, graph)
    if (!isOpen(state)) continue
    seen.add(link.from)
    out.push({ dependency, state })
  }
  return out.sort((a, b) => boundaryStateRank(a.state) - boundaryStateRank(b.state) || a.dependency.title.localeCompare(b.dependency.title))
}
