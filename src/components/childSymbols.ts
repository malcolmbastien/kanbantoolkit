import { isDiscarded, type Graph } from '@/domain/derive'
import { type BoardModel } from '@/domain/boardModel'
import { initiativeTypeById, isInitiativeItem, tagsOf } from '@/domain/board'
import { dueLabel, dueState, dueWhy, lateStartDay } from '@/domain/due'
import { ageDays, STALE_AFTER_DAYS } from '@/domain/filters'
import { lanePath } from '@/domain/lanes'
import type { HealthFlagInfo } from '@/domain/health'
import type { Board, BoardFlow, IssueType, Item, Lane, Placement } from '@/domain/types'
import { PROGRESS_STAGE_ORDER } from './StageProgressBar'
import type { CardSymbol } from './Card'

export interface ChildSymbolContext {
  graph: Graph
  model: BoardModel
  boards: Board[]
  issueTypes: IssueType[]
  placements: Placement[]
  lanes: Lane[]
  flows: BoardFlow[]
  /** The health rules, read from the same function the Health column reads. */
  flagsOf: (id: string) => HealthFlagInfo[]
  /** The board this surface is showing. */
  boardId: string
  /** A board being read from another board's view, when there is one. */
  viewedBoardId?: string
}

/**
 * The reading behind a child pip — the child's own status, why it is marked, and where it lives.
 *
 * The board's initiative cards and the dashboard's Initiatives table both draw pips from this one
 * builder, so a child cannot read one way on the board and another away from it. A child that was
 * discarded is filed history: it counts in the parent's `childCount`, but it is not drawn as a
 * normal stage pip, the same rule the card has always used.
 */
export function childSymbols(parentId: string, ctx: ChildSymbolContext): CardSymbol[] {
  const typeOf = (typeId: string): IssueType =>
    ctx.issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }

  return (ctx.model.childrenOf.get(parentId) ?? [])
    .map((id) => ctx.model.itemsById.get(id))
    .filter((child): child is Item => Boolean(child) && !isDiscarded(child, ctx.graph))
    .map((ci): CardSymbol => {
      const roll = ctx.model.rollup.get(ci.id)
      const bucket = roll?.bucket ?? 'backlog'
      // The child may sit on another board when this is a linked band; its own placement is the
      // one its reading should name, wherever the reader is.
      const placement =
        ctx.placements.find((p) => p.itemId === ci.id && p.boardId === (ctx.viewedBoardId ?? ctx.boardId)) ??
        ctx.placements.find((p) => p.itemId === ci.id)
      const lane = placement ? ctx.lanes.find((l) => l.id === placement.laneId) : undefined
      const flow = lane ? ctx.flows.find((f) => f.id === lane.flowId) : undefined
      const board = placement ? ctx.boards.find((b) => b.id === placement.boardId) : undefined
      const initiative = isInitiativeItem(ci, ctx.issueTypes)
      const kind = initiative ? initiativeTypeById(ctx.boards, ci.initiativeTypeId) : undefined
      const complete = bucket === 'done'
      // The same compact warning set the Mini tile wears, read from the child rather than copied
      // from its face: a blockage, a promise that has passed, a start that is late, a lane that has
      // stopped moving, nobody owning in-progress work, and an initiative's own health flags.
      const flags = initiative ? ctx.flagsOf(ci.id).filter((flag) => flag.flag !== 'discarded') : []
      const due = complete ? undefined : dueState(ci.dueDate, false)
      const late = complete ? undefined : lateStartDay(ci.targetStartDate, bucket)
      const age = complete ? undefined : ageDays(placement)
      const unowned = !complete && bucket === 'inProgress' && !(ci.assignees?.length ?? 0)
      // The reasons, in the card's own words. The blocked flag is not repeated here when the card
      // is itself blocked — the rose callout carries that — but a child initiative blocked *below*
      // has no other place to say why its pip is rose, so it joins the list.
      const ownWarnings = !complete
        ? [
            ...(due && due.tone !== 'later'
              ? [{ label: dueLabel(due), why: dueWhy(due), tone: due.tone === 'overdue' ? ('risk' as const) : ('watch' as const) }]
              : []),
            ...(late
              ? [{ label: 'Late start', why: `Its planned start (${late}) passed and it has not started`, tone: 'watch' as const }]
              : []),
            ...(unowned
              ? [{ label: 'Unowned', why: 'It is in progress and nobody is assigned', tone: 'watch' as const }]
              : []),
            ...(age !== undefined && age >= STALE_AFTER_DAYS
              ? [{ label: `${age}d in lane`, why: `${age} days in this lane — work that has stopped moving`, tone: 'watch' as const }]
              : []),
            ...flags
              .filter((flag) => flag.flag !== 'blocked')
              .map((flag) => ({ label: flag.label, why: flag.why, tone: flag.tone })),
          ]
        : []
      const warnings = [
        ...ownWarnings,
        ...flags
          .filter((flag) => flag.flag === 'blocked')
          .map((flag) => ({ label: flag.label, why: flag.why, tone: flag.tone })),
      ]
      const warned = ownWarnings.length > 0
      const blocked = Boolean(ci.blocked && !complete) || flags.some((flag) => flag.flag === 'blocked')
      return {
        id: ci.id,
        bucket,
        title: ci.title,
        type: typeOf(ci.typeId),
        ...(kind ? { kind } : {}),
        assigneeIds: ci.assignees,
        dueDate: ci.dueDate,
        priority: ci.priority,
        tags: tagsOf(ctx.boards, ci),
        blocked,
        warned,
        ...(warnings.length ? { warnings } : {}),
        blockedReason: ci.blockedReason,
        ...(board ? { boardName: board.name } : {}),
        ...(flow ? { flowName: flow.name } : {}),
        ...(lane ? { laneName: lanePath(ctx.lanes, lane.id).join(' / ') } : {}),
        ...(initiative && roll ? { below: { total: roll.total, percent: roll.total > 0 ? roll.percent : undefined } } : {}),
      }
    })
    .sort((a, b) => PROGRESS_STAGE_ORDER.indexOf(a.bucket) - PROGRESS_STAGE_ORDER.indexOf(b.bucket))
}
