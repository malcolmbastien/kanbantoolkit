/**
 * A card becoming an initiative, as one rule for two doors.
 *
 * The app's card menu and `/api/v1` both offer this act, and they must agree about what it means
 * before either writes anything: the same id, the same fields, the same sentence in its history,
 * and the same cell it lands in. So the rule is pure and lives here; each door reads the workspace,
 * asks this, and writes the answer.
 *
 * What it is, in one paragraph. The **item** keeps its identity — id, title, description, people,
 * tags, dates, checklist, links, dependencies, parent, log — and wears the reserved Initiative
 * type. The **type label** is the one thing it gives up, so the old one is named in its history
 * rather than silently lost. The **placement** on this board leaves the cards flow and lands in the
 * initiatives flow's section for the card's own stage, first cell, appended. The kind is left unset:
 * a board's kinds are a vocabulary a person chooses, and inventing one from the old type would be a
 * second label pretending to be the first.
 *
 * It is not a move: `moveCard` would refuse a card entering an initiatives cell, and `moveInitiative`
 * would refuse a section crossing. A card changing what it *is* is its own act, which is why
 * `canRetype` still refuses the shortcut of a bare `typeId` change and this is the one seam.
 */

import { canAddInitiative, initiativeTypeId, isInitiativeItem } from './board'
import { initiativesFlow, kindOf } from './flows'
import { childrenOf, effectiveStage, leavesUnder, nextRank, rootLane } from './lanes'
import type { Board, BoardFlow, Item, IssueType, Lane, Placement, Stage } from './types'

/** The state a promotion reads: exactly this and no more, so a caller can pass a snapshot. */
export interface PromotionSlice {
  items: Item[]
  boards: Board[]
  placements: Placement[]
  lanes: Lane[]
  flows: BoardFlow[]
  issueTypes: IssueType[]
}

/** What the caller supplies to make the result deterministic: a clock, an author, an id. */
export interface PromotionContext {
  at: number
  /** Who did it — a person's id, or the token owner's. Absent means nobody was named. */
  by?: string
  /** The token that acted, when it was not the app. */
  via?: string
  /** A fresh id, for the history entry this creates. */
  id: () => string
}

export type PromotionOutcome =
  | {
      kind: 'promoted'
      item: Item
      placement: Placement
      fromLaneId: string
      toLaneId: string
      oldTypeName: string
    }
  | { kind: 'refused'; message: string }

interface Plan {
  item: Item
  placement: Placement
  fromLaneId: string
  toLaneId: string
  oldTypeName: string
}

/**
 * The first cell of the initiatives section carrying this stage.
 *
 * Taken from the **card's** stage, before the retype, and mapped directly. Reading the rollup after
 * the item became an initiative would be a different question — and a childless one would still
 * answer itself, but an item with children would not, and the card was not in that section yet.
 */
function cellForStage(slice: PromotionSlice, boardId: string, stage: Stage): string | undefined {
  const flow = initiativesFlow(slice.flows, boardId)
  const root = flow ? rootLane(slice.lanes, flow.id) : undefined
  if (!root) return undefined
  const section = childrenOf(slice.lanes, root.id).find((lane) => lane.stage === stage)
  if (!section) return undefined
  return leavesUnder(slice.lanes, section.id)[0]?.id
}

/** Everything the act needs, or the sentence saying why it cannot. */
function plan(itemId: string, boardId: string, slice: PromotionSlice): Plan | string {
  const item = slice.items.find((entry) => entry.id === itemId)
  if (!item) return 'no such item'
  if (item.archived) return 'a filed-away card is read-only; restore it first'
  const board = slice.boards.find((entry) => entry.id === boardId)
  if (!board) return 'no such board'
  // A portfolio connects initiatives that already exist; it has no cards flow to make one from.
  if (!canAddInitiative(board)) return 'a portfolio reads existing initiatives; it does not make one from a card'
  if (isInitiativeItem(item, slice.issueTypes)) return 'this item is already an initiative'
  const initiativeType = initiativeTypeId(slice.issueTypes)
  if (!initiativeType) return 'this workspace has no Initiative type'

  const placement = slice.placements.find((entry) => entry.itemId === itemId && entry.boardId === boardId)
  if (!placement) return 'this card is not on this board'
  const lane = slice.lanes.find((entry) => entry.id === placement.laneId)
  if (!lane) return 'this card’s cell is not on this board'
  const flow = slice.flows.find((entry) => entry.id === lane.flowId)
  if (!flow || flow.boardId !== boardId || kindOf(slice.flows, lane.flowId) !== 'cards') {
    return 'only a card in a cards flow can become an initiative'
  }

  const stage = effectiveStage(slice.lanes, lane.id)
  if (!stage) return 'this card’s cell has no stage'
  const toLaneId = cellForStage(slice, boardId, stage)
  if (!toLaneId) return `this board’s initiatives flow has no cell for ${stage}`

  const oldTypeName = slice.issueTypes.find((type) => type.id === item.typeId)?.name ?? 'None'
  return {
    item,
    placement: {
      ...placement,
      laneId: toLaneId,
      rank: nextRank(slice.placements, toLaneId),
    },
    fromLaneId: lane.id,
    toLaneId,
    oldTypeName,
  }
}

/** Would the act accept this card on this board? One answer for the menu and the door. */
export function canPromoteToInitiative(itemId: string, boardId: string, slice: PromotionSlice): boolean {
  return typeof plan(itemId, boardId, slice) !== 'string'
}

/**
 * Promote one card, unless the rule refuses it.
 *
 * The returned item is the same object's fields with the reserved type, no kind, and one history
 * entry; the returned placement is the same placement in the new cell, at the bottom. Nothing is
 * written here and nothing else in the slice is changed, so the caller can put both in one write.
 */
export function promoteToInitiative(
  itemId: string,
  boardId: string,
  slice: PromotionSlice,
  context: PromotionContext,
): PromotionOutcome {
  const planned = plan(itemId, boardId, slice)
  if (typeof planned === 'string') return { kind: 'refused', message: planned }

  const initiativeType = initiativeTypeId(slice.issueTypes)!
  const log = {
    id: context.id(),
    at: context.at,
    kind: 'edited' as const,
    note: `Converted from a card (was ${planned.oldTypeName})`,
    ...(context.by ? { by: context.by } : {}),
    ...(context.via ? { via: context.via } : {}),
  }
  return {
    kind: 'promoted',
    item: {
      ...planned.item,
      typeId: initiativeType,
      // A card cannot carry a kind; clearing one here also repairs a record that somehow had one.
      initiativeTypeId: undefined,
      log: [...(planned.item.log ?? []), log],
    },
    placement: { ...planned.placement, laneEnteredAt: context.at },
    fromLaneId: planned.fromLaneId,
    toLaneId: planned.toLaneId,
    oldTypeName: planned.oldTypeName,
  }
}
