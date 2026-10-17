import type { RollupBucket } from './derive'
import { parseDay } from './filters'

/**
 * Laying a board's initiatives out over time, as pure arithmetic.
 *
 * This module places, it does not decide: the set of initiatives is the caller's (the same
 * board-local top-level set the dashboard and the initiatives workflow compute), and the colour
 * of a bar is carried in as a derived bucket — a fact from the work beneath, never a setting.
 * What it owns is the geometry: the visible day domain, the day offsets, one row per scheduled
 * initiative, and the month structure of the axis.
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
  /** A milestone's single date: a start alone, an end alone, or both on the same day. */
  from?: 'start' | 'end' | 'both'
  /** The day a milestone marks, or a span's first day — ISO, as laid out: a backwards span is
   * labelled in the order it renders, not the order it was typed. */
  dateIso: string
  /** A span's last day (inclusive), ISO. A milestone has none. */
  endIso?: string
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

/**
 * One day of the axis — the tick row, and the calendar facts that make it readable.
 *
 * The day numbers are the axis's own, so they are the layout's to answer: the surface must not
 * construct a date to label a column, or a boundary could be marked on a day the domain does
 * not contain. `monthStart` is where the axis restates the month; `weekend` lets a target read
 * against the working week.
 */
export interface TimelineDay {
  /** Day offset from the domain start. */
  offset: number
  /** The day itself, ISO — the surface prints it, it does not build it. */
  dateIso: string
  /** Day of the month, 1–31: the number the tick prints. */
  day: number
  /** The first of a calendar month. */
  monthStart: boolean
  /** Saturday or Sunday. */
  weekend: boolean
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
  /** Every day of the axis, in order. */
  days: TimelineDay[]
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

/** An ISO 'YYYY-MM-DD' for a local date — read back by `parseDay`, never through UTC. */
const isoOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function layoutTimeline(entries: readonly TimelineEntry[], options: TimelineOptions = {}): TimelineLayout {
  const source = options.today ?? new Date()
  const today = new Date(source.getFullYear(), source.getMonth(), source.getDate())

  // Parse once and normalise. `end` is inclusive for a span, equal to `start` for a milestone.
  const placed: Array<{
    entry: TimelineEntry
    index: number
    kind: 'span' | 'milestone'
    from?: 'start' | 'end' | 'both'
    dateIso: string
    endIso?: string
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
      if (s.getTime() === e.getTime())
        placed.push({ entry, index, kind: 'milestone', from: 'both', dateIso: entry.targetStartDate!, start: s, end: s })
      else if (s < e)
        placed.push({ entry, index, kind: 'span', dateIso: entry.targetStartDate!, endIso: entry.targetEndDate, start: s, end: e })
      else
        placed.push({ entry, index, kind: 'span', dateIso: entry.targetEndDate!, endIso: entry.targetStartDate, start: e, end: s })
    } else {
      const day = (s ?? e)!
      placed.push({ entry, index, kind: 'milestone', from: s ? 'start' : 'end', dateIso: (s ? entry.targetStartDate : entry.targetEndDate)!, start: day, end: day })
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

  // The axis day by day, from the same start the offsets are measured from — so a tick and the
  // bar beneath it can never disagree about which day they are.
  const days: TimelineDay[] = Array.from({ length: totalDays }, (_, offset) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset)
    const weekday = d.getDay()
    return {
      offset,
      dateIso: isoOf(d),
      day: d.getDate(),
      monthStart: d.getDate() === 1,
      weekend: weekday === 0 || weekday === 6,
    }
  })

  const todayOffset = daysBetween(today, start)

  const shapes = placed.map((p) => ({
    entry: p.entry,
    index: p.index,
    kind: p.kind,
    from: p.from,
    dateIso: p.dateIso,
    endIso: p.endIso,
    start: daysBetween(p.start, start),
    end: p.kind === 'span' ? daysBetween(p.end, start) + 1 : daysBetween(p.start, start),
  }))

  // One row per scheduled initiative — a list over time, not a packed grid. Overlapping work
  // sharing a row would save space but muddy whose bar is whose, and the row is what makes a
  // glance trustworthy. Chronological, longest first on ties, input order on full ties:
  // deterministic, and the top row is the earliest work.
  const order = shapes
    .map((_, i) => i)
    .sort(
      (a, b) =>
        shapes[a].start - shapes[b].start || shapes[b].end - shapes[a].end || shapes[a].index - shapes[b].index,
    )
  const bars: TimelineBar[] = order.map((i, row) => {
    const shape = shapes[i]
    return {
      id: shape.entry.id,
      title: shape.entry.title,
      kind: shape.kind,
      from: shape.from,
      dateIso: shape.dateIso,
      endIso: shape.endIso,
      row,
      start: shape.start,
      end: shape.end,
      bucket: shape.entry.bucket,
    }
  })

  return {
    start,
    totalDays,
    bars,
    rowCount: bars.length,
    unscheduled,
    months,
    days,
    today: todayOffset >= 0 && todayOffset < totalDays ? todayOffset : null,
  }
}
