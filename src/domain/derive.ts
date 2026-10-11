import { effectiveStage } from './lanes'
import type { Edge, Item, KeyResult, Lane, Objective, Placement, Stage } from './types'

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
  if (lane?.isCancelled) return { resolved: false, cancelled: true, started: false }
  const stage = effectiveStage(graph.lanes, placement.laneId)
  if (stage === 'done') return { resolved: true, cancelled: false, started: true }
  if (stage === 'inProgress') return { resolved: false, cancelled: false, started: true }
  if (stage === 'notStarted') return { resolved: false, cancelled: false, started: false }
  if (stage === 'backlog') return { resolved: false, cancelled: false, started: false }
  // No stage anywhere in the chain: fall back to legacy flags.
  return { resolved: false, cancelled: false, started: !(lane?.isStart ?? false) }
}

/** The stage (commitment state) a leaf currently sits in. */
export function stageOf(itemId: string, graph: Graph): Stage | undefined {
  const placement = graph.placements.find((p) => p.itemId === itemId)
  return placement ? effectiveStage(graph.lanes, placement.laneId) : undefined
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

/* ------------------------------------------------------------------ *
 * Rollup — an item's status is determined by the status of the work at
 * the lowest level of its subtree. Nothing is typed; it is computed.
 * ------------------------------------------------------------------ */

export function leafItems(id: string, graph: Graph): Item[] {
  const out: Item[] = []
  const walk = (nid: string) => {
    const kids = decompositionChildren(nid, graph.edges)
    if (kids.length === 0) {
      const it = graph.items.find((i) => i.id === nid)
      if (it) out.push(it)
      return
    }
    kids.forEach(walk)
  }
  walk(id)
  return out
}

export type RollupBucket = Stage

export interface Rollup {
  total: number
  done: number
  inProgress: number
  notStarted: number
  cancelled: number
  /** Done leaves as a percentage of countable (committed) leaves. */
  percent: number
  bucket: RollupBucket
}

export function rollupOf(id: string, graph: Graph): Rollup {
  const leaves = leafItems(id, graph)
  const total = leaves.length
  const isBacklog = (l: Item) => stageOf(l.id, graph) === 'backlog'
  const backlog = leaves.filter(isBacklog).length
  const committed = total - backlog
  const done = leaves.filter((l) => !isBacklog(l) && statusOf(l.id, graph).resolved).length
  const cancelled = leaves.filter((l) => statusOf(l.id, graph).cancelled).length
  const started = leaves.filter((l) => !isBacklog(l) && statusOf(l.id, graph).started).length
  const countable = Math.max(1, committed - cancelled)
  const percent = total === 0 ? 0 : Math.round((done / countable) * 100)

  // A committed parent cannot have uncommitted (Backlog) children, so any backlog
  // leaf forces the whole item back to Backlog. Otherwise the committed stage
  // derives from its leaves.
  let bucket: RollupBucket = 'backlog'
  if (total > 0 && backlog === 0) {
    bucket = done === total ? 'done' : started > 0 ? 'inProgress' : 'notStarted'
  }
  return {
    total,
    done,
    inProgress: Math.max(0, started - done - cancelled),
    notStarted: Math.max(0, committed - started - cancelled),
    cancelled,
    percent: Math.min(100, percent),
    bucket,
  }
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

/* ------------------------------------------------------------------ *
 * Lens — focus a card and highlight its lineage
 * ------------------------------------------------------------------ */

export type LensRole = 'self' | 'in' | 'out'

export function lensRole(itemId: string, lensId: string | null, graph: Graph): LensRole | undefined {
  if (!lensId) return undefined
  if (itemId === lensId) return 'self'
  if (descendants(lensId, graph).includes(itemId)) return 'in'
  let cur = decompositionParent(itemId, graph.edges)
  while (cur) {
    if (cur === lensId) return 'in'
    cur = decompositionParent(cur, graph.edges)
  }
  return 'out'
}
