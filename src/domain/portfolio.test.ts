import { describe, expect, it } from 'vitest'
import { portfolioHeatmap } from './portfolio'
import type { Graph } from './derive'
import type { Edge, Item, Lane, Objective, Period, Placement } from './types'

const now = new Date('2026-10-30T12:00:00').getTime()
const lanes: Lane[] = [
  { id: 'l-todo', boardId: 'b-portfolio', parentId: null, order: 0, name: 'Doing', flowId: 'f-init', stage: 'inProgress' },
  { id: 'l-done', boardId: 'b-portfolio', parentId: null, order: 1, name: 'Done', flowId: 'f-init', stage: 'done' },
]
const item = (id: string, extra: Partial<Item> = {}): Item => ({ id, title: id, typeId: 't-init', createdAt: 0, ...extra })
const place = (itemId: string, laneId: string): Placement => ({ id: `p-${itemId}`, boardId: 'b-portfolio', itemId, laneId })
const attribution = (objectiveId: string, initiativeId: string): Edge => ({
  id: `a-${objectiveId}-${initiativeId}`,
  kind: 'attribution',
  from: objectiveId,
  to: initiativeId,
})
const decomposition = (parent: string, child: string): Edge => ({
  id: `d-${parent}-${child}`,
  kind: 'decomposition',
  from: parent,
  to: child,
})
const objective = (id: string, periodId: string, title = id): Objective => ({ id, title, periodId, status: 'active' })

const q4: Period = { id: 'p-q4', name: 'FY26 Q4', start: '2026-10-01', end: '2026-12-31' }
const q1: Period = { id: 'p-q1', name: 'FY27 Q1', start: '2027-01-01', end: '2027-03-31' }

/** One initiative with one leaf, so its rollup and health have something to read. */
function project(id: string, stage: 'l-todo' | 'l-done', extra: Partial<Item> = {}) {
  const initiative = item(id, extra)
  const leaf = item(`${id}-card`, {
    typeId: 't-story',
    assignees: ['u-1'],
    ...(extra.targetEndDate ? { targetEndDate: extra.targetEndDate } : {}),
  })
  return { initiative, leaf, edges: [decomposition(id, leaf.id)], placements: [place(leaf.id, stage)] }
}

function graphOf(initiatives: Item[], edges: Edge[], placements: Placement[]): Graph {
  const leaves = placements.map((placement) => item(placement.itemId, { typeId: 't-story', assignees: ['u-1'] }))
  return {
    items: [...initiatives, ...leaves],
    edges,
    links: [],
    placements,
    lanes,
  }
}

describe('the portfolio risk heatmap', () => {
  it('reads coverage, progress, health and its period from the work', () => {
    const risk = project('i-risk', 'l-todo', { targetEndDate: '2026-10-01' })
    // The leaf is blocked, so the initiative is at risk even though its own date means nothing here.
    risk.leaf.blocked = true
    const healthy = project('i-healthy', 'l-done', { targetEndDate: '2027-01-01' })
    const objectives = [objective('o-risk', 'p-q4'), objective('o-healthy', 'p-q4'), objective('o-gap', 'p-q4')]
    const graph = graphOf(
      [risk.initiative, healthy.initiative],
      [attribution('o-risk', 'i-risk'), decomposition('i-risk', 'i-risk-card'), attribution('o-healthy', 'i-healthy'), decomposition('i-healthy', 'i-healthy-card')],
      [...risk.placements, ...healthy.placements],
    )
    // `graphOf` builds the leaf from its placement; the blocked flag belongs to that copy.
    graph.items.find((entry) => entry.id === 'i-risk-card')!.blocked = true

    const map = portfolioHeatmap(objectives, [q4], graph, now)
    const row = (id: string) => map.rows.find((entry) => entry.objective.id === id)!

    expect(row('o-risk')).toMatchObject({
      coverageGap: false,
      risk: 'atRisk',
      rollup: { total: 1, done: 0, percent: 0 },
    })
    expect(row('o-risk').period).toEqual(q4)
    expect(row('o-risk').health.level).toBe('atRisk')
    expect(row('o-healthy')).toMatchObject({ risk: 'onTrack', rollup: { total: 1, done: 1, percent: 100 } })
    expect(row('o-gap')).toMatchObject({ coverageGap: true, risk: 'unserved' })
    expect(row('o-gap').rollup).toBeUndefined()
    expect(map.counts).toMatchObject({ objectives: 3, atRisk: 1, onTrack: 1, unserved: 1 })
  })

  it('has no date of its own: an objective is due when its period ends, so the row carries the period', () => {
    const work = project('i-a', 'l-todo')
    const objectives = [objective('o-a', 'p-q4', 'A'), objective('o-stale', 'p-gone', 'Gone')]
    const graph = graphOf(
      [work.initiative],
      [attribution('o-a', 'i-a'), decomposition('i-a', 'i-a-card')],
      work.placements,
    )
    const map = portfolioHeatmap(objectives, [q4], graph, now)
    // A row whose period is gone is still a row — the work it carries must not vanish with it.
    expect(map.rows.map((row) => [row.objective.title, row.period?.name])).toEqual([
      ['A', 'FY26 Q4'],
      ['Gone', undefined],
    ])
  })

  it('counts an initiative mapped from another board, wherever it is placed', () => {
    const work = project('i-team', 'l-done')
    // The initiative lives on a team board; nothing about it is placed on the portfolio.
    const graph = graphOf(
      [work.initiative],
      [attribution('o-1', 'i-team'), decomposition('i-team', 'i-team-card')],
      work.placements,
    )
    const map = portfolioHeatmap([objective('o-1', 'p-q4')], [q4], graph, now)
    expect(map.rows[0].serving.map((item) => item.id)).toEqual(['i-team'])
    expect(map.rows[0].rollup).toMatchObject({ total: 1, done: 1, percent: 100 })
  })

  it('lists the periods its objectives are committed for, in reading order', () => {
    const a = project('i-a', 'l-todo')
    const b = project('i-b', 'l-todo')
    const objectives = [objective('o-b', 'p-q1', 'B'), objective('o-a', 'p-q4', 'A')]
    const graph = graphOf(
      [a.initiative, b.initiative],
      [attribution('o-a', 'i-a'), decomposition('i-a', 'i-a-card'), attribution('o-b', 'i-b'), decomposition('i-b', 'i-b-card')],
      [...a.placements, ...b.placements],
    )
    const map = portfolioHeatmap(objectives, [q1, q4], graph, now)
    expect(map.periods.map((period) => period.name)).toEqual(['FY26 Q4', 'FY27 Q1'])
    expect(map.rows.map((row) => row.objective.title)).toEqual(['A', 'B'])
    expect(portfolioHeatmap([], [q4], graph, now)).toMatchObject({ rows: [], periods: [], counts: { objectives: 0 } })
  })

  it('counts a shared leaf once, and a flag once per initiative that raises it', () => {
    const one = project('i-one', 'l-todo')
    const two = project('i-two', 'l-todo')
    // Both initiatives sit over the same card, which nobody owns: the rollup counts it once and
    // the unowned rule is one flag with two initiatives behind it.
    one.leaf.assignees = []
    const graph: Graph = {
      items: [one.initiative, two.initiative, one.leaf],
      edges: [
        attribution('o-1', 'i-one'),
        attribution('o-1', 'i-two'),
        decomposition('i-one', one.leaf.id),
        decomposition('i-two', one.leaf.id),
      ],
      links: [],
      placements: [place(one.leaf.id, 'l-todo')],
      lanes,
    }
    const map = portfolioHeatmap([objective('o-1', 'p-q4')], [q4], graph, now)
    expect(map.rows[0].rollup?.total).toBe(1)
    expect(map.rows[0].health.flags.filter((flag) => flag.flag === 'unowned')).toEqual([
      expect.objectContaining({ initiatives: 2 }),
    ])
  })
})
