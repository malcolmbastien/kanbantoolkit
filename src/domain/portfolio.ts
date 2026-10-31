import { objectiveRollup, rollupOf, type Graph, type Rollup } from './derive'
import { parseDay } from './filters'
import { initiativeHealth, type HealthFlag, type HealthLevel } from './health'
import type { Item, Objective } from './types'

/**
 * The portfolio at a glance: one row per objective, where the risk is concentrated.
 *
 * The strategy map answers "what serves what"; a leadership review also asks "where is it going
 * wrong, and when is it due". This module answers the second question from the same data — the
 * attribution edges, the work below the serving initiatives and the health rules — and stores
 * nothing. A row's coverage is the initiatives that serve it, its progress is the same
 * `objectiveRollup` the objective card shows, its health is the worst of the initiatives that
 * serve it, and its date is the nearest target among them.
 *
 * The ranking is a reading, not a new status: unserved work has no answer at all, an at-risk
 * initiative is a stop somebody can see, an overdue commitment is late even when nobody is blocked,
 * and "watch" is the quiet signal that something has not moved.
 */

export type PortfolioRisk = 'unserved' | 'atRisk' | 'overdue' | 'watch' | 'onTrack'

export interface PortfolioFlag {
  flag: HealthFlag
  tone: 'risk' | 'watch'
  /** How many serving initiatives raise it. The rule is the same on every initiative. */
  initiatives: number
}

export interface PortfolioHealth {
  /** `none` is an objective nothing serves: not healthy, not yet a health reading at all. */
  level: HealthLevel | 'none'
  risk: number
  watch: number
  flags: PortfolioFlag[]
}

export interface PortfolioRow {
  objective: Objective
  /** The strategic initiatives attributed to this objective. */
  serving: Item[]
  coverageGap: boolean
  /** The objective's completeness, from the same rollup an initiative uses. */
  rollup?: Rollup
  health: PortfolioHealth
  /** The nearest target date among the open serving initiatives, as the item stores it. */
  targetEnd?: string
  /** Open serving initiatives whose target date has passed. */
  overdue: number
  risk: PortfolioRisk
}

export interface PortfolioCounts {
  objectives: number
  unserved: number
  atRisk: number
  overdue: number
  watch: number
  onTrack: number
}

export interface PortfolioHeatmap {
  rows: PortfolioRow[]
  /** The periods the rows belong to, in reading order. */
  periods: string[]
  counts: PortfolioCounts
}

/** One objective's row, from the initiatives that serve it. */
function rowOf(objective: Objective, strategic: Item[], graph: Graph, now: number): PortfolioRow {
  const attributed = new Set(
    graph.edges.filter((edge) => edge.kind === 'attribution' && edge.from === objective.id).map((edge) => edge.to),
  )
  const serving = strategic.filter((initiative) => attributed.has(initiative.id))
  // An objective nothing in this reading serves has no percentage, even if an attribution exists
  // on another board: the row's coverage and its progress must answer the same question.
  const rollup = serving.length > 0 ? objectiveRollup(objective.id, graph) : undefined

  // Health is the serving initiatives', never the objective's own: an objective has no status
  // field and no work of its own. The same flag raised by three initiatives is one rule with a
  // count, not three rows.
  const flags = new Map<HealthFlag, PortfolioFlag>()
  let risk = 0
  let watch = 0
  for (const initiative of serving) {
    const health = initiativeHealth(initiative.id, graph, now)
    for (const flag of health.flags) {
      if (flag.tone === 'risk') risk++
      else watch++
      const seen = flags.get(flag.flag)
      if (seen) seen.initiatives++
      else flags.set(flag.flag, { flag: flag.flag, tone: flag.tone, initiatives: 1 })
    }
  }
  const level: PortfolioHealth['level'] =
    serving.length === 0 ? 'none' : risk > 0 ? 'atRisk' : watch > 0 ? 'watch' : 'healthy'

  // A finished initiative is not late and is not a date a review is waiting for. If every serving
  // initiative is done, the row still says when the work was aimed at, because that is its shape.
  const open = serving.filter((initiative) => rollupOf(initiative.id, graph).bucket !== 'done')
  const dated = (open.length > 0 ? open : serving)
    .map((initiative) => ({ iso: initiative.targetEndDate, at: parseDay(initiative.targetEndDate)?.getTime() }))
    .filter((entry): entry is { iso: string; at: number } => Boolean(entry.iso) && entry.at !== undefined)
    .sort((a, b) => a.at - b.at)
  const overdue = open.filter((initiative) => {
    const end = parseDay(initiative.targetEndDate)?.getTime()
    return end !== undefined && end < now
  }).length

  const riskRank: PortfolioRisk =
    serving.length === 0
      ? 'unserved'
      : level === 'atRisk'
        ? 'atRisk'
        : overdue > 0
          ? 'overdue'
          : level === 'watch'
            ? 'watch'
            : 'onTrack'

  return {
    objective,
    serving,
    coverageGap: serving.length === 0,
    ...(rollup ? { rollup } : {}),
    health: {
      level,
      risk,
      watch,
      flags: [...flags.values()].sort((a, b) => (a.tone === b.tone ? a.flag.localeCompare(b.flag) : a.tone === 'risk' ? -1 : 1)),
    },
    ...(dated[0] ? { targetEnd: dated[0].iso } : {}),
    overdue,
    risk: riskRank,
  }
}

/**
 * Every objective's row, grouped by period in reading order.
 *
 * `strategic` is the set the caller is reading — a portfolio board passes its own strategic
 * initiatives, so the heatmap and the flows beneath it are about the same work. An objective
 * nothing in that set serves is a coverage gap, not a row with 0%.
 */
export function portfolioHeatmap(
  objectives: Objective[],
  graph: Graph,
  strategic: Item[],
  now = Date.now(),
): PortfolioHeatmap {
  const rows = objectives
    .map((objective) => rowOf(objective, strategic, graph, now))
    .sort((a, b) => a.objective.period.localeCompare(b.objective.period) || a.objective.title.localeCompare(b.objective.title))

  const periods = [...new Set(rows.map((row) => row.objective.period))]
  const counts: PortfolioCounts = {
    objectives: rows.length,
    unserved: rows.filter((row) => row.risk === 'unserved').length,
    atRisk: rows.filter((row) => row.risk === 'atRisk').length,
    overdue: rows.filter((row) => row.risk === 'overdue').length,
    watch: rows.filter((row) => row.risk === 'watch').length,
    onTrack: rows.filter((row) => row.risk === 'onTrack').length,
  }
  return { rows, periods, counts }
}
