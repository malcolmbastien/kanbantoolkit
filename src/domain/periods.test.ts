import { describe, expect, it } from 'vitest'
import { comparePeriods, periodById, periodNameOf, periodRank, periodsInOrder } from './periods'
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
})
