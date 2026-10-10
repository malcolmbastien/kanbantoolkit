import type { Edge, Item, KeyResult, Lane, Objective, Placement } from './types'

export interface Graph {
  items: Item[]
  edges: Edge[]
  placements: Placement[]
  lanes: Lane[]
}

/* ------------------------------------------------------------------ *
 * Decomposition traversal — one parent, many children
 * ------------------------------------------------------------------ */

export function decompositionChildren(id: string, edges: Edge[]): string[] {
  return edges.filter((e) => e.kind === 'decomposition' && e.from === id).map((e) => e.to)
}

export function decompositionParent(id: string, edges: Edge[]): string | undefined {
  return edges.find((e) => e.kind === 'decomposition' && e.to === id)?.from
}

export function descendants(id: string, graph: Graph): string[] {
  const out: string[] = []
  const stack = [...decompositionChildren(id, graph.edges)]
  while (stack.length) {
    const next = stack.pop()!
    out.push(next)
    stack.push(...decompositionChildren(next, graph.edges))
  }
  return out
}

/** Distance from a root via decomposition — the derived structural fact. */
export function depth(id: string, graph: Graph): number {
  let d = 0
  let cur = decompositionParent(id, graph.edges)
  const seen = new Set<string>([id])
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    d += 1
    cur = decompositionParent(cur, graph.edges)
  }
  return d
}

export function roots(graph: Graph): Item[] {
  return graph.items.filter((i) => !decompositionParent(i.id, graph.edges))
}

/* ------------------------------------------------------------------ *
 * Status — derived from the column lane a card is placed in
 * ------------------------------------------------------------------ */

export interface Status {
  resolved: boolean
  cancelled: boolean
  started: boolean
}

export function statusOf(itemId: string, graph: Graph): Status {
  const placement = graph.placements.find((p) => p.itemId === itemId)
  if (!placement) return { resolved: false, cancelled: false, started: false }
  const lane = graph.lanes.find((l) => l.id === placement.laneId)
  return {
    resolved: Boolean(lane?.isDone),
    cancelled: Boolean(lane?.isCancelled),
    started: !(lane?.isStart ?? false),
  }
}

/* ------------------------------------------------------------------ *
 * Dependency state — computed from both endpoints
 * ------------------------------------------------------------------ */

export type DependencyState =
  | 'Closed'
  | 'Satisfied'
  | 'OpenPlanningRisk'
  | 'OpenLiveBlockage'
  | 'Void'

export function dependencyState(blockerId: string, dependentId: string, graph: Graph): DependencyState {
  const b = statusOf(blockerId, graph)
  const d = statusOf(dependentId, graph)
  if (d.resolved) return 'Closed'
  if (b.cancelled) return 'Void'
  if (b.resolved) return 'Satisfied'
  if (!d.started) return 'OpenPlanningRisk'
  return 'OpenLiveBlockage'
}

export const isOpen = (s: DependencyState) => s === 'OpenPlanningRisk' || s === 'OpenLiveBlockage'

export interface DependencyInfo {
  edge: Edge
  blocker: Item
  dependent: Item
  state: DependencyState
}

export function readDependency(edge: Edge, graph: Graph): DependencyInfo | null {
  const blocker = graph.items.find((i) => i.id === edge.from)
  const dependent = graph.items.find((i) => i.id === edge.to)
  if (!blocker || !dependent || edge.kind !== 'dependency') return null
  return { edge, blocker, dependent, state: dependencyState(edge.from, edge.to, graph) }
}

export function incomingDependencies(itemId: string, graph: Graph): DependencyInfo[] {
  return graph.edges
    .filter((e) => e.kind === 'dependency' && e.to === itemId)
    .map((e) => readDependency(e, graph))
    .filter((x): x is DependencyInfo => x !== null)
}

export function outgoingDependencies(itemId: string, graph: Graph): DependencyInfo[] {
  return graph.edges
    .filter((e) => e.kind === 'dependency' && e.from === itemId)
    .map((e) => readDependency(e, graph))
    .filter((x): x is DependencyInfo => x !== null)
}

export function blockingDeps(itemId: string, graph: Graph): DependencyInfo[] {
  return incomingDependencies(itemId, graph).filter(
    (d) => d.edge.dep?.status === 'confirmed' && isOpen(d.state),
  )
}

export function isBlocked(itemId: string, graph: Graph): boolean {
  return blockingDeps(itemId, graph).length > 0
}

export function confirmationRequests(itemId: string, graph: Graph): DependencyInfo[] {
  return outgoingDependencies(itemId, graph).filter((d) => d.edge.dep?.status === 'proposed')
}

/** "N items blocked by this" — distinct boards among the dependents. */
export function blockingSummary(itemId: string, graph: Graph): { count: number; boards: number } {
  const confirmed = outgoingDependencies(itemId, graph).filter(
    (d) => d.edge.dep?.status === 'confirmed' && !statusOf(d.dependent.id, graph).resolved,
  )
  const boardOf = (itemId: string) =>
    graph.placements.find((p) => p.itemId === itemId)?.boardId ?? 'none'
  const boards = new Set(confirmed.map((d) => boardOf(d.dependent.id)))
  return { count: confirmed.length, boards: boards.size }
}

/* ------------------------------------------------------------------ *
 * Composition pressure + attribution
 * ------------------------------------------------------------------ */

export function openDescendants(id: string, graph: Graph): Item[] {
  return descendants(id, graph)
    .map((d) => graph.items.find((i) => i.id === d))
    .filter((i): i is Item => Boolean(i))
    .filter((i) => !statusOf(i.id, graph).resolved && !statusOf(i.id, graph).cancelled)
}

export function attributedObjectives(itemId: string, edges: Edge[], objectives: Objective[]): Objective[] {
  const ids = edges.filter((e) => e.kind === 'attribution' && e.to === itemId).map((e) => e.from)
  return objectives.filter((o) => ids.includes(o.id))
}

export function periodObjectives(objectives: Objective[], keyResults: KeyResult[]) {
  return objectives.map((o) => ({ ...o, keyResults: keyResults.filter((k) => k.objectiveId === o.id) }))
}

export function byId<T extends { id: string }>(xs: T[]): Map<string, T> {
  return new Map(xs.map((x) => [x.id, x]))
}
