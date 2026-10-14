import { describe, expect, it } from 'vitest'
import { activeFilterCount, ageDays, filtersFromParam, hasActiveFilters, isOverdue, matchesFilters, NO_FILTERS, parseDay, type CardFilters } from './filters'
import type { Item } from './types'

const card = (patch: Partial<Item> = {}): Item => ({ id: 'x', title: 'X', typeId: 't-story', createdAt: 0, ...patch })
const with_ = (patch: Partial<CardFilters>): CardFilters => ({ ...NO_FILTERS, ...patch })

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
    // Assignee and unassigned are independent switches, not opposites.
    expect(matchesFilters(card(), with_({ unassigned: true }), false)).toBe(true)
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

  it('parses a day without a timezone shift', () => {
    const d = parseDay('2026-03-01')!
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(2)
    expect(d.getDate()).toBe(1)
    expect(parseDay(undefined)).toBeUndefined()
  })
})
