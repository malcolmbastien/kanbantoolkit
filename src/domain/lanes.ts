import type { Lane, LaneAxis, Placement } from './types'

export function lanesOf(lanes: Lane[], boardId: string, axis?: LaneAxis): Lane[] {
  return lanes.filter((l) => l.boardId === boardId && (axis === undefined || l.axis === axis))
}

export function childrenOf(lanes: Lane[], parentId: string | null): Lane[] {
  return lanes
    .filter((l) => l.parentId === parentId)
    .sort((a, b) => a.order - b.order)
}

/** Ordered depth-first leaves under a board on one axis. */
export function leafLanes(lanes: Lane[], boardId: string, axis: LaneAxis): Lane[] {
  const roots = lanesOf(lanes, boardId, axis).filter((l) => l.parentId === null)
  const out: Lane[] = []
  const walk = (node: Lane) => {
    const kids = childrenOf(lanes, node.id)
    if (kids.length === 0) out.push(node)
    else kids.forEach(walk)
  }
  roots.sort((a, b) => a.order - b.order).forEach(walk)
  return out
}

/** Ancestors of a lane, nearest first. */
export function ancestorsOf(lanes: Lane[], laneId: string): Lane[] {
  const out: Lane[] = []
  let cur = lanes.find((l) => l.id === laneId)
  while (cur?.parentId) {
    const parent = lanes.find((l) => l.id === cur!.parentId)
    if (!parent) break
    out.push(parent)
    cur = parent
  }
  return out
}

export function laneDepth(lanes: Lane[], laneId: string): number {
  return ancestorsOf(lanes, laneId).length
}

export function maxDepth(lanes: Lane[], boardId: string, axis: LaneAxis): number {
  const ls = lanesOf(lanes, boardId, axis)
  return ls.reduce((m, l) => Math.max(m, laneDepth(lanes, l.id)), 0)
}

/** Number of leaves under a lane (a leaf counts as 1). */
export function leafCount(lanes: Lane[], laneId: string): number {
  const kids = childrenOf(lanes, laneId)
  if (kids.length === 0) return 1
  return kids.reduce((sum, k) => sum + leafCount(lanes, k.id), 0)
}

/** Lanes on one axis at a given depth, in DFS order. */
export function lanesAtDepth(lanes: Lane[], boardId: string, axis: LaneAxis, depth: number): Lane[] {
  const out: Lane[] = []
  const walk = (node: Lane) => {
    const d = laneDepth(lanes, node.id)
    if (d === depth) out.push(node)
    if (d < depth) childrenOf(lanes, node.id).forEach(walk)
  }
  lanesOf(lanes, boardId, axis)
    .filter((l) => l.parentId === null)
    .sort((a, b) => a.order - b.order)
    .forEach(walk)
  return out
}

/** Leaf index at which a lane's subtree begins, for row-span bookkeeping. */
export function leafStartIndex(leafOrder: Lane[], lanes: Lane[], laneId: string): number {
  const ids = new Set(subtreeIds(lanes, laneId))
  return leafOrder.findIndex((l) => ids.has(l.id))
}

export function subtreeIds(lanes: Lane[], laneId: string): string[] {
  const out: string[] = []
  const walk = (id: string) => {
    out.push(id)
    childrenOf(lanes, id).forEach((c) => walk(c.id))
  }
  walk(laneId)
  return out
}

/** Count of placements in a lane's subtree (used for WIP counts). */
export function laneCardCount(lanes: Lane[], placements: Placement[], laneId: string, axis: LaneAxis): number {
  const ids = new Set(subtreeIds(lanes, laneId))
  return placements.filter((p) =>
    axis === 'vertical' ? ids.has(p.columnLaneId) : p.rowLaneId !== null && ids.has(p.rowLaneId),
  ).length
}
