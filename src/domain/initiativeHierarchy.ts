import { attentionSignals } from './attention'
import { decompositionChildren, leafItems, progressLeaves, rollupOf, stageOf, type Graph } from './derive'
import { ageDays, parseDay } from './filters'
import { initiativeHealth, type HealthFlag } from './health'
import type { StageMove } from './metrics'
import type { Item } from './types'

/**
 * The hierarchy reading an initiative's drawer shows above its children.
 *
 * Everything here is derived from the same model the board reads: the rollup counts the leaves,
 * the health rules name the risks, and the card-level attention rules say which leaf is overdue,
 * due soon, late to start or stale. The planned envelope is over the leaves' own target dates —
 * the plan, never the due date — and the actual dates appear only when the move history says
 * enough to know them. Nothing is stored, guessed or inferred from a lane stamp.
 */

export type HierarchyFlagKey =
  | 'blocked'
  | 'waiting'
  | 'unowned'
  | 'stale'
  | 'overdue'
  | 'dueSoon'
  | 'lateStart'
  | 'uncommitted'
  | 'discarded'

export interface HierarchyFlag {
  key: HierarchyFlagKey
  /** The chip's words, always with its count (or the stale rule's day count). */
  label: string
  /** The rule's own sentence — the chip's title. */
  why: string
  tone: 'risk' | 'watch'
  /** The items the rule found. Exactly what the child list narrows to, through their branch. */
  items: string[]
}

export interface HierarchyProgress {
  total: number
  done: number
  percent: number
  backlog: number
  notStarted: number
  inProgress: number
  /** Backlog + Not Started: work that has not begun. */
  waiting: number
  /** In Progress. */
  working: number
  /** Done. */
  finished: number
}

export interface HierarchyPlan {
  ownStart?: string
  ownEnd?: string
  earliestStart?: string
  latestFinish?: string
  /** Leaves with a target start or a target end, and all leaves below the initiative. */
  dated: number
  total: number
}

export type ActualStatus = 'known' | 'notLoaded' | 'notStarted' | 'notRecorded' | 'notFinished' | 'noLeaves'

export interface HierarchyActual {
  /** The earliest commitment among the leaves, when the move history could be read. */
  start?: number
  startStatus: ActualStatus
  /** The latest resolved day, only when every leaf is done and every one has a resolved stamp. */
  finish?: number
  finishStatus: ActualStatus
}

export interface InitiativeHierarchyReading {
  progress: HierarchyProgress
  flags: HierarchyFlag[]
  plan: HierarchyPlan
  actual: HierarchyActual
}

const flagOf = (health: ReturnType<typeof initiativeHealth>, flag: HealthFlag) =>
  health.flags.find((entry) => entry.flag === flag)

const dateKey = (date: string | undefined): number | undefined => {
  const parsed = parseDay(date)
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : undefined
}

/** The earliest or latest date in a list, keeping the original ISO string. */
function envelope(
  leaves: readonly Item[],
  field: 'targetStartDate' | 'targetEndDate',
  direction: 'earliest' | 'latest',
): string | undefined {
  let chosen: { date: string; at: number } | undefined
  for (const leaf of leaves) {
    const date = leaf[field]
    const at = dateKey(date)
    if (!date || at === undefined) continue
    if (
      !chosen ||
      (direction === 'earliest' ? at < chosen.at : at > chosen.at)
    ) {
      chosen = { date, at }
    }
  }
  return chosen?.date
}

/** The chapter below the leaves, read once and shared by the summary and the child list. */
export function initiativeHierarchyReading(
  item: Item,
  graph: Graph,
  now: number,
  moves?: ReadonlyMap<string, readonly StageMove[]>,
): InitiativeHierarchyReading {
  const roll = rollupOf(item.id, graph)
  // An initiative with nothing below it is not a leaf of its own: its progress, envelope and
  // actual dates are absent until work is added, rather than a misleading 100% of itself.
  const hasLeaves = decompositionChildren(item.id, graph.edges).length > 0
  const leaves = hasLeaves ? progressLeaves(item.id, graph) : []
  const allLeaves = hasLeaves ? leafItems(item.id, graph) : []
  const health = initiativeHealth(item.id, graph, now)

  const progress: HierarchyProgress = hasLeaves
    ? {
        total: roll.total,
        done: roll.done,
        percent: roll.percent,
        backlog: roll.uncommitted,
        notStarted: roll.notStarted,
        inProgress: roll.inProgress,
        waiting: roll.uncommitted + roll.notStarted,
        working: roll.inProgress,
        finished: roll.done,
      }
    : { total: 0, done: 0, percent: 0, backlog: 0, notStarted: 0, inProgress: 0, waiting: 0, working: 0, finished: 0 }

  const flags: HierarchyFlag[] = []
  const push = (flag: HierarchyFlag) => {
    // The two chips whose rule can be about the initiative itself rather than a leaf are still
    // worth saying when there is no item to point at; the list simply has nothing to narrow.
    if (flag.items.length > 0 || flag.key === 'blocked' || flag.key === 'stale') flags.push(flag)
  }

  const blocked = flagOf(health, 'blocked')
  if (blocked) {
    push({ key: 'blocked', label: blocked.label, why: blocked.why, tone: blocked.tone, items: blocked.items ?? [] })
  } else if (item.blocked) {
    // The initiative itself is the stop. It has no leaves to point at, so the chip explains and
    // does not pretend to narrow the list.
    push({
      key: 'blocked',
      label: 'Blocked',
      why: item.blockedReason ? `Blocked — ${item.blockedReason}` : 'This initiative is explicitly blocked',
      tone: 'risk',
      items: [],
    })
  }

  for (const key of ['waiting', 'unowned'] as const) {
    const found = flagOf(health, key)
    if (found) {
      push({ key, label: found.label, why: found.why, tone: found.tone, items: found.items ?? [] })
    }
  }

  // The card-level rules, applied to each leaf. The same `attentionSignals` the board's Needs
  // attention reads, so a leaf cannot be stale in one place and not in the other.
  const bySignal = new Map<'stale' | 'overdue' | 'dueSoon' | 'lateStart', string[]>()
  for (const leaf of allLeaves) {
    if (leaf.archived) continue
    const stage = stageOf(leaf.id, graph)
    if (!stage) continue
    const placement = graph.placements.find((entry) => entry.itemId === leaf.id)
    for (const signal of attentionSignals(leaf, stage, ageDays(placement, now), now, graph)) {
      if (signal.key === 'stale' || signal.key === 'overdue' || signal.key === 'dueSoon' || signal.key === 'lateStart') {
        const list = bySignal.get(signal.key) ?? []
        list.push(leaf.id)
        bySignal.set(signal.key, list)
      }
    }
  }

  // Staleness is read per leaf here, with the same threshold and the same committed stages the
  // card's own warning uses. The initiative's health flag says whether the whole subtree has gone
  // quiet; the leaves say which of them have, and are what a reader can narrow to.
  const stale = bySignal.get('stale') ?? []
  const healthStale = flagOf(health, 'stale')
  if (stale.length > 0) {
    push({
      key: 'stale',
      label: `${stale.length} stale`,
      why: healthStale?.why ?? `${stale.length} leaf${stale.length === 1 ? '' : 's'} have sat in their lane past the staleness threshold`,
      tone: 'watch',
      items: stale,
    })
  } else if (healthStale) {
    push({ key: 'stale', label: healthStale.label, why: healthStale.why, tone: healthStale.tone, items: [] })
  }

  for (const [key, label, tone] of [
    ['overdue', 'overdue', 'risk'],
    ['dueSoon', 'due soon', 'watch'],
    ['lateStart', 'late start', 'watch'],
  ] as const) {
    const items = bySignal.get(key) ?? []
    if (items.length === 0) continue
    push({
      key,
      label: `${items.length} ${label}`,
      why:
        key === 'overdue'
          ? `${items.length} leaf${items.length === 1 ? '' : 's'} ${items.length === 1 ? 'is' : 'are'} past a promise that has not been kept`
          : key === 'dueSoon'
            ? `${items.length} leaf${items.length === 1 ? '' : 's'} ${items.length === 1 ? 'is' : 'are'} due within a week`
            : `${items.length} leaf${items.length === 1 ? '' : 's'} ${items.length === 1 ? 'is' : 'are'} past a planned start that has not begun`,
      tone,
      items,
    })
  }

  for (const key of ['uncommitted', 'discarded'] as const) {
    const found = flagOf(health, key)
    if (found) {
      push({ key, label: found.label, why: found.why, tone: found.tone, items: found.items ?? [] })
    }
  }

  const earliestStart = envelope(leaves, 'targetStartDate', 'earliest')
  const latestFinish = envelope(leaves, 'targetEndDate', 'latest')
  const plan: HierarchyPlan = {
    ...(item.targetStartDate ? { ownStart: item.targetStartDate } : {}),
    ...(item.targetEndDate ? { ownEnd: item.targetEndDate } : {}),
    ...(earliestStart ? { earliestStart } : {}),
    ...(latestFinish ? { latestFinish } : {}),
    dated: leaves.filter((leaf) => dateKey(leaf.targetStartDate) !== undefined || dateKey(leaf.targetEndDate) !== undefined).length,
    total: leaves.length,
  }

  // Actual dates are optional and honest: a missing move read says "not loaded"; a leaf that
  // never left Backlog has not started; a leaf that started without a recorded move says so.
  let start: number | undefined
  if (moves) {
    for (const leaf of leaves) {
      const commitment = (moves.get(leaf.id) ?? []).find((move) => move.to !== 'backlog')
      if (commitment && (start === undefined || commitment.at < start)) start = commitment.at
    }
  }
  const anyStarted = leaves.some((leaf) => {
    const stage = stageOf(leaf.id, graph)
    return stage !== undefined && stage !== 'backlog' && stage !== 'notStarted'
  })
  const startStatus: ActualStatus =
    leaves.length === 0
      ? 'noLeaves'
      : moves === undefined
        ? 'notLoaded'
        : start !== undefined
          ? 'known'
          : anyStarted
            ? 'notRecorded'
            : 'notStarted'

  const allDone = leaves.length > 0 && roll.done === leaves.length
  const resolved = leaves.map((leaf) => leaf.resolvedAt).filter((at): at is number => typeof at === 'number')
  const finish = allDone && resolved.length === leaves.length ? Math.max(...resolved) : undefined
  const finishStatus: ActualStatus =
    leaves.length === 0
      ? 'noLeaves'
      : !allDone
        ? 'notFinished'
        : finish !== undefined
          ? 'known'
          : 'notRecorded'

  return {
    progress,
    flags,
    plan,
    actual: {
      ...(start !== undefined ? { start } : {}),
      startStatus,
      ...(finish !== undefined ? { finish } : {}),
      finishStatus,
    },
  }
}
