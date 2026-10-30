import { describe, expect, it } from 'vitest'
import {
  MAX_ALL_WEEKS,
  aging,
  averageWip,
  blockedRuns,
  blockedSummary,
  bucketsFor,
  committedAt,
  cumulativeFlow,
  cycleTimes,
  deliveredSince,
  flowRecord,
  firstRecordedMove,
  flowSummary,
  forecastBy,
  forecastWhen,
  histogram,
  inFlightAt,
  leadTimes,
  littleCycle,
  METRICS_CSV_HEADER,
  metricsCsv,
  moveCoverage,
  openScope,
  median,
  percentile,
  sampleStats,
  scatterPoints,
  serviceLevel,
  stageAt,
  throughput,
  throughputRate,
  weeklyBuckets,
  windowStart,
  type FlowRecord,
  type StageMove,
} from './metrics'
import type { Item, Stage } from './types'

const DAY = 86_400_000
/** A fixed "now" — Sat 17 Oct 2026, the demo's today. */
const T = Date.UTC(2026, 9, 17, 12)

const move = (at: number, to: Stage, from?: Stage): StageMove => ({ at, to, ...(from ? { from } : {}) })
const rec = (over: Partial<FlowRecord> = {}): FlowRecord => ({
  id: 'r1',
  title: 'Card',
  createdAt: T - 30 * DAY,
  startedIn: 'backlog',
  moves: [],
  blocks: [],
  blockedNow: false,
  ...over,
})

describe('flow metrics', () => {
  it('reads a card\'s log into stages, ignoring everything that is not a move', () => {
    const item: Item = {
      id: 'c1',
      title: 'Card',
      typeId: 't-story',
      createdAt: T - 30 * DAY,
      resolvedAt: T - 5 * DAY,
      log: [
        { id: 'l1', at: T - 30 * DAY, kind: 'created' },
        { id: 'l2', at: T - 20 * DAY, kind: 'moved', toStage: 'inProgress', fromStage: 'backlog' },
        { id: 'l3', at: T - 18 * DAY, kind: 'blocked', note: 'waiting' },
        { id: 'l4', at: T - 5 * DAY, kind: 'moved', toStage: 'done' },
        // An entry with no stage at all (written before stages were recorded) is not a move here.
        { id: 'l5', at: T - 4 * DAY, kind: 'moved' },
      ],
    }
    const r = flowRecord(item, 'done')
    expect(r.moves.map((m) => [m.at, m.to])).toEqual([
      [T - 20 * DAY, 'inProgress'],
      [T - 5 * DAY, 'done'],
    ])
    expect(r.startedIn).toBe('backlog')
    expect(r.resolvedAt).toBe(T - 5 * DAY)
  })

  it('a card that has never moved started where it sits; one that has knows from its first entry', () => {
    expect(flowRecord({ id: 'a', title: 'A', typeId: 't-story', createdAt: T }, 'inProgress').startedIn).toBe('inProgress')
    expect(flowRecord({ id: 'b', title: 'B', typeId: 't-story', createdAt: T }, undefined).startedIn).toBe('backlog')
    const moved = rec({ moves: [move(T - 10 * DAY, 'notStarted', 'backlog')], startedIn: 'notStarted' })
    expect(moved.startedIn).toBe('notStarted')
  })

  it('stageAt reads the last move at or before the moment', () => {
    const r = rec({
      createdAt: T - 30 * DAY,
      moves: [move(T - 20 * DAY, 'notStarted', 'backlog'), move(T - 10 * DAY, 'inProgress', 'notStarted'), move(T - 2 * DAY, 'done', 'inProgress')],
    })
    expect(stageAt(r, T - 25 * DAY)).toBe('backlog')
    expect(stageAt(r, T - 20 * DAY)).toBe('notStarted') // inclusive: the moment it landed
    expect(stageAt(r, T - 9 * DAY)).toBe('inProgress')
    expect(stageAt(r, T)).toBe('done')
  })

  it('lead time is created to resolved; cycle time is first committed to resolved', () => {
    const resolved = rec({
      createdAt: T - 30 * DAY,
      resolvedAt: T - 5 * DAY,
      startedIn: 'notStarted', // created straight into a committed column
    })
    expect(committedAt(resolved)).toBe(T - 30 * DAY)
    expect(leadTimes([resolved])).toEqual([25])
    expect(cycleTimes([resolved])).toEqual([25])

    // Committed later: the lead includes the wait, the cycle does not.
    const waited = rec({ createdAt: T - 30 * DAY, resolvedAt: T - 5 * DAY, moves: [move(T - 20 * DAY, 'notStarted', 'backlog')] })
    expect(leadTimes([waited])).toEqual([25])
    expect(cycleTimes([waited])).toEqual([15])

    // Never resolved: no lead and no cycle — a missing number, not a zero.
    const open = rec({ createdAt: T - 30 * DAY, moves: [move(T - 20 * DAY, 'inProgress', 'backlog')] })
    expect(leadTimes([open])).toEqual([])
    expect(cycleTimes([open])).toEqual([])

    // Straight from Backlog to Done: the only evidence it entered the flow is the Done move, so
    // the cycle is short rather than missing — the wait in the queue is what lead time measures.
    const jumped = rec({ createdAt: T - 30 * DAY, resolvedAt: T - 5 * DAY, moves: [move(T - 6 * DAY, 'done', 'backlog')] })
    expect(committedAt(jumped)).toBe(T - 6 * DAY)
    expect(leadTimes([jumped])).toEqual([25])
    expect(cycleTimes([jumped])).toEqual([1])
  })

  it('a card that moved back and forth is timed from its first commit to its last resolve', () => {
    const r = rec({
      createdAt: T - 40 * DAY,
      resolvedAt: T - 2 * DAY,
      moves: [
        move(T - 35 * DAY, 'inProgress', 'backlog'),
        move(T - 20 * DAY, 'done', 'inProgress'),
        move(T - 12 * DAY, 'inProgress', 'done'), // rejected after review
        move(T - 2 * DAY, 'done', 'inProgress'),
      ],
    })
    expect(cycleTimes([r])).toEqual([33]) // first commit → the delivery that stuck
    expect(stageAt(r, T - 15 * DAY)).toBe('done')
    expect(stageAt(r, T - 5 * DAY)).toBe('inProgress') // rejected after review, and it shows
    expect(stageAt(r, T)).toBe('done')
  })

  it('throughput counts resolutions in each week of the window, and only in it', () => {
    const buckets = weeklyBuckets(T, 3)
    expect(buckets).toEqual([T - 14 * DAY, T - 7 * DAY, T])
    const records = [
      rec({ id: 'a', resolvedAt: T - 1 * DAY }),
      rec({ id: 'b', resolvedAt: T - 3 * DAY }),
      rec({ id: 'c', resolvedAt: T - 8 * DAY }),
      rec({ id: 'd', resolvedAt: T - 30 * DAY }), // before the window
      rec({ id: 'e' }), // never resolved
    ]
    expect(throughput(records, buckets)).toEqual([0, 1, 2])
  })

  it('the cumulative flow diagram counts where the work is at each boundary', () => {
    const buckets = weeklyBuckets(T, 3) // T-14, T-7, T
    const records = [
      // Skipped a stage: Backlog straight to In Progress.
      rec({ id: 'skip', createdAt: T - 20 * DAY, moves: [move(T - 13 * DAY, 'inProgress', 'backlog')] }),
      // Moved backwards: delivered, then back to In Progress.
      rec({ id: 'back', createdAt: T - 25 * DAY, moves: [move(T - 20 * DAY, 'done', 'backlog'), move(T - 6 * DAY, 'inProgress', 'done')] }),
      // Filed away mid-flight: it left the flow, so it stops being counted.
      rec({ id: 'dropped', createdAt: T - 25 * DAY, archivedAt: T - 8 * DAY, moves: [move(T - 20 * DAY, 'inProgress', 'backlog')] }),
      // Filed away from Done: delivered is a fact the diagram keeps.
      rec({ id: 'filed', createdAt: T - 30 * DAY, resolvedAt: T - 10 * DAY, archivedAt: T - 9 * DAY, moves: [move(T - 10 * DAY, 'done', 'backlog')] }),
      // Not created yet at the first boundary.
      rec({ id: 'later', createdAt: T - 5 * DAY, startedIn: 'notStarted' }),
    ]
    expect(cumulativeFlow(records, buckets)).toEqual([
      // skip has not moved yet, dropped is in flight, filed is still queued, back is delivered
      { backlog: 2, notStarted: 0, inProgress: 1, done: 1 },
      // skip started, dropped left the flow, filed was delivered, back is still delivered
      { backlog: 0, notStarted: 0, inProgress: 1, done: 2 },
      // back was rejected into progress, later arrived — and nothing is smoothed away
      { backlog: 0, notStarted: 1, inProgress: 2, done: 1 },
    ])
  })

  it('in flight is neither delivered nor filed away', () => {
    expect(inFlightAt(rec({ moves: [move(T - 1 * DAY, 'inProgress', 'backlog')] }), T)).toBe(true)
    expect(inFlightAt(rec({ resolvedAt: T - 1 * DAY, moves: [move(T - 1 * DAY, 'done', 'backlog')] }), T)).toBe(false)
    expect(inFlightAt(rec({ archivedAt: T - 1 * DAY, moves: [move(T - 5 * DAY, 'inProgress', 'backlog')] }), T)).toBe(false)
  })

  it('the summary leads with the middle and the tail, and says how many cards it saw', () => {
    const records = [
      rec({ id: 'a', createdAt: T - 20 * DAY, resolvedAt: T - 10 * DAY, startedIn: 'notStarted', moves: [move(T - 10 * DAY, 'done', 'notStarted')] }), // lead 10, cycle 10
      rec({ id: 'b', createdAt: T - 30 * DAY, resolvedAt: T - 10 * DAY, startedIn: 'notStarted', moves: [move(T - 10 * DAY, 'done', 'notStarted')] }), // lead 20, cycle 20
      rec({ id: 'c', createdAt: T - 40 * DAY, resolvedAt: T - 10 * DAY, startedIn: 'notStarted', moves: [move(T - 10 * DAY, 'done', 'notStarted')] }), // lead 30, cycle 30
      rec({ id: 'open', createdAt: T - 5 * DAY, moves: [move(T - 3 * DAY, 'inProgress', 'backlog')] }),
      rec({ id: 'done', createdAt: T - 60 * DAY, resolvedAt: T - 50 * DAY, startedIn: 'notStarted', moves: [move(T - 50 * DAY, 'done', 'notStarted')] }), // lead 10
    ]
    const s = flowSummary(records, T)
    expect(s.inFlight).toBe(1)
    expect(s.delivered).toBe(4)
    expect(s.lead).toEqual({ n: 4, p50: 15, p85: 30, p95: 30 })
    expect(s.cycle).toEqual({ n: 4, p50: 15, p85: 30, p95: 30 })
    // Even counts average the middle two: 10, 20, 30, 40 → 25.
    expect(median([10, 40, 20, 30])).toBe(25)
    expect(percentile([10, 20, 30, 40], 50)).toBe(20)
    expect(median([])).toBeUndefined()
    expect(percentile([], 85)).toBeUndefined()
    expect(sampleStats([])).toEqual({ n: 0, p50: undefined, p85: undefined, p95: undefined })
    expect(sampleStats([10, 20, 30, 40])).toEqual({ n: 4, p50: 25, p85: 40, p95: 40 })
  })
})


describe("the Flow view's window", () => {
  it('a fixed window starts that many weeks back; all history has no start', () => {
    expect(windowStart(4, T)).toBe(T - 4 * 7 * DAY)
    expect(windowStart(12, T)).toBe(T - 12 * 7 * DAY)
    expect(windowStart('all', T)).toBeUndefined()
  })

  it('draws one bucket per week, and starts all history at the oldest card', () => {
    const fixed = bucketsFor(4, [], T)
    expect(fixed).toHaveLength(4)
    expect(fixed[fixed.length - 1]).toBe(T)
    expect(fixed[0]).toBe(T - 3 * 7 * DAY)

    // The oldest card is 30 days back: five weekly boundaries, the last one now.
    const all = bucketsFor('all', [rec({ createdAt: T - 30 * DAY }), rec({ createdAt: T - 2 * DAY })], T)
    expect(all).toHaveLength(5)
    expect(all[all.length - 1]).toBe(T)

    // A decade of history is still two years of buckets, and no more.
    const capped = bucketsFor('all', [rec({ createdAt: T - 900 * DAY })], T)
    expect(capped).toHaveLength(MAX_ALL_WEEKS)
  })

  it("the window narrows the delivery sample, not the board's state now", () => {
    const records = [
      rec({ id: 'inside', createdAt: T - 20 * DAY, resolvedAt: T - 2 * DAY, moves: [move(T - 2 * DAY, 'done', 'notStarted')] }),
      rec({ id: 'before', createdAt: T - 60 * DAY, resolvedAt: T - 40 * DAY, moves: [move(T - 40 * DAY, 'done', 'notStarted')] }),
      rec({ id: 'open', createdAt: T - 5 * DAY, moves: [move(T - 3 * DAY, 'inProgress', 'backlog')] }),
    ]
    const all = flowSummary(records, T)
    expect(all.lead.n).toBe(2)
    expect(all.inFlight).toBe(1)
    expect(all.delivered).toBe(2)

    const windowed = flowSummary(records, T, windowStart(4, T))
    expect(windowed.lead.n).toBe(1)
    expect(windowed.lead.p50).toBe(18)
    // Still a fact about the board now, however narrow the delivery sample is.
    expect(windowed.inFlight).toBe(1)
    expect(windowed.delivered).toBe(2)
  })

  it('deliveredSince keeps exactly the cards resolved after the start', () => {
    const records = [
      rec({ id: 'in', resolvedAt: T - 1 * DAY }),
      rec({ id: 'out', resolvedAt: T - 30 * DAY }),
      rec({ id: 'open' }),
    ]
    expect(deliveredSince(records, T - 7 * DAY).map((r) => r.id)).toEqual(['in'])
    expect(deliveredSince(records).map((r) => r.id)).toEqual(['in', 'out'])
  })
})

describe('the cycle time scatter', () => {
  it('draws delivered cards in the window, oldest completion first', () => {
    const records = [
      rec({
        id: 'later',
        title: 'Later',
        createdAt: T - 20 * DAY,
        resolvedAt: T - 2 * DAY,
        moves: [move(T - 12 * DAY, 'inProgress', 'backlog'), move(T - 2 * DAY, 'done', 'inProgress')],
      }),
      rec({
        id: 'earlier',
        title: 'Earlier',
        createdAt: T - 30 * DAY,
        resolvedAt: T - 10 * DAY,
        moves: [move(T - 20 * DAY, 'inProgress', 'backlog'), move(T - 10 * DAY, 'done', 'inProgress')],
      }),
      rec({ id: 'before', resolvedAt: T - 40 * DAY, moves: [move(T - 40 * DAY, 'done', 'backlog')] }),
      rec({ id: 'open', createdAt: T - 5 * DAY }),
    ]

    const points = scatterPoints(records, T - 14 * DAY)
    expect(points.map((p) => p.id)).toEqual(['earlier', 'later'])
    expect(points[0]).toMatchObject({ lead: 20, cycle: 10 })
    expect(points[1]).toMatchObject({ lead: 18, cycle: 10 })
    // All history sees the one delivered before the window too.
    expect(scatterPoints(records).map((p) => p.id)).toEqual(['before', 'earlier', 'later'])
  })

  it('skips a resolved card whose history never left Backlog: it has no cycle to plot', () => {
    const inconsistent = rec({ id: 'no-commit', resolvedAt: T - 2 * DAY, moves: [] })
    expect(scatterPoints([inconsistent])).toEqual([])
  })
})

describe('aging work', () => {
  it('ages open cards from the placement stamp, then the last move, then creation', () => {
    const stamped = rec({ id: 'stamped', createdAt: T - 30 * DAY, moves: [move(T - 10 * DAY, 'inProgress', 'backlog')] })
    const moved = rec({ id: 'moved', createdAt: T - 30 * DAY, moves: [move(T - 6 * DAY, 'inProgress', 'backlog')] })
    const fresh = rec({ id: 'fresh', createdAt: T - 4 * DAY, moves: [] })
    const entries = aging([stamped, moved, fresh], T, (record) => (record.id === 'stamped' ? T - 2 * DAY : undefined))

    const byId = new Map(entries.map((entry) => [entry.id, entry]))
    expect(byId.get('stamped')?.daysInColumn).toBe(2)
    expect(byId.get('stamped')?.daysSinceCommit).toBe(10)
    expect(byId.get('moved')?.daysInColumn).toBe(6)
    expect(byId.get('fresh')?.daysInColumn).toBe(4)
    // Never left Backlog: open, but not committed, so there is no cycle clock.
    expect(byId.get('fresh')?.daysSinceCommit).toBeUndefined()
  })

  it('leaves out done work and work filed away, and marks what has not moved', () => {
    const done = rec({ id: 'done', resolvedAt: T - DAY, moves: [move(T - DAY, 'done', 'inProgress')] })
    const filed = rec({ id: 'filed', archivedAt: T - 2 * DAY, moves: [move(T - 20 * DAY, 'inProgress', 'backlog')] })
    const still = rec({ id: 'still', createdAt: T - 20 * DAY, moves: [move(T - 20 * DAY, 'inProgress', 'backlog')] })
    const entries = aging([done, filed, still], T)
    expect(entries.map((entry) => entry.id)).toEqual(['still'])
    expect(entries[0].stalled).toBe(true)
  })

  it('orders the oldest commitment first', () => {
    const young = rec({ id: 'young', createdAt: T - 5 * DAY, moves: [move(T - 3 * DAY, 'inProgress', 'backlog')] })
    const old = rec({ id: 'old', createdAt: T - 40 * DAY, moves: [move(T - 35 * DAY, 'inProgress', 'backlog')] })
    const waiting = rec({ id: 'waiting', createdAt: T - 60 * DAY, moves: [] })
    expect(aging([young, old, waiting], T).map((entry) => entry.id)).toEqual(['old', 'young', 'waiting'])
  })
})

describe('blocked work', () => {
  it('pairs blocked and unblocked entries, and leaves an open run open', () => {
    const item: Item = {
      id: 'b1',
      title: 'Blocked card',
      typeId: 't-task',
      createdAt: T - 30 * DAY,
      blocked: true,
      blockedReason: 'Waiting on legal',
      log: [
        // An unblocked with nothing open, and an unrelated note, are not runs.
        { id: 'l0', at: T - 12 * DAY, kind: 'unblocked' },
        { id: 'l1', at: T - 10 * DAY, kind: 'blocked', note: 'Waiting on legal' },
        { id: 'l2', at: T - 8 * DAY, kind: 'unblocked' },
        { id: 'l3', at: T - 3 * DAY, kind: 'blocked', note: 'Waiting on legal' },
        { id: 'l4', at: T - 1 * DAY, kind: 'noted', note: 'ping' },
      ],
    }
    const record = flowRecord(item, 'inProgress')
    expect(record.blocks).toEqual([
      { from: T - 10 * DAY, to: T - 8 * DAY, reason: 'Waiting on legal' },
      { from: T - 3 * DAY, reason: 'Waiting on legal' },
    ])
    expect(blockedRuns(record, T)[1]).toMatchObject({ from: T - 3 * DAY, to: T, open: true })
  })

  it('counts blocked time inside the window, and says what is blocked now', () => {
    const open = rec({
      id: 'open',
      createdAt: T - 20 * DAY,
      blockedNow: true,
      blocks: [{ from: T - 4 * DAY, reason: 'Waiting on legal' }],
      moves: [move(T - 15 * DAY, 'inProgress', 'backlog')],
    })
    const closed = rec({
      id: 'closed',
      createdAt: T - 30 * DAY,
      blocks: [{ from: T - 20 * DAY, to: T - 15 * DAY, reason: 'Waiting on legal' }],
      moves: [move(T - 25 * DAY, 'inProgress', 'backlog')],
    })
    const summary = blockedSummary([open, closed], T, T - 7 * DAY)
    expect(summary.now.map((row) => row.id)).toEqual(['open'])
    expect(summary.now[0].days).toBe(4)
    // Only the open run intersects the last seven days.
    expect(summary.runs).toBe(1)
    expect(summary.totalDays).toBe(4)
    expect(summary.reasons).toEqual([{ reason: 'Waiting on legal', count: 1 }])
  })

  it('stops blocked time when the card is done, and counts a flagged card with no log', () => {
    const done = rec({
      id: 'done',
      resolvedAt: T - 1 * DAY,
      blockedNow: true,
      blocks: [{ from: T - 5 * DAY }],
      moves: [move(T - 1 * DAY, 'done', 'inProgress')],
    })
    const legacy = rec({
      id: 'legacy',
      createdAt: T - 20 * DAY,
      blockedNow: true,
      blockedReason: 'Awaiting capacity review',
      moves: [move(T - 15 * DAY, 'inProgress', 'backlog')],
    })
    const summary = blockedSummary([done, legacy], T)
    // The done card is not in flight, so it is not blocked now, and its run ended at Done.
    expect(summary.now.map((row) => row.id)).toEqual(['legacy'])
    expect(summary.now[0].days).toBeUndefined()
    expect(summary.now[0].reason).toBe('Awaiting capacity review')
    expect(summary.totalDays).toBe(4)
  })

  it('groups reasons ignoring case, and keeps only the top five', () => {
    const make = (id: string, reason: string, from: number) =>
      rec({ id, blocks: [{ from, to: from + DAY, reason }], moves: [move(from - DAY, 'inProgress', 'backlog')] })
    const records = [
      make('a', 'Waiting on legal', T - 10 * DAY),
      make('b', 'waiting on LEGAL', T - 9 * DAY),
      make('c', 'Security review', T - 8 * DAY),
      make('d', 'Vendor', T - 7 * DAY),
      make('e', 'Budget', T - 6 * DAY),
      make('f', 'Design', T - 5 * DAY),
      make('g', 'Capacity', T - 4 * DAY),
    ]
    const summary = blockedSummary(records, T)
    expect(summary.reasons[0]).toEqual({ reason: 'Waiting on legal', count: 2 })
    expect(summary.reasons).toHaveLength(5)
  })
})

describe('the histograms', () => {
  it('counts whole days, keeps the empty buckets, and folds the tail into one', () => {
    const buckets = histogram([0, 0.4, 1, 1.9, 2, 60, 61, 100], 1, 60)
    expect(buckets[0]).toEqual({ from: 0, to: 1, count: 2 })
    expect(buckets[1]).toEqual({ from: 1, to: 2, count: 2 })
    expect(buckets[2]).toEqual({ from: 2, to: 3, count: 1 })
    // Days 3–59 are present with nothing in them, because the gap is part of the shape.
    expect(buckets).toHaveLength(61)
    expect(buckets[3]).toEqual({ from: 3, to: 4, count: 0 })
    expect(buckets[60]).toEqual({ from: 60, to: 61, count: 3, tail: true })
  })

  it('groups into wider buckets and answers nothing for an empty sample', () => {
    expect(histogram([0, 1, 2, 3], 2)).toEqual([
      { from: 0, to: 2, count: 2 },
      { from: 2, to: 4, count: 2 },
    ])
    expect(histogram([])).toEqual([])
  })
})

describe("Little's Law", () => {
  it('averages committed WIP over the boundaries, leaving Backlog and Done out', () => {
    const buckets = weeklyBuckets(T, 3)
    const records = [
      // Committed throughout: one card in progress.
      rec({ id: 'in', createdAt: T - 30 * DAY, moves: [move(T - 25 * DAY, 'inProgress', 'backlog')] }),
      rec({ id: 'waiting', createdAt: T - 30 * DAY, moves: [move(T - 25 * DAY, 'notStarted', 'backlog')] }),
      rec({ id: 'backlog', createdAt: T - 30 * DAY }),
      rec({ id: 'done', resolvedAt: T - 20 * DAY, moves: [move(T - 20 * DAY, 'done', 'notStarted')] }),
    ]
    // In Progress and Not Started are both committed work; Backlog and Done are not.
    expect(averageWip(records, buckets)).toBe(2)
  })

  it('turns deliveries into a rate, and refuses to imply a cycle from no throughput', () => {
    const records = [
      rec({ id: 'a', resolvedAt: T - 5 * DAY }),
      rec({ id: 'b', resolvedAt: T - 3 * DAY }),
      rec({ id: 'old', resolvedAt: T - 30 * DAY }),
    ]
    expect(throughputRate(records, T - 7 * DAY, T)).toBeCloseTo(2 / 7)
    expect(throughputRate(records, T, T)).toBeUndefined()
    expect(littleCycle(10, 2)).toBe(5)
    expect(littleCycle(10, 0)).toBeUndefined()
    expect(littleCycle(10, undefined)).toBeUndefined()
  })
})

describe('how much history there is', () => {
  it('names the first move and how many cards have any', () => {
    const moved = rec({ id: 'moved', moves: [move(T - 20 * DAY, 'inProgress', 'backlog'), move(T - 5 * DAY, 'done', 'inProgress')] })
    const still = rec({ id: 'still' })
    expect(firstRecordedMove([moved, still])).toBe(T - 20 * DAY)
    expect(firstRecordedMove([still])).toBeUndefined()
    expect(moveCoverage([moved, still])).toEqual({ withMoves: 1, total: 2 })
    expect(moveCoverage([])).toEqual({ withMoves: 0, total: 0 })
  })
})

describe('the service level expectation', () => {
  it('reads the chosen share of the cycle times in the window', () => {
    const make = (id: string, days: number, resolvedAt: number) =>
      rec({
        id,
        createdAt: T - 60 * DAY,
        resolvedAt,
        moves: [move(resolvedAt - days * DAY, 'inProgress', 'backlog'), move(resolvedAt, 'done', 'inProgress')],
      })
    const records = [
      make('a', 2, T - 10 * DAY),
      make('b', 4, T - 9 * DAY),
      make('c', 6, T - 8 * DAY),
      make('d', 8, T - 7 * DAY),
      make('old', 20, T - 60 * DAY),
    ]
    expect(serviceLevel(records, T - 14 * DAY, 50)).toEqual({ share: 50, days: 4, n: 4 })
    expect(serviceLevel(records, T - 14 * DAY, 85)).toEqual({ share: 85, days: 8, n: 4 })
    // All history includes the old card.
    expect(serviceLevel(records, undefined, 85)).toEqual({ share: 85, days: 20, n: 5 })
    expect(serviceLevel([], undefined)).toEqual({ share: 85, days: undefined, n: 0 })
  })
})

describe('the forecast', () => {
  const weeks = (n: number) => weeklyBuckets(T, n)

  it('turns a constant throughput into an exact completion week', () => {
    const forecast = forecastWhen(10, [2, 2, 2, 2, 2, 2, 2, 2], T, { trials: 50 })
    expect(forecast.ok).toBe(true)
    if (!forecast.ok) return
    expect(forecast.weeks).toEqual({ p50: 5, p85: 5, p95: 5 })
    expect(forecast.dates.p85).toBe(T + 5 * 7 * DAY)
    expect(forecast.trials).toBe(50)
  })

  it('answers the same way twice, and keeps the percentiles in order', () => {
    const first = forecastWhen(12, [0, 1, 2, 3, 4], T, { trials: 500, seed: 7 })
    const second = forecastWhen(12, [0, 1, 2, 3, 4], T, { trials: 500, seed: 7 })
    expect(first).toEqual(second)
    if (!first.ok) throw new Error('expected a forecast')
    expect(first.weeks.p50).toBeLessThanOrEqual(first.weeks.p85!)
    expect(first.weeks.p85).toBeLessThanOrEqual(first.weeks.p95!)
    expect(first.dates.p50).toBe(T + first.weeks.p50! * 7 * DAY)
  })

  it('refuses with the reason, not with a number', () => {
    expect(forecastWhen(0, [1, 2, 3, 4], T)).toMatchObject({ ok: false, reason: 'no-scope' })
    expect(forecastWhen(5, [0, 0, 0, 0], T)).toMatchObject({ ok: false, reason: 'no-throughput' })
    expect(forecastWhen(5, [1, 1, 1], T)).toMatchObject({ ok: false, reason: 'thin-history' })
    expect(forecastWhen(5, [1, 1, 1, 1, 1], T)).toMatchObject({ ok: false, reason: 'thin-history', delivered: 5 })
  })

  it('counts only committed open cards unless Backlog is asked for', () => {
    const records = [
      rec({ id: 'backlog', createdAt: T - 10 * DAY }),
      rec({ id: 'committed', createdAt: T - 10 * DAY, moves: [move(T - 5 * DAY, 'inProgress', 'backlog')] }),
      rec({ id: 'done', resolvedAt: T - DAY, moves: [move(T - DAY, 'done', 'inProgress')] }),
    ]
    expect(openScope(records, T)).toBe(1)
    expect(openScope(records, T, true)).toBe(2)
    expect(weeks(4)).toHaveLength(4) // the helper used above matches the bucket axis
  })
})

describe('how many by a date', () => {
  it('counts the deliveries the same model makes by the date', () => {
    const horizon = 5 * 7 * DAY
    const byDate = forecastBy(10, [2, 2, 2, 2, 2, 2, 2, 2], T, T + horizon, { trials: 50 })
    expect(byDate.ok).toBe(true)
    if (!byDate.ok) return
    expect(byDate.counts).toEqual({ p50: 10, p85: 10, p95: 10 })
    expect(byDate.share).toBe(1)

    const sooner = forecastBy(10, [2, 2, 2, 2, 2, 2, 2, 2], T, T + 2 * 7 * DAY, { trials: 50 })
    if (!sooner.ok) throw new Error('expected an answer')
    expect(sooner.counts).toEqual({ p50: 4, p85: 4, p95: 4 })
    expect(sooner.share).toBe(0)
    expect(forecastBy(10, [2, 2, 2, 2, 2, 2, 2, 2], T, T + 2 * 7 * DAY, { atLeast: 4 }).ok).toBe(true)
  })

  it('refuses a date that has passed and the same thin histories as the when-forecast', () => {
    expect(forecastBy(5, [1, 2, 3, 4], T, T - DAY)).toMatchObject({ ok: false, reason: 'past-date' })
    expect(forecastBy(0, [1, 2, 3, 4], T, T + DAY)).toMatchObject({ ok: false, reason: 'no-scope' })
    expect(forecastBy(5, [0, 0, 0, 0], T, T + DAY)).toMatchObject({ ok: false, reason: 'no-throughput' })
    expect(forecastBy(5, [1, 1, 1], T, T + DAY)).toMatchObject({ ok: false, reason: 'thin-history' })
  })
})

describe('the Flow export', () => {
  it('writes the delivered rows, quoting what needs quoting and leaving ids out', () => {
    const csv = metricsCsv([
      {
        title: 'Fix, "urgent" bug',
        type: 'Bug',
        flow: 'Cards',
        createdAt: Date.UTC(2026, 9, 1),
        committedAt: Date.UTC(2026, 9, 2),
        resolvedAt: Date.UTC(2026, 9, 5),
        lead: 4,
        cycle: 3,
        blockedDays: 1.25,
      },
    ])
    const [header, row] = csv.trimEnd().split('\r\n')
    expect(header).toBe('Title,Type,Flow,Created,Committed,Done,Lead days,Cycle days,Blocked days')
    expect(row).toContain('"Fix, ""urgent"" bug"')
    expect(row).toContain('2026-10-05T00:00:00.000Z')
    expect(row).toContain('1.3')
    expect(header).not.toContain('Id')
    expect(header).toBe(METRICS_CSV_HEADER.join(','))
  })

  it('answers the header alone for an empty sample', () => {
    expect(metricsCsv([]).trimEnd()).toBe(METRICS_CSV_HEADER.join(','))
  })
})
