import { isArchived, openDependenciesOf, rollupOf, type DependencyInfo, type Graph } from './derive'
import { childrenOf, leavesUnder, rootLane } from './lanes'
import type { Board, BoardBand, IssueType, Item, Placement } from './types'

/** Items placed on a board (via explicit placement records). */
export function itemsOnBoard(boardId: string, placements: Placement[], items: Item[]): Item[] {
  const ids = new Set(placements.filter((p) => p.boardId === boardId).map((p) => p.itemId))
  return items.filter((i) => ids.has(i.id))
}

/* ------------------------------------------------------------------ *
 * The board workspace — every board in the organisation
 * ------------------------------------------------------------------ */

/** Flight levels top-down — how the workspace lists them. (Board settings shows them
 *  bottom-up, which is the order you build in; this is the order you read in.) */
export const BOARD_BAND_ORDER: BoardBand[] = ['portfolio', 'program', 'team']

/**
 * Boards still in play. An archived board is retired from the organisation's views — the
 * picker, the workspace's default list, the aggregation bands and the link candidates —
 * without anything being destroyed, so every surface that lists boards for *choosing*
 * from filters through here. An archived board can still be opened directly.
 */
export function activeBoards(boards: Board[]): Board[] {
  return boards.filter((b) => !b.archived)
}

/**
 * The board workspace's list: boards grouped by band (Portfolio → Program → Team), then
 * by name, narrowed by a name filter. Each board appears **exactly once** — the
 * aggregation graph is a DAG, so nesting a board under one of its parents would either
 * duplicate it or pick a parent and lie. Archived boards are hidden unless asked for.
 */
export function boardsByBand(boards: Board[], query = '', includeArchived = false): { band: BoardBand; boards: Board[] }[] {
  const q = query.trim().toLowerCase()
  const pool = includeArchived ? boards : activeBoards(boards)
  return BOARD_BAND_ORDER.map((band) => ({
    band,
    boards: pool
      .filter((b) => b.band === band)
      .filter((b) => !q || b.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((group) => group.boards.length > 0)
}

/* ------------------------------------------------------------------ *
 * Board aggregation — coordination/strategic boards link other boards
 * ------------------------------------------------------------------ */

/** A board that aggregates other boards rather than rendering work. */
export function isAggregating(board: Board | undefined): boolean {
  return board?.band === 'program' || board?.band === 'portfolio'
}

/** Every board beneath this one in the aggregation graph (transitive, deduped). */
export function descendantBoards(boards: Board[], boardId: string): Board[] {
  const out: Board[] = []
  const seen = new Set<string>()
  const stack = [...(boards.find((b) => b.id === boardId)?.linkedBoardIds ?? [])]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const b = boards.find((x) => x.id === id)
    if (b) out.push(b)
    stack.push(...(b?.linkedBoardIds ?? []))
  }
  return out
}

/** Is `candidateId` already an ancestor of `boardId` (or `boardId` itself)? */
export function isAggregationAncestor(boards: Board[], boardId: string, candidateId: string): boolean {
  if (boardId === candidateId) return true
  const seen = new Set<string>()
  const stack = [boardId]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const parent = boards.find((b) => (b.linkedBoardIds ?? []).includes(id))
    if (!parent) continue
    if (parent.id === candidateId) return true
    stack.push(parent.id)
  }
  return false
}

/** A board may link another so long as the aggregation graph stays acyclic. */
export function canLinkBoard(boards: Board[], parentId: string, childId: string): boolean {
  return !isAggregationAncestor(boards, parentId, childId)
}

/** The boards that may be linked under `boardId` (excludes itself and its ancestors). */
export function linkableBoards(boards: Board[], boardId: string): Board[] {
  // A retired board is not newly linkable; an existing edge to one is kept (see `archived`).
  return activeBoards(boards).filter((b) => canLinkBoard(boards, boardId, b.id))
}

/* ------------------------------------------------------------------ *
 * Strategic initiatives — the only place OKRs attach
 * ------------------------------------------------------------------ */

/** What `isStrategicInitiative` needs to look at. */
export interface StrategicCtx {
  items: Item[]
  placements: Placement[]
  boards: Board[]
  issueTypes: IssueType[]
}

/**
 * A strategic initiative is an ordinary Initiative placed on a portfolio-band
 * board. There is no flag or entity: "strategic" is *where it sits*.
 */
export function isStrategicInitiative(itemId: string, ctx: StrategicCtx): boolean {
  const item = ctx.items.find((i) => i.id === itemId)
  if (!item || item.typeId !== initiativeTypeId(ctx.issueTypes)) return false
  return ctx.placements.some(
    (p) => p.itemId === itemId && ctx.boards.find((b) => b.id === p.boardId)?.band === 'portfolio',
  )
}

/** Every strategic initiative in the graph. */
export function strategicInitiatives(ctx: StrategicCtx): Item[] {
  return ctx.items.filter((i) => isStrategicInitiative(i.id, ctx))
}

/**
 * Where an initiative sits in a board's initiatives flow. The **section** is derived —
 * the typed column whose stage matches the initiative's rollup bucket — so an
 * initiative can never claim a stage its work doesn't have. The **cell** within that
 * section is the user's arrangement: the one its placement names, falling back to the
 * section's first cell when that placement is stale (the work below moved the rollup
 * on) or missing. Arrangement self-heals; it never overrides the truth.
 */
export function initiativeCellOf(
  itemId: string,
  boardId: string,
  graph: Graph,
): { sectionId: string; cellId: string } | undefined {
  const root = rootLane(graph.lanes, boardId)
  if (!root) return undefined
  const section = childrenOf(graph.lanes, root.id).find((l) => l.stage === rollupOf(itemId, graph).bucket)
  if (!section) return undefined
  const cells = leavesUnder(graph.lanes, section.id)
  const placement = graph.placements.find((p) => p.itemId === itemId && p.boardId === boardId)
  const cellId = placement && cells.some((c) => c.id === placement.laneId) ? placement.laneId : cells[0]?.id
  return cellId ? { sectionId: section.id, cellId } : undefined
}

/** Open dependencies of on-board work that live on another board (boundary pins). */
export function externalDependenciesOnBoard(graph: Graph, boardId: string): DependencyInfo[] {
  const onBoard = new Set(graph.placements.filter((p) => p.boardId === boardId).map((p) => p.itemId))
  const seen = new Set<string>()
  const out: DependencyInfo[] = []
  for (const p of graph.placements.filter((pl) => pl.boardId === boardId)) {
    // Archived work is off the board — it produces no boundary pins.
    if (isArchived(graph.items.find((i) => i.id === p.itemId))) continue
    for (const dep of openDependenciesOf(p.itemId, graph)) {
      if (!onBoard.has(dep.dependency.id) && !dep.dependency.archived && !seen.has(dep.dependency.id)) {
        seen.add(dep.dependency.id)
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
 * The reserved Initiative type id (identified by name). Initiative is reserved for
 * the Initiatives workflow and is never offered as a card type.
 */
export function initiativeTypeId(types: IssueType[]): string | undefined {
  return types.find((t) => t.name === 'Initiative')?.id
}

/** Types selectable for a card — everything except the reserved Initiative type. */
export function cardTypes(types: IssueType[]): IssueType[] {
  return types.filter((t) => t.name !== 'Initiative')
}

/** The default card type: the first non-Initiative type. */
export function defaultCardTypeId(types: IssueType[]): string | undefined {
  return cardTypes(types)[0]?.id ?? types[0]?.id
}

/**
 * The card types available on a board: its configured subset (`cardTypeIds`), or
 * every card type when it has none.
 */
export function boardCardTypes(board: Board | undefined, types: IssueType[]): IssueType[] {
  const all = cardTypes(types)
  const allowed = board?.cardTypeIds
  return allowed && allowed.length > 0 ? all.filter((t) => allowed.includes(t.id)) : all
}

/** The type a new card gets on a board: its configured default if allowed, else the first available. */
export function boardCardTypeId(board: Board | undefined, types: IssueType[]): string | undefined {
  const available = boardCardTypes(board, types)
  const configured = board?.defaultCardTypeId
  if (configured && available.some((t) => t.id === configured)) return configured
  return available[0]?.id ?? defaultCardTypeId(types)
}

/**
 * Global search: items whose title or display ref contains the query
 * (case-insensitive). An empty query returns no matches.
 */
export function searchItems(items: Item[], refs: Map<string, string>, query: string): Item[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return items.filter((i) => i.title.toLowerCase().includes(q) || (refs.get(i.id) ?? '').toLowerCase().includes(q))
}
