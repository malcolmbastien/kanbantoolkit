import type { Item } from './types'

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
  /** Only cards with no assignee. */
  unassigned: boolean
}

export const NO_FILTERS: CardFilters = { typeIds: [], blocked: false, overdue: false, unassigned: false }

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
  return (f.typeIds.length > 0 ? 1 : 0) + (f.blocked ? 1 : 0) + (f.overdue ? 1 : 0) + (f.unassigned ? 1 : 0)
}

export function hasActiveFilters(f: CardFilters): boolean {
  return activeFilterCount(f) > 0
}

/** A card passes when it matches every active filter. */
export function matchesFilters(item: Item, f: CardFilters, resolved: boolean, now = Date.now()): boolean {
  if (f.typeIds.length > 0 && !f.typeIds.includes(item.typeId)) return false
  if (f.blocked && item.blocked !== true) return false
  if (f.unassigned && item.assignee) return false
  if (f.overdue && !isOverdue(item, resolved, now)) return false
  return true
}
