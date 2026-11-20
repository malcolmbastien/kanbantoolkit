/**
 * Editing a template's design.
 *
 * A template is not a board: its lanes are keyed (`key`/`parentKey`), it carries no cards, and its
 * flows are described rather than placed. These live in their own module because only the template
 * editor needs them — the board's first download would otherwise carry the machinery for a screen
 * nobody has opened yet.
 *
 * The structure still runs through the **same kernels the board's lane actions use**
 * (`splitLaneNodes`, `addLaneNode`, `moveLaneNode`, … in `domain/lanes.ts`), so a template can do
 * exactly what a board can do, and a change to a rule is made once in the kernel. The adapters only
 * bridge the vocabulary: a template's lanes are keyed and hang from a phantom root — the board root
 * itself is not part of a template, but the kernels reason about "top-level" through it, so the same
 * fixed-typed-columns rule falls out identically. A template with several flows is edited one flow
 * at a time, which is also what makes "top-level" mean that flow's columns.
 *
 * They stay pure: each returns the new lane list, so the editor's behaviour is unit tested rather
 * than inferred from the UI.
 */

import {
  addLaneNode,
  duplicateLaneNode,
  insertLaneAfterNode,
  moveLaneNode,
  removeLaneNodes,
  setLaneOrientationNode,
  splitLaneNodes,
  STAGE_LABELS,
  STAGES,
  type LaneNode,
} from './lanes'
import type { BoardTemplate, SplitOrientation, TemplateFlow, TemplateLane } from './types'

/**
 * A template's lanes under a parent, in order. `null` is the top-level columns of `flowKey` —
 * a template with two flows has two sets of columns, and only the flow says which is meant.
 */
export function templateChildren(template: BoardTemplate, parentKey: string | null, flowKey = template.flows[0]?.key): TemplateLane[] {
  return template.lanes
    .filter((l) => l.parentKey === parentKey && (parentKey !== null || l.flowKey === flowKey))
    .sort((a, b) => a.order - b.order)
}

/**
 * Whether a lane is one *row* of its parent's stack rather than a column beside its siblings.
 *
 * It decides two things a surface must not guess at: which way the lane moves (up/down, not
 * left/right) and what it claims room with — a lane in a split of columns takes width in
 * proportion to the cells beneath it, while a lane in a split of rows takes its own height.
 * Guessing it wrong is not a small thing on screen: `flex-basis: 0` on a row of a stack whose
 * height is its own content is a lane with no height at all, controls and all.
 *
 * A top-level column is not a row: the root arranges its children as columns.
 */
export function templateLaneIsRow(template: BoardTemplate, key: string): boolean {
  const lane = template.lanes.find((l) => l.key === key)
  const parent = lane?.parentKey == null ? undefined : template.lanes.find((l) => l.key === lane.parentKey)
  return parent?.orientation === 'rows'
}

/**
 * The bridge to the kernels: template lanes become structural nodes under a phantom root
 * (the thing the board root is on the board), and kernel results come back as template
 * lanes. The extra template fields (WIP limit, policy) ride along in the spread.
 */
const ROOT_KEY = '__template-root__'
type SlimNode = LaneNode & Partial<TemplateLane>
/**
 * One flow's lanes, under the phantom root the kernels reason about. The kernels know one tree at
 * a time, so a template with several flows is edited one flow at a time — which is also what makes
 * "top-level" mean the flow's columns rather than every flow's.
 */
const slim = (template: BoardTemplate, flowKey: string): SlimNode[] => [
  { id: ROOT_KEY, parentId: null, order: -1, name: '' },
  ...template.lanes
    .filter((l) => l.flowKey === flowKey)
    .map((l) => ({ ...l, id: l.key, parentId: l.parentKey ?? ROOT_KEY })),
]
const unslim = (nodes: SlimNode[], flowKey: string): TemplateLane[] =>
  nodes
    .filter((n) => n.id !== ROOT_KEY)
    .map((n) => ({
      key: n.id,
      flowKey,
      parentKey: n.parentId === ROOT_KEY ? null : n.parentId,
      order: n.order,
      name: n.name,
      ...(n.orientation ? { orientation: n.orientation } : {}),
      ...(n.stage ? { stage: n.stage } : {}),
      ...(n.wipLimit !== undefined ? { wipLimit: n.wipLimit } : {}),
      ...(n.description ? { description: n.description } : {}),
    }))

/** The flow a lane belongs to. A template always has one, so a missing lane falls back to it. */
const flowKeyOfLane = (template: BoardTemplate, key: string | null | undefined): string =>
  template.lanes.find((l) => l.key === key)?.flowKey ?? template.flows[0]?.key ?? ''

/** Replace one flow's lanes, leaving the other flows' where they are. */
const withFlowLanes = (template: BoardTemplate, flowKey: string, nodes: SlimNode[]): TemplateLane[] => {
  const replaced = unslim(nodes, flowKey)
  // A lane edit reorders one flow, never the others: the edited flow keeps its slot in the list
  // rather than being appended after every other flow.
  const firstIndex = template.lanes.findIndex((l) => l.flowKey === flowKey)
  if (firstIndex < 0) return [...template.lanes, ...replaced]
  const kept = template.lanes.filter((l) => l.flowKey !== flowKey)
  const insertAt = template.lanes.slice(0, firstIndex).filter((l) => l.flowKey !== flowKey).length
  kept.splice(insertAt, 0, ...replaced)
  return kept
}

const withLane = (template: BoardTemplate, key: string, patch: Partial<TemplateLane>): TemplateLane[] =>
  template.lanes.map((l) => (l.key === key ? { ...l, ...patch } : l))

/** The kind of a template flow, when the key names one. */
export function templateFlowKind(template: BoardTemplate, key: string): TemplateFlow['kind'] | undefined {
  return template.flows.find((flow) => flow.key === key)?.kind
}

/** Whether a lane is one of the initiatives flow's typed sections — the fixed top-level columns. */
export function templateLaneIsSection(template: BoardTemplate, key: string): boolean {
  const lane = template.lanes.find((l) => l.key === key)
  return lane?.parentKey === null && templateFlowKind(template, lane?.flowKey ?? '') === 'initiatives'
}

/** A template's flows as it is drawn: the initiatives flow first, then the cards flows in order. */
export function templateFlowsInOrder(template: BoardTemplate): TemplateFlow[] {
  return [...template.flows].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'initiatives' ? -1 : 1
    return a.order - b.order
  })
}

/**
 * Give a template the initiatives flow it needs, fixed at the top.
 *
 * Every board has one, and for a program it is the board's whole design — so a template without it
 * would describe nothing. A team's matches the flow its cards roll up through. The sections are the
 * app's four typed columns; a template may have split them into cells, which are kept. Idempotent: a
 * template already drawn with the initiatives flow first and clean orders is returned untouched.
 */
export function withInitiatives(template: BoardTemplate): BoardTemplate {
  const existing = template.flows.find((flow) => flow.kind === 'initiatives')
  let lanes = template.lanes
  let flows = template.flows
  if (!existing) {
    const usedFlows = new Set(template.flows.map((flow) => flow.key))
    let flowIndex = 0
    while (usedFlows.has(`i${flowIndex}`)) flowIndex += 1
    const flowKey = `i${flowIndex}`
    const usedLanes = new Set(template.lanes.map((lane) => lane.key))
    const fresh = (): string => {
      let index = 0
      while (usedLanes.has(`i${index}`)) index += 1
      usedLanes.add(`i${index}`)
      return `i${index}`
    }
    const sections: TemplateLane[] = STAGES.map((stage, order) => ({
      key: fresh(),
      flowKey,
      parentKey: null,
      order,
      name: STAGE_LABELS[stage],
      stage,
    }))
    flows = [...template.flows, { key: flowKey, kind: 'initiatives', name: 'Initiatives', order: template.flows.length }]
    lanes = [...template.lanes, ...sections]
  }
  // The initiatives flow is fixed above every cards flow, whatever order it was stored in; the
  // cards keep their own relative order.
  const ordered = templateFlowsInOrder({ ...template, flows })
  const normal = ordered.map((flow, order) => (flow.order === order ? flow : { ...flow, order }))
  if (normal.length === template.flows.length && normal.every((flow, i) => flow === template.flows[i]) && lanes === template.lanes) {
    return template
  }
  return { ...template, flows: normal, lanes }
}

export function templateRenameLane(template: BoardTemplate, key: string, name: string): TemplateLane[] {
  // A section's name is the stage's: the organisation reads the same four words on every board.
  if (templateLaneIsSection(template, key)) return template.lanes
  return withLane(template, key, { name })
}

export function templateSetLaneWip(template: BoardTemplate, key: string, wipLimit: number | undefined): TemplateLane[] {
  return withLane(template, key, { wipLimit })
}

export function templateSetLanePolicy(template: BoardTemplate, key: string, description: string | undefined): TemplateLane[] {
  return withLane(template, key, { description })
}

/** Flip columns ↔ rows — typed columns included: fixed in stage, not in shape. */
export function templateSetOrientation(
  template: BoardTemplate,
  key: string,
  orientation: SplitOrientation,
): TemplateLane[] {
  const flowKey = flowKeyOfLane(template, key)
  return withFlowLanes(template, flowKey, setLaneOrientationNode(slim(template, flowKey), key, orientation))
}

/** Split a leaf lane into a container of the given orientation. */
export function templateSplitLane(
  template: BoardTemplate,
  key: string,
  orientation: SplitOrientation,
  uid: () => string,
  count = 2,
): TemplateLane[] {
  const flowKey = flowKeyOfLane(template, key)
  const { nodes, created } = splitLaneNodes(slim(template, flowKey), key, orientation, uid, count)
  return created.length > 0 ? withFlowLanes(template, flowKey, nodes) : template.lanes
}

/** Add a lane to an existing split — never a new top-level column. */
export function templateAddLane(template: BoardTemplate, parentKey: string, uid: () => string): TemplateLane[] {
  const flowKey = flowKeyOfLane(template, parentKey)
  const { nodes, created } = addLaneNode(slim(template, flowKey), parentKey, uid)
  return created ? withFlowLanes(template, flowKey, nodes) : template.lanes
}

/** Insert a sub-lane after a sibling — among sub-lanes only, as on a board. */
export function templateInsertLaneAfter(template: BoardTemplate, key: string, uid: () => string): TemplateLane[] {
  const flowKey = flowKeyOfLane(template, key)
  const { nodes, created } = insertLaneAfterNode(slim(template, flowKey), key, uid)
  return created ? withFlowLanes(template, flowKey, nodes) : template.lanes
}

/** Duplicate a sub-lane and its sub-tree ("… copy"), renumbered like the board does. */
export function templateDuplicateLane(template: BoardTemplate, key: string, uid: () => string): TemplateLane[] {
  const flowKey = flowKeyOfLane(template, key)
  const { nodes, created } = duplicateLaneNode(slim(template, flowKey), key, uid)
  return created.length > 0 ? withFlowLanes(template, flowKey, nodes) : template.lanes
}

/**
 * Remove a sub-lane and its sub-tree; a split left with one child folds away, the same
 * answer the board gives. Returns the new lanes, or the template untouched for the
 * lanes that are fixed — every refusal the board has.
 */
export function templateRemoveLane(template: BoardTemplate, key: string): TemplateLane[] {
  const flowKey = flowKeyOfLane(template, key)
  const { nodes, vanished } = removeLaneNodes(slim(template, flowKey), key)
  return vanished.size > 0 ? withFlowLanes(template, flowKey, nodes) : template.lanes
}

/** Reorder a sub-lane within its parent. Top-level columns are fixed in place. */
export function templateMoveLane(template: BoardTemplate, key: string, delta: number): TemplateLane[] {
  const flowKey = flowKeyOfLane(template, key)
  return withFlowLanes(template, flowKey, moveLaneNode(slim(template, flowKey), key, delta))
}

/* ---- A template's flows ------------------------------------------------------------------ *
 * The same verbs a board's flows have, with the one difference a template can have: it holds no
 * cards, so only "keep at least one" applies — there is no work that would be lost with a flow.
 * ------------------------------------------------------------------------------------------ */

/** The next free key of a kind, so removing and adding never reuses an identity. */
function nextKey(prefix: string, keys: string[]): string {
  const used = new Set(keys)
  let i = 0
  while (used.has(`${prefix}${i}`)) i += 1
  return `${prefix}${i}`
}

/** A new cards flow: its four typed columns, one cell each, appended after the ones it has. */
export function templateAddFlow(template: BoardTemplate): { flows: TemplateFlow[]; lanes: TemplateLane[]; key: string } {
  const key = nextKey('f', template.flows.map((f) => f.key))
  const taken = new Set(template.flows.map((f) => f.name.trim().toLowerCase()))
  // Count the cards flows, not every flow: the initiatives flow is not one more set of columns.
  let n = template.flows.filter((flow) => flow.kind === 'cards').length + 1
  let name = taken.has('cards') ? `Cards ${n}` : 'Cards'
  while (taken.has(name.toLowerCase())) {
    n += 1
    name = `Cards ${n}`
  }
  // The four typed columns, one cell each — where every flow starts. Keys are unique among the
  // template's lanes, taken as they are minted so the four cannot collide with each other.
  const used = new Set(template.lanes.map((l) => l.key))
  const freshLaneKey = (): string => {
    let i = 0
    while (used.has(`k${i}`)) i += 1
    used.add(`k${i}`)
    return `k${i}`
  }
  const columns: TemplateLane[] = STAGES.map((stage, order) => ({
    key: freshLaneKey(),
    flowKey: key,
    parentKey: null,
    order,
    name: STAGE_LABELS[stage],
    stage,
  }))
  const nextOrder = Math.max(-1, ...template.flows.map((flow) => flow.order)) + 1
  return {
    flows: [...template.flows, { key, kind: 'cards', name, order: nextOrder }],
    lanes: [...template.lanes, ...columns],
    key,
  }
}

/** Name a template flow. Empty is refused by the caller (the editor keeps the old name). */
export function templateRenameFlow(template: BoardTemplate, key: string, name: string): TemplateFlow[] {
  // The initiatives flow is the standard shape the organisation reads, not the team's to name.
  if (templateFlowKind(template, key) === 'initiatives') return template.flows
  return template.flows.map((f) => (f.key === key ? { ...f, name } : f))
}

/** Move a template flow within the set; the order stays a clean 0..n-1. */
export function templateMoveFlow(template: BoardTemplate, key: string, delta: number): TemplateFlow[] {
  // The initiatives flow is fixed at the top and the board draws it on its own, so it is never moved.
  if (templateFlowKind(template, key) === 'initiatives') return template.flows
  const ordered = templateFlowsInOrder(template)
  const from = ordered.findIndex((f) => f.key === key)
  if (from < 0) return template.flows
  // Move among flows of the same kind. The first cards flow has no same-kind neighbour above it,
  // so it cannot be lifted over the initiatives flow.
  const kind = ordered[from].kind
  let to = from + delta
  while (to >= 0 && to < ordered.length && ordered[to].kind !== kind) to += delta
  if (to < 0 || to >= ordered.length) return template.flows
  const [moved] = ordered.splice(from, 1)
  ordered.splice(to, 0, moved)
  const orderOf = new Map(ordered.map((f, i) => [f.key, i] as const))
  // Sorted, not merely renumbered: the editor draws `template.flows` in array order, and a flow
  // that moved must read where it moved to.
  return template.flows
    .map((f) => (orderOf.has(f.key) ? { ...f, order: orderOf.get(f.key)! } : f))
    .sort((a, b) => a.order - b.order)
}

/** A template keeps its initiatives flow, and a team template keeps at least one cards flow. */
export function canRemoveTemplateFlow(template: BoardTemplate, key: string): boolean {
  const flow = template.flows.find((f) => f.key === key)
  if (!flow || flow.kind !== 'cards') return false
  return template.flows.filter((f) => f.kind === 'cards').length > 1
}

/** Remove a flow and its lanes, or nothing when it is the last one. */
export function templateRemoveFlow(
  template: BoardTemplate,
  key: string,
): { flows: TemplateFlow[]; lanes: TemplateLane[] } | null {
  if (!canRemoveTemplateFlow(template, key)) return null
  const flows = template.flows.filter((f) => f.key !== key)
  const orderOf = new Map(templateFlowsInOrder({ ...template, flows }).map((f, i) => [f.key, i] as const))
  return {
    flows: flows
      .map((f) => (orderOf.has(f.key) ? { ...f, order: orderOf.get(f.key)! } : f))
      .sort((a, b) => a.order - b.order),
    lanes: template.lanes.filter((l) => l.flowKey !== key),
  }
}

