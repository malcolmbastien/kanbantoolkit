import { isArchived, openDependenciesOf, rollupOf, type DependencyInfo, type Graph } from './derive'
import { childrenOf, leavesUnder, rootLane, WORKFLOWS } from './lanes'
import type { Board, BoardBand, BoardTemplate, IssueType, Item, Lane, Placement, SplitOrientation, TemplateLane } from './types'

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
 * Board templates — a design, reused across the organisation
 * ------------------------------------------------------------------ */

/**
 * Capture a board's **design** as a template: its lane tree (everything below the root),
 * which card types it allows, its default type and how it enforces WIP.
 *
 * Deliberately not captured: items, placements and linked boards. Those belong to the
 * board, not to its shape — a template is meant to be reused, and a copy carrying one
 * team's work or one program's links would be wrong everywhere else.
 */
export function templateFromBoard(id: string, name: string, board: Board, lanes: Lane[]): BoardTemplate {
  const root = rootLane(lanes, board.id, 'cards')
  const flat: Lane[] = []
  const walk = (lane: Lane) => {
    flat.push(lane)
    childrenOf(lanes, lane.id).forEach(walk)
  }
  if (root) childrenOf(lanes, root.id).forEach(walk)

  // Keys are minted in document order and only need to be unique inside the template.
  const keyOf = new Map(flat.map((l, i) => [l.id, `k${i}`]))
  return {
    id,
    name,
    band: board.band,
    lanes: flat.map((l) => ({
      key: keyOf.get(l.id)!,
      parentKey: l.parentId && l.parentId !== root?.id ? keyOf.get(l.parentId) ?? null : null,
      order: l.order,
      name: l.name,
      ...(l.orientation ? { orientation: l.orientation } : {}),
      ...(l.stage ? { stage: l.stage } : {}),
      ...(l.wipLimit !== undefined ? { wipLimit: l.wipLimit } : {}),
      ...(l.description ? { description: l.description } : {}),
    })),
    ...(board.cardTypeIds ? { cardTypeIds: [...board.cardTypeIds] } : {}),
    ...(board.defaultCardTypeId ? { defaultCardTypeId: board.defaultCardTypeId } : {}),
    ...(board.wipEnforcement ? { wipEnforcement: board.wipEnforcement } : {}),
  }
}

/**
 * Mint a template's lanes for a new board: the structure comes across intact, every id is
 * fresh (`uid` is injected so this stays pure), and nothing references the template.
 */
export function lanesFromTemplate(
  template: BoardTemplate,
  boardId: string,
  rootId: string,
  uid: () => string,
): Lane[] {
  const idOf = new Map(template.lanes.map((l) => [l.key, uid()]))
  return template.lanes.map((l) => ({
    id: idOf.get(l.key)!,
    boardId,
    parentId: l.parentKey === null ? rootId : idOf.get(l.parentKey)!,
    order: l.order,
    name: l.name,
    // A template is a team's design, so its lanes are always the cards workflow.
    workflow: 'cards' as const,
    ...(l.orientation ? { orientation: l.orientation } : {}),
    ...(l.stage ? { stage: l.stage } : {}),
    ...(l.wipLimit !== undefined ? { wipLimit: l.wipLimit } : {}),
    ...(l.description ? { description: l.description } : {}),
  }))
}

/* ---- Editing a template's design ------------------------------------------------
 * These mirror the board's lane actions (`splitLane`, `addLane`, `removeLane`, …) over a
 * template's flat, keyed lanes. They are pure: each returns the new lane list, so the
 * editor's behaviour is unit tested rather than inferred from the UI.
 *
 * One rule carries over from boards: the **top-level columns stay put**. They carry the
 * stages, and a board's status derivation reads them, so a template's columns can be
 * renamed but not removed or reordered — refine them by splitting, as on a board.
 * ------------------------------------------------------------------------------- */

/** A template's lanes under a parent, in order. `null` is the root's children. */
export function templateChildren(template: BoardTemplate, parentKey: string | null): TemplateLane[] {
  return template.lanes.filter((l) => l.parentKey === parentKey).sort((a, b) => a.order - b.order)
}

function templateDescendants(template: BoardTemplate, key: string): string[] {
  const out: string[] = []
  const walk = (k: string) => {
    for (const child of template.lanes.filter((l) => l.parentKey === k)) {
      out.push(child.key)
      walk(child.key)
    }
  }
  walk(key)
  return out
}

const withLane = (template: BoardTemplate, key: string, patch: Partial<TemplateLane>): TemplateLane[] =>
  template.lanes.map((l) => (l.key === key ? { ...l, ...patch } : l))

export function templateRenameLane(template: BoardTemplate, key: string, name: string): TemplateLane[] {
  return withLane(template, key, { name })
}

export function templateSetLaneWip(template: BoardTemplate, key: string, wipLimit: number | undefined): TemplateLane[] {
  return withLane(template, key, { wipLimit })
}

export function templateSetLanePolicy(template: BoardTemplate, key: string, description: string | undefined): TemplateLane[] {
  return withLane(template, key, { description })
}

export function templateSetOrientation(
  template: BoardTemplate,
  key: string,
  orientation: SplitOrientation,
): TemplateLane[] {
  return withLane(template, key, { orientation })
}

/** Split a leaf lane into a container of the given orientation. */
export function templateSplitLane(
  template: BoardTemplate,
  key: string,
  orientation: SplitOrientation,
  uid: () => string,
  count = 2,
): TemplateLane[] {
  if (templateChildren(template, key).length > 0) return template.lanes // only a leaf splits
  const kids: TemplateLane[] = Array.from({ length: count }, (_, i) => ({
    key: uid(),
    parentKey: key,
    order: i,
    name: orientation === 'rows' ? `Row ${i + 1}` : `Column ${i + 1}`,
  }))
  return [...withLane(template, key, { orientation }), ...kids]
}

/** Add a lane to an existing split — never a new top-level column. */
export function templateAddLane(template: BoardTemplate, parentKey: string, uid: () => string): TemplateLane[] {
  const parent = template.lanes.find((l) => l.key === parentKey)
  if (!parent) return template.lanes
  const order = templateChildren(template, parentKey).length
  const orientation = parent.orientation ?? 'columns'
  const child: TemplateLane = {
    key: uid(),
    parentKey,
    order,
    name: orientation === 'rows' ? `Row ${order + 1}` : `Column ${order + 1}`,
  }
  return [...withLane(template, parentKey, { orientation }), child]
}

/** Remove a sub-lane and its subtree; the remaining siblings are renumbered. */
export function templateRemoveLane(template: BoardTemplate, key: string): TemplateLane[] {
  const lane = template.lanes.find((l) => l.key === key)
  if (!lane || lane.parentKey === null) return template.lanes // a top-level column stays
  const doomed = new Set([key, ...templateDescendants(template, key)])
  const kept = templateChildren(template, lane.parentKey).filter((l) => !doomed.has(l.key))
  const orderOf = new Map(kept.map((l, i) => [l.key, i]))
  return template.lanes
    .filter((l) => !doomed.has(l.key))
    .map((l) => (orderOf.has(l.key) ? { ...l, order: orderOf.get(l.key)! } : l))
}

/** Reorder a sub-lane within its parent. Top-level columns are fixed in place. */
export function templateMoveLane(template: BoardTemplate, key: string, delta: number): TemplateLane[] {
  const lane = template.lanes.find((l) => l.key === key)
  if (!lane || lane.parentKey === null) return template.lanes
  const siblings = templateChildren(template, lane.parentKey)
  const idx = siblings.findIndex((s) => s.key === key)
  const to = idx + delta
  if (idx < 0 || to < 0 || to >= siblings.length) return template.lanes
  const reordered = [...siblings]
  const [moved] = reordered.splice(idx, 1)
  reordered.splice(to, 0, moved)
  const orderOf = new Map(reordered.map((s, i) => [s.key, i]))
  return template.lanes.map((l) => (orderOf.has(l.key) ? { ...l, order: orderOf.get(l.key)! } : l))
}

/* ------------------------------------------------------------------ *
 * Duplicating a board — its design, not its work
 * ------------------------------------------------------------------ */

/**
 * Deep-copy a board: **both** its lane trees (cards and initiatives, with fresh ids
 * throughout), its settings, and its aggregation links.
 *
 * **Its work is not copied.** Items live in placements, so duplicating them would
 * duplicate the work itself — the same cards on two boards, with two lives. A copy is a
 * design to build on, which is also why it comes back unarchived whatever the original was.
 *
 * Every lane id is fresh and every `parentId` points *within* the copy, so the two boards
 * share nothing and editing one cannot disturb the other.
 */
export function duplicateBoard(
  board: Board,
  lanes: Lane[],
  uid: () => string,
  name?: string,
): { board: Board; lanes: Lane[] } {
  const idOf = new Map<string, string>()
  const subtree: Lane[] = []
  // Both workflows come across, each from its own root.
  for (const workflow of WORKFLOWS) {
    const root = rootLane(lanes, board.id, workflow)
    if (!root) continue
    const walk = (lane: Lane) => {
      idOf.set(lane.id, uid())
      subtree.push(lane)
      childrenOf(lanes, lane.id).forEach(walk)
    }
    walk(root)
  }

  const { archived: _archived, archivedAt: _archivedAt, ...rest } = board
  const id = uid()
  return {
    board: {
      ...rest,
      id,
      name: name?.trim() || `${board.name} copy`,
      ...(board.linkedBoardIds ? { linkedBoardIds: [...board.linkedBoardIds] } : {}),
      ...(board.cardTypeIds ? { cardTypeIds: [...board.cardTypeIds] } : {}),
    },
    lanes: subtree.map((lane) => ({
      ...lane,
      id: idOf.get(lane.id)!,
      boardId: id,
      parentId: lane.parentId ? idOf.get(lane.parentId) ?? null : null,
    })),
  }
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
  const root = rootLane(graph.lanes, boardId, 'initiatives')
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

/** Is this item the reserved Initiative type? */
export function isInitiativeItem(item: Item | undefined, types: IssueType[]): boolean {
  const id = initiativeTypeId(types)
  return Boolean(id && item?.typeId === id)
}

/**
 * Whether an item's type may be changed at all.
 *
 * The Initiative type is **reserved**: it is not a card type, it is what makes an item an
 * initiative, and the initiatives workflow reads it. So an initiative cannot be retyped
 * into a card type, and no card can be retyped into an initiative. Refused, never
 * corrected — an item silently changing kind would be worse than the action failing.
 */
export function canRetype(item: Item, nextTypeId: string, types: IssueType[]): boolean {
  const initiative = initiativeTypeId(types)
  if (!initiative) return true
  return item.typeId !== initiative && nextTypeId !== initiative
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
