import { rollupOf, type Graph } from './derive'
import { boardInitiatives, isAggregating } from './board'
import { ageDays, isOverdue, STALE_AFTER_DAYS } from './filters'
import { initiativeHealth } from './health'
import { effectiveStage, lanePath, STAGE_LABELS, workflowLanes } from './lanes'
import type { Board, IssueType, Item, Placement, Stage } from './types'

/**
 * What needs attention on a board: the signals an unfinished item carries, and the items behind
 * every count.
 *
 * This is a reading surface and nothing else. Every signal is derived from state the model
 * already keeps — the placement's lane and stamp, the assignees, the priority, the size and the
 * target date — so nothing is stored, nothing is flagged, and no rule can disagree with the card
 * it describes. The band and the list read one array (`rows`), which is why a tile's number and
 * the rows carrying its signal are the same fact.
 *
 * The population is what the board actually renders. A board with a cards workflow reads its
 * cards; a coordination board, which makes no cards, reads its own initiatives. The signals an
 * initiative can carry are the ones it can actually answer for: it has no estimate by design, so
 * it is never counted against one.
 */

export type AttentionSignalKey = 'overdue' | 'stale' | 'unassigned' | 'noPriority' | 'noEstimate'

/** Every tile in the band, in reading order — Unfinished first, because it is the population. */
export type AttentionKey = 'unfinished' | AttentionSignalKey

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
  unfinished: number
  overdue: number
  stale: number
  unassigned: number
  noPriority: number
  noEstimate: number
}

export interface Attention {
  /** Which workflow the board was read for, so a surface can explain itself honestly. */
  population: 'cards' | 'initiatives'
  /** Every attention item, those with signals first. The counts are taken from this array. */
  rows: AttentionRow[]
  counts: AttentionCounts
  /** Whether "no estimate" is a meaningful signal here: never on an initiative. */
  hasEstimate: boolean
}

/** The band's tiles, in the order they read. The label is the tile; the key is the count. */
export const ATTENTION_TILES: { key: AttentionKey; label: string }[] = [
  { key: 'unfinished', label: 'Unfinished' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'stale', label: 'Stale' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'noPriority', label: 'No priority' },
  { key: 'noEstimate', label: 'No estimate' },
]

const COMMITTED = new Set<Stage>(['notStarted', 'inProgress'])

/**
 * Read a board's attention: the population it renders, every row with its signals, the counts,
 * and whether the estimate signal exists here.
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
  { boards = [], now = Date.now() }: { boards?: Board[]; now?: number } = {},
): Attention {
  const makesCards = !isAggregating(boards.find((b) => b.id === boardId))
  const rows = makesCards ? cardRows(graph, boardId, now) : initiativeRows(graph, boardId, issueTypes, now)
  const counts: AttentionCounts = {
    unfinished: rows.length,
    overdue: 0,
    stale: 0,
    unassigned: 0,
    noPriority: 0,
    noEstimate: 0,
  }
  for (const row of rows) for (const signal of row.signals) counts[signal.key] += 1
  return { population: makesCards ? 'cards' : 'initiatives', rows: orderRows(rows), counts, hasEstimate: makesCards }
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

function cardRows(graph: Graph, boardId: string, now: number): AttentionRow[] {
  const laneIds = new Set(workflowLanes(graph.lanes, boardId, 'cards').map((l) => l.id))
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
      status: cardStatus(graph, placement, stage),
      stage,
      ...(age !== undefined ? { ageDays: age } : {}),
      signals: cardSignals(item, stage, age, now),
    })
  }
  return rows
}

/** The lane path (the root's nameless top excluded), with the stage as the fallback. */
function cardStatus(graph: Graph, placement: Placement, stage: Stage): string {
  const path = lanePath(graph.lanes, placement.laneId).filter(Boolean)
  return path.length > 0 ? path.join(' · ') : STAGE_LABELS[stage]
}

function cardSignals(item: Item, stage: Stage, age: number | undefined, now: number): AttentionSignal[] {
  const signals: AttentionSignal[] = []

  if (isOverdue(item, false, now)) {
    signals.push({
      key: 'overdue',
      label: 'Overdue',
      why: `Its target date (${item.targetEndDate}) has passed`,
      tone: 'risk',
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

  if (item.priority === undefined) {
    signals.push({
      key: 'noPriority',
      label: 'No priority',
      why: 'No priority is set',
      tone: 'watch',
    })
  }

  // An initiative has no estimate by design, and can never reach this branch: the population for
  // this rule is a cards workflow. `size: 0` is an estimate of nothing, not the absence of one.
  if (item.size === undefined) {
    signals.push({
      key: 'noEstimate',
      label: 'No estimate',
      why: 'No size is estimated',
      tone: 'watch',
    })
  }

  return signals
}

/* ------------------------------------------------------------------ *
 * Initiatives — a board that makes no cards
 * ------------------------------------------------------------------ */

function initiativeRows(graph: Graph, boardId: string, issueTypes: IssueType[], now: number): AttentionRow[] {
  const rows: AttentionRow[] = []
  for (const item of boardInitiatives(graph, boardId, issueTypes)) {
    const bucket = rollupOf(item.id, graph).bucket
    if (bucket === 'done') continue
    const placement = graph.placements.find((p) => p.boardId === boardId && p.itemId === item.id)
    const age = ageDays(placement, now)
    const health = initiativeHealth(item.id, graph, now)
    const stale = health.flags.find((f) => f.flag === 'stale')
    const unowned = health.flags.find((f) => f.flag === 'unowned')

    const signals: AttentionSignal[] = []
    if (isOverdue(item, false, now)) {
      signals.push({
        key: 'overdue',
        label: 'Overdue',
        why: `Its target date (${item.targetEndDate}) has passed`,
        tone: 'risk',
      })
    }
    // Staleness and ownership below are the health rules' own readings, so the dashboard and the
    // initiative's health column speak about the same work in the same words.
    if (stale) signals.push({ key: 'stale', label: 'Stale', why: stale.why, tone: 'watch' })
    if (unowned) signals.push({ key: 'unassigned', label: 'Unassigned', why: unowned.why, tone: 'watch' })
    if (item.priority === undefined) {
      signals.push({
        key: 'noPriority',
        label: 'No priority',
        why: 'No priority is set',
        tone: 'watch',
      })
    }

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
