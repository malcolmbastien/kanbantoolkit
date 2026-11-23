/**
 * The geometry a cycle-time scatter needs, apart from the SVG that draws it.
 *
 * The component used to read the sample, choose the axis and group the percentile lines inline, so
 * the only way to check them was through a browser. This is the same arithmetic as a pure reading.
 */
import { percentile, sampleStats, type ScatterPoint } from './metrics'

const DAY_MS = 86_400_000
export const MAX_SCATTER_POINTS = 400

export interface ScatterLine {
  label: string
  value: number
  service: boolean
}

export interface ScatterReading {
  /** The points actually drawn: the last 400 when the sample is larger. */
  shown: ScatterPoint[]
  /** How many points sit above the axis cap, for the note beneath the chart. */
  above: number
  cap: number
  from: number
  to: number
  stats: ReturnType<typeof sampleStats>
  lines: ScatterLine[]
}

const shareLabel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`

export function scatterReading(
  points: ScatterPoint[],
  since: number | undefined,
  service: { share: number; days: number } | undefined,
  now = Date.now(),
): ScatterReading {
  const stats = sampleStats(points.map((point) => point.cycle))
  const cap = Math.max(1, Math.ceil(percentile(points.map((point) => point.cycle), 98) ?? 1))
  const shown = points.length > MAX_SCATTER_POINTS ? points.slice(-MAX_SCATTER_POINTS) : points
  const above = points.filter((point) => point.cycle > cap).length
  const latest = points[points.length - 1].resolvedAt
  const from = Math.min(since ?? points[0].resolvedAt, latest - DAY_MS)
  const to = Math.max(now, latest, from + DAY_MS)
  const lines: ScatterLine[] = service
    ? [
        ...(stats.p50 !== undefined && service.share !== 50
          ? [{ label: 'p50', value: stats.p50, service: false }]
          : []),
        { label: shareLabel(service.share), value: service.days, service: true },
      ]
    : [
        { label: 'p50', value: stats.p50 },
        { label: 'p85', value: stats.p85 },
        { label: 'p95', value: stats.p95 },
      ].flatMap((line) => (line.value === undefined ? [] : [{ ...line, value: line.value, service: false }]))
  return { shown, above, cap, from, to, stats, lines }
}
