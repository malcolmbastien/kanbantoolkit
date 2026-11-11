import { effectiveStage } from './lanes'
import type { ChecklistEntry, Edge, Item, ItemLink, KeyResult, Lane, Objective, Placement, Stage } from './types'

export interface Graph {
  items: Item[]
  edges: Edge[]
  links: ItemLink[]
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
export function depth(id: string, graph: Graph): number {  let d = 0
  let cur = decompositionParent(id, graph.edges)
  const seen = new Set<string>([id])
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    d += 1
    cur = decompositionParent(cur, graph.edges)
  }
  return d
}

/**
 * The decomposition chain from the root down to this item: `[root, …, item]`.
 * This is the "how this work rolls up" lineage.
 */
export function lineageOf(itemId: string, graph: Graph): Item[] {
  const chain: Item[] = []
  let cur: string | undefined = itemId
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const item = graph.items.find((i) => i.id === cur)
    if (!item) break
    chain.unshift(item)
    cur = decompositionParent(cur, graph.edges)
  }
  return chain
}

export function roots(graph: Graph): Item[] {
  return graph.items.filter((i) => !decompositionParent(i.id, graph.edges))
}

/* ------------------------------------------------------------------ *
 * Status — derived from the column lane a card is placed in
 * ------------------------------------------------------------------ */

export interface Status {
  resolved: boolean
  started: boolean
}

/** A card's status is the stage of the top-level column its cell sits under. */
export function statusOf(itemId: string, graph: Graph): Status {
  const placement = graph.placements.find((p) => p.itemId === itemId)
  if (!placement) return { resolved: false, started: false }
  const stage = effectiveStage(graph.lanes, placement.laneId)
  if (stage === 'done') return { resolved: true, started: true }
  if (stage === 'inProgress') return { resolved: false, started: true }
  return { resolved: false, started: false } // notStarted, backlog, or unknown
}

/**
 * Is this finished? True for a leaf in a Done column, and for a parent once every leaf below it
 * is done — the rule behind the Done stamp on a card.
 *
 * It is the same bucket the initiatives workflow arranges its sections by, so the stamp can
 * never disagree with the column it sits in. Note it is not the percentage: an initiative with
 * every committed leaf finished and one leaf still unplanned reads 100% and is not done.
 */
export function isComplete(id: string, graph: Graph): boolean {
  return rollupOf(id, graph).bucket === 'done'
}

/**
 * What an item's place in the archive means: work that was finished, or work that was thrown away.
 *
 * The word is decided once, when the item is filed, by the same rollup that draws its Done stamp —
 * and then kept on the item. Re-reading the leaves later would let rearranging a board rewrite what
 * happened to work that has already left it.
 *
 * An item archived before the distinction existed carries no flag, so the column it left is the best
 * answer available: filed from Done, it was completed; filed from anywhere else, it was discarded.
 * An item with no placement at all cannot be read that way and reads as completed.
 */
export function archiveOutcome(item: Item, graph: Graph): 'completed' | 'discarded' {
  if (item.discarded !== undefined) return item.discarded ? 'discarded' : 'completed'
  const stage = stageOf(item.id, graph)
  return stage && stage !== 'done' ? 'discarded' : 'completed'
}

/** The stage (commitment state) a leaf currently sits in. */
export function stageOf(itemId: string, graph: Graph): Stage | undefined {
  const placement = graph.placements.find((p) => p.itemId === itemId)
  return placement ? effectiveStage(graph.lanes, placement.laneId) : undefined
}

/* ------------------------------------------------------------------ *
 * Dependency state — computed from both endpoints of a link
 * ------------------------------------------------------------------ */

export type DependencyState =
  | 'Closed'
  | 'Satisfied'
  | 'OpenPlanningRisk'
  | 'OpenLiveBlockage'

/**
 * Whether `dependentId` may wait on `dependencyId`.
 *
 * A dependency is a relationship *across* the decomposition, never along it. A card that waits
 * on its own parent can never start — the parent is not done until the card is — and a parent
 * that waits on its own descendant says only what the rollup already says. Links also may not
 * close a loop through work that already waits: a link is a promise about which of two items
 * finishes first, and work that waits on itself has no first.
 *
 * This is the one rule, read by the item panel (so its picker offers only links it would accept)
 * and by the store (so no other path can write one). It judges a proposed link, not a stored one:
 * the demo and every existing graph are checked against it in their own tests.
 */
export function canDepend(dependentId: string, dependencyId: string, graph: Graph): boolean {
  if (dependentId === dependencyId) return false
  const dependent = graph.items.find((i) => i.id === dependentId)
  const dependency = graph.items.find((i) => i.id === dependencyId)
  if (!dependent || !dependency) return false
  // A filed-away item is not work in play: a new link to or from it would plan around something
  // that has left the board. Existing links stay — they are still a fact about the history.
  if (dependent.archived || dependency.archived) return false
  // An existing link is not a new one.
  if (graph.links.some((link) => link.from === dependencyId && link.to === dependentId)) return false

  // The decomposition is already a waiting order: a parent is done when the work below it is.
  // So neither end of a link may sit above the other. Both directions are refused, not corrected.
  if (descendants(dependencyId, graph).includes(dependentId)) return false
  if (descendants(dependentId, graph).includes(dependencyId)) return false

  // Would the new link close a loop? Walk from the dependency along what it already waits for.
  // Reaching the dependent means the new link would come back round. A decomposition edge joins
  // the walk because a parent waits on its children; a link joins it in the direction the link
  // waits — the dependent, then the dependency it points at.
  const seen = new Set<string>()
  const stack = [dependencyId]
  while (stack.length > 0) {
    const next = stack.pop()!
    if (next === dependentId) return false
    if (seen.has(next)) continue
    seen.add(next)
    for (const edge of graph.edges) if (edge.kind === 'decomposition' && edge.from === next) stack.push(edge.to)
    for (const link of graph.links) if (link.to === next) stack.push(link.from)
  }
  return true
}

export function dependencyState(dependencyId: string, dependentId: string, graph: Graph): DependencyState {
  const dep = statusOf(dependencyId, graph)
  const d = statusOf(dependentId, graph)
  if (d.resolved) return 'Closed'
  if (dep.resolved) return 'Satisfied'
  if (!d.started) return 'OpenPlanningRisk'
  return 'OpenLiveBlockage'
}

export const isOpen = (s: DependencyState) => s === 'OpenPlanningRisk' || s === 'OpenLiveBlockage'

export interface DependencyInfo {
  link: ItemLink
  /** The card depended upon. */
  dependency: Item
  /** The card that depends on it. */
  dependent: Item
  state: DependencyState
}

export function readDependency(link: ItemLink, graph: Graph): DependencyInfo | null {
  const dependency = graph.items.find((i) => i.id === link.from)
  const dependent = graph.items.find((i) => i.id === link.to)
  if (!dependency || !dependent) return null
  return { link, dependency, dependent, state: dependencyState(link.from, link.to, graph) }
}

/** The cards this item depends on (its links). */
export function dependenciesOf(itemId: string, graph: Graph): DependencyInfo[] {
  return graph.links
    .filter((l) => l.to === itemId)
    .map((l) => readDependency(l, graph))
    .filter((x): x is DependencyInfo => x !== null)
}

/** The cards that depend on this item. */
export function dependentsOf(itemId: string, graph: Graph): DependencyInfo[] {
  return graph.links
    .filter((l) => l.from === itemId)
    .map((l) => readDependency(l, graph))
    .filter((x): x is DependencyInfo => x !== null)
}

/** Open dependencies of this item — the dependency is not yet done, and is still in play. */
export function openDependenciesOf(itemId: string, graph: Graph): DependencyInfo[] {
  return dependenciesOf(itemId, graph).filter((d) => isOpen(d.state) && !isArchived(d.dependency))
}

/**
 * Does this item wait on the given item — i.e. a still-open dependency?
 * Used to link a boundary-lane pin to the local cards that wait on that external work.
 */
export function waitsOn(itemId: string, dependencyId: string, graph: Graph): boolean {
  return openDependenciesOf(itemId, graph).some((d) => d.dependency.id === dependencyId)
}

/**
 * Blocking is a status the user sets on the item — it is *not* derived from
 * links. `openDependenciesOf` describes dependency state; this describes intent.
 */
export function isBlocked(itemId: string, graph: Graph): boolean {
  return graph.items.find((i) => i.id === itemId)?.blocked === true
}

/** "N cards depend on this" — distinct boards among the dependents. */
export function dependentSummary(itemId: string, graph: Graph): { count: number; boards: number } {
  const open = dependentsOf(itemId, graph).filter((d) => !statusOf(d.dependent.id, graph).resolved)
  const boardOf = (itemId: string) =>
    graph.placements.find((p) => p.itemId === itemId)?.boardId ?? 'none'
  const boards = new Set(open.map((d) => boardOf(d.dependent.id)))
  return { count: open.length, boards: boards.size }
}

/* ------------------------------------------------------------------ *
 * Composition pressure + attribution
 * ------------------------------------------------------------------ */

export function openDescendants(id: string, graph: Graph): Item[] {
  return descendants(id, graph)
    .map((d) => graph.items.find((i) => i.id === d))
    .filter((i): i is Item => Boolean(i))
    .filter((i) => !i.archived && !statusOf(i.id, graph).resolved)
}

/**
 * How many descendants (at any depth) are explicitly blocked and still open.
 * This is what lets a blockage on a team card roll up into its team initiative
 * and, aggregated, into a top-level initiative — without the top board having
 * to know the individual blocked card.
 */
export function blockedBelow(id: string, graph: Graph): number {
  return blockedBelowItems(id, graph).length
}

/**
 * The same cards, named — what a surface needs to take a reader to them rather than only tell them
 * how many there are. The count is this list's length, so the two can never disagree.
 */
export function blockedBelowItems(id: string, graph: Graph): Item[] {
  return descendants(id, graph)
    .map((d) => graph.items.find((i) => i.id === d))
    .filter((i): i is Item => Boolean(i))
    .filter((i) => !i.archived && i.blocked === true && !statusOf(i.id, graph).resolved)
}

/**
 * Filed away. Archived items leave the boards but stay in the data: they remain
 * searchable and still appear in linked-issue surfaces. Rollup still counts their
 * work (archiving a done card must not drop a parent's progress).
 */
export function isArchived(item: Item | undefined): boolean {
  return item?.archived === true
}

/**
 * Filed away as work that was thrown away rather than finished.
 *
 * The distinction is already stamped when an item is filed (`archiveOutcome`); this is the reading
 * the progress rules need, so a discarded branch does not sit in a live parent's denominator for
 * ever. A live item is never discarded, and a completed archived item is not either.
 */
export function isDiscarded(item: Item | undefined, graph: Graph): boolean {
  return Boolean(item?.archived && archiveOutcome(item, graph) === 'discarded')
}

/** Discarded items anywhere below this one — what a parent stopped counting when they were filed. */
export function discardedBelowItems(id: string, graph: Graph): Item[] {
  return descendants(id, graph)
    .map((d) => graph.items.find((i) => i.id === d))
    .filter((i): i is Item => Boolean(i))
    .filter((i) => isDiscarded(i, graph))
}

/* ------------------------------------------------------------------ *
 * Checklist — sub-tasks inside a card (never schedulable, never WIP)
 * ------------------------------------------------------------------ */

/** A card's checklist entries (empty when it has none). */
export function checklistItems(item: Item | undefined): ChecklistEntry[] {
  return item?.checklist ?? []
}

/** Checklist progress: how many entries are done, out of the total. */
export function checklistProgress(item: Item | undefined): { done: number; total: number } {
  const list = checklistItems(item)
  return { done: list.filter((c) => c.done).length, total: list.length }
}

/*
 * The edits. Pure, and given the entry id rather than making one, so they are testable and
 * the store stays a thin wrapper.
 */

/** Add an entry to a card's checklist. */
export function withChecklistEntry(item: Item, entry: ChecklistEntry): Item {
  return { ...item, checklist: [...checklistItems(item), entry] }
}

/** Tick or untick one entry. */
export function withToggledChecklistEntry(item: Item, entryId: string): Item {
  return {
    ...item,
    checklist: checklistItems(item).map((e) => (e.id === entryId ? { ...e, done: !e.done } : e)),
  }
}

/** Remove one entry. */
export function withoutChecklistEntry(item: Item, entryId: string): Item {
  return { ...item, checklist: checklistItems(item).filter((e) => e.id !== entryId) }
}

/**
 * Rename one entry. Clearing the text removes it — a checklist line with no words on it is
 * not a line, and it is the same gesture as the remove button.
 */
export function withChecklistEntryText(item: Item, entryId: string, text: string): Item {
  const value = text.trim()
  if (!value) return withoutChecklistEntry(item, entryId)
  return {
    ...item,
    checklist: checklistItems(item).map((e) => (e.id === entryId ? { ...e, text: value } : e)),
  }
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
  /** Leaves still in Backlog — uncommitted inventory, still counted in `percent`. */
  uncommitted: number
  /**
   * The finished issues as a percentage of **everything below** — one issue, one share. Backlog
   * leaves are in it: unplanned work is still work, so adding a card moves the number back rather
   * than leaving the bar where it was.
   */
  percent: number
  bucket: RollupBucket
}

/**
 * The leaves that count toward a parent's progress.
 *
 * Completed work that has been filed away still counts: filing a done card must not lower its
 * parent's percentage. **Discarded** work does not: it was thrown away, so it is not a plan that
 * remains unfinished, and leaving it in the denominator would make the parent impossible to finish.
 * A discarded branch takes its whole subtree with it, even a leaf that happened to be completed
 * before the branch was thrown away. An archived parent's own rollup is a historical reading and
 * keeps all its leaves; the rule is about a live parent's answer.
 */
export function progressLeaves(id: string, graph: Graph): Item[] {
  const owner = graph.items.find((i) => i.id === id)
  if (owner?.archived) return leafItems(id, graph)

  const out: Item[] = []
  const walk = (nodeId: string) => {
    const kids = decompositionChildren(nodeId, graph.edges)
    if (kids.length === 0) {
      const item = graph.items.find((i) => i.id === nodeId)
      if (item && !isDiscarded(item, graph)) out.push(item)
      return
    }
    for (const kid of kids) {
      const item = graph.items.find((i) => i.id === kid)
      if (item && isDiscarded(item, graph)) continue
      walk(kid)
    }
  }
  walk(id)
  return out
}

export function rollupOf(id: string, graph: Graph): Rollup {
  return rollupFrom(progressLeaves(id, graph), graph)
}

/**
 * The arithmetic of a rollup, over a set of leaves.
 *
 * `rollupOf` is this over the leaves below one item; `objectiveRollup` is this over the leaves
 * below the initiatives that serve one objective. One implementation, so an initiative and an
 * objective can never disagree about what "how far along" means.
 */
function rollupFrom(leaves: Item[], graph: Graph): Rollup {
  const total = leaves.length
  const isBacklog = (l: Item) => stageOf(l.id, graph) === 'backlog'
  const backlog = leaves.filter(isBacklog).length
  const committed = total - backlog
  const done = leaves.filter((l) => !isBacklog(l) && statusOf(l.id, graph).resolved).length
  const started = leaves.filter((l) => !isBacklog(l) && statusOf(l.id, graph).started).length
  // Progress is the number of finished issues over the number of issues below: no weighting, and
  // nothing to weight with. The counts beside it are the same numbers, which is the point — a bar
  // a reader can check against the pips above it.
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)

  // A parent is as advanced as the work beneath it, but never claims completion early:
  // everything done → done; anything under way → inProgress; anything committed →
  // notStarted; only when every leaf is still uncommitted → backlog. A single Backlog
  // leaf does not drag the parent backwards, so an initiative with one stream under way
  // reads as in progress even while another stream is still unplanned.
  let bucket: RollupBucket = 'backlog'
  if (total > 0) {
    if (done === total) bucket = 'done'
    else if (started > 0) bucket = 'inProgress'
    else if (committed > 0) bucket = 'notStarted'
  }
  return {
    total,
    done,
    inProgress: Math.max(0, started - done),
    notStarted: Math.max(0, committed - started),
    uncommitted: backlog,
    percent: Math.min(100, percent),
    bucket,
  }
}

/**
 * Committed, but part of its work is not: the item is under way (or at least committed)
 * while some leaves below it are still in Backlog — uncommitted inventory sitting under
 * a commitment. A warning to put in front of a person, never a block and never an
 * auto-correction: committing is a judgement, and the app doesn't make it.
 *
 * Zero for anything still in Backlog itself (nothing is claimed yet) and for anything
 * Done (every leaf is finished by definition).
 */
/**
 * May this initiative sit in this cell?
 *
 * Its section is *derived* from the work below it, so a move may rearrange a cell within a
 * section but never cross into another one — **unless there is no work below**. An initiative
 * with nothing under it is its own leaf (`rollupOf` reads its own placement), and then its
 * section is the only fact there is: it may be committed before it is broken down, and moved
 * back afterwards. Refusing that made decomposition a precondition of commitment, which is
 * backwards.
 *
 * Both the store's move actions and the initiatives surface's drop preview ask this, so the
 * gesture and the model cannot disagree about where a drop is allowed.
 */
export function canPlaceInSection(itemId: string, laneId: string, graph: Graph): boolean {
  if (descendants(itemId, graph).length === 0) return true
  return effectiveStage(graph.lanes, laneId) === rollupOf(itemId, graph).bucket
}

export function uncommittedBelow(id: string, graph: Graph): number {
  const roll = rollupOf(id, graph)
  return roll.bucket === 'notStarted' || roll.bucket === 'inProgress' ? roll.uncommitted : 0
}

export function attributedObjectives(itemId: string, edges: Edge[], objectives: Objective[]): Objective[] {
  const ids = edges.filter((e) => e.kind === 'attribution' && e.to === itemId).map((e) => e.from)
  return objectives.filter((o) => ids.includes(o.id))
}

/**
 * How far along an objective is: the same rollup, over the union of the leaves below the
 * initiatives that are attributed to it.
 *
 * `undefined` when nothing serves it. An objective with no work has no completeness, and 0% would
 * be a worse way of saying so — the coverage gap already says it in words.
 *
 * Each leaf counts once, however many attributed initiatives sit above it: an initiative can be
 * attributed to the same objective as its own parent, and a leaf counted twice would move the
 * number for a reason nobody could see. `id` is the objective, which is never one of its own
 * leaves, so the percentage is over the whole of the work below it.
 */
export function objectiveRollup(objectiveId: string, graph: Graph): Rollup | undefined {
  const initiatives = graph.edges.filter((e) => e.kind === 'attribution' && e.from === objectiveId).map((e) => e.to)
  if (initiatives.length === 0) return undefined
  const leaves = new Map<string, Item>()
  for (const initiative of initiatives) {
    for (const leaf of progressLeaves(initiative, graph)) leaves.set(leaf.id, leaf)
  }
  return rollupFrom([...leaves.values()], graph)
}

/**
 * OKR coverage: initiatives in the given population that carry no OKR, and OKRs that no
 * initiative serves. Both are first-class gaps on the L3 lens.
 */
export function okrCoverage(
  initiatives: Item[],
  objectives: Objective[],
  edges: Edge[],
): { unmapped: Item[]; unserved: Objective[] } {
  const attribution = edges.filter((e) => e.kind === 'attribution')
  const mapped = new Set(attribution.map((e) => e.to))
  const served = new Set(attribution.map((e) => e.from))
  return {
    unmapped: initiatives.filter((i) => !mapped.has(i.id)),
    unserved: objectives.filter((o) => !served.has(o.id)),
  }
}

/**
 * The nearest ancestor (or self) that is an Initiative — how a card maps to an
 * initiative. OKR attribution is reserved for initiatives; cards inherit it.
 */
export function initiativeOf(itemId: string, graph: Graph, initiativeTypeId?: string): Item | undefined {
  if (!initiativeTypeId) return undefined
  let cur: string | undefined = itemId
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const item = graph.items.find((i) => i.id === cur)
    if (item?.typeId === initiativeTypeId) return item
    cur = decompositionParent(cur, graph.edges)
  }
  return undefined
}

export function periodObjectives(objectives: Objective[], keyResults: KeyResult[]) {
  return objectives.map((o) => ({ ...o, keyResults: keyResults.filter((k) => k.objectiveId === o.id) }))
}

export function byId<T extends { id: string }>(xs: T[]): Map<string, T> {
  return new Map(xs.map((x) => [x.id, x]))
}
