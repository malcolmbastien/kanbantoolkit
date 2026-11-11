import { describe, expect, it } from 'vitest'
import { comparePeriods, periodById, periodNameOf, periodProgress, periodRank, periodsInOrder } from './periods'
import type { Period } from './types'

const q4: Period = { id: 'p-q4', name: 'FY26 Q4', start: '2026-10-01', end: '2026-12-31' }
const q1: Period = { id: 'p-q1', name: 'FY27 Q1', start: '2027-01-01', end: '2027-03-31' }
const undated: Period = { id: 'p-x', name: 'Later' }

describe('periods', () => {
  it('reads in calendar order: start date first, then the name', () => {
    expect(periodsInOrder([q1, undated, q4]).map((p) => p.name)).toEqual(['FY26 Q4', 'FY27 Q1', 'Later'])
    // Two undated periods still have an order a reader can rely on.
    expect(comparePeriods({ id: 'a', name: 'B' }, { id: 'b', name: 'A' })).toBeGreaterThan(0)
    expect(comparePeriods(q4, q4)).toBe(0)
  })

  it('finds a period by id, and names a stale one rather than saying nothing', () => {
    expect(periodById([q4], 'p-q4')).toEqual(q4)
    expect(periodById([q4], 'p-gone')).toBeUndefined()
    expect(periodNameOf([q4], 'p-q4')).toBe('FY26 Q4')
    expect(periodNameOf([q4], 'p-gone')).toBe('No period')
  })

  it('ranks an objective’s period, and puts a stale one last rather than dropping it', () => {
    expect(periodRank([q1, q4], 'p-q4')).toBe(0)
    expect(periodRank([q1, q4], 'p-q1')).toBe(1)
    expect(periodRank([q1, q4], 'p-gone')).toBe(2)
  })

  it('says how far into a period a reader is, in whole days', () => {
    // Day one is the start date; the last day is the end date, inclusive.
    expect(periodProgress(q4, Date.UTC(2026, 9, 1))).toEqual({
      state: 'running',
      day: 1,
      totalDays: 92,
      percent: 1,
      daysLeft: 91,
    })
    expect(periodProgress(q4, Date.UTC(2026, 9, 15, 23, 59))).toMatchObject({ state: 'running', day: 15, daysLeft: 77 })
    expect(periodProgress(q4, Date.UTC(2026, 11, 31, 12))).toMatchObject({ state: 'running', day: 92, percent: 100, daysLeft: 0 })

    // Before and after are said as such, rather than as day 0 or day 93.
    expect(periodProgress(q4, Date.UTC(2026, 8, 20))).toEqual({ state: 'upcoming', daysUntilStart: 11, totalDays: 92, percent: 0 })
    expect(periodProgress(q4, Date.UTC(2027, 0, 5))).toEqual({ state: 'ended', daysSinceEnd: 5, totalDays: 92, percent: 100 })

    // One end, or none, says only what it can.
    expect(periodProgress({ id: 'p', name: 'From', start: '2026-10-01' }, Date.UTC(2026, 9, 15))).toEqual({
      state: 'running',
      day: 15,
    })
    expect(periodProgress({ id: 'p', name: 'To', end: '2026-10-20' }, Date.UTC(2026, 9, 15))).toEqual({
      state: 'running',
      daysLeft: 5,
    })
    expect(periodProgress(undated, Date.UTC(2026, 9, 15))).toEqual({ state: 'no-window' })
  })
})
