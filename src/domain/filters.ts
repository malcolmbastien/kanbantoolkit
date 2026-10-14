import type { Item, Placement } from './types'

/**
 * Card filters for the board view. Filters combine with AND across categories
 * (type, blocked, overdue, unassigned); within a category they're a union.
 * An empty filter set matches everything.
 */
export interface CardFilters {
  /** Selected card-type ids. Empty = every type. */
  typeIds: string[]
  /** Only explicitly blocked cards. */
  blocked: boolean
  /** Only cards past their target date that aren't done. */
  overdue: boolean
  /** Only cards with no assignees. */
  unassigned: boolean
  /** Selected assignee ids. Empty = anyone. */
  assigneeIds: string[]
  /** Selected priorities. Empty = any priority. */
  priorities: string[]
  /** Only cards that have sat in their lane at least this many days. Undefined = any age. */
  minAgeDays?: number
}

export const NO_FILTERS: CardFilters = {
  typeIds: [],
  blocked: false,
  overdue: false,
  unassigned: false,
  assigneeIds: [],
  priorities: [],
}

/**
 * How long a card has sat in the lane it is in, in whole days — or undefined when the
 * placement predates the stamp, since an unknown age is not the same as no age.
 */
export function ageDays(placement: Placement | undefined, now = Date.now()): number | undefined {
  if (!placement?.laneEnteredAt) return undefined
  return Math.floor((now - placement.laneEnteredAt) / 86_400_000)
}

/** Parse an ISO 'YYYY-MM-DD' as a local date so it doesn't shift a day. */
export function parseDay(iso?: string): Date | undefined {
  return iso ? new Date(`${iso}T00:00:00`) : undefined
}

/** A card is overdue when its target end date is in the past and it isn't resolved. */
export function isOverdue(item: Item, resolved: boolean, now = Date.now()): boolean {
  if (resolved) return false
  const t = parseDay(item.targetEndDate)
  return Boolean(t && t.getTime() < now)
}

/** Number of active filter categories (for the button badge). */
export function activeFilterCount(f: CardFilters): number {
  return (
    (f.typeIds.length > 0 ? 1 : 0) +
    (f.blocked ? 1 : 0) +
    (f.overdue ? 1 : 0) +
    (f.unassigned ? 1 : 0) +
    (f.assigneeIds.length > 0 ? 1 : 0) +
    (f.priorities.length > 0 ? 1 : 0) +
    (f.minAgeDays !== undefined ? 1 : 0)
  )
}

export function hasActiveFilters(f: CardFilters): boolean {
  return activeFilterCount(f) > 0
}

/** A card passes when it matches every active filter. */
export function matchesFilters(
  item: Item,
  f: CardFilters,
  resolved: boolean,
  now = Date.now(),
  /** The card's age in its lane, when it is known — see `ageDays`. */
  age?: number,
): boolean {
  if (f.typeIds.length > 0 && !f.typeIds.includes(item.typeId)) return false
  if (f.blocked && item.blocked !== true) return false
  if (f.unassigned && (item.assignees?.length ?? 0) > 0) return false
  if (f.overdue && !isOverdue(item, resolved, now)) return false
  // Within a category the filter is a union: any selected assignee, any selected priority.
  if (f.assigneeIds.length > 0 && !(item.assignees ?? []).some((id) => f.assigneeIds.includes(id))) return false
  if (f.priorities.length > 0 && (!item.priority || !f.priorities.includes(item.priority))) return false
  // An age filter excludes cards whose age is unknown, rather than pretending they are old.
  if (f.minAgeDays !== undefined && (age === undefined || age < f.minAgeDays)) return false
  return true
}
