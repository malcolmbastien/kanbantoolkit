import { descendants, type Graph } from './derive'
import { subtreeIds } from './lanes'
import type { Item, Lane, Placement } from './types'

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
  /** Only cards whose target date is within the next week and that aren't done. */
  dueSoon: boolean
  /** Only cards with no assignees — the pseudo-entry in the assignee filter. */
  unassigned: boolean
  /** Selected assignee ids. Empty = anyone. */
  assigneeIds: string[]
  /** Selected priorities. Empty = any priority. */
  priorities: string[]
  /**
   * Only the work under this initiative — itself and everything the decomposition puts below it.
   * Undefined = any. A card's place under an initiative is derived from the edges, not stored on
   * the card, which is why matching it needs `initiativeScope` alongside the filter.
   */
  initiativeId?: string
  /** Only cards that have sat in their lane at least this many days. Undefined = any age. */
  minAgeDays?: number
  /** Only cards whose title or description contains this text. Undefined/empty = any card. */
  text?: string
}

export const NO_FILTERS: CardFilters = {
  typeIds: [],
  blocked: false,
  overdue: false,
  dueSoon: false,
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

/**
 * The ids an initiative filter narrows to: the initiative and everything under it. Separate from
 * `matchesFilters` because it is the one filter that needs the graph — every other one is a fact
 * about the card itself.
 */
export function initiativeScope(f: CardFilters, graph: Graph): ReadonlySet<string> | undefined {
  if (!f.initiativeId) return undefined
  return new Set([f.initiativeId, ...descendants(f.initiativeId, graph)])
}

/** A card is overdue when its target end date is in the past and it isn't resolved. */
export function isOverdue(item: Item, resolved: boolean, now = Date.now()): boolean {
  if (resolved) return false
  const t = parseDay(item.targetEndDate)
  return Boolean(t && t.getTime() < now)
}

/** How far ahead "due soon" reaches, counted in days including today: a week. */
export const DUE_SOON_DAYS = 7

/**
 * The staleness threshold, in days — the point where a card stops staying quiet about how
 * long it has sat still. One constant for the card's aging cue and the dashboard's oldest
 * numbers, so every surface speaks at the same moment.
 */
export const STALE_AFTER_DAYS = 7

/**
 * Every known age inside a lane's subtree, in days: the card's placement names the leaf it
 * sits in, and counting a container means reading its descendants — a cell's work ages for
 * the column that holds it. Placements without a stamp say nothing and are skipped.
 */
export function laneAges(lanes: Lane[], placements: Placement[], laneId: string, now = Date.now()): number[] {
  const ids = new Set(subtreeIds(lanes, laneId))
  return placements
    .filter((p) => ids.has(p.laneId))
    .map((p) => ageDays(p, now))
    .filter((a): a is number => a !== undefined)
}

/**
 * The middle age, or the average of the two middle ones for an even count — one number for
 * "how long does work usually sit here", unmoved by one extreme old card.
 */
export function medianOf(ages: number[]): number | undefined {
  if (ages.length === 0) return undefined
  const sorted = [...ages].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** A card is due soon when its target end date falls within the next week and isn't resolved. */
export function isDueSoon(item: Item, resolved: boolean, now = Date.now()): boolean {
  if (resolved) return false
  const t = parseDay(item.targetEndDate)
  if (!t) return false
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const start = today.getTime()
  // Counting today itself: an end date today+DUE_SOON_DAYS-1 is in, and even today+
  // DUE_SOON_DAYS is not — the window is the next seven days, not one past them.
  return t.getTime() >= start && t.getTime() < start + DUE_SOON_DAYS * 86_400_000
}

/** Number of active filter categories (for the button badge). */
export function activeFilterCount(f: CardFilters): number {
  return (
    (f.typeIds.length > 0 ? 1 : 0) +
    (f.blocked ? 1 : 0) +
    (f.overdue ? 1 : 0) +
    (f.dueSoon ? 1 : 0) +
    (f.unassigned ? 1 : 0) +
    (f.assigneeIds.length > 0 ? 1 : 0) +
    (f.priorities.length > 0 ? 1 : 0) +
    (f.initiativeId !== undefined ? 1 : 0) +
    (f.minAgeDays !== undefined ? 1 : 0) +
    // An all-whitespace query narrows nothing, so it counts as nothing either.
    ((f.text ?? '').trim() ? 1 : 0)
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
  /** The ids an initiative filter narrows to — see `initiativeScope`. */
  within?: ReadonlySet<string>,
): boolean {
  // An initiative filter with nothing to narrow to matches nothing rather than everything: a
  // filter that silently stops filtering is the one failure nobody would notice.
  if (f.initiativeId && !within?.has(item.id)) return false
  if (f.typeIds.length > 0 && !f.typeIds.includes(item.typeId)) return false
  if (f.blocked && item.blocked !== true) return false
  if (f.overdue && !isOverdue(item, resolved, now)) return false
  if (f.dueSoon && !isDueSoon(item, resolved, now)) return false
  // Assignees are one concept with one control: the picked people and the unassigned
  // pseudo-entry draw from the same list, so they combine as a union within the category
  // — picking Alice and "no one" shows Alice's cards plus every card without an owner.
  const assigneePicked = f.assigneeIds.length > 0 || f.unassigned
  if (assigneePicked) {
    const a = item.assignees ?? []
    if (!(f.unassigned && a.length === 0) && !a.some((id) => f.assigneeIds.includes(id))) return false
  }
  // Within the remaining categories the filter is a union: any selected priority.
  if (f.priorities.length > 0 && (!item.priority || !f.priorities.includes(item.priority))) return false
  // An age filter excludes cards whose age is unknown, rather than pretending they are old.
  if (f.minAgeDays !== undefined && (age === undefined || age < f.minAgeDays)) return false
  // Text looks in the title and the description, case-insensitively. Whitespace alone
  // narrows nothing.
  const text = (f.text ?? '').trim().toLowerCase()
  if (text && !`${item.title}\n${item.description ?? ''}`.toLowerCase().includes(text)) return false
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
    else if (key === 'duesoon') next.dueSoon = true
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

/**
 * A named filter set the board can re-apply — the one deliberately persisted piece of
 * filter state. Everything else about filters stays view state.
 */
export interface SavedFilter {
  id: string
  name: string
  /**
   * The board it was saved against — a preset is that board's own way of reading itself. Absent
   * on a set saved before presets belonged to a board: it stays available on every board, because
   * claiming it for one of them would be inventing a fact about where it came from.
   */
  boardId?: string
  filters: CardFilters
}

/** Whether two filter sets would narrow the board the same way, whatever order they were built in. */
export function sameFilters(a: CardFilters, b: CardFilters): boolean {
  const set = (ids: string[]) => [...ids].sort().join()
  return (
    (a.text ?? '').trim() === (b.text ?? '').trim() &&
    a.blocked === b.blocked &&
    a.overdue === b.overdue &&
    a.dueSoon === b.dueSoon &&
    a.unassigned === b.unassigned &&
    a.minAgeDays === b.minAgeDays &&
    a.initiativeId === b.initiativeId &&
    set(a.typeIds) === set(b.typeIds) &&
    set(a.assigneeIds) === set(b.assigneeIds) &&
    set(a.priorities) === set(b.priorities)
  )
}
