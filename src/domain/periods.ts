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
