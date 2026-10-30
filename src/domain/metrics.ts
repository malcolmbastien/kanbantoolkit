import { STALE_AFTER_DAYS } from './filters'
import type { FlowWindow } from './flowWindow'
import type { Item, Stage } from './types'

/**
 * Flow metrics — lead time, cycle time, throughput and a cumulative flow diagram — derived from
 * what the cards themselves recorded.
 *
 * Nothing here is stored and nothing is maintained by hand: a card's history is the `moved`
 * entries in its own log (task 74), each of which carries the **stage** it landed in. That is
 * the point of recording stages rather than lane ids: a team is free to rename, split and
 * rearrange its columns, and the four stages stay fixed, so a board redesigned on Tuesday still
 * reports its own past correctly on Wednesday.
 *
 * The history starts the day the app began recording moves, which is honest and worth saying
 * out loud wherever these numbers are shown.
 */

const DAY_MS = 86_400_000
export const WEEK_MS = 7 * DAY_MS
/** The most weekly buckets an all-history reading draws: two years, so the chart stays readable. */
export const MAX_ALL_WEEKS = 104

/** A move as flow reads it: the stage it landed in, and when. */
export interface StageMove {
  at: number
  to: Stage
  from?: Stage
}

/** One blocked run, as the log recorded it: an open run has no end. */
export interface BlockedSpan {
  from: number
  to?: number
  reason?: string
}

/** One card's history in the terms flow is read in — all of it derived from the card's log. */
export interface FlowRecord {
  id: string
  title: string
  createdAt: number
  resolvedAt?: number
  archivedAt?: number
  /** The stage it was in before its first recorded move: where the history starts. */
  startedIn: Stage
  moves: StageMove[]
  /** Blocked runs, paired from the log. An open run is one still blocked at read time. */
  blocks: BlockedSpan[]
  /** The card's explicit blocked flag now — work can be blocked without a logged run. */
  blockedNow: boolean
  /** The reason kept on the card, for a blockage that has no logged entry. */
  blockedReason?: string
}

/** Pair the blocked and unblocked entries in a card's log, oldest first. */
function blockedSpans(log: Item['log']): BlockedSpan[] {
  const entries = (log ?? [])
    .filter((entry) => entry.kind === 'blocked' || entry.kind === 'unblocked')
    .sort((a, b) => a.at - b.at)
  const spans: BlockedSpan[] = []
  let open: BlockedSpan | undefined
  for (const entry of entries) {
    if (entry.kind === 'blocked' && open === undefined) {
      open = { from: entry.at, ...(entry.note ? { reason: entry.note.trim() } : {}) }
    } else if (entry.kind === 'unblocked' && open !== undefined) {
      spans.push({ ...open, to: entry.at })
      open = undefined
    }
  }
  if (open !== undefined) spans.push(open)
  return spans
}

/**
 * Read one card's history. `currentStage` is the stage the card sits in now, which is what tells
 * a card that has never moved where it started; a card that has moved knows from its first entry.
 */
export function flowRecord(item: Item, currentStage: Stage | undefined): FlowRecord {
  const moves = (item.log ?? [])
    .filter((e) => e.kind === 'moved' && e.toStage)
    .sort((a, b) => a.at - b.at)
    .map((e) => ({ at: e.at, to: e.toStage as Stage, ...(e.fromStage ? { from: e.fromStage } : {}) }))
  return {
    id: item.id,
    title: item.title,
    createdAt: item.createdAt,
    ...(item.resolvedAt ? { resolvedAt: item.resolvedAt } : {}),
    ...(item.archivedAt ? { archivedAt: item.archivedAt } : {}),
    startedIn: moves[0]?.from ?? currentStage ?? 'backlog',
    moves,
    blocks: blockedSpans(item.log),
    blockedNow: item.blocked === true,
    ...(item.blockedReason ? { blockedReason: item.blockedReason } : {}),
  }
}

/** The stage a card was in at a moment: the last move at or before it, else where it started. */
export function stageAt(record: FlowRecord, at: number): Stage {
  let stage = record.startedIn
  for (const m of record.moves) {
    if (m.at > at) break
    stage = m.to
  }
  return stage
}

/**
 * When the work was committed — the first time it was not Backlog. A card created straight into
 * a committed column was committed the day it was created; one that has never left Backlog never
 * was, which is why a cycle time is missing rather than zero.
 */
export function committedAt(record: FlowRecord): number | undefined {
  if (record.startedIn !== 'backlog') return record.createdAt
  return record.moves.find((m) => m.to !== 'backlog')?.at
}

/** Whether the card was still work in flight at a moment — delivered or filed away is neither. */
export function inFlightAt(record: FlowRecord, at: number): boolean {
  if (stageAt(record, at) === 'done') return false
  return !(record.archivedAt !== undefined && record.archivedAt <= at)
}

const days = (from: number, to: number) => (to - from) / DAY_MS

/** Lead time per resolved card, in days: created to resolved. */
export function leadTimes(records: FlowRecord[]): number[] {
  return records.flatMap((r) => (r.resolvedAt === undefined ? [] : [days(r.createdAt, r.resolvedAt)]))
}

/** Cycle time per resolved card that was committed, in days: first committed to resolved. */
export function cycleTimes(records: FlowRecord[]): number[] {
  return records.flatMap((r) => {
    const committed = committedAt(r)
    return r.resolvedAt === undefined || committed === undefined ? [] : [days(committed, r.resolvedAt)]
  })
}

/** One delivered card, as a scatter of cycle time against completion date. */
export interface ScatterPoint {
  id: string
  title: string
  createdAt: number
  committedAt: number
  resolvedAt: number
  /** Created to done, in days. */
  lead: number
  /** Committed to done, in days. */
  cycle: number
}

/**
 * The delivered cards a window sees, oldest completion first.
 *
 * A card with no commitment — a resolved record whose history never left Backlog — has no cycle
 * time, so it is not a point: a scatter of cycle times cannot show a card that has no cycle. It is
 * still counted in lead time and throughput, where the source is the resolved timestamp.
 */
export function scatterPoints(records: FlowRecord[], since?: number): ScatterPoint[] {
  return deliveredSince(records, since)
    .flatMap((record) => {
      const committed = committedAt(record)
      if (record.resolvedAt === undefined || committed === undefined) return []
      return [
        {
          id: record.id,
          title: record.title,
          createdAt: record.createdAt,
          committedAt: committed,
          resolvedAt: record.resolvedAt,
          lead: days(record.createdAt, record.resolvedAt),
          cycle: days(committed, record.resolvedAt),
        },
      ]
    })
    .sort((a, b) => a.resolvedAt - b.resolvedAt || a.id.localeCompare(b.id))
}

/**
 * One open card, aged: how long it has been where it is, and how long since it was committed.
 *
 * Two clocks, deliberately. `daysInColumn` is time since it arrived in the current column — where a
 * reader looks when asking "what is stuck here". `daysSinceCommit` is time since it left Backlog —
 * the same clock cycle time uses, which is what a percentile line may be compared with. A card still
 * in Backlog has no commitment; it is open, but it is not in flight in the cycle-time sense.
 */
export interface AgingEntry {
  id: string
  title: string
  stage: Stage
  /** When it arrived in the current column, from the placement or the last move. */
  enteredAt: number
  daysInColumn: number
  committedAt?: number
  daysSinceCommit?: number
  /** Nothing has moved for longer than the app's staleness threshold. */
  stalled: boolean
}

/**
 * Open cards, oldest first.
 *
 * `laneEnteredAt` is the placement's own arrival stamp, which the view has and the record does not:
 * the fallback is the last move into the current stage, then creation. Only cards still in flight
 * are aged — done work and work filed away mid-flight are not waiting for anything.
 */
export function aging(
  records: FlowRecord[],
  now: number,
  laneEnteredAt: (record: FlowRecord) => number | undefined = () => undefined,
): AgingEntry[] {
  return records
    .flatMap((record) => {
      if (!inFlightAt(record, now)) return []
      const stage = stageAt(record, now)
      const moves = record.moves.filter((move) => move.at <= now)
      const enteredAt = laneEnteredAt(record) ?? moves[moves.length - 1]?.at ?? record.createdAt
      const committed = committedAt(record)
      const lastActivity = Math.max(record.createdAt, moves[moves.length - 1]?.at ?? record.createdAt)
      return [
        {
          id: record.id,
          title: record.title,
          stage,
          enteredAt,
          daysInColumn: Math.max(0, days(enteredAt, now)),
          ...(committed !== undefined
            ? { committedAt: committed, daysSinceCommit: Math.max(0, days(committed, now)) }
            : {}),
          stalled: now - lastActivity >= STALE_AFTER_DAYS * DAY_MS,
        },
      ]
    })
    .sort((a, b) => {
      // Committed work first, because the percentile line is about that clock; then the oldest.
      const committed = (entry: AgingEntry) => entry.daysSinceCommit !== undefined
      if (committed(a) !== committed(b)) return committed(a) ? -1 : 1
      const age = (entry: AgingEntry) => entry.daysSinceCommit ?? entry.daysInColumn
      return age(b) - age(a) || a.id.localeCompare(b.id)
    })
}

/**
 * A blocked run closed for reading.
 *
 * An open log entry ends when the card leaves the flow — resolution or filing away — because a card
 * cannot still be accruing blocked days after it is done. A run with no end and no exit is open now.
 */
export interface BlockedRun {
  from: number
  to: number
  reason?: string
  open: boolean
}

/** A card blocked right now; `days` is absent when the card carries the flag but no logged run. */
export interface BlockedNowEntry {
  id: string
  title: string
  days?: number
  reason?: string
}

export interface BlockedSummary {
  now: BlockedNowEntry[]
  /** Blocked days inside the window, summed across runs and cards. */
  totalDays: number
  /** Blocked runs that the window touches. */
  runs: number
  median?: number
  p85?: number
  reasons: { reason: string; count: number }[]
}

/** Close every blocked run at the moment the card left the flow, or at `now`. */
export function blockedRuns(record: FlowRecord, now: number): BlockedRun[] {
  const stop = Math.min(now, record.resolvedAt ?? record.archivedAt ?? now)
  return record.blocks.flatMap((span) => {
    const to = span.to === undefined ? stop : Math.min(span.to, stop)
    if (to < span.from) return []
    return [{ from: span.from, to, ...(span.reason ? { reason: span.reason } : {}), open: span.to === undefined }]
  })
}

/**
 * The blocked reading: what is blocked now, and how much blocked time the window contains.
 *
 * "Blocked" is the explicit flag, not a dependency that is not done — the app keeps those apart, and
 * the panel says so. A blockage written before the log recorded events still counts as blocked now;
 * its duration is simply unknown, and says so rather than showing zero.
 */
export function blockedSummary(records: FlowRecord[], now: number, since?: number): BlockedSummary {
  const from = since ?? Number.NEGATIVE_INFINITY
  const nowEntries: BlockedNowEntry[] = []
  const durations: number[] = []
  const reasons = new Map<string, { reason: string; count: number }>()
  let totalDays = 0
  let runs = 0

  for (const record of records) {
    const closed = blockedRuns(record, now)
    const open = closed.find((run) => run.open)
    if (record.blockedNow && inFlightAt(record, now) && open === undefined) {
      nowEntries.push({
        id: record.id,
        title: record.title,
        ...(record.blockedReason ? { reason: record.blockedReason } : {}),
      })
    }
    if (open !== undefined && inFlightAt(record, now)) {
      nowEntries.push({
        id: record.id,
        title: record.title,
        days: days(open.from, now),
        ...(open.reason ?? record.blockedReason ? { reason: open.reason ?? record.blockedReason } : {}),
      })
    }

    for (const run of closed) {
      const start = Math.max(run.from, from)
      const end = Math.min(run.to, now)
      if (end <= start) continue
      runs += 1
      totalDays += days(start, end)
      durations.push(days(run.from, run.to))
      const label = run.reason?.trim() || 'No reason given'
      const key = label.toLowerCase()
      const row = reasons.get(key) ?? { reason: label, count: 0 }
      row.count += 1
      reasons.set(key, row)
    }
  }

  const stats = sampleStats(durations)
  return {
    now: nowEntries.sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || a.id.localeCompare(b.id)),
    totalDays,
    runs,
    ...(stats.p50 !== undefined ? { median: stats.p50 } : {}),
    ...(stats.p85 !== undefined ? { p85: stats.p85 } : {}),
    reasons: [...reasons.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)).slice(0, 5),
  }
}

/** One bucket of a histogram; `tail` is the last bucket, which holds everything past the cap. */
export interface HistogramBucket {
  from: number
  /** Exclusive end, except on the tail bucket, where it is `to`-less by construction. */
  to: number
  count: number
  tail?: boolean
}

/**
 * Count values in fixed-width buckets, with every empty bucket between the ends kept.
 *
 * Gaps are the shape: "nothing finished in 3 days, then nine cards in 4" is a different story from
 * a smooth spread, and a histogram that skipped the empty buckets would hide it. A `cap` puts every
 * value at or beyond it into one final bucket, so one very long card cannot make a hundred slivers.
 */
export function histogram(values: number[], size = 1, cap?: number): HistogramBucket[] {
  if (values.length === 0) return []
  const width = Math.max(1, size)
  const capIndex = cap === undefined ? undefined : Math.max(0, Math.floor(cap / width))
  const indices = values.map((value) => Math.max(0, Math.floor(value / width)))
  // The cap only becomes a bucket when something reaches it; otherwise the last day with a card
  // is the last bucket, and a board whose work finishes in a week does not draw sixty empty days.
  const capped = capIndex !== undefined && indices.some((index) => index >= capIndex)
  const last = capped ? capIndex! : Math.max(...indices)
  const buckets: HistogramBucket[] = []
  for (let index = 0; index <= last; index += 1) {
    const from = index * width
    const tail = capped && index === capIndex
    buckets.push({
      from,
      to: from + width,
      count: values.filter((value) => {
        const bucket = Math.max(0, Math.floor(value / width))
        return tail ? bucket >= capIndex : bucket === index
      }).length,
      ...(tail ? { tail: true } : {}),
    })
  }
  return buckets
}

/** Weekly boundaries ending at `now`, oldest first — the axis a flow chart is read on. */
export function weeklyBuckets(now: number, weeks: number): number[] {
  return Array.from({ length: weeks }, (_, i) => now - (weeks - 1 - i) * WEEK_MS)
}

/**
 * The start of a window, or `undefined` for all recorded history.
 *
 * A week is elapsed time, not a calendar week: two readings made a minute apart see different
 * boundaries, which is honest and keeps the implementation free of timezones.
 */
export function windowStart(window: FlowWindow, now = Date.now()): number | undefined {
  return window === 'all' ? undefined : now - window * WEEK_MS
}

/**
 * The weekly boundaries a reading draws.
 *
 * A fixed window is that many weeks back from now. All history starts at the oldest card the board
 * has, capped at two years: a board with a decade of moves should not draw a thousand slivers, and
 * the cap is stated on screen rather than silently changing the sample.
 */
export function bucketsFor(window: FlowWindow, records: FlowRecord[], now = Date.now()): number[] {
  if (window !== 'all') return weeklyBuckets(now, window)
  const earliest = records.reduce((oldest, record) => Math.min(oldest, record.createdAt), now)
  const weeks = Math.max(1, Math.min(MAX_ALL_WEEKS, Math.ceil((now - earliest) / WEEK_MS)))
  return weeklyBuckets(now, weeks)
}

/**
 * The delivered cards a window sees: resolved inside it, oldest first is the caller's business.
 *
 * A card created before the window but delivered inside it belongs to the window; one delivered
 * before it does not, however long its lead time was.
 */
export function deliveredSince(records: FlowRecord[], since?: number): FlowRecord[] {
  return records.filter((record) => record.resolvedAt !== undefined && (since === undefined || record.resolvedAt > since))
}

/** Items resolved in each bucket's own week: the week ending at that boundary, and not before. */
export function throughput(records: FlowRecord[], buckets: number[]): number[] {
  return buckets.map((b) =>
    records.filter((r) => r.resolvedAt !== undefined && r.resolvedAt > b - WEEK_MS && r.resolvedAt <= b).length,
  )
}

/**
 * Items per stage at each bucket boundary — the cumulative flow diagram.
 *
 * A card that did not exist yet is not in a column. A card filed away mid-flight left the flow
 * and is no longer counted; one filed away from Done was *delivered*, and delivery is a fact the
 * diagram keeps. Nothing is smoothed: a card that moves backwards moves backwards here too, which
 * is the whole reason to draw the diagram rather than a number.
 */
export function cumulativeFlow(records: FlowRecord[], buckets: number[]): Record<Stage, number>[] {
  return buckets.map((b) => {
    const counts = { backlog: 0, notStarted: 0, inProgress: 0, done: 0 } as Record<Stage, number>
    for (const r of records) {
      if (r.createdAt > b) continue
      const stage = stageAt(r, b)
      if (r.archivedAt !== undefined && r.archivedAt <= b && stage !== 'done') continue
      counts[stage] += 1
    }
    return counts
  })
}

/** The middle of a set of values, or the middle two averaged. Nothing in, nothing out. */
export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The value at a percentile (nearest rank) — the tail a median hides. */
export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}

/** A sample's middle and tail, with the count that makes the numbers readable. */
export interface SampleStats {
  n: number
  p50?: number
  p85?: number
  p95?: number
}

/** The middle and the tail of a set of values, in one place so every panel agrees. */
export function sampleStats(values: number[]): SampleStats {
  return {
    n: values.length,
    p50: median(values),
    p85: percentile(values, 85),
    p95: percentile(values, 95),
  }
}

export interface FlowSummary {
  /** Cards still moving at `now`. */
  inFlight: number
  /** Cards that reached Done, however long ago. */
  delivered: number
  lead: SampleStats
  cycle: SampleStats
}

/**
 * The four numbers a flow view leads with, over the cards it was given.
 *
 * `since` narrows the lead and cycle samples to work delivered inside the window; in flight and
 * delivered are always read at `now`, because they are the state of the board rather than a sample.
 */
export function flowSummary(records: FlowRecord[], now: number, since?: number): FlowSummary {
  const sample = deliveredSince(records, since)
  const lead = leadTimes(sample)
  const cycle = cycleTimes(sample)
  return {
    inFlight: records.filter((r) => inFlightAt(r, now)).length,
    delivered: records.filter((r) => stageAt(r, now) === 'done').length,
    lead: sampleStats(lead),
    cycle: sampleStats(cycle),
  }
}
