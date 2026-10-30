import { decompositionChildren, decompositionParent, descendants, rollupOf, type Graph } from './derive'
import { childrenOf, leafLanes, leavesUnder, placementsInOrder, rootLane } from './lanes'
import { cardsFlows, initiativesFlow } from './flows'
import type { Board, BoardBand, BoardFlow, BoardTemplate, InitiativeType, IssueType, Item, Lane, Placement, Tag } from './types'

/** The kinds a board offers, in the order it lists them. An absent list is simply empty. */
export function boardInitiativeTypes(board: Board | undefined): InitiativeType[] {
  return board?.initiativeTypes ?? []
}

/**
 * A label by id, wherever it is defined.
 *
 * An item can be placed on more than one board while its label is item-level, so a kind or a tag
 * defined on one board can be read on another: resolve by id across all of them. Nothing is
 * returned when the definition is gone — a board deleted while items placed on it live on — so a
 * surface renders nothing rather than a raw id. The name and colour are never copied onto the
 * item, because a label renamed has to rename everywhere at once.
 *
 * Kinds and tags share this rule exactly; only the lists they are read from differ.
 */
function labelById<T extends { id: string }>(lists: (T[] | undefined)[], id: string | undefined): T | undefined {
  if (!id) return undefined
  for (const list of lists) {
    const found = list?.find((l) => l.id === id)
    if (found) return found
  }
  return undefined
}

/** An initiative kind by id — see `labelById`. */
export function initiativeTypeById(boards: Board[], id: string | undefined): InitiativeType | undefined {
  return labelById(boards.map((b) => b.initiativeTypes), id)
}

/** A tag by id — see `labelById`. */
export function tagById(boards: Board[], id: string | undefined): Tag | undefined {
  return labelById(boards.map((b) => b.tags), id)
}

/** The tags a board offers, in the order it lists them. */
export function boardTags(board: Board | undefined): Tag[] {
  return board?.tags ?? []
}

/** How many items carry a kind — what a refusal has to be able to say out loud. */
export function initiativesCarrying(items: Item[], kindId: string): number {
  return items.filter((i) => i.initiativeTypeId === kindId).length
}

/** An item's tags, resolved wherever they are defined and in the order it carries them. */
export function tagsOf(boards: Board[], item: Item): Tag[] {
  return (item.tagIds ?? []).flatMap((id) => {
    const tag = tagById(boards, id)
    return tag ? [tag] : []
  })
}

/** The same count for a tag, which any item can carry. */
export function itemsCarryingTag(items: Item[], tagId: string): number {
  return items.filter((i) => (i.tagIds ?? []).includes(tagId)).length
}

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
export function templateFromBoard(id: string, name: string, board: Board, lanes: Lane[], flows: BoardFlow[]): BoardTemplate {
  // A template captures every **cards flow** — the team's design — and never the initiatives
  // flow, which is the standard shape the organisation reads rather than the team's to design.
  const cards = cardsFlows(flows, board.id)
  const flowKeyOf = new Map(cards.map((flow, i) => [flow.id, `f${i}`]))
  const flat: Lane[] = []
  const walk = (lane: Lane) => {
    flat.push(lane)
    childrenOf(lanes, lane.id).forEach(walk)
  }
  for (const flow of cards) {
    const root = rootLane(lanes, flow.id)
    if (root) childrenOf(lanes, root.id).forEach(walk)
  }

  // Keys are minted in document order and only need to be unique inside the template.
  const keyOf = new Map(flat.map((l, i) => [l.id, `k${i}`]))
  const rootOfFlow = new Map(cards.map((flow) => [flow.id, rootLane(lanes, flow.id)?.id]))
  return {
    id,
    name,
    band: board.band,
    flows: cards.map((flow, i) => ({ key: `f${i}`, kind: 'cards', name: flow.name, order: i })),
    lanes: flat.map((l) => ({
      key: keyOf.get(l.id)!,
      flowKey: flowKeyOf.get(l.flowId)!,
      // A top-level column names its flow's root, which is structural and not stored.
      parentKey: l.parentId && l.parentId !== rootOfFlow.get(l.flowId) ? keyOf.get(l.parentId) ?? null : null,
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
  uid: () => string,
): { flows: BoardFlow[]; lanes: Lane[] } {
  // One flow per template flow, one root each, then the lanes under the root of their own flow —
  // a template with two cards flows becomes a board with two, sharing nothing with the template.
  const flows: BoardFlow[] = template.flows.map((flow) => ({
    id: uid(),
    boardId,
    kind: flow.kind,
    name: flow.name,
    order: flow.order,
  }))
  const flowIdOf = new Map(template.flows.map((flow, i) => [flow.key, flows[i].id]))
  const roots = new Map(
    flows.map((flow) => [flow.id, { id: uid(), boardId, parentId: null, order: 0, name: '', orientation: 'columns' as const, flowId: flow.id }]),
  )
  const idOf = new Map(template.lanes.map((lane) => [lane.key, uid()]))
  return {
    flows,
    lanes: [
      ...roots.values(),
      ...template.lanes.map((l) => ({
        id: idOf.get(l.key)!,
        boardId,
        parentId: l.parentKey === null ? roots.get(flowIdOf.get(l.flowKey)!)!.id : idOf.get(l.parentKey)!,
        order: l.order,
        name: l.name,
        flowId: flowIdOf.get(l.flowKey)!,
        ...(l.orientation ? { orientation: l.orientation } : {}),
        ...(l.stage ? { stage: l.stage } : {}),
        ...(l.wipLimit !== undefined ? { wipLimit: l.wipLimit } : {}),
        ...(l.description ? { description: l.description } : {}),
      })),
    ],
  }
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
  flows: BoardFlow[],
  uid: () => string,
  name?: string,
): { board: Board; lanes: Lane[]; flows: BoardFlow[] } {
  const idOf = new Map<string, string>()
  const flowIdOf = new Map<string, string>()
  const subtree: Lane[] = []
  // Every flow comes across with its own tree, with fresh ids on both.
  const copiedFlows: BoardFlow[] = flows
    .filter((f) => f.boardId === board.id)
    .sort((a, b) => a.order - b.order)
    .map((flow) => {
      const id = uid()
      flowIdOf.set(flow.id, id)
      return { ...flow, id, boardId: '' }
    })
  for (const flow of flows.filter((f) => f.boardId === board.id)) {
    const root = rootLane(lanes, flow.id)
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
  // The kinds come across with the design, with fresh ids: two boards may each have a "Bet", and
  // renaming one must not rename the other. (No item comes across, so nothing has to be remapped.)
  const kindIds = new Map((board.initiativeTypes ?? []).map((t) => [t.id, uid()] as const))
  const tagIds = new Map((board.tags ?? []).map((t) => [t.id, uid()] as const))
  return {
    board: {
      ...rest,
      id,
      name: name?.trim() || `${board.name} copy`,
      ...(board.linkedBoardIds ? { linkedBoardIds: [...board.linkedBoardIds] } : {}),
      ...(board.initiativeTypes
        ? { initiativeTypes: board.initiativeTypes.map((t) => ({ ...t, id: kindIds.get(t.id)! })) }
        : {}),
      ...(board.tags ? { tags: board.tags.map((t) => ({ ...t, id: tagIds.get(t.id)! })) } : {}),
      },
    lanes: subtree.map((lane) => ({
      ...lane,
      id: idOf.get(lane.id)!,
      boardId: id,
      flowId: flowIdOf.get(lane.flowId)!,
      parentId: lane.parentId ? idOf.get(lane.parentId) ?? null : null,
    })),
    flows: copiedFlows.map((flow) => ({ ...flow, boardId: id })),
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
  flows: BoardFlow[],
): { sectionId: string; cellId: string } | undefined {
  const flow = initiativesFlow(flows, boardId)
  const root = flow ? rootLane(graph.lanes, flow.id) : undefined
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
  flows: BoardFlow[],
): Map<string, Item[]> {
  const cells = leavesUnder(graph.lanes, sectionId)
  const byCell = new Map<string, Item[]>(cells.map((c) => [c.id, []]))
  const here = new Set(
    initiatives
      .filter((i) => initiativeCellOf(i.id, boardId, graph, flows)?.sectionId === sectionId)
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
    const cellId = initiativeCellOf(i.id, boardId, graph, flows)?.cellId
    const rank = cellId ? byCell.get(cellId) : undefined
    if (rank) rank.push(i)
  }
  return byCell
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
 * Would `setParent` accept this? One rule, so a drop preview and the store cannot disagree.
 *
 * A parent is always an initiative, and an item is never its own ancestor. The drawer's picker
 * excludes an item's descendants, which is why the ancestor rule could be left to the interface;
 * a drop target excludes nothing, so the rule has to live where both of them can read it.
 */
export function canSetParent(childId: string, parentId: string, graph: Graph, issueTypes: IssueType[]): boolean {
  if (childId === parentId) return false
  if (!isInitiativeItem(graph.items.find((i) => i.id === parentId), issueTypes)) return false
  return !descendants(childId, graph).includes(parentId)
}

/**
 * The built-in type that means “no type”.
 *
 * It is a real issue type rather than an absence — unlike a kind, which uses `undefined` — because
 * an item's type is required in the model and is what tells a card from an initiative. It is always
 * offered, and it is never renamed or removed: the settings screen shows it as built-in.
 */
export const NONE_TYPE_ID = 't-none'
export const NONE_TYPE: IssueType = { id: NONE_TYPE_ID, name: 'None', color: '#64748b' }

/** Types the system owns: never offered as a retype target, never retyped out of. */
export function isReservedType(typeId: string | undefined, types: IssueType[]): boolean {
  const t = types.find((x) => x.id === typeId)
  return t?.name === 'Initiative' || t?.name === 'Sub-task'
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
  return !isReservedType(item.typeId, types) && !isReservedType(nextTypeId, types)
}

/** Types selectable for a card — everything except the reserved Initiative type. */
/**
 * The types a card can be given. Two are reserved and never offered: `Initiative` belongs
 * to the initiatives workflow, and `Sub-task` is what a decomposition child is rather
 * than something you choose.
 */
export function cardTypes(types: IssueType[]): IssueType[] {
  // None is the absence of a type rather than one of the labels, so it always leads the list.
  // The sort is stable, so the workspace's own order is kept below it.
  return types
    .filter((t) => t.name !== 'Initiative' && t.name !== 'Sub-task')
    .sort((a, b) => (a.id === NONE_TYPE_ID ? -1 : b.id === NONE_TYPE_ID ? 1 : 0))
}

/** The default card type: the first real card type, and None only when there is nothing else. */
export function defaultCardTypeId(types: IssueType[]): string | undefined {
  const cards = cardTypes(types)
  return cards.find((t) => t.id !== NONE_TYPE_ID)?.id ?? cards[0]?.id ?? types[0]?.id
}

/**
 * Where a card lands on a board: the cell the board named, or the first one it has.
 *
 * The fallback is the point of this being a function. A named cell can be deleted, or split
 * into cells that did not exist when it was named, and a board that has lost its answer should
 * still take a card rather than refuse one.
 */
export function defaultDropLane(
  board: Board | undefined,
  flows: BoardFlow[],
  lanes: Lane[],
  boardId: string,
): Lane | undefined {
  const leaves = cardsFlows(flows, boardId).flatMap((flow) => leafLanes(lanes, flow.id))
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
 * Global search: items whose title contains the query (case-insensitive). An empty query returns
 * no matches.
 *
 * The title alone, deliberately: an item's identity is its id, which is nobody's business but the
 * app's, and there is no shorter handle to search by — a card is found by the words on it.
 */
export function searchItems(items: Item[], query: string): Item[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return items.filter((i) => i.title.toLowerCase().includes(q))
}
