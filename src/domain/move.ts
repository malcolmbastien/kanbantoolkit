/**
 * A move, as one rule for three doors.
 *
 * The app drags a card, a script posts to `/api/v1`, and an agent calls `move_item` (task 170). All
 * three must land in the same place, or refuse with the same sentence — so the rule lives here,
 * pure, and each door is a thin adapter: read the workspace, ask this, write the answer.
 *
 * What a move is, in one paragraph. It moves a **placement** (arrangement), stamps the item's Done
 * clock (content the clock reads), and appends to its history — the cell it left, the cell it
 * arrived in, and the two *stages*. The stages matter more than the names: a lane can be renamed or
 * split tomorrow, and flow metrics are derived from stages, so a history written in stage terms
 * survives a board redesign.
 *
 * Three refusals, each a sentence rather than a boolean:
 *
 * - **wrong workflow** — a card does not live in an initiatives cell, and an initiative does not
 *   live in a card lane. The two trees are independent.
 * - **WIP** — `block` refuses; `justify` holds until a reason arrives, and the *place the gesture
 *   offered* is carried with the hold so answering lands the card where it was put rather than at
 *   the end of the lane.
 * - **section** — an initiative's section is derived from the work below it, so a move may
 *   rearrange a cell within its section and can never cross into another.
 *
 * Nothing here writes, announces or prompts: the outcome says what happened, and the caller decides
 * how a person hears it. That is what lets the API answer with a status code and the app with a
 * sentence, from the same decision.
 */

import { canPlaceInSection, rollupOf, type Graph } from './derive'
import { effectiveStage, laneNameAt, lanePath, nextRank, placementsInOrder, subtreeIds } from './lanes'
import type { Board, Item, ItemLogEntry, Lane, Placement } from './types'

/** The state a move reads. Exactly this and no more, so a caller can pass a snapshot. */
export interface MoveSlice {
  items: Item[]
  placements: Placement[]
  lanes: Lane[]
  boards: Board[]
  edges: Graph['edges']
  links: Graph['links']
}

/** What the caller has to supply to make the result deterministic: a clock, an author, ids. */
export interface MoveContext {
  /** When it happened, in ms. */
  at: number
  /** Who did it — a person's id, or the token owner's. Absent means nobody was named. */
  by?: string
  /** A fresh id, for the placement or the log entry this move creates. */
  id: () => string
}

export interface MoveInput {
  itemId: string
  boardId: string
  /** The cell it is going into. */
  laneId: string
  /** The reason a `justify` lane asked for. Its presence is what answers the question. */
  reason?: string
  /** The position within the lane, when the caller has one: `0` is the top, `n` is the end. */
  index?: number
}

export type MoveRefusal =
  | { code: 'not_found'; message: string }
  | { code: 'wrong_workflow'; message: string }
  | { code: 'wip_blocked'; message: string; details: { laneId: string; laneName: string; limit: number } }
  | { code: 'section_fixed'; message: string; details: { section: string; itemSection: string } }

export type MoveOutcome =
  /**
   * It landed. `justified` says a reason was recorded, which is the one thing a caller may want to
   * report differently; `positionOnly` says the card was already in the cell and only its place in
   * the list changed — no history, because a log of every drag is noise rather than a journey.
   */
  | {
      kind: 'moved'
      items: Item[]
      placements: Placement[]
      placement: Placement
      lane: Lane
      justified: boolean
      positionOnly: boolean
    }
  /**
   * A `justify` lane, and no reason yet. Nothing was written: the caller asks, and calls again with
   * the reason. The place the gesture offered travels with the hold.
   */
  | { kind: 'held'; code: 'wip_justify'; message: string; laneId: string; laneName: string; limit: number; index?: number }
  | { kind: 'refused'; refusal: MoveRefusal }

/** The limited lane a move into `laneId` would overfill, if any. */
export function wipBreach(
  lanes: Lane[],
  placements: Placement[],
  boardId: string,
  laneId: string,
  fromLaneId: string | undefined,
): Lane | undefined {
  const limited = [lanes.find((lane) => lane.id === laneId), ...ancestors(lanes, laneId)]
  for (const lane of limited) {
    if (!lane || lane.wipLimit === undefined) continue
    const subtree = new Set(subtreeIds(lanes, lane.id))
    const count = placements.filter((p) => p.boardId === boardId && subtree.has(p.laneId)).length
    // A card already inside the limited subtree does not add to it when it moves within it.
    const alreadyInside = fromLaneId ? subtree.has(fromLaneId) : false
    if (count + (alreadyInside ? 0 : 1) > lane.wipLimit) return lane
  }
  return undefined
}

function ancestors(lanes: Lane[], laneId: string): Lane[] {
  const byId = new Map(lanes.map((lane) => [lane.id, lane]))
  const found: Lane[] = []
  let parent = byId.get(laneId)?.parentId ?? null
  while (parent) {
    const lane = byId.get(parent)
    if (!lane) break
    found.push(lane)
    parent = lane.parentId ?? null
  }
  return found
}

/**
 * The history entry a move leaves. Exported because lane edits reuse it: a card whose cell was split
 * away also moved, and it says so in the same words.
 */
export function movedEntry(
  lanes: Lane[],
  boardId: string,
  fromLaneId: string | undefined,
  toLaneId: string,
  context: { id: () => string; at: number; by?: string; why?: string },
): ItemLogEntry {
  const from = laneNameAt(lanes, fromLaneId)
  const to = laneNameAt(lanes, toLaneId)
  const fromStage = fromLaneId ? effectiveStage(lanes, fromLaneId) : undefined
  const toStage = effectiveStage(lanes, toLaneId)
  return {
    id: context.id(),
    at: context.at,
    kind: 'moved',
    note: `${from ? `${from} → ${to}` : `into ${to}`}${context.why ? ` · ${context.why}` : ''}`,
    boardId,
    ...(fromLaneId ? { fromLaneId } : {}),
    toLaneId,
    ...(fromStage ? { fromStage } : {}),
    ...(toStage ? { toStage } : {}),
    ...(context.by ? { by: context.by } : {}),
  }
}

/** Put a placement in a lane at a position, renumbering the lane 0..n-1 as it lands. */
function placeAt(
  placements: Placement[],
  moving: Placement,
  laneId: string,
  index: number | undefined,
  context: MoveContext,
): Placement[] {
  if (index === undefined) {
    return placements.map((p) =>
      p.id === moving.id ? { ...p, laneId, laneEnteredAt: context.at, rank: nextRank(placements, laneId) } : p,
    )
  }

  const rest = placements.filter((p) => p.laneId === laneId && p.id !== moving.id)
  const ordered = placementsInOrder(rest, laneId)
  const at = Math.max(0, Math.min(index, ordered.length))
  ordered.splice(at, 0, { ...moving, laneId, laneEnteredAt: context.at })
  const rankById = new Map(ordered.map((p, i) => [p.id, i]))

  const others = placements.filter((p) => p.id !== moving.id && p.laneId !== laneId)
  const landed = placements.filter((p) => p.id !== moving.id && p.laneId === laneId)
  return [
    ...others,
    ...landed.map((p) => (rankById.has(p.id) ? { ...p, rank: rankById.get(p.id)! } : p)),
    { ...moving, laneId, laneEnteredAt: context.at, rank: rankById.get(moving.id) ?? 0 },
  ]
}

/**
 * Move a **card** into a cell of the cards workflow.
 *
 * The WIP check reads the target lane and every limited ancestor, because a split lane's limit is on
 * the container and a card in any of its cells counts. A card already inside that subtree moving
 * within it adds nothing to the count.
 */
export function moveCard(slice: MoveSlice, input: MoveInput, context: MoveContext): MoveOutcome {
  const lane = slice.lanes.find((l) => l.id === input.laneId)
  if (!lane) return { kind: 'refused', refusal: { code: 'not_found', message: 'no such lane' } }
  if (lane.workflow !== 'cards') {
    return {
      kind: 'refused',
      refusal: { code: 'wrong_workflow', message: 'cards live in the cards workflow; that cell is for initiatives' },
    }
  }

  const item = slice.items.find((i) => i.id === input.itemId)
  if (!item) return { kind: 'refused', refusal: { code: 'not_found', message: 'no such item' } }

  const existing = slice.placements.find((p) => p.itemId === input.itemId && p.boardId === input.boardId)
  const board = slice.boards.find((b) => b.id === input.boardId)

  if (existing && existing.laneId === input.laneId) {
    // Already there: nothing to record, and the answer is yes. A caller with a position of its own
    // may still write it, which is what a drop within a column is.
    const placements = input.index === undefined ? slice.placements : placeAt(slice.placements, existing, lane.id, input.index, context)
    return {
      kind: 'moved',
      items: slice.items,
      placements,
      placement: placements.find((p) => p.id === existing.id)!,
      lane,
      justified: false,
      positionOnly: true,
    }
  }

  const mode = board?.wipEnforcement ?? 'visualize'
  if (mode !== 'visualize') {
    const breached = wipBreach(slice.lanes, slice.placements, input.boardId, lane.id, existing?.laneId)
    if (breached) {
      const laneName = breached.name || 'that lane'
      const limit = breached.wipLimit ?? 0
      if (mode === 'block') {
        return {
          kind: 'refused',
          refusal: {
            code: 'wip_blocked',
            message: `${laneName} is at its limit of ${limit}.`,
            details: { laneId: breached.id, laneName, limit },
          },
        }
      }
      if (input.reason === undefined) {
        return {
          kind: 'held',
          code: 'wip_justify',
          message: `${laneName} is at its limit of ${limit}, so a reason is needed to move into it.`,
          laneId: breached.id,
          laneName,
          limit,
          ...(input.index === undefined ? {} : { index: input.index }),
        }
      }
    }
  }

  const moving: Placement =
    existing ?? {
      id: context.id(),
      boardId: input.boardId,
      itemId: input.itemId,
      laneId: lane.id,
      laneEnteredAt: context.at,
      rank: nextRank(slice.placements, lane.id),
    }
  // A new placement arrives with the others; one already in the workspace is rewritten in place.
  const base = existing ? slice.placements : [...slice.placements, moving]
  const placements = placeAt(base, moving, lane.id, input.index, context)

  const stage = effectiveStage(slice.lanes, lane.id)
  const items = slice.items.map((i) => {
    if (i.id !== input.itemId) return i
    let next = i
    // Done is a clock, not a flag with a preference: entering starts it, leaving clears it.
    if (stage === 'done' && !i.resolvedAt) next = { ...next, resolvedAt: context.at }
    if (stage !== 'done' && i.resolvedAt) next = { ...next, resolvedAt: null }
    // The overrun first, so the destination reads after the explanation.
    if (input.reason) {
      next = {
        ...next,
        lastMoveReason: input.reason,
        log: [...(next.log ?? []), { id: context.id(), at: context.at, kind: 'limit', note: input.reason, ...(context.by ? { by: context.by } : {}) }],
      }
    }
    next = {
      ...next,
      log: [...(next.log ?? []), movedEntry(slice.lanes, input.boardId, existing?.laneId, lane.id, context)],
    }
    return next
  })

  return {
    kind: 'moved',
    items,
    placements,
    placement: placements.find((p) => p.itemId === input.itemId && p.boardId === input.boardId)!,
    lane,
    justified: Boolean(input.reason),
    positionOnly: false,
  }
}

/**
 * Move an **initiative** between the cells of its section.
 *
 * The section is derived from the work below, so a move may rearrange a cell within its section and
 * can never cross into another. An initiative with nothing under it is its own leaf, so its section
 * is the only fact there is: it can be committed before it is broken down, and moved back.
 */
export function moveInitiative(slice: MoveSlice, input: MoveInput, context: MoveContext): MoveOutcome {
  const lane = slice.lanes.find((l) => l.id === input.laneId)
  if (!lane) return { kind: 'refused', refusal: { code: 'not_found', message: 'no such lane' } }
  if (lane.workflow !== 'initiatives') {
    return {
      kind: 'refused',
      refusal: { code: 'wrong_workflow', message: 'an initiative is arranged in the initiatives workflow; that cell is a card lane' },
    }
  }

  const item = slice.items.find((i) => i.id === input.itemId)
  if (!item) return { kind: 'refused', refusal: { code: 'not_found', message: 'no such item' } }

  const graph: Graph = {
    items: slice.items,
    edges: slice.edges,
    links: slice.links,
    placements: slice.placements,
    lanes: slice.lanes,
  }
  if (!canPlaceInSection(input.itemId, lane.id, graph)) {
    return {
      kind: 'refused',
      refusal: {
        code: 'section_fixed',
        message: 'that initiative’s section is decided by the work below it; a move cannot cross one',
        details: {
          section: effectiveStage(slice.lanes, lane.id) ?? '',
          itemSection: rollupOf(input.itemId, graph).bucket,
        },
      },
    }
  }

  const existing = slice.placements.find((p) => p.itemId === input.itemId && p.boardId === input.boardId)
  if (existing && existing.laneId === lane.id) {
    const placements = input.index === undefined ? slice.placements : placeAt(slice.placements, existing, lane.id, input.index, context)
    return {
      kind: 'moved',
      items: slice.items,
      placements,
      placement: placements.find((p) => p.id === existing.id)!,
      lane,
      justified: false,
      positionOnly: true,
    }
  }

  const moving: Placement =
    existing ?? {
      id: context.id(),
      boardId: input.boardId,
      itemId: input.itemId,
      laneId: lane.id,
      laneEnteredAt: context.at,
      rank: nextRank(slice.placements, lane.id),
    }
  const base = existing ? slice.placements : [...slice.placements, moving]
  const placements = placeAt(base, moving, lane.id, input.index, context)
  const items = slice.items.map((i) =>
    i.id === input.itemId
      ? { ...i, log: [...(i.log ?? []), movedEntry(slice.lanes, input.boardId, existing?.laneId, lane.id, context)] }
      : i,
  )

  return {
    kind: 'moved',
    items,
    placements,
    placement: placements.find((p) => p.itemId === input.itemId && p.boardId === input.boardId)!,
    lane,
    justified: false,
    positionOnly: false,
  }
}

/** How a move reads to a person: the card, and the path it arrived at. */
export function moveSentence(slice: Pick<MoveSlice, 'items' | 'lanes'>, itemId: string, laneId: string): string {
  const title = slice.items.find((i) => i.id === itemId)?.title ?? 'The card'
  const path = lanePath(slice.lanes, laneId).join(' / ')
  return `${title} moved to ${path || 'another lane'}.`
}
