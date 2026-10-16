import type { RollupBucket } from './derive'
import { parseDay } from './filters'

/**
 * Laying a board's initiatives out over time, as pure arithmetic.
 *
 * This module places, it does not decide: the set of initiatives is the caller's (the same
 * board-local top-level set the dashboard and the initiatives workflow compute), and the colour
 * of a bar is carried in as a derived bucket — a fact from the work beneath, never a setting.
 * What it owns is the geometry: the visible day domain, the day offsets, the row packing, and
 * the month structure of the axis.
 *
 * An initiative with neither date is never placed at an invented day — it comes back in an
 * unscheduled tray. A single date marks one day. Two equal dates are a point, not a one-day
 * bar. Two dates backwards are shown as the span they evidently meant.
 */

/** One initiative, already scoped to the board, carrying its derived stage. */
export interface TimelineEntry {
  id: string
  title: string
  targetStartDate?: string
  targetEndDate?: string
  /** Derived from the work beneath via `rollupOf` — the only colour a bar may claim. */
  bucket: RollupBucket
}

export interface TimelineBar {
  id: string
  title: string
  /** A `span` covers a range of days; a `milestone` marks a single day. */
  kind: 'span' | 'milestone'
  /** Row index — packed so overlapping shapes never share a row. */
  row: number
  /** Day offset from the domain start (local midnight to local midnight, DST-safe). */
  start: number
  /** Exclusive end offset. A span covers its end date, so this is one past it; a milestone is zero-width. */
  end: number
  bucket: RollupBucket
}

/** One whole calendar month of the axis, positioned. */
export interface TimelineMonth {
  year: number
  /** 0-based, the `Date` convention. */
  month: number
  /** Day offset of the month's first day from the domain start. */
  start: number
  /** Calendar length in days. */
  days: number
}

export interface TimelineLayout {
  /** Day offsets are measured from this date. */
  start: Date
  totalDays: number
  bars: TimelineBar[]
  rowCount: number
  /** Initiatives with neither date. A tray, not a position. */
  unscheduled: TimelineEntry[]
  months: TimelineMonth[]
  /** Day offset of today, or null when today lies outside the domain. */
  today: number | null
}

export interface TimelineOptions {
  /** The day the today marker is drawn for; defaults to now. Tests inject a fixed day. */
  today?: Date
}

const DAY = 86_400_000

/** Local-midnight day difference — rounding absorbs the 23h and 25h days DST makes. */
const daysBetween = (a: Date, b: Date): number => Math.round((a.getTime() - b.getTime()) / DAY)

const monthLength = (year: number, month: number): number => new Date(year, month + 1, 0).getDate()

export function layoutTimeline(entries: readonly TimelineEntry[], options: TimelineOptions = {}): TimelineLayout {
  const source = options.today ?? new Date()
  const today = new Date(source.getFullYear(), source.getMonth(), source.getDate())

  // Parse once and normalise. `end` is inclusive for a span, equal to `start` for a milestone.
  const placed: Array<{
    entry: TimelineEntry
    index: number
    kind: 'span' | 'milestone'
    start: Date
    end: Date
  }> = []
  const unscheduled: TimelineEntry[] = []

  entries.forEach((entry, index) => {
    const s = parseDay(entry.targetStartDate)
    const e = parseDay(entry.targetEndDate)
    if (!s && !e) {
      unscheduled.push(entry)
    } else if (s && e) {
      if (s.getTime() === e.getTime()) placed.push({ entry, index, kind: 'milestone', start: s, end: s })
      else if (s < e) placed.push({ entry, index, kind: 'span', start: s, end: e })
      else placed.push({ entry, index, kind: 'span', start: e, end: s })
    } else {
      const day = (s ?? e)!
      placed.push({ entry, index, kind: 'milestone', start: day, end: day })
    }
  })

  // The domain is the data's own span, widened to whole months so the axis starts and ends
  // on a boundary and every month in it is complete. With nothing scheduled, it is the
  // current month — an empty board still deserves an axis.
  let start: Date
  let endExclusive: Date
  if (placed.length > 0) {
    const earliest = placed.reduce((m, p) => (p.start < m ? p.start : m), placed[0].start)
    const latest = placed.reduce((m, p) => (p.end > m ? p.end : m), placed[0].end)
    start = new Date(earliest.getFullYear(), earliest.getMonth(), 1)
    endExclusive = new Date(latest.getFullYear(), latest.getMonth() + 1, 1)
  } else {
    start = new Date(today.getFullYear(), today.getMonth(), 1)
    endExclusive = new Date(today.getFullYear(), today.getMonth() + 1, 1)
  }
  const totalDays = daysBetween(endExclusive, start)

  const months: TimelineMonth[] = []
  for (let y = start.getFullYear(), m = start.getMonth(); new Date(y, m, 1) < endExclusive; ) {
    months.push({ year: y, month: m, start: daysBetween(new Date(y, m, 1), start), days: monthLength(y, m) })
    m += 1
    if (m > 11) {
      m = 0
      y += 1
    }
  }

  const todayOffset = daysBetween(today, start)

  // Pack greedily: everything in start order, longest first on ties, into the first row
  // whose last shape has finished. Deterministic, and good enough that rows stay few.
  const shapes = placed.map((p) => ({
    entry: p.entry,
    index: p.index,
    kind: p.kind,
    start: daysBetween(p.start, start),
    end: p.kind === 'span' ? daysBetween(p.end, start) + 1 : daysBetween(p.start, start),
  }))
  const order = shapes
    .map((_, i) => i)
    .sort(
      (a, b) =>
        shapes[a].start - shapes[b].start || shapes[b].end - shapes[a].end || shapes[a].index - shapes[b].index,
    )
  const rowEnds: number[] = []
  const bars: TimelineBar[] = []
  for (const i of order) {
    const shape = shapes[i]
    let row = rowEnds.findIndex((end) => end <= shape.start)
    if (row === -1) {
      row = rowEnds.length
      rowEnds.push(0)
    }
    rowEnds[row] = Math.max(rowEnds[row], shape.end)
    bars.push({
      id: shape.entry.id,
      title: shape.entry.title,
      kind: shape.kind,
      row,
      start: shape.start,
      end: shape.end,
      bucket: shape.entry.bucket,
    })
  }
  bars.sort((a, b) => a.row - b.row || a.start - b.start || a.end - b.end)

  return {
    start,
    totalDays,
    bars,
    rowCount: rowEnds.length,
    unscheduled,
    months,
    today: todayOffset >= 0 && todayOffset < totalDays ? todayOffset : null,
  }
}
