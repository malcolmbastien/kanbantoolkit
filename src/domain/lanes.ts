import type { Lane, Placement, SplitOrientation, Stage, Workflow } from './types'

export const STAGES: Stage[] = ['backlog', 'notStarted', 'inProgress', 'done']
/** The two workflows a board carries — each an independent lane tree. */
export const WORKFLOWS: Workflow[] = ['cards', 'initiatives']

/**
 * The structural spine every lane tree shares — the part the **editing rules** read.
 * A board's `Lane` is one of these with a board, a workflow and a stage attached; a
 * template's lanes are the same spine under different field names, so the template's
 * editor runs its structure through these same kernels via a thin adapter
 * (`templateSplitLane` & friends in `domain/board.ts`).
 */
export interface LaneNode {
  id: string
  parentId: string | null
  order: number
  name: string
  orientation?: SplitOrientation
}

/**
 * Lane-tree editing — **one rulebook for boards and templates alike**.
 *
 * A board reshapes itself in edit mode through the store's lane actions; a template is
 * shaped the same way in the template editor. Both now call the functions below, so the
 * behaviour cannot drift: what a template can do is exactly what a board can do, and a
 * change to a rule (the fold of a one-child split, or that typed columns are fixed but
 * flippable) is made once, here.
 *
 * The one carried-over rule from boards: **the typed top-level columns stay put**. They
 * carry the stages and status derivation reads them, so they are renamed, given WIP
 * limits and policies, and flipped (fixed in stage, not in shape) — but never moved,
 * removed or given a new sibling. Refinement happens by splitting, as on a board.
 *
 * The rules speak of "top-level": a lane whose parent is a root (`parentId === null`).
 * Kernels know nothing of roots as nodes — the caller supplies the tree, and for
 * templates a phantom root node bridges the vocabulary (see `board.ts`).
 */

const nodeOf = <T extends LaneNode>(nodes: T[], id: string): T | undefined => nodes.find((n) => n.id === id)

/** A container is a root (`parentId === null`) or split; a control only exists on one that exists. */
const parentIsRoot = <T extends LaneNode>(nodes: T[], node?: T): boolean => {
  if (!node) return true
  const parent = node.parentId ? nodeOf(nodes, node.parentId) : undefined
  return !parent || parent.parentId === null
}

/** Split a leaf into a container of the given orientation with `count` children. */
export function splitLaneNodes<T extends LaneNode>(
  nodes: T[],
  id: string,
  orientation: SplitOrientation,
  uid: () => string,
  count = 2,
): { nodes: T[]; created: T[]; firstChildId: string } {
  const lane = nodeOf(nodes, id)
  const kids = nodes.filter((n) => n.parentId === id)
  if (!lane || kids.length > 0) return { nodes, created: [], firstChildId: id } // only a leaf splits
  const created: T[] = Array.from({ length: count }, (_, i) =>
    ({
      id: uid(),
      parentId: id,
      order: i,
      name: orientation === 'rows' ? `Row ${i + 1}` : `Column ${i + 1}`,
    }) as T,
  )
  return {
    nodes: [...nodes.map((n) => (n.id === id ? { ...n, orientation } : n)), ...created],
    created,
    firstChildId: created[0].id,
  }
}

/** Add a lane to an existing split — never a new top-level column: the root refuses. */
export function addLaneNode<T extends LaneNode>(nodes: T[], parentId: string, uid: () => string): { nodes: T[]; created: T | undefined } {
  const parent = nodeOf(nodes, parentId)
  if (!parent || parent.parentId === null) return { nodes, created: undefined } // the board root stays four columns
  const order = nodes.filter((n) => n.parentId === parentId).length
  const created: T = {
    id: uid(),
    parentId,
    order,
    name: (parent.orientation ?? 'columns') === 'rows' ? `Row ${order + 1}` : `Column ${order + 1}`,
  } as T
  return {
    nodes: [...nodes.map((n) => (n.id === parentId ? { ...n, orientation: n.orientation ?? 'columns' } : n)), created],
    created,
  }
}

/** Insert a sub-lane after a sibling — among sub-lanes only: a typed column stays put. */
export function insertLaneAfterNode<T extends LaneNode>(nodes: T[], id: string, uid: () => string): { nodes: T[]; created: T | undefined } {
  const lane = nodeOf(nodes, id)
  if (!lane || parentIsRoot(nodes, lane)) return { nodes, created: undefined }
  const siblings = nodes.filter((n) => n.parentId === lane.parentId).sort((a, b) => a.order - b.order)
  const idx = siblings.findIndex((s) => s.id === id)
  const orientation = (lane.parentId ? nodeOf(nodes, lane.parentId)?.orientation : undefined) ?? 'columns'
  const created: T = {
    id: uid(),
    parentId: lane.parentId,
    order: idx + 1,
    name: orientation === 'rows' ? `Row ${siblings.length + 1}` : `Column ${siblings.length + 1}`,
  } as T
  const renumber = new Map(
    siblings.filter((s) => s.order > idx).map((s) => [s.id, s.order + 1] as const),
  )
  return {
    nodes: [...nodes.map((n) => (renumber.has(n.id) ? { ...n, order: renumber.get(n.id)! } : n)), created],
    created,
  }
}

/** Duplicate a sub-lane and its sub-tree — the root's children (typed columns) refuse. */
export function duplicateLaneNode<T extends LaneNode>(nodes: T[], id: string, uid: () => string): { nodes: T[]; created: T[] } {
  const src = nodeOf(nodes, id)
  if (!src || parentIsRoot(nodes, src)) return { nodes, created: [] }
  const subtree: T[] = []
  const collect = (k: string) => {
    for (const child of nodes.filter((n) => n.parentId === k).sort((a, b) => a.order - b.order)) {
      subtree.push(child)
      collect(child.id)
    }
  }
  collect(id)
  // The copy's own parent is the sibling position it takes; only descendants remap.
  const idMap = new Map([[id, uid()] as const, ...subtree.map((n) => [n.id, uid()] as const)])
  const siblings = nodes.filter((n) => n.parentId === src.parentId).sort((a, b) => a.order - b.order)
  const idx = siblings.findIndex((s) => s.id === id)
  const created: T[] = [src, ...subtree].map((n) => {
    const clone: T = { ...n, id: idMap.get(n.id)!, parentId: n.parentId && idMap.has(n.parentId) ? idMap.get(n.parentId)! : n.parentId }
    if (n.id === id) {
      clone.name = `${n.name} copy`
      clone.order = idx + 1
    }
    return clone
  })
  const renumber = new Map(
    siblings.filter((s) => s.order > idx).map((s) => [s.id, s.order + 1] as const),
  )
  return { nodes: [...nodes.map((n) => (renumber.has(n.id) ? { ...n, order: renumber.get(n.id)! } : n)), ...created], created }
}

/**
 * Remove a sub-lane and its sub-tree; renumber the survivors. A split left with one
 * child folds away and the parent becomes a cell — the same answer boards give, so a
 * design never carries a "split of one". Returns what vanished and where anything that
 * lived there should go: the first surviving leaf under the parent, or the parent itself
 * once it is a cell again. Never nowhere — a caller with contents rehomes them.
 */
export function removeLaneNodes<T extends LaneNode>(
  nodes: T[],
  id: string,
): { nodes: T[]; vanished: Set<string>; to: string } {
  const lane = nodeOf(nodes, id)
  if (!lane || parentIsRoot(nodes, lane) || lane.parentId === null) return { nodes, vanished: new Set(), to: id }
  const parentId: string = lane.parentId
  // Sub-lanes go; the folder below may take the parent's last child with them.
  let out = nodes.filter((n) => n.id !== id && !subtreeOf(nodes, id).has(n.id))
  const left = out.filter((n) => n.parentId === parentId)
  const folded = left.length === 1 ? new Set([left[0].id, ...subtreeOf(out, left[0].id)]) : null
  if (folded) out = out.filter((n) => !folded.has(n.id))
  // Renumber the survivors so order stays a clean 0..n-1 sequence.
  const survivors = out.filter((n) => n.parentId === parentId).sort((a, b) => a.order - b.order)
  const orderOf = new Map(survivors.map((s, i) => [s.id, i] as const))
  out = out.map((n) => (orderOf.has(n.id) ? { ...n, order: orderOf.get(n.id)! } : n))
  const vanished = new Set(subtreeOf(nodes, id)) // includes the lane itself
  if (folded) for (const v of folded) vanished.add(v)
  // Where contents go: the first surviving leaf under the parent, or the parent itself
  // once the fold has made it a cell. Never nowhere.
  const to = folded ? parentId : leaveTarget(out, parentId)
  return { nodes: out, vanished, to }
}

function leaveTarget<T extends LaneNode>(nodes: T[], parentId: string): string {
  return leaveTargetWalk(nodes, parentId)
}

function leaveTargetWalk<T extends LaneNode>(nodes: T[], id: string): string {
  const children = nodes.filter((n) => n.parentId === id).sort((a, b) => a.order - b.order)
  if (children.length === 0) return id
  return leaveTargetWalk(nodes, children[0].id)
}

// The sub-tree ids at and below a node — same answer the board's `subtreeIds` gives.
function subtreeOf<T extends LaneNode>(nodes: T[], id: string): Set<string> {
  const out = new Set<string>()
  const walk = (k: string) => {
    out.add(k)
    for (const child of nodes.filter((n) => n.parentId === k)) walk(child.id)
  }
  walk(id)
  return out
}

/** Reorder a sub-lane within its parent. Typed columns are fixed in place. */
export function moveLaneNode<T extends LaneNode>(nodes: T[], id: string, delta: number): T[] {
  const lane = nodeOf(nodes, id)
  if (!lane || parentIsRoot(nodes, lane)) return nodes // the root and typed columns have no say in where they sit
  const siblings = nodes.filter((n) => n.parentId === lane.parentId).sort((a, b) => a.order - b.order)
  const idx = siblings.findIndex((s) => s.id === id)
  const j = idx + delta
  if (idx < 0 || j < 0 || j >= siblings.length) return nodes
  const reordered = [...siblings]
  const [moved] = reordered.splice(idx, 1)
  reordered.splice(j, 0, moved)
  const orderOf = new Map(reordered.map((s, i) => [s.id, i] as const))
  return nodes.map((n) => (orderOf.has(n.id) ? { ...n, order: orderOf.get(n.id)! } : n))
}

/** Flip a split's arrangement — allowed anywhere except on a root: fixed in stage, not in shape. */
export function setLaneOrientationNode<T extends LaneNode>(nodes: T[], id: string, orientation: SplitOrientation): T[] {
  const lane = nodeOf(nodes, id)
  if (!lane || lane.parentId === null) return nodes // never flip the board root
  return nodes.map((n) => (n.id === id ? { ...n, orientation } : n))
}
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

/**
 * How a lane reads in a history note: the name it had at that moment, or the stage it carries when a
 * board has left it unnamed. Callers pass the lanes *as they were* — a lane renamed or removed later
 * must not rewrite what the note says, which is the whole point of a history.
 */
export function laneNameAt(lanes: Lane[], laneId: string | undefined): string {
  if (!laneId) return ''
  const lane = lanes.find((l) => l.id === laneId)
  if (!lane) return 'a lane since gone'
  const stage = effectiveStage(lanes, laneId)
  return lane.name || (stage ? STAGE_LABELS[stage] : 'a lane since gone')
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
