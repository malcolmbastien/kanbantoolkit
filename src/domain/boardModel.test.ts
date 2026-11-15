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

  it('leaves discarded work out of a live rollup, and matches history for an archived one', () => {
    const item = (id: string, over: Partial<Graph['items'][number]> = {}): Graph['items'][number] => ({
      id,
      title: id,
      typeId: 't-story',
      createdAt: 0,
      ...over,
    })
    const edge = (from: string, to: string): Graph['edges'][number] => ({
      id: `${from}-${to}`,
      kind: 'decomposition',
      from,
      to,
    })
    const lane = (id: string, stage: 'done' | 'inProgress' | 'backlog'): Graph['lanes'][number] => ({
      id,
      boardId: 'b',
      parentId: null,
      order: 0,
      name: id,
      stage,
      flowId: 'f-cards',
    })
    const place = (itemId: string, laneId: string): Graph['placements'][number] => ({
      id: `p-${itemId}`,
      boardId: 'b',
      itemId,
      laneId,
    })
    const graph: Graph = {
      items: [
        item('live', { typeId: 't-initiative' }),
        item('archived', { typeId: 't-initiative', archived: true }),
        item('done', { resolvedAt: 1 }),
        item('done-2', { resolvedAt: 1 }),
        item('thrown', { archived: true, discarded: true }),
      ],
      edges: [edge('live', 'done'), edge('live', 'done-2'), edge('live', 'thrown'), edge('archived', 'done'), edge('archived', 'thrown')],
      links: [],
      placements: [place('done', 'done'), place('done-2', 'done'), place('thrown', 'ip')],
      lanes: [lane('done', 'done'), lane('ip', 'inProgress'), lane('backlog', 'backlog')],
    }
    const model = buildBoardModel(graph)
    // Live work: the discarded branch is not a plan that remains unfinished.
    expect(model.rollup.get('live')).toEqual(rollupOf('live', graph))
    // Two done leaves and one thrown away: 100%, not the 67% a discarded leaf would make it.
    expect(model.rollup.get('live')?.total).toBe(2)
    expect(model.rollup.get('live')?.percent).toBe(100)
    // An archived parent's own reading is historical, and keeps every leaf it had.
    expect(model.rollup.get('archived')).toEqual(rollupOf('archived', graph))
    expect(model.rollup.get('archived')?.total).toBe(2)
    expect(model.rollup.get('archived')?.percent).toBe(50)
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
