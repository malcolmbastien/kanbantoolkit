import { LIFECYCLES, nominalResolution, isDone } from './lifecycles'
import type {
  Edge,
  Item,
  KeyResult,
  LimitPolicy,
  Objective,
  Resolution,
  Scope,
} from './types'

export interface Graph {
  items: Item[]
  edges: Edge[]
}

export const byId = <T extends { id: string }>(xs: T[]): Map<string, T> =>
  new Map(xs.map((x) => [x.id, x]))

/* ------------------------------------------------------------------ *
 * Decomposition traversal
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

/* ------------------------------------------------------------------ *
 * Level — DERIVED, never stored.
 *
 * Children determine the level; absent children the nominal resolution
 * applies. There is no level field to get wrong.
 * ------------------------------------------------------------------ */

export interface LevelResult {
  level: Resolution
  derivation: string
  /** true when children determined it; false when the nominal type did. */
  derived: boolean
}

export function computeLevel(item: Item, graph: Graph): LevelResult {
  if (item.type === 'initiative') {
    return { level: 'L1', derivation: 'initiative — the strategy layer', derived: false }
  }
  const ids = decompositionChildren(item.id, graph.edges)
  const childTypes = new Set(ids.map((id) => graph.items.find((i) => i.id === id)?.type))

  if (ids.length === 0) {
    const level = nominalResolution(item.type)
    return {
      level,
      derivation: `no decomposition — nominal resolution of a ${item.type}`,
      derived: false,
    }
  }
  if (childTypes.has('initiative')) {
    return { level: 'L1', derivation: 'decomposes into initiatives — a portfolio container', derived: true }
  }
  if (childTypes.has('epic')) {
    return { level: 'L1', derivation: 'decomposes into epics — a value-stream container', derived: true }
  }
  return {
    level: 'L2',
    derivation: 'decomposes into stories — a coordination unit',
    derived: true,
  }
}

export function levelOf(id: string, graph: Graph): Resolution {
  const item = graph.items.find((i) => i.id === id)
  return item ? computeLevel(item, graph).level : 'L3'
}

/* ------------------------------------------------------------------ *
 * Dependency state — computed from both endpoints. Nothing to maintain.
 * ------------------------------------------------------------------ */

export type DependencyState =
  | 'Closed'
  | 'Satisfied'
  | 'OpenPlanningRisk'
  | 'OpenLiveBlockage'
  | 'Void'

export function resolved(item: Item): boolean {
  return isDone(LIFECYCLES[nominalResolution(item.type)], item.state) || Boolean(item.resolvedAt)
}

export function cancelled(item: Item): boolean {
  return LIFECYCLES[nominalResolution(item.type)].cancelled.includes(item.state) || Boolean(item.cancelledAt)
}

export function started(item: Item): boolean {
  return !LIFECYCLES[nominalResolution(item.type)].start.includes(item.state)
}

export function dependencyState(blocker: Item, dependent: Item): DependencyState {
  if (resolved(dependent)) return 'Closed'
  if (cancelled(blocker)) return 'Void'
  if (resolved(blocker)) return 'Satisfied'
  if (!started(dependent)) return 'OpenPlanningRisk'
  return 'OpenLiveBlockage'
}

export const isOpen = (s: DependencyState) =>
  s === 'OpenPlanningRisk' || s === 'OpenLiveBlockage'

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
  return { edge, blocker, dependent, state: dependencyState(blocker, dependent) }
}

/** Dependencies pointing AT this item (it is the dependent) — what blocks it. */
export function incomingDependencies(itemId: string, graph: Graph): DependencyInfo[] {
  return graph.edges
    .filter((e) => e.kind === 'dependency' && e.to === itemId)
    .map((e) => readDependency(e, graph))
    .filter((x): x is DependencyInfo => x !== null)
}

/** Dependencies pointing FROM this item (it is the blocker) — what it blocks. */
export function outgoingDependencies(itemId: string, graph: Graph): DependencyInfo[] {
  return graph.edges
    .filter((e) => e.kind === 'dependency' && e.from === itemId)
    .map((e) => readDependency(e, graph))
    .filter((x): x is DependencyInfo => x !== null)
}

/** Confirmed dependencies that currently bind (make this item blocked). */
export function blockingDeps(itemId: string, graph: Graph): DependencyInfo[] {
  return incomingDependencies(itemId, graph).filter(
    (d) => d.edge.dep?.status === 'confirmed' && isOpen(d.state),
  )
}

export function isBlocked(itemId: string, graph: Graph): boolean {
  return blockingDeps(itemId, graph).length > 0
}

/** Requests awaiting confirmation on this (blocker's) board. */
export function confirmationRequests(itemId: string, graph: Graph): DependencyInfo[] {
  return outgoingDependencies(itemId, graph).filter((d) => d.edge.dep?.status === 'proposed')
}

/** "N items blocked by this across M streams" — the healthy-looking board's blind spot. */
export function blockingSummary(itemId: string, graph: Graph, scopes: Scope[]) {
  const streamOf = byId(scopes)
  const confirmed = outgoingDependencies(itemId, graph).filter(
    (d) => d.edge.dep?.status === 'confirmed' && !resolved(d.dependent),
  )
  const streams = new Set(
    confirmed.map((d) => streamOf.get(d.dependent.valueStreamId)?.name ?? d.dependent.valueStreamId),
  )
  return { count: confirmed.length, streams: streams.size, streamNames: [...streams] }
}

/* ------------------------------------------------------------------ *
 * Composition pressure — visible, never capped.
 * ------------------------------------------------------------------ */

export function openDescendants(id: string, graph: Graph): Item[] {
  return descendants(id, graph)
    .map((d) => graph.items.find((i) => i.id === d))
    .filter((i): i is Item => Boolean(i))
    .filter((i) => !resolved(i) && !cancelled(i))
}

/* ------------------------------------------------------------------ *
 * Attribution — informs, never composes. Never counts as WIP.
 * ------------------------------------------------------------------ */

export function attributedObjectives(itemId: string, edges: Edge[], objectives: Objective[]): Objective[] {
  const ids = edges.filter((e) => e.kind === 'attribution' && e.to === itemId).map((e) => e.from)
  return objectives.filter((o) => ids.includes(o.id))
}

/* ------------------------------------------------------------------ *
 * Portfolio rollup + sponsor recommendation (computed, human-confirmed)
 * ------------------------------------------------------------------ */

export interface PortfolioStatus {
  label: string
  tone: 'slate' | 'sky' | 'indigo' | 'emerald' | 'rose'
  committed: number
  inFlight: number
  done: number
  total: number
  recommendation: 'committed' | 'rejected' | 'dormant'
  rationale: string
}

export function portfolioStatus(initiative: Item, graph: Graph): PortfolioStatus {
  const epicIds = decompositionChildren(initiative.id, graph.edges)
  const epics = epicIds
    .map((id) => graph.items.find((i) => i.id === id))
    .filter((i): i is Item => Boolean(i))

  const done = epics.filter(resolved).length
  const inFlight = epics.filter((e) => ['In Progress', 'Ready', 'Analyze'].includes(e.state)).length
  const backlog = epics.filter((e) => e.state === 'Backlog').length
  const total = epics.length

  if (total === 0) {
    return {
      label: 'Idea', tone: 'slate', committed: 0, inFlight: 0, done: 0, total: 0,
      recommendation: 'dormant',
      rationale: 'No decomposed epics yet — nothing has been committed.',
    }
  }
  if (done === total) {
    return {
      label: 'Realised', tone: 'emerald', committed: 0, inFlight, done, total,
      recommendation: 'committed',
      rationale: `All ${total} epics are done.`,
    }
  }
  if (inFlight > 0 || done > 0) {
    return {
      label: 'Committed', tone: 'indigo', committed: epics.length - backlog, inFlight, done, total,
      recommendation: 'committed',
      rationale: `${inFlight} in flight, ${done} done, ${backlog} still in backlog.`,
    }
  }
  return {
    label: 'Option', tone: 'sky', committed: 0, inFlight: 0, done: 0, total,
    recommendation: 'dormant',
    rationale: `${total} epics exist but none have left the backlog.`,
  }
}

/* ------------------------------------------------------------------ *
 * Limits — optional, keyed on (resolution, itemType, scope)
 * ------------------------------------------------------------------ */

export function applicableLimit(
  limits: LimitPolicy[],
  resolution: Resolution,
  itemType: Item['type'],
  scopeId: string | null,
  column?: string,
): LimitPolicy | undefined {
  const candidates = limits.filter(
    (l) =>
      l.resolution === resolution &&
      l.itemType === itemType &&
      (l.column ?? undefined) === (column ?? undefined),
  )
  // scope-specific overrides the global (null) policy.
  return candidates.find((l) => l.scopeId === scopeId) ?? candidates.find((l) => l.scopeId === null)
}

export type LimitLevel = 'ok' | 'yellow' | 'red' | 'over'

export function limitLevel(count: number, policy: LimitPolicy): LimitLevel {
  if (count > policy.limit) return 'over'
  if (count >= policy.thresholds.red) return 'red'
  if (count >= policy.thresholds.yellow) return 'yellow'
  return 'ok'
}

export function periodObjectives(objectives: Objective[], keyResults: KeyResult[]) {
  return objectives.map((o) => ({
    ...o,
    keyResults: keyResults.filter((k) => k.objectiveId === o.id),
  }))
}
