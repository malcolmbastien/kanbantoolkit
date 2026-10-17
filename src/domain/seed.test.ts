import { describe, expect, it } from 'vitest'
import { createSeed } from './seed'
import { demoWorkspace } from './demo'
import { boardInitiatives, initiativeTypeId, isStrategicInitiative } from './board'
import { blockedBelow, descendants, openDependenciesOf, rollupOf, type Graph } from './derive'
import { initiativeHealth } from './health'
import { childrenOf, effectiveStage, isLeaf, laneCardCount, placementsInOrder, topLevelLanes } from './lanes'
import type { Stage } from './types'

/**
 * The demo is data, and data can be wrong in ways a type cannot catch: a card in a cell whose
 * stage its history disagrees with, an initiative placed in a section its own rollup does not
 * name, a link pointing at something that does not exist. This is the check that the dataset a
 * client will actually look at is coherent — and that the imperfections in it are the deliberate
 * ones, not accidents.
 */
const seed = createSeed()
const { items, placements, edges, links, boards, lanes } = seed
const graph: Graph = { items, edges, links, placements, lanes }
const initiativeType = initiativeTypeId(seed.issueTypes)!

const cards = items.filter((i) => i.typeId !== initiativeType)
const initiatives = items.filter((i) => i.typeId === initiativeType)
const at = (id: string) => placements.find((p) => p.itemId === id)!
const stageOf = (id: string) => effectiveStage(lanes, at(id).laneId)

describe('the demo dataset', () => {
  it('is built on the boards the app ships, four typed columns and all', () => {
    const shared = demoWorkspace()
    expect(seed.boards.map((b) => b.id)).toEqual(shared.boards.map((b) => b.id))
    expect(seed.boards).toHaveLength(6)
    for (const board of seed.boards) {
      const cards = topLevelLanes(lanes, board.id, 'cards')
      const init = topLevelLanes(lanes, board.id, 'initiatives')
      expect(cards.map((c) => c.stage), board.name).toEqual(['backlog', 'notStarted', 'inProgress', 'done'])
      expect(init.map((c) => c.stage), board.name).toEqual(['backlog', 'notStarted', 'inProgress', 'done'])
    }
  })

  it('gives every board work to show, and every card a cell of its own flow', () => {
    for (const board of boards) {
      const here = boardInitiatives(graph, board.id, seed.issueTypes)
      expect(here.length, `${board.name} has no initiatives`).toBeGreaterThan(0)
    }
    for (const card of cards) {
      const placement = at(card.id)
      expect(placement, card.title).toBeDefined()
      expect(isLeaf(lanes, placement.laneId), `${card.title} is not in a cell`).toBe(true)
      // A card's own log ends where it sits, and its arrival stamp is that same moment.
      const moves = (card.log ?? []).filter((e) => e.kind === 'moved')
      const stage = stageOf(card.id) as Stage
      expect(moves.at(-1)?.toStage ?? 'backlog', card.title).toBe(stage)
      if (moves.length > 0) expect(placement.laneEnteredAt, card.title).toBe(moves.at(-1)!.at)
      // Resolved exactly when it is done; filed away only once it was delivered.
      expect(Boolean(card.resolvedAt), card.title).toBe(stage === 'done')
      expect(Boolean(card.archived), card.title).toBe(Boolean(card.resolvedAt) && Boolean(card.archivedAt))
      // And every history is in time order.
      const times = (card.log ?? []).map((e) => e.at)
      expect([...times].sort((x, y) => x - y), card.title).toEqual(times)
    }
  })

  it('places every initiative in the section its own rollup names', () => {
    for (const init of initiatives) {
      const placement = at(init.id)
      expect(lanes.find((l) => l.id === placement.laneId)!.workflow, init.title).toBe('initiatives')
      expect(isLeaf(lanes, placement.laneId), init.title).toBe(true)
      // A section is derived from the work below, so the placement must agree with the rollup —
      // otherwise the initiative reads in a section it is not actually in.
      expect(stageOf(init.id), init.title).toBe(rollupOf(init.id, graph).bucket)
    }
  })

  it('holds together: no dangling reference, one parent each, a rank per cell', () => {
    const ids = new Set(items.map((i) => i.id))
    for (const placement of placements) {
      expect(ids.has(placement.itemId), placement.itemId).toBe(true)
      expect(lanes.some((l) => l.id === placement.laneId), placement.laneId).toBe(true)
    }
    // A decomposition edge is item to item; an attribution edge is objective to initiative, so it
    // is checked against the objectives instead.
    for (const edge of edges.filter((e) => e.kind === 'decomposition')) {
      expect(ids.has(edge.from) && ids.has(edge.to), `${edge.from}→${edge.to}`).toBe(true)
    }
    for (const link of links) expect(ids.has(link.from) && ids.has(link.to), `${link.from}→${link.to}`).toBe(true)
    const objectiveIds = new Set(seed.objectives.map((o) => o.id))
    for (const edge of edges.filter((e) => e.kind === 'attribution')) {
      expect(objectiveIds.has(edge.from) && ids.has(edge.to), `${edge.from}→${edge.to}`).toBe(true)
    }

    // One parent, at most: a decomposition is a tree.
    const parents = new Map<string, number>()
    for (const edge of edges.filter((e) => e.kind === 'decomposition')) {
      parents.set(edge.to, (parents.get(edge.to) ?? 0) + 1)
    }
    expect([...parents.entries()].filter(([, n]) => n > 1)).toEqual([])

    // A rank per cell: either a clean 0..n-1, or none at all — in which case the order is the
    // order the seed placed them in, which is what `placementsInOrder` falls back to.
    for (const lane of lanes.filter((l) => isLeaf(lanes, l.id))) {
      const ordered = placementsInOrder(placements, lane.id)
      const ranks = ordered.map((p) => p.rank)
      const clean = ranks.every((r) => r === undefined) || ranks.join() === ordered.map((_, i) => i).join()
      expect(clean, lane.name).toBe(true)
    }
  })

  it('maps OKRs to strategic initiatives only, and leaves both coverage gaps showing', () => {
    const strategic = initiatives.filter((i) => isStrategicInitiative(i.id, { ...graph, boards, issueTypes: seed.issueTypes }))
    expect(strategic.length).toBeGreaterThanOrEqual(3)
    const mapped = new Set(edges.filter((e) => e.kind === 'attribution').map((e) => e.to))
    for (const id of mapped) {
      expect(strategic.some((i) => i.id === id), `${id} is not strategic`).toBe(true)
    }
    // One strategic initiative serves no OKR…
    expect(strategic.filter((i) => !mapped.has(i.id)).map((i) => i.id)).toEqual(['init-trust'])
    // …and one objective is served by no strategic initiative.
    const served = new Set(edges.filter((e) => e.kind === 'attribution').map((e) => e.from))
    expect(seed.objectives.filter((o) => !served.has(o.id)).map((o) => o.id)).toEqual(['obj-reliability'])
  })

  it('keeps the imperfections it is meant to have, so the views have something to say', () => {
    // A card waiting on another board — the boundary lane's reason to exist.
    const waiting = cards.filter((c) => openDependenciesOf(c.id, graph).length > 0)
    expect(waiting.map((c) => c.id)).toContain('st-enterprise-sso')
    const acrossBoards = waiting.filter((c) =>
      openDependenciesOf(c.id, graph).some((d) => at(d.dependency.id).boardId !== at(c.id).boardId),
    )
    expect(acrossBoards.length).toBeGreaterThan(0)

    // Blocked work, including one nobody has picked up.
    const blocked = cards.filter((c) => c.blocked)
    expect(blocked.length).toBeGreaterThanOrEqual(2)
    expect(blocked.some((c) => stageOf(c.id) === 'backlog')).toBe(true)

    // An initiative with nothing under it, and one whose only work was delivered.
    expect(initiatives.filter((i) => descendants(i.id, graph).length === 0).map((i) => i.id)).toEqual(['init-data-quality'])
    expect(stageOf('init-slo')).toBe('done')

    // The health column is a mix, not a row of identical badges: the rules have to have
    // something to find, and something to be quiet about.
    const levels = initiatives.map((i) => initiativeHealth(i.id, graph).level)
    expect(new Set(levels).size).toBeGreaterThanOrEqual(2)
    expect(levels).toContain('atRisk')
    // Work nobody owns, including one committed card.
    expect(cards.filter((c) => !c.assignees || c.assignees.length === 0).length).toBeGreaterThanOrEqual(2)
    expect(initiativeHealth('init-billing', graph).flags.map((f) => f.flag)).toContain('unowned')
    expect(cards.filter((c) => (c.checklist ?? []).length > 0).length).toBeGreaterThanOrEqual(3)
    expect(cards.filter((c) => c.targetEndDate).length).toBeGreaterThanOrEqual(10)

    // A column over its limit: the demo's WIP limits are meant to bite.
    const over = lanes.filter((l) => l.wipLimit !== undefined && laneCardCount(lanes, placements, l.id) > l.wipLimit!)
    expect(over.length).toBeGreaterThan(0)
    expect(childrenOf(lanes, topLevelLanes(lanes, 'b-atlas', 'cards')[2].id).map((l) => l.name)).toEqual(['Dev', 'Test'])
  })

  it('labels initiatives with the board’s own kinds, and leaves the team boards plain', () => {
    const kinds = (boardId: string) => boards.find((b) => b.id === boardId)!.initiativeTypes ?? []
    expect(kinds('b-strategy').map((k) => k.name)).toEqual(['Bet', 'Programme', 'Experiment'])
    expect(kinds('b-portfolio').map((k) => k.name)).toEqual(['Workstream', 'Enabler'])
    // A team board has none, which is what "None is the only option" looks like.
    expect(kinds('b-atlas')).toEqual([])

    // A kind belongs to the board that owns the outcome, so the demo never labels an initiative
    // with another board's vocabulary — and no kind is called None.
    for (const init of initiatives) {
      const board = boards.find((b) => b.id === at(init.id).boardId)!
      if (!init.initiativeTypeId) continue
      expect(board.initiativeTypes?.some((k) => k.id === init.initiativeTypeId), init.title).toBe(true)
    }
    expect(initiatives.filter((i) => i.initiativeTypeId).length).toBeGreaterThanOrEqual(6)
    expect(boards.flatMap((b) => b.initiativeTypes ?? []).every((k) => !/^none$/i.test(k.name))).toBe(true)
  })

  it('has a history old enough for Flow to have a shape', () => {
    const delivered = cards.filter((c) => c.resolvedAt)
    expect(delivered.length).toBeGreaterThanOrEqual(4)
    const archived = cards.filter((c) => c.archived)
    expect(archived.length).toBeGreaterThanOrEqual(2)
    const oldest = Math.min(...cards.map((c) => c.createdAt))
    const newest = Math.max(...cards.map((c) => c.resolvedAt ?? c.createdAt))
    expect(newest - oldest).toBeGreaterThan(50 * 86_400_000)
    // And the health of the whole programme is mixed, not uniformly green.
    const levels = initiatives.map((i) => blockedBelow(i.id, graph))
    expect(levels.some((n) => n > 0)).toBe(true)
  })
})
