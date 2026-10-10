import { blockingDeps, computeLevel, type DependencyInfo, type Graph } from './derive'
import type { Edge, Item, Resolution, Scope } from './types'

export interface Row {
  scope: Scope
  depth: number
}

export function scopeSubtreeIds(scopeId: string, scopes: Scope[]): Set<string> {
  const ids = new Set<string>([scopeId])
  let added = true
  while (added) {
    added = false
    for (const s of scopes) {
      if (s.parentId && ids.has(s.parentId) && !ids.has(s.id)) {
        ids.add(s.id)
        added = true
      }
    }
  }
  return ids
}

export function itemInScope(item: Item, scopeSet: Set<string>): boolean {
  return scopeSet.has(item.valueStreamId) || (!!item.teamId && scopeSet.has(item.teamId))
}

/** Which scope a card physically sits in, given the current resolution. */
export function homeScopeId(item: Item, resolution: Resolution): string {
  if (resolution === 'L1') return item.valueStreamId
  return item.teamId ?? item.valueStreamId
}

export function buildRows(scopeId: string, scopes: Scope[], resolution: Resolution): Row[] {
  const scope = scopes.find((s) => s.id === scopeId)
  if (!scope) return []
  const rows: Row[] = []
  if (scope.kind === 'enterprise') {
    for (const vs of scopes.filter((s) => s.kind === 'value_stream' && s.parentId === scopeId)) {
      rows.push({ scope: vs, depth: 0 })
      if (resolution !== 'L1') {
        for (const t of scopes.filter((s) => s.kind === 'team' && s.parentId === vs.id)) {
          rows.push({ scope: t, depth: 1 })
        }
      }
    }
    return rows
  }
  if (scope.kind === 'value_stream') {
    for (const t of scopes.filter((s) => s.kind === 'team' && s.parentId === scope.id)) {
      rows.push({ scope: t, depth: 0 })
    }
    return rows
  }
  return [{ scope, depth: 0 }]
}

/** Items a board renders: scope ∩ level == resolution. */
export function boardItems(
  items: Item[],
  edges: Edge[],
  scopeId: string,
  resolution: Resolution,
  scopes: Scope[],
): Item[] {
  const scopeSet = scopeSubtreeIds(scopeId, scopes)
  const g: Graph = { items, edges }
  return items.filter((i) => itemInScope(i, scopeSet) && computeLevel(i, g).level === resolution)
}

/** External blockers relevant to a board — read-only boundary pins / ghost lane. */
export function externalBlockers(
  items: Item[],
  edges: Edge[],
  scopeId: string,
  resolution: Resolution,
  scopes: Scope[],
): DependencyInfo[] {
  const g: Graph = { items, edges }
  const onBoard = new Set(boardItems(items, edges, scopeId, resolution, scopes).map((i) => i.id))
  const seen = new Set<string>()
  const out: DependencyInfo[] = []
  for (const item of items) {
    if (!onBoard.has(item.id)) continue
    for (const dep of blockingDeps(item.id, g)) {
      if (!onBoard.has(dep.blocker.id) && !seen.has(dep.blocker.id)) {
        seen.add(dep.blocker.id)
        out.push(dep)
      }
    }
  }
  return out
}

/** Stable display reference per type, e.g. EP3, ST12, IT1. */
export function buildRefs(items: Item[]): Map<string, string> {
  const counters: Record<string, number> = { initiative: 0, epic: 0, story: 0, defect: 0 }
  const prefix: Record<string, string> = { initiative: 'IT', epic: 'EP', story: 'ST', defect: 'DF' }
  const map = new Map<string, string>()
  for (const i of items) {
    counters[i.type] += 1
    map.set(i.id, `${prefix[i.type]}${counters[i.type]}`)
  }
  return map
}
