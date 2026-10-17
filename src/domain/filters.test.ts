import { describe, expect, it } from 'vitest'
import { laneAges, medianOf } from './filters'
import { activeFilterCount, ageDays, filtersFromParam, hasActiveFilters, isDueSoon, isOverdue, matchesFilters, NO_FILTERS, parseDay, sameFilters, type CardFilters } from './filters'
import { initiativeScope } from './filters'
import type { Edge, Item, Lane, Placement } from './types'
import type { Graph } from './derive'

const card = (patch: Partial<Item> = {}): Item => ({ id: 'x', title: 'X', typeId: 't-story', createdAt: 0, ...patch })
const with_ = (patch: Partial<CardFilters>): CardFilters => ({ ...NO_FILTERS, ...patch })
/** A local 'YYYY-MM-DD' some days from a base date, so boundaries are stated in days. */
const day = (offset: number, from = Date.now()) => {
  const d = new Date(from)
  d.setDate(d.getDate() + offset)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}
// A fixed afternoon in the middle of a month: neither daylight-saving drift nor a midnight
// roll-over can move the boundaries these tests pin.
const NOON = new Date(2026, 3, 15, 12).getTime()

describe('card filters', () => {
  it('matches everything when no filter is active', () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false)
    expect(matchesFilters(card(), NO_FILTERS, false)).toBe(true)
  })

  it('filters by card type', () => {
    const f = with_({ typeIds: ['t-bug'] })
    expect(matchesFilters(card({ typeId: 't-bug' }), f, false)).toBe(true)
    expect(matchesFilters(card({ typeId: 't-story' }), f, false)).toBe(false)
  })

  it('filters blocked, unassigned and overdue', () => {
    expect(matchesFilters(card({ blocked: true }), with_({ blocked: true }), false)).toBe(true)
    expect(matchesFilters(card(), with_({ blocked: true }), false)).toBe(false)

    expect(matchesFilters(card(), with_({ unassigned: true }), false)).toBe(true)
    expect(matchesFilters(card({ assignees: ['MB'] }), with_({ unassigned: true }), false)).toBe(false)

    const past = card({ targetEndDate: '2000-01-01' })
    const future = card({ targetEndDate: '2999-01-01' })
    expect(matchesFilters(past, with_({ overdue: true }), false)).toBe(true)
    expect(matchesFilters(future, with_({ overdue: true }), false)).toBe(false)
    // A resolved card is never overdue.
    expect(matchesFilters(past, with_({ overdue: true }), true)).toBe(false)
  })

  it('combines categories with AND', () => {
    const f = with_({ blocked: true, unassigned: true })
    expect(matchesFilters(card({ blocked: true, assignees: ['MB'] }), f, false)).toBe(false)
    expect(matchesFilters(card({ blocked: true }), f, false)).toBe(true)
  })

  it('filters by assignee, as a union within the category', () => {
    const f = with_({ assigneeIds: ['u-1', 'u-2'] })
    expect(matchesFilters(card({ assignees: ['u-2'] }), f, false)).toBe(true)
    expect(matchesFilters(card({ assignees: ['u-9'] }), f, false)).toBe(false)
    expect(matchesFilters(card(), f, false)).toBe(false)
    // "Unassigned" is a pseudo-entry in the same list, so it composes as a union with the
    // picked people rather than standing apart as a second switch.
    const both = with_({ assigneeIds: ['u-1'], unassigned: true })
    expect(matchesFilters(card({ assignees: ['u-1'] }), both, false)).toBe(true)
    expect(matchesFilters(card(), both, false)).toBe(true)
    expect(matchesFilters(card({ assignees: ['u-9'] }), both, false)).toBe(false)
    // On its own it is still "only the ownerless cards".
    expect(matchesFilters(card(), with_({ unassigned: true }), false)).toBe(true)
    expect(matchesFilters(card({ assignees: ['MB'] }), with_({ unassigned: true }), false)).toBe(false)
  })

  it('filters by priority, and a card with none matches no selection', () => {
    const f = with_({ priorities: ['urgent', 'high'] })
    expect(matchesFilters(card({ priority: 'high' }), f, false)).toBe(true)
    expect(matchesFilters(card({ priority: 'low' }), f, false)).toBe(false)
    expect(matchesFilters(card(), f, false)).toBe(false)
  })

  it('filters by time in lane, and excludes cards whose age is unknown', () => {
    const f = with_({ minAgeDays: 7 })
    expect(matchesFilters(card(), f, false, Date.now(), 7)).toBe(true)
    expect(matchesFilters(card(), f, false, Date.now(), 6)).toBe(false)
    // Unknown age is not "old enough": it is unknown, so it is not claimed.
    expect(matchesFilters(card(), f, false, Date.now(), undefined)).toBe(false)
    // No age filter means age is irrelevant.
    expect(matchesFilters(card(), NO_FILTERS, false, Date.now(), undefined)).toBe(true)
  })

  it('ageDays reads the placement, and says nothing when the stamp is missing', () => {
    const day = 86_400_000
    const now = 1_000 * day
    expect(ageDays({ id: 'p', boardId: 'b', itemId: 'i', laneId: 'l', laneEnteredAt: now - 3 * day }, now)).toBe(3)
    expect(ageDays({ id: 'p', boardId: 'b', itemId: 'i', laneId: 'l' }, now)).toBeUndefined()
    expect(ageDays(undefined, now)).toBeUndefined()
  })

  it('combines dimensions with AND', () => {
    const f = with_({ priorities: ['urgent'], assigneeIds: ['u-1'], minAgeDays: 7, blocked: true })
    const good = card({ priority: 'urgent', assignees: ['u-1'], blocked: true })
    expect(matchesFilters(good, f, false, Date.now(), 10)).toBe(true)
    expect(matchesFilters(good, f, false, Date.now(), 1)).toBe(false)
    expect(matchesFilters({ ...good, blocked: false }, f, false, Date.now(), 10)).toBe(false)
    expect(matchesFilters({ ...good, priority: 'low' }, f, false, Date.now(), 10)).toBe(false)
  })

  it('reads a ?filters= parameter, so a narrowed board can be linked', () => {
    expect(filtersFromParam(null)).toBeUndefined()
    expect(filtersFromParam('')).toBeUndefined()

    expect(filtersFromParam('blocked,overdue')).toMatchObject({ blocked: true, overdue: true, unassigned: false })
    expect(filtersFromParam('priority:urgent,priority:high,assignee:u-1,age:7')).toMatchObject({
      priorities: ['urgent', 'high'],
      assigneeIds: ['u-1'],
      minAgeDays: 7,
    })
    // Repeats collapse rather than duplicating.
    expect(filtersFromParam('assignee:u-1,assignee:u-1')!.assigneeIds).toEqual(['u-1'])
    // Unknown tokens and malformed values are ignored, not guessed at.
    expect(filtersFromParam('nonsense,age:soon,priority:')).toMatchObject({ priorities: [] })
    expect(filtersFromParam('nonsense,age:soon')!.minAgeDays).toBeUndefined()
    expect(filtersFromParam('age:0')!.minAgeDays).toBeUndefined()
    // Case is not part of the contract.
    expect(filtersFromParam('BLOCKED,Priority:Urgent')).toMatchObject({ blocked: true, priorities: ['urgent'] })
  })

  it('counts active filter categories', () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0)
    expect(activeFilterCount(with_({ typeIds: ['a', 'b'] }))).toBe(1)
    expect(activeFilterCount(with_({ typeIds: ['a'], blocked: true, overdue: true }))).toBe(3)
    expect(activeFilterCount(with_({ assigneeIds: ['u-1'], priorities: ['high'], minAgeDays: 7 }))).toBe(3)
  })

  it('isOverdue needs a past target date and an open card', () => {
    expect(isOverdue(card({ targetEndDate: '2000-01-01' }), false)).toBe(true)
    expect(isOverdue(card({ targetEndDate: '2000-01-01' }), true)).toBe(false)
    expect(isOverdue(card(), false)).toBe(false)
    expect(isOverdue(card({ targetEndDate: '2999-01-01' }), false)).toBe(false)
  })

  it('isDueSoon is target date within the next seven days, boundary included', () => {
    // Seven days counting today: the sixth day ahead is in, and neither the seventh nor
    // the eighth makes it — the window does not stretch past the week it names.
    expect(isDueSoon(card({ targetEndDate: day(0, NOON) }), false, NOON)).toBe(true)
    expect(isDueSoon(card({ targetEndDate: day(6, NOON) }), false, NOON)).toBe(true)
    expect(isDueSoon(card({ targetEndDate: day(7, NOON) }), false, NOON)).toBe(false)
    expect(isDueSoon(card({ targetEndDate: day(8, NOON) }), false, NOON)).toBe(false)
    // A date already past belongs to overdue, not due soon — and the two never double-count.
    expect(isDueSoon(card({ targetEndDate: day(-1, NOON) }), false, NOON)).toBe(false)
    // A done card has no due date, and neither does a card with no target date at all.
    expect(isDueSoon(card({ targetEndDate: day(2, NOON) }), true, NOON)).toBe(false)
    expect(isDueSoon(card(), false, NOON)).toBe(false)
    // In the matcher itself, so the panel's toggle and the ?filters= token share one truth.
    expect(matchesFilters(card({ targetEndDate: day(3, NOON) }), with_({ dueSoon: true }), false, NOON)).toBe(true)
    expect(matchesFilters(card({ targetEndDate: day(10, NOON) }), with_({ dueSoon: true }), false, NOON)).toBe(false)
  })

  it('narrows by text over the title and the description, case-insensitively', () => {
    expect(matchesFilters(card({ title: 'Rework the Login Flow' }), with_({ text: ' login ' }), false)).toBe(true)
    expect(matchesFilters(card({ description: 'The telemetry rollout notes' }), with_({ text: 'Telemetry' }), false)).toBe(true)
    expect(matchesFilters(card({ description: 'The telemetry rollout notes' }), with_({ text: 'payments' }), false)).toBe(false)
    // Whitespace narrows nothing, exactly as it counts nothing.
    expect(matchesFilters(card(), with_({ text: '\t' }), false)).toBe(true)
    expect(activeFilterCount(with_({ text: '' }))).toBe(0)
    expect(activeFilterCount(with_({ text: 'flow' }))).toBe(1)
  })

  it('sameFilters compares the narrowing, not the order a list was built in', () => {
    expect(sameFilters(with_({ assigneeIds: ['a', 'b'] }), with_({ assigneeIds: ['b', 'a'] }))).toBe(true)
    expect(sameFilters(with_({ dueSoon: true }), NO_FILTERS)).toBe(false)
    // Whitespace in a text query is no narrowing, so neither is having it saved.
    expect(sameFilters(with_({ text: ' ' }), NO_FILTERS)).toBe(true)
    expect(sameFilters(with_({ text: 'x' }), with_({}))).toBe(false)
  })

  it('parses a day without a timezone shift', () => {
    const d = parseDay('2026-03-01')!
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(2)
    expect(d.getDate()).toBe(1)
    expect(parseDay(undefined)).toBeUndefined()
  })
})

describe('column age', () => {
  const day = 86_400_000
  const now = 1_000 * day
  // A column with a cell inside it: work in a cell ages for the column that holds it.
  const lanes: Lane[] = [
    { id: 'col', boardId: 'b', parentId: null, order: 0, name: 'In Progress', workflow: 'cards', stage: 'inProgress' },
    { id: 'cell', boardId: 'b', parentId: 'col', order: 0, name: 'A', workflow: 'cards', stage: 'inProgress' },
    { id: 'other', boardId: 'b', parentId: null, order: 1, name: 'Done', workflow: 'cards', stage: 'done' },
  ]
  const place = (id: string, lane: string, agoDays?: number): Placement => ({
    id,
    boardId: 'b',
    itemId: id,
    laneId: lane,
    ...(agoDays === undefined ? {} : { laneEnteredAt: now - agoDays * day }),
  })

  it('reads every placement under a lane, cells included, stampless ones skipped', () => {
    const placements = [place('p1', 'cell', 10), place('p2', 'col', 2), place('p3', 'col'), place('p4', 'other', 99)]
    const ages = laneAges(lanes, placements, 'col', now)
    expect(ages.slice().sort((a, b) => a - b)).toEqual([2, 10])
  })

  it('medians the middle day, averaging the two middle ones for an even count', () => {
    expect(medianOf([])).toBeUndefined()
    expect(medianOf([9])).toBe(9)
    expect(medianOf([10, 2])).toBe(6)
    expect(medianOf([9, 1, 2, 2, 11])).toBe(2)
    expect(medianOf([10, 4, 2, 8])).toBe(6)
  })

  it('an initiative filter narrows to the work under it, however deep', () => {
    const edge = (from: string, to: string): Edge => ({ id: `${from}-${to}`, kind: 'decomposition', from, to })
    const graph: Graph = {
      items: [
        card({ id: 'init-a', typeId: 't-initiative' }),
        card({ id: 'init-b', typeId: 't-initiative' }),
        card({ id: 'epic', typeId: 't-epic' }),
        card({ id: 'leaf' }),
      ],
      edges: [edge('init-a', 'init-b'), edge('init-b', 'epic'), edge('epic', 'leaf')],
      links: [],
      placements: [],
      lanes: [],
    }
    const scope = (id: string) => initiativeScope(with_({ initiativeId: id }), graph)

    // The initiative, its child initiative, and the work two levels below it.
    expect([...scope('init-a')!].sort()).toEqual(['epic', 'init-a', 'init-b', 'leaf'])
    expect(matchesFilters(graph.items[3], with_({ initiativeId: 'init-a' }), false, Date.now(), undefined, scope('init-a'))).toBe(true)
    expect(matchesFilters(graph.items[0], with_({ initiativeId: 'init-a' }), false, Date.now(), undefined, scope('init-a'))).toBe(true)

    // Someone else's work is out of it — an initiative filter is not a text match.
    expect(matchesFilters(graph.items[3], with_({ initiativeId: 'init-b' }), false, Date.now(), undefined, scope('init-b'))).toBe(true)
    expect(matchesFilters(graph.items[0], with_({ initiativeId: 'init-b' }), false, Date.now(), undefined, scope('init-b'))).toBe(false)
    expect(matchesFilters(card({ id: 'outside' }), with_({ initiativeId: 'init-a' }), false, Date.now(), undefined, scope('init-a'))).toBe(false)

    // With nothing to narrow to it matches nothing, not everything: a filter that quietly
    // stops filtering is the one failure nobody would notice.
    expect(matchesFilters(graph.items[3], with_({ initiativeId: 'init-a' }), false)).toBe(false)
    expect(initiativeScope(NO_FILTERS, graph)).toBeUndefined()
    // An unknown initiative narrows to itself and nothing else.
    expect([...scope('gone')!]).toEqual(['gone'])
  })

  it('an initiative filter is one active filter, and part of a preset\'s identity', () => {
    expect(activeFilterCount(with_({ initiativeId: 'init-a' }))).toBe(1)
    expect(hasActiveFilters(with_({ initiativeId: 'init-a' }))).toBe(true)
    expect(sameFilters(with_({ initiativeId: 'init-a' }), with_({ initiativeId: 'init-a' }))).toBe(true)
    expect(sameFilters(with_({ initiativeId: 'init-a' }), with_({ initiativeId: 'init-b' }))).toBe(false)
    expect(sameFilters(with_({ initiativeId: 'init-a' }), NO_FILTERS)).toBe(false)
    // It composes with the rest, like every other category.
    const both = with_({ initiativeId: 'init-a', blocked: true })
    expect(activeFilterCount(both)).toBe(2)
  })
})
