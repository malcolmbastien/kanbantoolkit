/**
 * My work — a view over the graph, not a place: everything a person owns across every
 * board, with its board and cell context. Nothing here is recorded — no my-work flag, no
 * second placement — the query reads assignments and placements where they live. It is
 * per-browser by nature: assignments read the local users directory.
 */

import { isDueSoon, isOverdue } from './filters'
import { cardsFlows } from './flows'
import { effectiveStage } from './lanes'
import type { Board, BoardBand, BoardFlow, Item, Lane, Placement } from './types'

export interface MyWorkEntry {
  item: Item
  /**
   * The cell (leaf lane) the item sits in — the answer to "where is this?". Prefixed with the
   * flow's name when the board carries more than one cards flow, because "Backlog" alone is then
   * two different answers.
   */
  cellName: string
  isOverdue: boolean
  isDueSoon: boolean
  /** Resolved work still assigned to the person: it leads nothing. */
  isResolved: boolean
}

export interface MyWorkGroup {
  boardId: string
  boardName: string
  band: BoardBand
  entries: MyWorkEntry[]
}

/**
 * Everything the person is assigned to, once per board it is placed on (a card may sit on
 * more than one board). Within a board the urgent leads: overdue first, then due soon,
 * then the undated — each by due date, untitled cards tie-break by title. Archived work is
 * filed away and stays out.
 */
export function myWork(
  items: Item[],
  placements: Placement[],
  lanes: Lane[],
  boards: Board[],
  flows: BoardFlow[],
  userId: string | undefined,
  now = Date.now(),
): MyWorkGroup[] {
  if (!userId) return []
  const byId = new Map(items.map((i) => [i.id, i]))
  const laneById = new Map(lanes.map((l) => [l.id, l]))
  // Which flows the prefix is needed for: a board with one cards flow is unambiguous without it.
  const needsFlow = new Set(boards.filter((b) => cardsFlows(flows, b.id).length > 1).map((b) => b.id))

  const groups: MyWorkGroup[] = []
  for (const board of boards) {
    const entries: MyWorkEntry[] = []
    for (const p of placements) {
      if (p.boardId !== board.id) continue
      const item = byId.get(p.itemId)
      if (!item || item.archived) continue
      if (!item.assignees?.includes(userId)) continue
      const lane = laneById.get(p.laneId)
      if (!lane) continue // a stale placement, not where the work sits
      const flowName = needsFlow.has(board.id) ? flows.find((f) => f.id === lane.flowId)?.name : undefined
      const cellName = flowName ? `${flowName} / ${lane.name}` : lane.name
      const resolved = effectiveStage(lanes, p.laneId) === 'done'
      entries.push({
        item,
        cellName,
        isOverdue: isOverdue(item, resolved, now),
        isDueSoon: isDueSoon(item, resolved, now),
        isResolved: resolved,
      })
    }
    // Urgent leads: overdue, then due this week, then the planned and undated; resolved
    // work the person still owns sinks below everything that waits on them.
    const rank = (e: MyWorkEntry): number => (e.isOverdue ? 0 : e.isDueSoon ? 1 : e.isResolved ? 3 : 2)
    const dueOf = (e: MyWorkEntry): number => {
      const t = e.item.targetEndDate
      return t ? new Date(t).getTime() : Number.POSITIVE_INFINITY
    }
    entries.sort((a, c) => {
      const r = rank(a) - rank(c)
      if (r !== 0) return r
      const d = dueOf(a) - dueOf(c)
      // A stable tie-break so the view does not reorder between renders.
      return d !== 0 ? d : a.item.title.localeCompare(c.item.title)
    })
    if (entries.length > 0) {
      groups.push({ boardId: board.id, boardName: board.name, band: board.band, entries })
    }
  }
  return groups
}
