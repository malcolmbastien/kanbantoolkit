import { decompositionChildren, decompositionParent, isArchived, openDependenciesOf, rollupOf, type DependencyInfo, type Graph } from './derive'
import {
  addLaneNode,
  childrenOf,
  duplicateLaneNode,
  insertLaneAfterNode,
  leafLanes,
  leavesUnder,
  moveLaneNode,
  placementsInOrder,
  removeLaneNodes,
  rootLane,
  setLaneOrientationNode,
  splitLaneNodes,
  WORKFLOWS,
  type LaneNode,
} from './lanes'
import type { Board, BoardBand, BoardTemplate, IssueType, Item, Lane, Placement, SplitOrientation, TemplateLane } from './types'

/** Items placed on a board (via explicit placement records). */
export function itemsOnBoard(boardId: string, placements: Placement[], items: Item[]): Item[] {
  const ids = new Set(placements.filter((p) => p.boardId === boardId).map((p) => p.itemId))
  return items.filter((i) => ids.has(i.id))
}

/**
 * The one placement an item has on a board — the cell it sits in there. `undefined` when it
 * does not sit on that board at all, which is the honest answer for a card read inside
 * another board's band, or for one opened from a surface that has no board behind it.
 */
export function placementOn(placements: Placement[], itemId: string, boardId: string): Placement | undefined {
  return placements.find((p) => p.itemId === itemId && p.boardId === boardId)
}

/**
 * The initiatives of a board's initiatives workflow — items of the Initiative type placed on
 * it, never archived. With `rootsOnly`, only the board's *local* top-level ones: an initiative
 * whose parent is not on this same board is top-level here, so it can roll up to a top-level
 * initiative on another management board and still appear as top-level on its own.
 *
 * One computation, on purpose: the dashboard, the board's own initiatives flow and the timeline
 * all read this, so the surfaces cannot disagree about what a board's initiatives are. Order
 * follows the placements — the order the board itself keeps. When no Initiative type exists
 * (data before types load), having decomposition children stands in for the type.
 */
export function boardInitiatives(
  graph: Graph,
  boardId: string,
  issueTypes: IssueType[],
  { rootsOnly = true }: { rootsOnly?: boolean } = {},
): Item[] {
  const onBoard = graph.placements
    .filter((p) => p.boardId === boardId)
    .map((p) => graph.items.find((i) => i.id === p.itemId))
    .filter((i): i is Item => Boolean(i))
  const onBoardIds = new Set(onBoard.map((i) => i.id))
  const initiativeTypeId = issueTypes.find((t) => t.name === 'Initiative')?.id
  return (
    initiativeTypeId
      ? onBoard.filter((i) => i.typeId === initiativeTypeId)
      : onBoard.filter((i) => decompositionChildren(i.id, graph.edges).length > 0)
  )
    .filter((i) => !i.archived)
    .filter((i) => {
      if (!rootsOnly) return true
      const parent = decompositionParent(i.id, graph.edges)
      return !parent || !onBoardIds.has(parent)
    })
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
 * The template runs its structure through the **same kernels the board's lane actions
 * use** (`splitLaneNodes`, `addLaneNode`, `moveLaneNode`, … in `domain/lanes.ts`), so a
 * template can do exactly what a board can do, and a change to a rule is made once in
 * the kernel. The adapters only bridge the vocabulary: a template's lanes are keyed
 * (`key`/`parentKey`) and hang from a phantom root — the board root itself is not part
 * of a template, but the kernels reason about "top-level" through it, so the same
 * fixed-typed-columns rule falls out identically.
 *
 * They stay pure: each returns the new lane list, so the editor's behaviour is unit
 * tested rather than inferred from the UI.
 * ------------------------------------------------------------------------------- */

/** A template's lanes under a parent, in order. `null` is the root's children. */
export function templateChildren(template: BoardTemplate, parentKey: string | null): TemplateLane[] {
  return template.lanes.filter((l) => l.parentKey === parentKey).sort((a, b) => a.order - b.order)
}

/**
 * Whether a lane is one *row* of its parent's stack rather than a column beside its siblings.
 *
 * It decides two things a surface must not guess at: which way the lane moves (up/down, not
 * left/right) and what it claims room with — a lane in a split of columns takes width in
 * proportion to the cells beneath it, while a lane in a split of rows takes its own height.
 * Guessing it wrong is not a small thing on screen: `flex-basis: 0` on a row of a stack whose
 * height is its own content is a lane with no height at all, controls and all.
 *
 * A top-level column is not a row: the root arranges its children as columns.
 */
export function templateLaneIsRow(template: BoardTemplate, key: string): boolean {
  const lane = template.lanes.find((l) => l.key === key)
  const parent = lane?.parentKey == null ? undefined : template.lanes.find((l) => l.key === lane.parentKey)
  return parent?.orientation === 'rows'
}

/**
 * The bridge to the kernels: template lanes become structural nodes under a phantom root
 * (the thing the board root is on the board), and kernel results come back as template
 * lanes. The extra template fields (WIP limit, policy) ride along in the spread.
 */
const ROOT_KEY = '__template-root__'
type SlimNode = LaneNode & Partial<TemplateLane>
const slim = (template: BoardTemplate): SlimNode[] => [
  { id: ROOT_KEY, parentId: null, order: -1, name: '' },
  ...template.lanes.map((l) => ({ ...l, id: l.key, parentId: l.parentKey ?? ROOT_KEY })),
]
const unslim = (nodes: SlimNode[]): TemplateLane[] =>
  nodes
    .filter((n) => n.id !== ROOT_KEY)
    .map((n) => ({
      key: n.id,
      parentKey: n.parentId === ROOT_KEY ? null : n.parentId,
      order: n.order,
      name: n.name,
      ...(n.orientation ? { orientation: n.orientation } : {}),
      ...(n.stage ? { stage: n.stage } : {}),
      ...(n.wipLimit !== undefined ? { wipLimit: n.wipLimit } : {}),
      ...(n.description ? { description: n.description } : {}),
    }))

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

/** Flip columns ↔ rows — typed columns included: fixed in stage, not in shape. */
export function templateSetOrientation(
  template: BoardTemplate,
  key: string,
  orientation: SplitOrientation,
): TemplateLane[] {
  return unslim(setLaneOrientationNode(slim(template), key, orientation))
}

/** Split a leaf lane into a container of the given orientation. */
export function templateSplitLane(
  template: BoardTemplate,
  key: string,
  orientation: SplitOrientation,
  uid: () => string,
  count = 2,
): TemplateLane[] {
  const { nodes, created } = splitLaneNodes(slim(template), key, orientation, uid, count)
  return created.length > 0 ? unslim(nodes) : template.lanes
}

/** Add a lane to an existing split — never a new top-level column. */
export function templateAddLane(template: BoardTemplate, parentKey: string, uid: () => string): TemplateLane[] {
  const { nodes, created } = addLaneNode(slim(template), parentKey, uid)
  return created ? unslim(nodes) : template.lanes
}

/** Insert a sub-lane after a sibling — among sub-lanes only, as on a board. */
export function templateInsertLaneAfter(template: BoardTemplate, key: string, uid: () => string): TemplateLane[] {
  const { nodes, created } = insertLaneAfterNode(slim(template), key, uid)
  return created ? unslim(nodes) : template.lanes
}

/** Duplicate a sub-lane and its sub-tree ("… copy"), renumbered like the board does. */
export function templateDuplicateLane(template: BoardTemplate, key: string, uid: () => string): TemplateLane[] {
  const { nodes, created } = duplicateLaneNode(slim(template), key, uid)
  return created.length > 0 ? unslim(nodes) : template.lanes
}

/**
 * Remove a sub-lane and its sub-tree; a split left with one child folds away, the same
 * answer the board gives. Returns the new lanes, or the template untouched for the
 * lanes that are fixed — every refusal the board has.
 */
export function templateRemoveLane(template: BoardTemplate, key: string): TemplateLane[] {
  const { nodes, vanished } = removeLaneNodes(slim(template), key)
  return vanished.size > 0 ? unslim(nodes) : template.lanes
}

/** Reorder a sub-lane within its parent. Top-level columns are fixed in place. */
export function templateMoveLane(template: BoardTemplate, key: string, delta: number): TemplateLane[] {
  return unslim(moveLaneNode(slim(template), key, delta))
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

/**
 * A section's initiatives, cell by cell — what the initiatives flow draws.
 *
 * The section is derived and the cell is arranged, so the two can disagree: the work below
 * moves the rollup into another section while the placement still names a cell of the old one.
 * That stale placement is not an error to repair — it is where the initiative was *last*
 * arranged, and if the work moves back it reads correctly again — but while the rollup
 * disagrees it cannot be honoured, so the initiative reads in the cell `initiativeCellOf`
 * falls back to. It goes last in that cell's rank: nothing arranged it there, so it does not
 * displace what a person put in order.
 *
 * Reading the placement instead was the bug: the initiative belonged to the section by rollup,
 * no cell of that section held its placement, and every cell filtered by placement — so moving
 * a card to Not Started made its parent initiative vanish from the flow altogether rather than
 * roll up into Not Started.
 */
export function initiativeRanks(
  graph: Graph,
  boardId: string,
  sectionId: string,
  /** The board's initiatives — exactly the set the surface shows, from `boardInitiatives`. */
  initiatives: Item[],
): Map<string, Item[]> {
  const cells = leavesUnder(graph.lanes, sectionId)
  const byCell = new Map<string, Item[]>(cells.map((c) => [c.id, []]))
  const here = new Set(
    initiatives
      .filter((i) => initiativeCellOf(i.id, boardId, graph)?.sectionId === sectionId)
      .map((i) => i.id),
  )
  for (const cell of cells) {
    for (const pl of placementsInOrder(graph.placements, cell.id)) {
      if (!here.has(pl.itemId)) continue
      const item = graph.items.find((i) => i.id === pl.itemId)
      if (item) byCell.get(cell.id)!.push(item)
    }
  }
  const arranged = new Set([...byCell.values()].flat().map((i) => i.id))
  for (const i of initiatives) {
    if (!here.has(i.id) || arranged.has(i.id)) continue
    const cellId = initiativeCellOf(i.id, boardId, graph)?.cellId
    const rank = cellId ? byCell.get(cellId) : undefined
    if (rank) rank.push(i)
  }
  return byCell
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
/** Types the system owns: never offered, never retyped into or out of. */
export function isReservedType(typeId: string | undefined, types: IssueType[]): boolean {
  const t = types.find((x) => x.id === typeId)
  return t?.name === 'Initiative' || t?.name === 'Sub-task'
}

export function canRetype(item: Item, nextTypeId: string, types: IssueType[]): boolean {
  return !isReservedType(item.typeId, types) && !isReservedType(nextTypeId, types)
}

/** Types selectable for a card — everything except the reserved Initiative type. */
/**
 * The types a card can be given. Two are reserved and never offered: `Initiative` belongs
 * to the initiatives workflow, and `Sub-task` is what a decomposition child is rather
 * than something you choose.
 */
export function cardTypes(types: IssueType[]): IssueType[] {
  return types.filter((t) => t.name !== 'Initiative' && t.name !== 'Sub-task')
}

/** The default card type: the first non-Initiative type. */
export function defaultCardTypeId(types: IssueType[]): string | undefined {
  return cardTypes(types)[0]?.id ?? types[0]?.id
}

/**
 * Where a card lands on a board: the cell the board named, or the first one it has.
 *
 * The fallback is the point of this being a function. A named cell can be deleted, or split
 * into cells that did not exist when it was named, and a board that has lost its answer should
 * still take a card rather than refuse one.
 */
export function defaultDropLane(board: Board | undefined, lanes: Lane[], boardId: string): Lane | undefined {
  const leaves = leafLanes(lanes, boardId, 'cards')
  return leaves.find((l) => l.id === board?.defaultDropLaneId) ?? leaves[0]
}

/**
 * The type a new card gets on a board: the board's own choice, or the first card type.
 *
 * There is no per-board subset of types to check against any more. A card type is a
 * workspace-wide label, so every board offers all of them, and the only choice left is which
 * one a new card starts as.
 */
export function boardCardTypeId(board: Board | undefined, types: IssueType[]): string | undefined {
  const configured = board?.defaultCardTypeId
  if (configured && cardTypes(types).some((t) => t.id === configured)) return configured
  return defaultCardTypeId(types)
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
