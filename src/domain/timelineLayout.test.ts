import { describe, expect, it } from 'vitest'
import { layoutTimeline, type TimelineEntry } from './timelineLayout'

const entry = (id: string, patch: Partial<TimelineEntry> = {}): TimelineEntry => ({
  id,
  title: id,
  bucket: 'notStarted',
  ...patch,
})

const TODAY = new Date('2026-12-15T00:00:00')

describe('timeline layout', () => {
  it('maps dates to day offsets from the first of the earliest month', () => {
    const l = layoutTimeline(
      [
        entry('a', { targetStartDate: '2026-11-01', targetEndDate: '2026-11-10' }),
        entry('b', { targetStartDate: '2027-01-05', targetEndDate: '2027-01-06' }),
      ],
      { today: TODAY },
    )
    expect(l.start.getFullYear()).toBe(2026)
    expect(l.start.getMonth()).toBe(10)
    expect(l.start.getDate()).toBe(1)
    const a = l.bars.find((b) => b.id === 'a')!
    expect(a.kind).toBe('span')
    expect(a.start).toBe(0)
    expect(a.end).toBe(10) // inclusive of the end date
    expect(a.dateIso).toBe('2026-11-01')
    expect(a.endIso).toBe('2026-11-10')
    const b = l.bars.find((x) => x.id === 'b')!
    expect(b.start).toBe(65) // 30 (Nov) + 31 (Dec) + 4
    expect(b.end).toBe(67)
    expect(b.dateIso).toBe('2027-01-05')
    expect(l.totalDays).toBe(92)
  })

  it('crosses a year boundary in its month headers', () => {
    const l = layoutTimeline(
      [
        entry('a', { targetStartDate: '2026-11-01', targetEndDate: '2026-11-10' }),
        entry('b', { targetStartDate: '2027-01-05', targetEndDate: '2027-01-06' }),
      ],
      { today: TODAY },
    )
    expect(l.months).toEqual([
      { year: 2026, month: 10, start: 0, days: 30 },
      { year: 2026, month: 11, start: 30, days: 31 },
      { year: 2027, month: 0, start: 61, days: 31 },
    ])
  })

  it('gives every scheduled initiative its own row, in chronological order', () => {
    const l = layoutTimeline(
      [
        entry('b', { targetStartDate: '2026-11-06', targetEndDate: '2026-11-15' }),
        entry('c', { targetStartDate: '2026-11-16', targetEndDate: '2026-11-20' }),
        entry('a', { targetStartDate: '2026-11-01', targetEndDate: '2026-11-10' }),
      ],
      { today: TODAY },
    )
    // Chronological, whatever order the caller listed them in: the earliest work tops the chart.
    expect(l.bars.map((b) => b.id)).toEqual(['a', 'b', 'c'])
    expect(l.bars.map((b) => b.row)).toEqual([0, 1, 2])
    expect(l.rowCount).toBe(3)
  })

  it('puts an initiative with neither date in the unscheduled tray, never at an invented day', () => {
    const l = layoutTimeline(
      [entry('x'), entry('a', { targetStartDate: '2026-11-01', targetEndDate: '2026-11-10' })],
      { today: TODAY },
    )
    expect(l.unscheduled.map((u) => u.id)).toEqual(['x'])
    expect(l.bars.every((b) => b.id !== 'x')).toBe(true)
    // The tray does not stretch the domain: it is still November's 30 days.
    expect(l.totalDays).toBe(30)
  })

  it('lays out a tray of only unscheduled work on the current month with no bars', () => {
    const l = layoutTimeline([entry('x'), entry('y')], { today: TODAY })
    expect(l.bars).toEqual([])
    expect(l.rowCount).toBe(0)
    expect(l.unscheduled).toHaveLength(2)
    expect(l.months).toEqual([{ year: 2026, month: 11, start: 0, days: 31 }])
    expect(l.totalDays).toBe(31)
  })

  it('lays out an empty board the same way', () => {
    const l = layoutTimeline([], { today: TODAY })
    expect(l.bars).toEqual([])
    expect(l.unscheduled).toEqual([])
    expect(l.rowCount).toBe(0)
    expect(l.totalDays).toBe(31)
    expect(l.today).toBe(14)
  })

  it('marks a single-date initiative as a milestone, whichever date it has', () => {
    const l = layoutTimeline(
      [entry('end-only', { targetEndDate: '2026-11-15' }), entry('start-only', { targetStartDate: '2026-11-03' })],
      { today: TODAY },
    )
    const e = l.bars.find((b) => b.id === 'end-only')!
    expect(e.kind).toBe('milestone')
    expect(e.from).toBe('end')
    expect(e.dateIso).toBe('2026-11-15')
    expect(e.endIso).toBeUndefined()
    expect(e.start).toBe(14)
    expect(e.end).toBe(14) // zero width
    const s = l.bars.find((b) => b.id === 'start-only')!
    expect(s.kind).toBe('milestone')
    expect(s.from).toBe('start')
    expect(s.dateIso).toBe('2026-11-03')
    expect(s.start).toBe(2)
  })

  it('renders a zero-width span as a milestone rather than a one-day bar', () => {
    const l = layoutTimeline([entry('a', { targetStartDate: '2026-11-05', targetEndDate: '2026-11-05' })], {
      today: TODAY,
    })
    expect(l.bars).toHaveLength(1)
    expect(l.bars[0].kind).toBe('milestone')
    expect(l.bars[0].from).toBe('both') // a start and an end on the same day
    expect(l.bars[0].dateIso).toBe('2026-11-05')
    expect(l.bars[0].start).toBe(4)
    expect(l.bars[0].end).toBe(4)
  })

  it('shows backwards dates as the span they evidently meant', () => {
    const l = layoutTimeline([entry('a', { targetStartDate: '2026-11-10', targetEndDate: '2026-11-02' })], {
      today: TODAY,
    })
    expect(l.bars[0].kind).toBe('span')
    expect(l.bars[0].start).toBe(1)
    expect(l.bars[0].end).toBe(10)
    // Labelled as rendered: the meant order, not the typed one.
    expect(l.bars[0].dateIso).toBe('2026-11-02')
    expect(l.bars[0].endIso).toBe('2026-11-10')
  })

  it('draws the today marker only when today lies inside the domain', () => {
    const nov = [entry('a', { targetStartDate: '2026-11-01', targetEndDate: '2026-11-10' })]
    expect(layoutTimeline(nov, { today: new Date('2026-11-15T00:00:00') }).today).toBe(14)
    expect(layoutTimeline(nov, { today: TODAY }).today).toBeNull() // after the domain
    expect(layoutTimeline(nov, { today: new Date('2026-09-01T00:00:00') }).today).toBeNull() // before it
  })

  it('does not mutate its input and orders bars by row then start', () => {
    const input = [
      entry('c', { targetStartDate: '2026-11-16', targetEndDate: '2026-11-20' }),
      entry('b', { targetStartDate: '2026-11-06', targetEndDate: '2026-11-15' }),
      entry('a', { targetStartDate: '2026-11-01', targetEndDate: '2026-11-10' }),
    ]
    const l = layoutTimeline(input, { today: TODAY })
    expect(input.map((e) => e.id)).toEqual(['c', 'b', 'a'])
    expect(l.bars.map((b) => b.id)).toEqual(['a', 'b', 'c'])
  })

  it('carries the derived bucket through — colour is a fact, not a setting', () => {
    const l = layoutTimeline(
      [
        entry('a', { targetStartDate: '2026-11-01', targetEndDate: '2026-11-10', bucket: 'inProgress' }),
        entry('b', { targetEndDate: '2026-11-12', bucket: 'done' }),
        entry('x', { bucket: 'backlog' }),
      ],
      { today: TODAY },
    )
    expect(l.bars.find((b) => b.id === 'a')!.bucket).toBe('inProgress')
    expect(l.bars.find((b) => b.id === 'b')!.bucket).toBe('done')
    expect(l.unscheduled[0].bucket).toBe('backlog')
  })
})
