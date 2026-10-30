/**
 * A board's flows: the lane trees it carries, named and ordered.
 *
 * The model this replaces stored a workflow as a two-value string on every lane, so a board had
 * exactly one cards tree and the identity of a tree was its *kind*. A flow is now a record —
 * id, board, kind, name, place — and a lane names its flow. That is what lets one board carry
 * Delivery and Support as two independent cards flows while still having exactly one
 * initiatives flow.
 *
 * The rules that decide which flows may be renamed, reordered or removed live here too, for the
 * same reason `canSetParent` and `canMoveCard` do: the store and the control that shows must read
 * one answer, so a button that is offered is a button that works.
 */

import type { BoardFlow, FlowKind, Lane, Placement } from './types'

/** A board's flows of one kind, in the order the board shows them. */
export function flowsOf(flows: BoardFlow[], boardId: string, kind: FlowKind): BoardFlow[] {
  return flows.filter((f) => f.boardId === boardId && f.kind === kind).sort((a, b) => a.order - b.order)
}

/** The cards flows of a board, in order. A team board has at least one; a coordination board none. */
export function cardsFlows(flows: BoardFlow[], boardId: string): BoardFlow[] {
  return flowsOf(flows, boardId, 'cards')
}

/** The one initiatives flow of a board. */
export function initiativesFlow(flows: BoardFlow[], boardId: string): BoardFlow | undefined {
  return flowsOf(flows, boardId, 'initiatives')[0]
}

/** A flow by id — the only way a lane's tree is identified. */
export function flowOf(flows: BoardFlow[], id: string | undefined): BoardFlow | undefined {
  return id ? flows.find((f) => f.id === id) : undefined
}

/**
 * What kind of tree a lane's flow is.
 *
 * `undefined` for a flow that is not there, rather than a guess: a lane whose flow has gone is a
 * lane the board cannot read, and saying "cards" would make a broken tree look like a working one.
 */
export function kindOf(flows: BoardFlow[], flowId: string | undefined): FlowKind | undefined {
  return flowOf(flows, flowId)?.kind
}

/**
 * Every lane id in a flow — what "this card is in this flow" is checked against.
 *
 * Deliberately not in `lanes.ts`: that file is about the shape of a tree and knows nothing about
 * flows; this one is about which trees a board has.
 */
export function flowLaneIds(lanes: Lane[], flowId: string): Set<string> {
  return new Set(lanes.filter((l) => l.flowId === flowId).map((l) => l.id))
}

/** The initiatives flow is the board's external shape, not the team's: cards flows are named. */
export function canRenameFlow(flows: BoardFlow[], flowId: string): boolean {
  return flowOf(flows, flowId)?.kind === 'cards'
}

/** Cards flows are ordered by the team; the initiatives flow sits where it always has. */
export function canReorderFlow(flows: BoardFlow[], flowId: string): boolean {
  return flowOf(flows, flowId)?.kind === 'cards'
}

/**
 * A cards flow can go only if the board keeps one, and only if no card is in it.
 *
 * Removing a flow with work in it would have to either delete the cards or invent a home for
 * them, and both are decisions a person must make explicitly: move or discard the cards first.
 */
export function canRemoveFlow(flows: BoardFlow[], flowId: string, lanes: Lane[], placements: Placement[]): boolean {
  const flow = flowOf(flows, flowId)
  if (!flow || flow.kind !== 'cards') return false
  if (cardsFlows(flows, flow.boardId).length <= 1) return false
  const laneIds = flowLaneIds(lanes, flowId)
  return !placements.some((p) => laneIds.has(p.laneId))
}

/** The name a new cards flow takes: "Cards", then "Cards 2", "Cards 3". */
export function nextFlowName(flows: BoardFlow[], boardId: string): string {
  const taken = new Set(cardsFlows(flows, boardId).map((f) => f.name.trim().toLowerCase()))
  if (!taken.has('cards')) return 'Cards'
  let n = 2
  while (taken.has(`cards ${n}`)) n += 1
  return `Cards ${n}`
}
