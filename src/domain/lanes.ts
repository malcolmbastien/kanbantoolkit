import type { Lane, Placement, Stage } from './types'

export const STAGES: Stage[] = ['backlog', 'notStarted', 'inProgress', 'done']
/** The committed stages — everything except Backlog (uncommitted inventory). */
export const COMMITTED_STAGES: Stage[] = ['notStarted', 'inProgress', 'done']
export const STAGE_LABELS: Record<Stage, string> = {
  backlog: 'Backlog',
  notStarted: 'Not Started',
  inProgress: 'In Progress',
  done: 'Done',
}

/** The three top-level columns of a board. */
export function topLevelLanes(lanes: Lane[], boardId: string): Lane[] {
  const root = rootLane(lanes, boardId)
  return root ? childrenOf(lanes, root.id) : []
}

export function isTopLevel(lanes: Lane[], laneId: string): boolean {
  const lane = lanes.find((l) => l.id === laneId)
  return Boolean(lane && lane.parentId && lanes.find((l) => l.id === lane.parentId)?.parentId === null)
}

/** Effective stage of a lane: its own, else the nearest ancestor's, else legacy flags. */
export function effectiveStage(lanes: Lane[], laneId: string): Stage | undefined {
  let cur = lanes.find((l) => l.id === laneId)
  let hops = 0
  while (cur && hops < 20) {
    if (cur.stage) return cur.stage
    cur = cur.parentId ? lanes.find((l) => l.id === cur!.parentId) : undefined
    hops += 1
  }
  const leaf = lanes.find((l) => l.id === laneId)
  if (leaf?.isStart) return 'notStarted'
  if (leaf?.isDone) return 'done'
  return undefined
}

export function childrenOf(lanes: Lane[], parentId: string): Lane[] {
  return lanes.filter((l) => l.parentId === parentId).sort((a, b) => a.order - b.order)
}

export function rootLane(lanes: Lane[], boardId: string): Lane | undefined {
  return lanes.find((l) => l.boardId === boardId && l.parentId === null)
}

export function isLeaf(lanes: Lane[], laneId: string): boolean {
  return !lanes.some((l) => l.parentId === laneId)
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

/** Ordered depth-first leaves (cells) under a board. */
export function leafLanes(lanes: Lane[], boardId: string): Lane[] {
  const root = rootLane(lanes, boardId)
  if (!root) return []
  const out: Lane[] = []
  const walk = (node: Lane) => {
    const kids = childrenOf(lanes, node.id)
    if (kids.length === 0) out.push(node)
    else kids.forEach(walk)
  }
  walk(root)
  return out
}

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

/** Names from the root down to this lane (exclusive of a nameless root). */
export function lanePath(lanes: Lane[], laneId: string): string[] {
  const chain = [...ancestorsOf(lanes, laneId)].reverse().map((l) => l.name)
  const self = lanes.find((l) => l.id === laneId)?.name ?? ''
  return [...chain, self].filter(Boolean)
}

/** Placements anywhere in a lane's subtree. */
export function laneCardCount(lanes: Lane[], placements: Placement[], laneId: string): number {
  const ids = new Set(subtreeIds(lanes, laneId))
  return placements.filter((p) => ids.has(p.laneId)).length
}

/** Direct placements in a leaf lane. */
export function laneLeafCards(placements: Placement[], laneId: string): Placement[] {
  return placements.filter((p) => p.laneId === laneId)
}

/** Map a rollup bucket onto a board's typed top-level column (Not Started / In Progress / Done). */
export function bucketLaneId(lanes: Lane[], boardId: string, bucket: Stage): string | undefined {
  const top = topLevelLanes(lanes, boardId).find(
    (l) => l.stage === bucket || effectiveStage(lanes, l.id) === bucket,
  )
  if (top) {
    const leaves = leavesUnder(lanes, top.id)
    return (leaves[0] ?? top).id
  }
  const leaves = leafLanes(lanes, boardId)
  if (bucket === 'done') return (leaves.find((l) => l.isDone) ?? leaves[leaves.length - 1])?.id
  if (bucket === 'notStarted') return (leaves.find((l) => l.isStart) ?? leaves[0])?.id
  return (leaves.find((l) => !l.isStart && !l.isDone) ?? leaves[0])?.id
}

/** Ordered leaves somewhere in a subtree (not board-scoped). */
export function leavesUnder(lanes: Lane[], laneId: string): Lane[] {
  const out: Lane[] = []
  const walk = (node: Lane) => {
    const kids = childrenOf(lanes, node.id)
    if (kids.length === 0) out.push(node)
    else kids.forEach(walk)
  }
  walk(lanes.find((l) => l.id === laneId) ?? ({ id: '', parentId: null, order: 0, name: '', boardId: '' } as Lane))
  return out
}
