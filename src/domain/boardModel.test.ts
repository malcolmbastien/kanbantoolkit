import { describe, expect, it } from 'vitest'
import { createFixture } from './fixture'
import { createSeed } from './seed'
import { stressBoard } from './stressBoard'
import { buildBoardModel } from './boardModel'
import {
  blockedBelow,
  openDependenciesOf,
  openDescendants,
  rollupOf,
  stageOf,
  statusOf,
  type Graph,
} from './derive'

const graphOf = (state: { items: Graph['items']; edges: Graph['edges']; links: Graph['links']; placements: Graph['placements']; lanes: Graph['lanes'] }): Graph => ({
  items: state.items,
  edges: state.edges,
  links: state.links,
  placements: state.placements,
  lanes: state.lanes,
})

describe('the board model', () => {
  it('answers exactly as the per-card functions do on the fixture', () => {
    const graph = graphOf(createFixture())
    const model = buildBoardModel(graph)
    for (const item of graph.items) {
      expect(model.rollup.get(item.id), `${item.id} rollup`).toEqual(rollupOf(item.id, graph))
      expect(model.status.get(item.id), `${item.id} status`).toEqual(statusOf(item.id, graph))
      expect(model.stage.get(item.id), `${item.id} stage`).toBe(stageOf(item.id, graph))
      expect(model.openDescendants.get(item.id), `${item.id} open below`).toBe(openDescendants(item.id, graph).length)
      expect(model.blockedBelow.get(item.id), `${item.id} blocked below`).toBe(blockedBelow(item.id, graph))
      expect(
        [...(model.openDependencies.get(item.id) ?? [])].sort(),
        `${item.id} open dependencies`,
      ).toEqual(openDependenciesOf(item.id, graph).map((dependency) => dependency.dependency.id).sort())
    }
  })

  it('answers exactly as the per-card functions do on a stress board', () => {
    const seed = createSeed()
    const stress = stressBoard(300, seed.issueTypes)
    const graph = graphOf({
      items: [...seed.items, ...stress.items],
      edges: [...seed.edges, ...stress.edges],
      links: [...seed.links, ...stress.links],
      placements: [...seed.placements, ...stress.placements],
      lanes: [...seed.lanes, ...stress.lanes],
    })
    const model = buildBoardModel(graph)
    for (const item of stress.items) {
      expect(model.rollup.get(item.id), `${item.id} rollup`).toEqual(rollupOf(item.id, graph))
      expect(model.openDescendants.get(item.id), `${item.id} open below`).toBe(openDescendants(item.id, graph).length)
      expect(model.blockedBelow.get(item.id), `${item.id} blocked below`).toBe(blockedBelow(item.id, graph))
    }
  })
})
