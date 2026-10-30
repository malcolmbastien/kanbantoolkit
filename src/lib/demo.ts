/**
 * The demo, recognised.
 *
 * The browser seeds a demo workspace so a static page has something to show. On an instance that
 * demo is not the person's work, and must never be adopted or copied up in their name — but the
 * distinction cannot be "is there anything in the browser", because a person may have used the demo
 * for real before their team ran an instance.
 *
 * So it is recognised by what it is: the same boards, the same cards, in the same places, with the
 * same words. Any edit at all — a rename, a card moved, a note — breaks the comparison, and from
 * then on it is the person's workspace rather than ours.
 */

import { createSeed } from '@/domain/seed'
import type { Board, BoardFlow, Item, Lane, Placement } from '@/domain/types'

/** The lists the demo is made of — what `persistedSlice` and the seed both carry. */
export interface Workspaceish {
  boards: Board[]
  flows: BoardFlow[]
  lanes: Lane[]
  placements: Placement[]
  items: Item[]
}

const signature = (workspace: Workspaceish): string =>
  JSON.stringify([
    workspace.boards.map((board) => [board.id, board.name]),
    // The flows too: a board with a second cards flow is a different demo, and a stale copy must
    // not read as the one we handed out.
    workspace.flows.map((flow) => [flow.id, flow.boardId, flow.kind, flow.name, flow.order]),
    workspace.lanes.map((lane) => [lane.id, lane.boardId, lane.parentId, lane.name, lane.flowId]),
    workspace.items.map((item) => [item.id, item.title, item.resolvedAt ?? null]),
    workspace.placements.map((placement) => [placement.id, placement.itemId, placement.laneId]),
  ])

/** Whether what the browser holds is exactly the demo it was handed, never touched. */
export function isDemoWorkspace(workspace: Workspaceish): boolean {
  if (workspace.boards.length === 0) return false
  const seed = createSeed()
  return signature(workspace) === signature(seed)
}
