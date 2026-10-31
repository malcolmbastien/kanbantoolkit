import { parseDay } from '@/domain/filters'
import type { Period } from '@/domain/types'

const dayMonth = (iso?: string) => {
  const date = parseDay(iso)
  return date ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : undefined
}

const fullDay = (iso?: string) => {
  const date = parseDay(iso)
  return date ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : undefined
}

const yearOf = (iso?: string) => parseDay(iso)?.getFullYear()

/**
 * A period's window as one line — `1 Jan – 31 Mar 2026`, `From 1 Jan 2026`, `To 31 Mar 2026` — or
 * `undefined` when nobody has set it. The year is said once when both ends share it, because it is
 * the period a reader is placing, not two dates.
 */
export function periodRangeLabel(period: Period | undefined): string | undefined {
  if (!period) return undefined
  const { start, end } = period
  const from = dayMonth(start)
  const to = fullDay(end)
  if (from && to) return yearOf(start) === yearOf(end) ? `${from} – ${to}` : `${fullDay(start)} – ${to}`
  if (from) return `From ${fullDay(start)}`
  if (to) return `To ${to}`
  return undefined
}
