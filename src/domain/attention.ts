import { openDependenciesOf, rollupOf, type Graph } from './derive'
import { boardInitiatives, isAggregating, isPortfolio, portfolioInitiatives } from './board'
import { ageDays, isOverdue, STALE_AFTER_DAYS } from './filters'
import { dueDay, dueState, lateStartDay } from './due'
import { initiativeHealth } from './health'
import { cardsFlows } from './flows'
import { effectiveStage, lanePath, STAGE_LABELS, workflowLanes } from './lanes'
import type { Board, BoardFlow, IssueType, Item, Placement, Stage } from './types'

/**
 * What needs attention on a board: the signals an unfinished item carries, and the items behind
 * every count.
 *
 * This is a reading surface and nothing else. Every signal is derived from state the model
 * already keeps — the blocked flag, the dependency links, the placement's lane and stamp, the
 * assignees and the due date — so nothing is stored, nothing is flagged, and no rule can
 * disagree with the card it describes. The band and the list read one array (`rows`), which is
 * why a tile's number and the rows carrying its signal are the same fact.
 *
 * The population is what the board actually renders. A board with a cards flow reads its cards —
 * every cards flow it has, because the dashboard reads the board and not one of its tabs; a
 * coordination board, which makes no cards, reads its own initiatives. Both read the same rules,
 * because an initiative answers for the same facts a card does.
 */

export type AttentionSignalKey =
  | 'blocked'
  | 'waiting'
  | 'overdue'
  | 'dueSoon'
  | 'lateStart'
  | 'stale'
  | 'unassigned'

/**
 * Every tile in the band. There is no "Unfinished" tile: every row here is unfinished already,
 * and a count of the population was a fact about the surface rather than a way into the work.
 * Blocked work and work waiting on another item come first, because those are the states a
 * reader can act on now.
 */
export type AttentionKey = AttentionSignalKey

export interface AttentionSignal {
  key: AttentionSignalKey
  /** The chip: the rule's name. */
  label: string
  /** Why the rule raised it, in the rule's own words — the chip's title. */
  why: string
  tone: 'risk' | 'watch'
}

export interface AttentionRow {
  item: Item
  /** Where it sits: the lane path on a card, the derived section on an initiative. */
  status: string
  /** The stage the row reads as, when it has one. */
  stage?: Stage
  /** Whole days in its current lane; absent when the placement predates the stamp. */
  ageDays?: number
  /** Risks and watches, in a fixed order. Empty for a row that needs no review. */
  signals: AttentionSignal[]
}

export interface AttentionCounts {
  blocked: number
  waiting: number
  overdue: number
  dueSoon: number
  lateStart: number
  stale: number
  unassigned: number
}

export interface Attention {
  /** Which workflow the board was read for, so a surface can explain itself honestly. */
  population: 'cards' | 'initiatives'
  /** Every attention item, those with signals first. The counts are taken from this array. */
  rows: AttentionRow[]
  counts: AttentionCounts
}

/** The band's tiles, in the order they read. The label is the tile; the key is the count. */
export const ATTENTION_TILES: { key: AttentionKey; label: string }[] = [
  { key: 'blocked', label: 'Blocked' },
  { key: 'waiting', label: 'Waiting on' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'dueSoon', label: 'Due soon' },
  { key: 'lateStart', label: 'Late start' },
  { key: 'stale', label: 'Stale' },
  { key: 'unassigned', label: 'Unassigned' },
]

const COMMITTED = new Set<Stage>(['notStarted', 'inProgress'])

/**
 * Read a board's attention: the population it renders, every row with its signals, and the counts.
 *
 * A programme or portfolio board is aggregating, not working: it makes no cards, even when the
 * lane tree still carries an empty cards workflow (the demo's coordination boards do). The same
 * `isAggregating` rule the toolbar and the palette read decides the population here, so the
 * dashboard cannot offer attention on cards its board would refuse to create.
 */
export function boardAttention(
  graph: Graph,
  boardId: string,
  issueTypes: IssueType[],
  flows: BoardFlow[],
  { boards = [], now = Date.now() }: { boards?: Board[]; now?: number } = {},
): Attention {
  const makesCards = !isAggregating(boards.find((b) => b.id === boardId))
  const rows = makesCards ? cardRows(graph, boardId, flows, now) : initiativeRows(graph, boardId, issueTypes, now, boards)
  const counts: AttentionCounts = {
    blocked: 0,
    waiting: 0,
    overdue: 0,
    dueSoon: 0,
    lateStart: 0,
    stale: 0,
    unassigned: 0,
  }
  for (const row of rows) for (const signal of row.signals) counts[signal.key] += 1
  return { population: makesCards ? 'cards' : 'initiatives', rows: orderRows(rows), counts }
}

/**
 * Worst first: the number of signals, then the longest-known age, then the title. A reader who
 * stops after the first row has still seen the one with the most wrong with it.
 */
export function orderRows(rows: AttentionRow[]): AttentionRow[] {
  return [...rows].sort(
    (a, b) =>
      b.signals.length - a.signals.length ||
      (b.ageDays ?? -1) - (a.ageDays ?? -1) ||
      a.item.title.localeCompare(b.item.title, undefined, { sensitivity: 'base' }),
  )
}

/* ------------------------------------------------------------------ *
 * Cards — the board's own flow
 * ------------------------------------------------------------------ */

function cardRows(graph: Graph, boardId: string, flows: BoardFlow[], now: number): AttentionRow[] {
  const flowsHere = cardsFlows(flows, boardId)
  const laneIds = new Set(flowsHere.flatMap((flow) => workflowLanes(graph.lanes, flow.id)).map((l) => l.id))
  // "Backlog" is two answers on a board with two cards flows, so the row says which tree it means.
  const nameOfFlow = flowsHere.length > 1 ? (laneId: string) => flows.find((f) => f.id === graph.lanes.find((l) => l.id === laneId)?.flowId)?.name : undefined
  const rows: AttentionRow[] = []
  for (const placement of graph.placements) {
    if (placement.boardId !== boardId || !laneIds.has(placement.laneId)) continue
    const item = graph.items.find((i) => i.id === placement.itemId)
    if (!item || item.archived) continue
    const stage = effectiveStage(graph.lanes, placement.laneId)
    // A placement whose lane vanished is not on the board any more; a Done card is finished.
    if (!stage || stage === 'done') continue
    const age = ageDays(placement, now)
    rows.push({
      item,
      status: cardStatus(graph, placement, stage, nameOfFlow?.(placement.laneId)),
      stage,
      ...(age !== undefined ? { ageDays: age } : {}),
      signals: cardSignals(item, stage, age, now, graph),
    })
  }
  return rows
}

/** The lane path (the root's nameless top excluded), with the stage as the fallback. */
function cardStatus(graph: Graph, placement: Placement, stage: Stage, flowName?: string): string {
  const path = lanePath(graph.lanes, placement.laneId).filter(Boolean)
  const where = path.length > 0 ? path.join(' · ') : STAGE_LABELS[stage]
  return flowName ? `${flowName} · ${where}` : where
}

function cardSignals(
  item: Item,
  stage: Stage,
  age: number | undefined,
  now: number,
  graph: Graph,
): AttentionSignal[] {
  const signals: AttentionSignal[] = []

  // Blocked is a state a person set, not a reading of the work: it needs no reasoning to find.
  if (item.blocked) {
    signals.push({
      key: 'blocked',
      label: 'Blocked',
      why: item.blockedReason ? `Blocked — ${item.blockedReason}` : 'It is explicitly blocked',
      tone: 'risk',
    })
  }

  // Waiting is the other half of a hard stop: the work cannot proceed until the item it depends
  // on is done. The same open-link reading the card's own chips use, so the two cannot disagree.
  const waiting = openDependenciesOf(item.id, graph)
  if (waiting.length > 0) {
    signals.push({
      key: 'waiting',
      label: 'Waiting on',
      why: `Waits on ${waiting.length} item${waiting.length === 1 ? '' : 's'} that ${waiting.length === 1 ? 'is' : 'are'} not done`,
      tone: 'risk',
    })
  }

  if (isOverdue(item, false, now)) {
    signals.push({
      key: 'overdue',
      label: 'Overdue',
      why: `Its due date (${item.dueDate}) has passed`,
      tone: 'risk',
    })
  }

  // The forward-looking half of the same promise. `dueState` names the window, and it calls a
  // passed day overdue rather than soon, so a row never carries both chips.
  const due = dueState(item.dueDate, false, now)
  if (due?.tone === 'soon') {
    signals.push({
      key: 'dueSoon',
      label: 'Due soon',
      why:
        due.days === 0
          ? `Due today — ${dueDay(due.date)}`
          : `Due ${dueDay(due.date)} — in ${due.days} day${due.days === 1 ? '' : 's'}`,
      tone: 'watch',
    })
  }

  // A plan that has slipped before the work began: the target start passed and the board still
  // says the item has not started. Never inferred — an item with no planned start says nothing.
  const lateStart = lateStartDay(item.targetStartDate, stage, now)
  if (lateStart) {
    signals.push({
      key: 'lateStart',
      label: 'Late start',
      why: `Its planned start (${lateStart}) passed and it has not started`,
      tone: 'watch',
    })
  }

  // Committed work that has stopped moving. An unknown stamp says nothing: an app that never
  // recorded the arrival must not accuse the card of sitting still.
  if (COMMITTED.has(stage) && age !== undefined && age >= STALE_AFTER_DAYS) {
    signals.push({
      key: 'stale',
      label: 'Stale',
      why: `It has sat in this lane for ${age} days — past the ${STALE_AFTER_DAYS}-day threshold`,
      tone: 'watch',
    })
  }

  // The same test as the assignee filter's "Unassigned" entry, so the count and the filtered
  // board cannot disagree.
  if ((item.assignees ?? []).length === 0) {
    signals.push({
      key: 'unassigned',
      label: 'Unassigned',
      why: 'Nobody is assigned',
      tone: 'watch',
    })
  }

  return signals
}

/* ------------------------------------------------------------------ *
 * Initiatives — a board that makes no cards
 * ------------------------------------------------------------------ */

function initiativeRows(
  graph: Graph,
  boardId: string,
  issueTypes: IssueType[],
  now: number,
  boards: Board[],
): AttentionRow[] {
  // A portfolio holds no initiatives of its own: it reads those in its remit and those linked to
  // its objectives, wherever the board that carries them sits.
  const population = isPortfolio(boards.find((b) => b.id === boardId))
    ? portfolioInitiatives(graph, boards, boardId, issueTypes)
    : boardInitiatives(graph, boardId, issueTypes)
  const rows: AttentionRow[] = []
  for (const item of population) {
    const bucket = rollupOf(item.id, graph).bucket
    if (bucket === 'done') continue
    const placement = graph.placements.find((p) => p.boardId === boardId && p.itemId === item.id)
    const age = ageDays(placement, now)
    const health = initiativeHealth(item.id, graph, now)
    const stale = health.flags.find((f) => f.flag === 'stale')
    const unowned = health.flags.find((f) => f.flag === 'unowned')

    const signals: AttentionSignal[] = []
    const blockedFlag = health.flags.find((f) => f.flag === 'blocked')
    if (item.blocked) {
      signals.push({
        key: 'blocked',
        label: 'Blocked',
        why: item.blockedReason ? `Blocked — ${item.blockedReason}` : 'It is explicitly blocked',
        tone: 'risk',
      })
    } else if (blockedFlag) {
      signals.push({ key: 'blocked', label: 'Blocked', why: blockedFlag.why, tone: 'risk' })
    }

    // The initiative's own dependency links first, then the work below: both mean it cannot
    // proceed, and the health flag already says the second in the same words as the health column.
    const ownWaits = openDependenciesOf(item.id, graph)
    const waitingFlag = health.flags.find((f) => f.flag === 'waiting')
    if (ownWaits.length > 0) {
      signals.push({
        key: 'waiting',
        label: 'Waiting on',
        why: `Waits on ${ownWaits.length} item${ownWaits.length === 1 ? '' : 's'} that ${ownWaits.length === 1 ? 'is' : 'are'} not done`,
        tone: 'risk',
      })
    } else if (waitingFlag) {
      signals.push({ key: 'waiting', label: 'Waiting on', why: waitingFlag.why, tone: 'risk' })
    }

    if (isOverdue(item, false, now)) {
      signals.push({
        key: 'overdue',
        label: 'Overdue',
        why: `Its due date (${item.dueDate}) has passed`,
        tone: 'risk',
      })
    }
    const due = dueState(item.dueDate, false, now)
    if (due?.tone === 'soon') {
      signals.push({
        key: 'dueSoon',
        label: 'Due soon',
        why:
          due.days === 0
            ? `Due today — ${dueDay(due.date)}`
            : `Due ${dueDay(due.date)} — in ${due.days} day${due.days === 1 ? '' : 's'}`,
        tone: 'watch',
      })
    }
    const lateStart = lateStartDay(item.targetStartDate, bucket, now)
    if (lateStart) {
      signals.push({
        key: 'lateStart',
        label: 'Late start',
        why: `Its planned start (${lateStart}) passed and it has not started`,
        tone: 'watch',
      })
    }
    // Staleness and ownership below are the health rules' own readings, so the dashboard and the
    // initiative's health column speak about the same work in the same words.
    if (stale) signals.push({ key: 'stale', label: 'Stale', why: stale.why, tone: 'watch' })
    if (unowned) signals.push({ key: 'unassigned', label: 'Unassigned', why: unowned.why, tone: 'watch' })
    rows.push({
      item,
      status: STAGE_LABELS[bucket],
      stage: bucket,
      ...(age !== undefined ? { ageDays: age } : {}),
      signals,
    })
  }
  return rows
}
