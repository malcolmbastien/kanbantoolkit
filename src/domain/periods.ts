import { parseDay } from './filters'
import type { Period } from './types'

/**
 * Periods — the windows objectives are committed for.
 *
 * A period is a record, not a label on an objective, because the window is shared: every objective
 * in "FY26 Q4" is due when that period ends, and setting the window once is what keeps them from
 * disagreeing. An objective therefore carries no target date of its own.
 *
 * Nothing here computes lateness yet. The dates are the period's shape — set, read and ordered —
 * and a surface that wants to say "past its period" reads them through `periodById`.
 */

/** How far into a period a reader is, measured in whole days. */
export interface PeriodProgress {
  state: 'no-window' | 'upcoming' | 'running' | 'ended'
  /** The 1-based day into the period, once it has started. */
  day?: number
  /** The inclusive length, when both ends are known. */
  totalDays?: number
  /** 0–100, when both ends are known. */
  percent?: number
  /** Whole days until a future start. */
  daysUntilStart?: number
  /** Whole days left, including today, while running. */
  daysLeft?: number
  /** Whole days since a past end. */
  daysSinceEnd?: number
}

const DAY_MS = 86_400_000

/** An ISO day at UTC midnight — the same clock for every reader. */
const dayOf = (iso: string | undefined): number | undefined => {
  if (!iso) return undefined
  const at = Date.parse(`${iso}T00:00:00Z`)
  return Number.isFinite(at) ? at : undefined
}
const dayCount = (from: number, to: number) => Math.round((to - from) / DAY_MS)

/**
 * Where today sits in a period: before it, inside it (with the day and percentage), or after it.
 *
 * A period with one end set says what that one date can say; a period with no window says so rather
 * than inventing a start. Both ends are read at UTC midnight, so the answer is the same in every
 * timezone the instance is read in.
 */
export function periodProgress(period: Period, now = Date.now()): PeriodProgress {
  const start = dayOf(period.start)
  const end = dayOf(period.end)
  const today = Math.floor(now / DAY_MS) * DAY_MS
  if (start === undefined && end === undefined) return { state: 'no-window' }
  if (start !== undefined && end !== undefined) {
    if (end < start) return { state: 'no-window' }
    const totalDays = dayCount(start, end) + 1
    if (today < start) return { state: 'upcoming', daysUntilStart: dayCount(today, start), totalDays, percent: 0 }
    if (today > end) return { state: 'ended', daysSinceEnd: dayCount(end, today), totalDays, percent: 100 }
    const day = dayCount(start, today) + 1
    return {
      state: 'running',
      day,
      totalDays,
      percent: Math.round((day / totalDays) * 100),
      daysLeft: dayCount(today, end),
    }
  }
  if (start !== undefined) {
    if (today < start) return { state: 'upcoming', daysUntilStart: dayCount(today, start) }
    return { state: 'running', day: dayCount(start, today) + 1 }
  }
  if (today > end!) return { state: 'ended', daysSinceEnd: dayCount(end!, today) }
  return { state: 'running', daysLeft: dayCount(today, end!) }
}

/** The period a record names, or `undefined` when the id is stale (a period removed under it). */
export function periodById(periods: Period[], id: string | undefined): Period | undefined {
  return id ? periods.find((p) => p.id === id) : undefined
}

/** The period's name, or the words that say there is no period behind the id. */
export function periodNameOf(periods: Period[], id: string | undefined): string {
  return periodById(periods, id)?.name ?? 'No period'
}

/**
 * Reading order: by start date, then by name.
 *
 * A period with no start sits after the dated ones and is ordered by name among its peers: there is
 * no date to place it by, and inventing one would reorder a reader's periods behind their back.
 */
export function comparePeriods(a: Period, b: Period): number {
  const aStart = parseDay(a.start)?.getTime()
  const bStart = parseDay(b.start)?.getTime()
  if (aStart !== undefined && bStart !== undefined && aStart !== bStart) return aStart - bStart
  if (aStart !== undefined && bStart === undefined) return -1
  if (aStart === undefined && bStart !== undefined) return 1
  return a.name.localeCompare(b.name)
}

/** Every period in reading order — what a select, a heading and the heatmap all list. */
export function periodsInOrder(periods: Period[]): Period[] {
  return [...periods].sort(comparePeriods)
}

/**
 * Where an objective's period sits in reading order — the key a surface sorts objectives by.
 *
 * A stale id sorts after every real period rather than being dropped: an objective whose period is
 * gone is still an objective, and hiding it would lose the work it carries.
 */
export function periodRank(periods: Period[], periodId: string): number {
  const ordered = periodsInOrder(periods)
  const index = ordered.findIndex((p) => p.id === periodId)
  return index === -1 ? ordered.length : index
}
