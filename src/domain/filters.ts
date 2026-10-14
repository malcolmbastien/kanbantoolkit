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

/**
 * Read a `?filters=` parameter, so a narrowed board can be linked.
 *
 * Tokens are comma-separated: `blocked`, `overdue`, `unassigned`, and then the dimensions
 * that carry a value — `priority:urgent`, `assignee:<userId>`, `age:7`. An unknown token is
 * ignored rather than guessed at, and a malformed value is dropped rather than defaulted.
 */
export function filtersFromParam(param: string | null): CardFilters | undefined {
  if (!param) return undefined
  const tokens = param.split(',').map((t) => t.trim()).filter(Boolean)
  if (tokens.length === 0) return undefined
  // Every array is copied: NO_FILTERS is handed out by clearFilters, so pushing into
  // what it holds would edit the empty filter set for everyone.
  const next: CardFilters = { ...NO_FILTERS, typeIds: [], assigneeIds: [], priorities: [] }
  for (const token of tokens) {
    const [rawKey, rawValue] = token.split(':')
    const key = rawKey.toLowerCase()
    if (key === 'blocked') next.blocked = true
    else if (key === 'overdue') next.overdue = true
    else if (key === 'unassigned') next.unassigned = true
    else if (key === 'priority' && rawValue) {
      const level = rawValue.toLowerCase()
      if (!next.priorities.includes(level)) next.priorities.push(level)
    } else if (key === 'assignee' && rawValue) {
      if (!next.assigneeIds.includes(rawValue)) next.assigneeIds.push(rawValue)
    } else if (key === 'age' && rawValue) {
      const days = Number(rawValue)
      if (Number.isFinite(days) && days > 0) next.minAgeDays = days
    }
  }
  return next
}
