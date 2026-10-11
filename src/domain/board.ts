import { isArchived, openIncomingLinks, type DependencyInfo, type Graph } from './derive'
import type { IssueType, Item, Placement } from './types'

/** Items placed on a board (via explicit placement records). */
export function itemsOnBoard(boardId: string, placements: Placement[], items: Item[]): Item[] {
  const ids = new Set(placements.filter((p) => p.boardId === boardId).map((p) => p.itemId))
  return items.filter((i) => ids.has(i.id))
}

/** Open links from off-board blockers into on-board work (boundary pins). */
export function externalBlockersOnBoard(graph: Graph, boardId: string): DependencyInfo[] {
  const onBoard = new Set(graph.placements.filter((p) => p.boardId === boardId).map((p) => p.itemId))
  const seen = new Set<string>()
  const out: DependencyInfo[] = []
  for (const p of graph.placements.filter((pl) => pl.boardId === boardId)) {
    // Archived work is off the board — it produces no boundary pins.
    if (isArchived(graph.items.find((i) => i.id === p.itemId))) continue
    for (const dep of openIncomingLinks(p.itemId, graph)) {
      if (!onBoard.has(dep.blocker.id) && !dep.blocker.archived && !seen.has(dep.blocker.id)) {
        seen.add(dep.blocker.id)
        out.push(dep)
      }
    }
  }
  return out
}

/** Stable display reference per item, prefixed by its type, e.g. FEAT3, BUG1. */
export function buildRefs(items: Item[], types: IssueType[]): Map<string, string> {
  const prefix = (typeId: string) => {
    const name = types.find((t) => t.id === typeId)?.name ?? 'Item'
    return name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'ITEM'
  }
  const counters: Record<string, number> = {}
  const map = new Map<string, string>()
  for (const i of items) {
    const key = prefix(i.typeId)
    counters[key] = (counters[key] ?? 0) + 1
    map.set(i.id, `${key}${counters[key]}`)
  }
  return map
}

/**
 * The type a freshly-created card should get. Cards live in the Cards workflow, so
 * this is never the Initiative type — otherwise a new card would surface in the
 * Initiatives workflow instead of the lane you clicked.
 */
export function defaultCardTypeId(types: IssueType[]): string | undefined {
  return (types.find((t) => t.name !== 'Initiative') ?? types[0])?.id
}
