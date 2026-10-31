import { objectiveRollup, type Graph, type Rollup } from './derive'
import { initiativeHealth, type HealthFlag, type HealthLevel } from './health'
import { periodRank, periodsInOrder } from './periods'
import type { Item, Objective, Period } from './types'

/**
 * The portfolio at a glance: one row per objective, where the risk is concentrated.
 *
 * The strategy map answers "what serves what"; a leadership review also asks "where is it going
 * wrong, and which window is it in". This module answers the second question from the same data —
 * the attribution edges, the work below the serving initiatives and the health rules — and stores
 * nothing. A row's coverage is the initiatives that serve it, its progress is the same
 * `objectiveRollup` the objective card shows, its health is the worst of the initiatives that
 * serve it, and its window is the **period** it is committed for. An objective has no target date
 * of its own: it is due when its period ends, and the period is the record that says so.
 *
 * The ranking is a reading, not a new status: unserved work has no answer at all, an at-risk
 * initiative is a stop somebody can see, and "watch" is the quiet signal that something has not
 * moved.
 */

export type PortfolioRisk = 'unserved' | 'atRisk' | 'watch' | 'onTrack'

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
  /** The window it is committed for. Absent only when the period id is stale. */
  period?: Period
  /** The initiatives attributed to this objective — wherever their board sits. */
  serving: Item[]
  coverageGap: boolean
  /** The objective's completeness, from the same rollup an initiative uses. */
  rollup?: Rollup
  health: PortfolioHealth
  risk: PortfolioRisk
}

export interface PortfolioCounts {
  objectives: number
  unserved: number
  atRisk: number
  watch: number
  onTrack: number
}

export interface PortfolioHeatmap {
  rows: PortfolioRow[]
  /** The periods the rows belong to, in reading order. */
  periods: Period[]
  counts: PortfolioCounts
}

/** One objective's row, from the initiatives that serve it. */
function rowOf(
  objective: Objective,
  periods: Period[],
  graph: Graph,
  now: number,
  attributed: Set<string>,
  itemById: Map<string, Item>,
): PortfolioRow {
  // The work an objective is committed for may live on any board: a mapped initiative names the
  // outcome, wherever the team or programme that carries it sits.
  const serving = [...attributed]
    .map((id) => itemById.get(id))
    .filter((item): item is Item => item !== undefined && !item.archived)
  // An objective nothing serves has no percentage: its coverage and its progress must answer the
  // same question.
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

  const riskRank: PortfolioRisk =
    serving.length === 0 ? 'unserved' : level === 'atRisk' ? 'atRisk' : level === 'watch' ? 'watch' : 'onTrack'

  const period = periods.find((candidate) => candidate.id === objective.periodId)

  return {
    objective,
    ...(period ? { period } : {}),
    serving,
    coverageGap: serving.length === 0,
    ...(rollup ? { rollup } : {}),
    health: {
      level,
      risk,
      watch,
      flags: [...flags.values()].sort((a, b) => (a.tone === b.tone ? a.flag.localeCompare(b.flag) : a.tone === 'risk' ? -1 : 1)),
    },
    risk: riskRank,
  }
}

/**
 * Every objective's row, grouped by period in reading order.
 *
 * An objective is read from the initiatives mapped to it — anywhere in the workspace, not only the
 * ones placed on a portfolio board. An objective nothing serves is a coverage gap, not a row with 0%.
 */
export function portfolioHeatmap(
  objectives: Objective[],
  periods: Period[],
  graph: Graph,
  now = Date.now(),
): PortfolioHeatmap {
  // One pass over the attribution edges and the items, so a portfolio of many objectives does not
  // rescan the whole workspace once per row.
  const attributedByObjective = new Map<string, Set<string>>()
  for (const edge of graph.edges) {
    if (edge.kind !== 'attribution') continue
    const ids = attributedByObjective.get(edge.from)
    if (ids) ids.add(edge.to)
    else attributedByObjective.set(edge.from, new Set([edge.to]))
  }
  const itemById = new Map(graph.items.map((item) => [item.id, item] as const))

  const rows = objectives
    .map((objective) =>
      rowOf(objective, periods, graph, now, attributedByObjective.get(objective.id) ?? new Set(), itemById),
    )
    .sort(
      (a, b) =>
        periodRank(periods, a.objective.periodId) - periodRank(periods, b.objective.periodId) ||
        a.objective.title.localeCompare(b.objective.title),
    )

  const read = periodsInOrder(periods).filter((period) =>
    rows.some((row) => row.objective.periodId === period.id),
  )
  const counts: PortfolioCounts = {
    objectives: rows.length,
    unserved: rows.filter((row) => row.risk === 'unserved').length,
    atRisk: rows.filter((row) => row.risk === 'atRisk').length,
    watch: rows.filter((row) => row.risk === 'watch').length,
    onTrack: rows.filter((row) => row.risk === 'onTrack').length,
  }
  return { rows, periods: read, counts }
}
