import { dependencyState, isOpen, type Graph, type Rollup, type Status } from './derive'
import { effectiveStage } from './lanes'
import type { Item, Lane, Placement, Stage } from './types'

/**
 * The board's derived facts, built in one pass.
 *
 * A card face asks for the same handful of answers every time — its parent, its children, its
 * rollup, its open work below, what it waits for — and the functions in `derive.ts` answer each by
 * scanning the arrays. Per card, that is quadratic in the size of the board. This model indexes the
 * arrays once; the render then costs a lookup per card.
 *
 * It is pure and React-free, so the values can be checked against the functions they replace
 * without a render. It is keyed on the data, never on selection or drag: those change a card's
 * props, not the board's facts.
 */
export interface BoardModel {
  itemsById: ReadonlyMap<string, Item>
  placementByItem: ReadonlyMap<string, Placement>
  laneById: ReadonlyMap<string, Lane>
  parentOf: ReadonlyMap<string, string>
  childrenOf: ReadonlyMap<string, readonly string[]>
  stage: ReadonlyMap<string, Stage | undefined>
  status: ReadonlyMap<string, Status>
  rollup: ReadonlyMap<string, Rollup>
  /** Open descendants at any depth, not counting the item itself. */
  openDescendants: ReadonlyMap<string, number>
  /** Blocked, open descendants at any depth. */
  blockedBelow: ReadonlyMap<string, number>
  /** The dependency ids this item waits for. */
  dependenciesOf: ReadonlyMap<string, readonly string[]>
  /** The dependent ids that wait for this item. */
  dependentsOf: ReadonlyMap<string, readonly string[]>
  /** The still-open dependencies of this item. */
  openDependencies: ReadonlyMap<string, ReadonlySet<string>>
}


export function buildBoardModel(graph: Graph): BoardModel {
  const itemsById = new Map(graph.items.map((item) => [item.id, item]))
  const laneById = new Map(graph.lanes.map((lane) => [lane.id, lane]))

  // The first placement, as `statusOf` reads it. A card on two boards is two placements; the
  // board surface uses its own per-board lane map, and this matches the domain's answer.
  const placementByItem = new Map<string, Placement>()
  for (const placement of graph.placements) if (!placementByItem.has(placement.itemId)) placementByItem.set(placement.itemId, placement)

  const parentOf = new Map<string, string>()
  const childrenOf = new Map<string, string[]>()
  for (const edge of graph.edges) {
    if (edge.kind !== 'decomposition') continue
    parentOf.set(edge.to, edge.from)
    const kids = childrenOf.get(edge.from)
    if (kids) kids.push(edge.to)
    else childrenOf.set(edge.from, [edge.to])
  }

  const stage = new Map<string, Stage | undefined>()
  const status = new Map<string, Status>()
  for (const item of graph.items) {
    const placement = placementByItem.get(item.id)
    const value = placement ? effectiveStage(graph.lanes, placement.laneId) : undefined
    stage.set(item.id, value)
    status.set(
      item.id,
      value === 'done'
        ? { resolved: true, started: true }
        : value === 'inProgress'
          ? { resolved: false, started: true }
          : { resolved: false, started: false },
    )
  }

  const rollup = new Map<string, Rollup>()
  const rollupFor = (id: string): Rollup => {
    const cached = rollup.get(id)
    if (cached) return cached
    const kids = childrenOf.get(id) ?? []
    let total = 0
    let done = 0
    let started = 0
    let committed = 0
    let uncommitted = 0
    if (kids.length === 0) {
      total = 1
      if (stage.get(id) === 'backlog') uncommitted = 1
      else {
        committed = 1
        const current = status.get(id)
        if (current?.resolved) {
          done = 1
          started = 1
        } else if (current?.started) started = 1
      }
    } else {
      for (const kid of kids) {
        const child = rollupFor(kid)
        total += child.total
        done += child.done
        started += child.done + child.inProgress
        committed += child.done + child.inProgress + child.notStarted
        uncommitted += child.uncommitted
      }
    }
    const value: Rollup = {
      total,
      done,
      inProgress: Math.max(0, started - done),
      notStarted: Math.max(0, committed - started),
      uncommitted,
      percent: total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100)),
      bucket: total === 0 ? 'backlog' : done === total ? 'done' : started > 0 ? 'inProgress' : committed > 0 ? 'notStarted' : 'backlog',
    }
    rollup.set(id, value)
    return value
  }

  const open = (id: string) => status.get(id)?.resolved !== true && itemsById.get(id)?.archived !== true
  const openDescendants = new Map<string, number>()
  const blockedBelow = new Map<string, number>()
  const openBelow = (id: string): { open: number; blocked: number } => {
    const cachedOpen = openDescendants.get(id)
    if (cachedOpen !== undefined) return { open: cachedOpen, blocked: blockedBelow.get(id) ?? 0 }
    let count = 0
    let blocked = 0
    for (const kid of childrenOf.get(id) ?? []) {
      const below = openBelow(kid)
      if (open(kid)) count += 1
      count += below.open
      if (open(kid) && itemsById.get(kid)?.blocked === true) blocked += 1
      blocked += below.blocked
    }
    openDescendants.set(id, count)
    blockedBelow.set(id, blocked)
    return { open: count, blocked }
  }

  const dependenciesOf = new Map<string, string[]>()
  const dependentsOf = new Map<string, string[]>()
  const openDependencies = new Map<string, Set<string>>()
  for (const link of graph.links) {
    const dependencies = dependenciesOf.get(link.to)
    if (dependencies) dependencies.push(link.from)
    else dependenciesOf.set(link.to, [link.from])
    const dependents = dependentsOf.get(link.from)
    if (dependents) dependents.push(link.to)
    else dependentsOf.set(link.from, [link.to])
    if (isOpen(dependencyState(link.from, link.to, graph))) {
      const waiting = openDependencies.get(link.to)
      if (waiting) waiting.add(link.from)
      else openDependencies.set(link.to, new Set([link.from]))
    }
  }

  for (const item of graph.items) {
    rollupFor(item.id)
    openBelow(item.id)
  }

  return {
    itemsById,
    placementByItem,
    laneById,
    parentOf,
    childrenOf,
    stage,
    status,
    rollup,
    openDescendants,
    blockedBelow,
    dependenciesOf,
    dependentsOf,
    openDependencies,
  }
}
