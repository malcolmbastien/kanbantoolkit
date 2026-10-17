import type { Lane, Placement, Stage, Workflow } from './types'

export const STAGES: Stage[] = ['backlog', 'notStarted', 'inProgress', 'done']
/** The two workflows a board carries — each an independent lane tree. */
export const WORKFLOWS: Workflow[] = ['cards', 'initiatives']
/** The committed stages — everything except Backlog (uncommitted inventory). */
export const COMMITTED_STAGES: Stage[] = ['notStarted', 'inProgress', 'done']
export const STAGE_LABELS: Record<Stage, string> = {
  backlog: 'Backlog',
  notStarted: 'Not Started',
  inProgress: 'In Progress',
  done: 'Done',
}

/** The top-level columns of one of a board's workflows. */
export function topLevelLanes(lanes: Lane[], boardId: string, workflow: Workflow): Lane[] {
  const root = rootLane(lanes, boardId, workflow)
  return root ? childrenOf(lanes, root.id) : []
}

export function isTopLevel(lanes: Lane[], laneId: string): boolean {
  const lane = lanes.find((l) => l.id === laneId)
  return Boolean(lane && lane.parentId && lanes.find((l) => l.id === lane.parentId)?.parentId === null)
}

/** Effective stage of a lane: its own, else the nearest ancestor's. */
export function effectiveStage(lanes: Lane[], laneId: string): Stage | undefined {
  let cur = lanes.find((l) => l.id === laneId)
  let hops = 0
  while (cur && hops < 20) {
    if (cur.stage) return cur.stage
    cur = cur.parentId ? lanes.find((l) => l.id === cur!.parentId) : undefined
    hops += 1
  }
  return undefined
}

export function childrenOf(lanes: Lane[], parentId: string): Lane[] {
  return lanes.filter((l) => l.parentId === parentId).sort((a, b) => a.order - b.order)
}

/**
 * A workflow's root. Each board has one per workflow, so `workflow` is required: a tree
 * walk that forgot it would silently mix the two.
 */
export function rootLane(lanes: Lane[], boardId: string, workflow: Workflow): Lane | undefined {
  return lanes.find((l) => l.boardId === boardId && l.parentId === null && l.workflow === workflow)
}

/** Every lane of one workflow on a board. */
export function workflowLanes(lanes: Lane[], boardId: string, workflow: Workflow): Lane[] {
  return lanes.filter((l) => l.boardId === boardId && l.workflow === workflow)
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

/** Ordered depth-first leaves (cells) of one workflow. */
export function leafLanes(lanes: Lane[], boardId: string, workflow: Workflow): Lane[] {
  const root = rootLane(lanes, boardId, workflow)
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

/**
 * A workflow's starting tree: the four typed columns, one per stage, each a single cell.
 * Both workflows begin here — the initiatives one stays here unless someone refines it.
 */
export function defaultColumns(
  boardId: string,
  rootId: string,
  workflow: Workflow,
  uid: () => string,
): Lane[] {
  return STAGES.map((s, i) => ({
    id: uid(),
    boardId,
    parentId: rootId,
    order: i,
    name: STAGE_LABELS[s],
    stage: s,
    workflow,
  }))
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

/** WIP limit state for a lane's card count: at the limit, over it, or neither. */
export function wipState(count: number, limit?: number): 'at' | 'over' | null {
  if (limit === undefined) return null
  if (count > limit) return 'over'
  if (count === limit) return 'at'
  return null
}

/**
 * The strongest WIP state anywhere among a lane's ancestors — the load above a lane is a
 * fact about everything under it: when a parent or top-level column fills up, its children
 * only exist inside it, so the whole column reads as full. Derived by walking up (never
 * stored), and "over" outranks "at" so a descendant of a full column shows the stronger
 * state even when a higher ancestor has merely reached its own.
 */
export function inheritedWipState(
  lanes: Lane[],
  laneId: string,
  countInLane: (laneId: string) => number,
): 'at' | 'over' | null {
  let state: 'at' | 'over' | null = null
  let parentId = lanes.find((l) => l.id === laneId)?.parentId
  while (parentId) {
    const ancestor = lanes.find((l) => l.id === parentId)
    if (!ancestor) break
    const w = wipState(countInLane(ancestor.id), ancestor.wipLimit)
    if (w === 'over') return 'over'
    if (w === 'at') state = 'at'
    parentId = ancestor.parentId
  }
  return state
}

/** Two WIP states at once — an at-limit lane inside an over-limit column is over. */
export function strongestWip(a: 'at' | 'over' | null, b: 'at' | 'over' | null): 'at' | 'over' | null {
  if (a === 'over' || b === 'over') return 'over'
  if (a === 'at' || b === 'at') return 'at'
  return null
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

/**
 * A lane's placements in the order a person put them.
 *
 * A placement that predates rank falls back to where it already sits, so a lane nobody has
 * reordered reads exactly as it always did — and a lane half-ranked is not reshuffled the
 * moment one card is moved.
 */
export function placementsInOrder(placements: Placement[], laneId: string): Placement[] {
  return placements
    .filter((p) => p.laneId === laneId)
    // The fallback is the card's place *within the lane*, not in the whole list.
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.rank ?? a.i) - (b.p.rank ?? b.i))
    .map((x) => x.p)
}

/**
 * The rank a card appended to this lane takes: past every card in it, ranked or not, so
 * arriving means arriving at the bottom rather than above everything that predates rank.
 */
export function nextRank(placements: Placement[], laneId: string): number {
  return placements.filter((p) => p.laneId === laneId).length
}
