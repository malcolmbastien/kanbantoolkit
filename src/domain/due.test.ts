import { describe, expect, it } from 'vitest'
import { dueDay, dueLabel, dueState, dueWhy } from './due'
import { DUE_SOON_DAYS } from './filters'

/** Noon, so "today" and "tomorrow" are unambiguous wherever this runs. */
const NOON = new Date(2026, 10, 12, 12).getTime()

/** The day `n` days from the fixture's noon, as the ISO day a date input gives. */
const day = (n: number) => {
  const d = new Date(NOON)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('the due date, as a reading', () => {
  it('says nothing when there is no due date, or when it is not a day', () => {
    expect(dueState(undefined, false, NOON)).toBeUndefined()
    expect(dueState('', false, NOON)).toBeUndefined()
    expect(dueState('next friday', false, NOON)).toBeUndefined()
  })

  it('counts whole days from today, whichever side of it the date falls', () => {
    expect(dueState(day(0), false, NOON)).toMatchObject({ days: 0, tone: 'soon' })
    expect(dueState(day(3), false, NOON)).toMatchObject({ days: 3, tone: 'soon' })
    expect(dueState(day(-1), false, NOON)).toMatchObject({ days: -1, tone: 'overdue' })
    expect(dueState(day(-40), false, NOON)).toMatchObject({ days: -40, tone: 'overdue' })
    expect(dueState(day(DUE_SOON_DAYS), false, NOON)).toMatchObject({ days: DUE_SOON_DAYS, tone: 'later' })
  })

  it('is quiet about work that is finished, however long the day has passed', () => {
    expect(dueState(day(-40), true, NOON)?.tone).toBe('later')
    expect(dueState(day(0), true, NOON)?.tone).toBe('later')
  })

  it('is the same window the board’s own "due soon" filter names', () => {
    // One constant, so a card can never be amber while the filter that says "due soon" excludes it.
    expect(dueState(day(DUE_SOON_DAYS - 1), false, NOON)?.tone).toBe('soon')
    expect(dueState(day(DUE_SOON_DAYS), false, NOON)?.tone).toBe('later')
  })

  it('says how late, how near, or which day — in one voice for every surface', () => {
    expect(dueLabel(dueState(day(-3), false, NOON)!)).toBe('3d overdue')
    expect(dueLabel(dueState(day(-1), false, NOON)!)).toBe('1d overdue')
    expect(dueLabel(dueState(day(0), false, NOON)!)).toBe('Due today')
    expect(dueLabel(dueState(day(2), false, NOON)!)).toBe('Due in 2d')
    expect(dueLabel(dueState(day(30), false, NOON)!)).toMatch(/^Due /)
    expect(dueWhy(dueState(day(-2), false, NOON)!)).toMatch(/2 days past its due date/)
    expect(dueWhy(dueState(day(-1), false, NOON)!)).toMatch(/1 day past its due date/)
    expect(dueWhy(dueState(day(1), false, NOON)!)).toMatch(/in 1 day$/)
  })

  it('writes the day as a person reads it, and leaves anything unparseable as it came', () => {
    expect(dueDay(day(0))).toMatch(/\d/)
    expect(dueDay('not a day')).toBe('not a day')
  })
})
