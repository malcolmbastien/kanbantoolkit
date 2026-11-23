import { describe, expect, it } from 'vitest'
import { scatterReading } from './scatterChart'
import type { ScatterPoint } from './metrics'

const point = (id: string, cycle: number, resolvedAt: number): ScatterPoint => ({
  id,
  title: id,
  createdAt: resolvedAt - cycle * 86_400_000,
  committedAt: resolvedAt - cycle * 86_400_000,
  resolvedAt,
  lead: cycle,
  cycle,
})

describe('the cycle-time scatter reading', () => {
  const now = Date.UTC(2026, 10, 23)
  const points = [point('a', 1, now - 3 * 86_400_000), point('b', 4, now - 2 * 86_400_000), point('c', 9, now)]

  it('draws the sample, caps the axis at p98 and names the service line', () => {
    const reading = scatterReading(points, undefined, { share: 85, days: 6 }, now)
    expect(reading.shown.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(reading.cap).toBeGreaterThanOrEqual(9)
    expect(reading.above).toBe(0)
    expect(reading.lines).toEqual([
      { label: 'p50', value: 4, service: false },
      { label: '85%', value: 6, service: true },
    ])
    expect(reading.from).toBeLessThanOrEqual(reading.to)
  })

  it('keeps the last 400 points and counts the ones above the cap', () => {
    const many = Array.from({ length: 405 }, (_, i) => point(`p${i}`, i === 0 ? 100 : 1, now - 405 + i))
    const reading = scatterReading(many, undefined, undefined, now)
    expect(reading.shown).toHaveLength(400)
    expect(reading.shown[0].id).toBe('p5')
    expect(reading.above).toBe(1)
  })
})
