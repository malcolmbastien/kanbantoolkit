import { describe, expect, it } from 'vitest'
import { activeFilterCount, hasActiveFilters, isOverdue, matchesFilters, NO_FILTERS, parseDay, type CardFilters } from './filters'
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

  it('counts active filter categories', () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0)
    expect(activeFilterCount(with_({ typeIds: ['a', 'b'] }))).toBe(1)
    expect(activeFilterCount(with_({ typeIds: ['a'], blocked: true, overdue: true }))).toBe(3)
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
