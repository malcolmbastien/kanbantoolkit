import { describe, expect, it } from 'vitest'
import {
  MAX_ALL_WEEKS,
  bucketsFor,
  committedAt,
  cumulativeFlow,
  cycleTimes,
  deliveredSince,
  flowRecord,
  flowSummary,
  inFlightAt,
  leadTimes,
  median,
  percentile,
  stageAt,
  throughput,
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
    expect(s.lead).toEqual({ median: 15, p85: 30, count: 4 })
    expect(s.cycle).toEqual({ median: 15, p85: 30, count: 4 })
    // Even counts average the middle two: 10, 20, 30, 40 → 25.
    expect(median([10, 40, 20, 30])).toBe(25)
    expect(percentile([10, 20, 30, 40], 50)).toBe(20)
    expect(median([])).toBeUndefined()
    expect(percentile([], 85)).toBeUndefined()
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
    expect(all.lead.count).toBe(2)
    expect(all.inFlight).toBe(1)
    expect(all.delivered).toBe(2)

    const windowed = flowSummary(records, T, windowStart(4, T))
    expect(windowed.lead.count).toBe(1)
    expect(windowed.lead.median).toBe(18)
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
