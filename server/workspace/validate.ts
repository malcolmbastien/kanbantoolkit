/**
 * What the server will accept as an item.
 *
 * The client sends a whole card, so the server checks the whole card rather than trusting it: every
 * field is the type it claims to be, every string has a ceiling, and the lists have a length. What
 * comes back is *this* function's object, not the caller's, so nothing unlisted can reach a column.
 */

import type {
  Board,
  BoardFlow,
  BoardTemplate,
  ChecklistEntry,
  Edge,
  Item,
  ItemLink,
  ItemLogEntry,
  ItemLogKind,
  IssueType,
  KeyResult,
  Lane,
  Objective,
  Placement,
  Stage,
  TemplateFlow,
  TemplateLane,
  User,
} from '../../src/domain/types'
import type { Vocabulary, Workspace } from './types'

const LIMITS = { id: 100, title: 300, description: 20_000, text: 2_000, list: 200, log: 2_000 } as const

const PRIORITIES = new Set(['urgent', 'high', 'medium', 'low'])
const STAGES = new Set<Stage>(['backlog', 'notStarted', 'inProgress', 'done'])
const KINDS = new Set<ItemLogKind>([
  'created',
  'moved',
  'edited',
  'linked',
  'unlinked',
  'blocked',
  'unblocked',
  'archived',
  'discarded',
  'unarchived',
  'noted',
  'limit',
])

function text(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' ? value.slice(0, limit) : undefined
}

function requiredText(value: unknown, limit: number): string | undefined {
  const cleaned = text(value, limit)
  return cleaned && cleaned.trim() ? cleaned : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((entry): entry is string => typeof entry === 'string').slice(0, LIMITS.list).map((entry) => entry.slice(0, LIMITS.id))
}

function stage(value: unknown): Stage | undefined {
  return typeof value === 'string' && STAGES.has(value as Stage) ? (value as Stage) : undefined
}

function checklist(value: unknown): ChecklistEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .slice(0, LIMITS.list)
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return undefined
      const raw = entry as Record<string, unknown>
      const id = requiredText(raw.id, LIMITS.id)
      const line = text(raw.text, LIMITS.text)
      if (!id || line === undefined) return undefined
      return { id, text: line, done: raw.done === true }
    })
    .filter((entry): entry is ChecklistEntry => entry !== undefined)
}

function log(value: unknown): ItemLogEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .slice(0, LIMITS.log)
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return undefined
      const raw = entry as Record<string, unknown>
      const id = requiredText(raw.id, LIMITS.id)
      const at = number(raw.at)
      const kind = text(raw.kind, 20)
      if (!id || at === undefined || !kind || !KINDS.has(kind as ItemLogKind)) return undefined

      const line: ItemLogEntry = { id, at, kind: kind as ItemLogKind }
      const by = text(raw.by, LIMITS.id)
      if (by !== undefined) line.by = by
      const note = text(raw.note, LIMITS.text)
      if (note !== undefined) line.note = note
      const fromLaneId = text(raw.fromLaneId, LIMITS.id)
      if (fromLaneId !== undefined) line.fromLaneId = fromLaneId
      const toLaneId = text(raw.toLaneId, LIMITS.id)
      if (toLaneId !== undefined) line.toLaneId = toLaneId
      const fromStage = stage(raw.fromStage)
      if (fromStage !== undefined) line.fromStage = fromStage
      const toStage = stage(raw.toStage)
      if (toStage !== undefined) line.toStage = toStage
      const boardId = text(raw.boardId, LIMITS.id)
      if (boardId !== undefined) line.boardId = boardId
      return line
    })
    .filter((entry): entry is ItemLogEntry => entry !== undefined)
}

export function parseItem(input: unknown): Item | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>

  const id = requiredText(raw.id, LIMITS.id)
  const title = requiredText(raw.title, LIMITS.title)
  const typeId = requiredText(raw.typeId, LIMITS.id)
  const createdAt = number(raw.createdAt)
  if (!id || !title || !typeId || createdAt === undefined) return null

  const item: Item = { id, title, typeId, createdAt }

  const description = text(raw.description, LIMITS.description)
  if (description !== undefined) item.description = description
  const createdById = text(raw.createdById, LIMITS.id)
  if (createdById !== undefined) item.createdById = createdById
  const initiativeTypeId = text(raw.initiativeTypeId, LIMITS.id)
  if (initiativeTypeId !== undefined) item.initiativeTypeId = initiativeTypeId
  const tagIds = strings(raw.tagIds)
  if (tagIds !== undefined) item.tagIds = tagIds
  const assignees = strings(raw.assignees)
  if (assignees !== undefined) item.assignees = assignees
  const priority = text(raw.priority, 20)
  if (priority !== undefined && PRIORITIES.has(priority)) item.priority = priority as Item['priority']
  const targetStartDate = text(raw.targetStartDate, 10)
  if (targetStartDate !== undefined) item.targetStartDate = targetStartDate
  const targetEndDate = text(raw.targetEndDate, 10)
  if (targetEndDate !== undefined) item.targetEndDate = targetEndDate
  const rev = number(raw.rev)
  if (rev !== undefined) item.rev = rev
  if (raw.resolvedAt === null) item.resolvedAt = null
  else if (number(raw.resolvedAt) !== undefined) item.resolvedAt = number(raw.resolvedAt)
  const lastMoveReason = text(raw.lastMoveReason, LIMITS.text)
  if (lastMoveReason !== undefined) item.lastMoveReason = lastMoveReason
  const blocked = boolean(raw.blocked)
  if (blocked !== undefined) item.blocked = blocked
  const blockedReason = text(raw.blockedReason, LIMITS.text)
  if (blockedReason !== undefined) item.blockedReason = blockedReason
  const archived = boolean(raw.archived)
  if (archived !== undefined) item.archived = archived
  const archivedAt = number(raw.archivedAt)
  if (archivedAt !== undefined) item.archivedAt = archivedAt
  const discarded = boolean(raw.discarded)
  if (discarded !== undefined) item.discarded = discarded
  const entries = checklist(raw.checklist)
  if (entries?.length) item.checklist = entries
  const history = log(raw.log)
  if (history?.length) item.log = history

  return item
}

/**
 * A whole workspace, as the browser hands it over.
 *
 * The rules are the ones the item parser already keeps, applied at the top: every list is a list,
 * every row is an object with an id, and each list has a ceiling. What the writer then does is read
 * each column defensively, so a row that survives this cannot make a statement fail. An item the
 * item parser refuses is dropped rather than failing the import — the person's boards and cards are
 * worth keeping even if one of them is not shaped as this version expects.
 *
 * A lane names its flow, so a workspace that has lanes must name their flows too. An older file is
 * migrated by the browser before it is sent (the store's own migrate), and a payload that arrives
 * without them is refused rather than half-read: inventing a tree here would put a card in a flow
 * its own file never mentioned.
 */
export function parseWorkspace(input: unknown): Workspace | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>

  const isRow = (row: unknown) =>
    Boolean(row) && typeof row === 'object' && typeof (row as Record<string, unknown>).id === 'string'

  const rows = <T>(value: unknown, limit: number): T[] =>
    Array.isArray(value) ? (value.filter(isRow).slice(0, limit) as T[]) : []

  const items = (Array.isArray(raw.items) ? raw.items.slice(0, 5_000) : [])
    .map(parseItem)
    .filter((item): item is Item => item !== null)

  const boards = rows<Board>(raw.boards, 200)
  if (!boards.length) return null
  const lanes = rows<Lane>(raw.lanes, 2_000)
  const flows = rows<BoardFlow>(raw.flows, 1_000)
  if (lanes.length > 0 && flows.length === 0) return null

  return {
    users: rows<User>(raw.users, 2_000),
    issueTypes: rows<IssueType>(raw.issueTypes, 500),
    items,
    edges: rows<Edge>(raw.edges, 20_000),
    links: rows<ItemLink>(raw.links, 20_000),
    objectives: rows<Objective>(raw.objectives, 2_000),
    keyResults: rows<KeyResult>(raw.keyResults, 5_000),
    boardTemplates: rows<BoardTemplate>(raw.boardTemplates, 200),
    autoArchiveDays: typeof raw.autoArchiveDays === 'number' ? raw.autoArchiveDays : undefined,
    savedFilters: Array.isArray(raw.savedFilters) ? raw.savedFilters.slice(0, 200) : [],
    collapsedLanes:
      raw.collapsedLanes && typeof raw.collapsedLanes === 'object' && !Array.isArray(raw.collapsedLanes)
        ? (raw.collapsedLanes as Record<string, boolean>)
        : {},
    boardId: typeof raw.boardId === 'string' ? raw.boardId : boards[0].id,
    boards,
    flows,
    lanes,
    placements: rows<Placement>(raw.placements, 20_000),
  }
}

/* ------------------------------------------------------------------ *
 * The workspace's words — types, templates, objectives, key results
 * ------------------------------------------------------------------ */

/** The ceilings a vocabulary document may not exceed — the workspace parser's own. */
export const VOCABULARY_LIMITS = { issueTypes: 500, boardTemplates: 200, objectives: 2_000, keyResults: 5_000 } as const

const rowId = (row: unknown): string | undefined =>
  row && typeof row === 'object' && typeof (row as Record<string, unknown>).id === 'string'
    ? (row as Record<string, unknown>).id as string
    : undefined

/**
 * Rows of one list, strictly: a list, under its ceiling, every row with a unique id.
 *
 * Stricter than the import's rows because this is a *replacement*: a duplicate id or an over-long
 * list would silently delete rows the sender never saw, and a write that drops work is worse than
 * one that refuses it.
 */
function vocabularyRows(value: unknown, limit: number): Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.length > limit) return null
  const seen = new Set<string>()
  const rows: Record<string, unknown>[] = []
  for (const row of value) {
    const id = rowId(row)
    if (!id || id.length > LIMITS.id || seen.has(id)) return null
    seen.add(id)
    rows.push(row as Record<string, unknown>)
  }
  return rows
}

/** One issue type: a label, a colour, and nothing else. */
const canonicalIssueType = (t: IssueType): IssueType => ({ id: t.id, name: t.name, color: t.color })

const parseIssueType = (raw: Record<string, unknown>): IssueType | null => {
  const id = requiredText(raw.id, LIMITS.id)
  const name = requiredText(raw.name, LIMITS.title)
  if (!id || !name) return null
  return { id, name, color: text(raw.color, 20) || '#64748b' }
}

/**
 * One template: its cards flows and their keyed lanes.
 *
 * Refused rather than repaired when a lane names a flow the template does not have, when a flow is
 * not a cards flow, or when a parent names a lane that is not there: a template is what a board is
 * made from, and one that cannot be made from is not a design.
 */
const parseTemplate = (raw: Record<string, unknown>): BoardTemplate | null => {
  const id = requiredText(raw.id, LIMITS.id)
  const name = requiredText(raw.name, LIMITS.title)
  const flowsRaw = raw.flows
  if (!id || !name || !Array.isArray(flowsRaw) || flowsRaw.length === 0 || flowsRaw.length > 100) return null
  const flows: TemplateFlow[] = []
  for (const value of flowsRaw) {
    if (!value || typeof value !== 'object') return null
    const flow = value as Record<string, unknown>
    const key = requiredText(flow.key, LIMITS.id)
    const flowName = requiredText(flow.name, LIMITS.title)
    // A template designs the team's own flow; the initiatives flow is never captured.
    if (!key || !flowName || flow.kind !== 'cards') return null
    flows.push({ key, kind: 'cards', name: flowName, order: number(flow.order) ?? 0 })
  }
  if (new Set(flows.map((f) => f.key)).size !== flows.length) return null

  const lanesRaw = raw.lanes
  if (!Array.isArray(lanesRaw) || lanesRaw.length > 500) return null
  const lanes: TemplateLane[] = []
  for (const value of lanesRaw) {
    if (!value || typeof value !== 'object') return null
    const lane = value as Record<string, unknown>
    const key = requiredText(lane.key, LIMITS.id)
    const flowKey = requiredText(lane.flowKey, LIMITS.id)
    if (!key || !flowKey || !flows.some((f) => f.key === flowKey)) return null
    const parentKey = lane.parentKey === null || lane.parentKey === undefined ? null : requiredText(lane.parentKey, LIMITS.id)
    if (parentKey === undefined) return null
    lanes.push({
      key,
      flowKey,
      parentKey,
      order: number(lane.order) ?? 0,
      name: text(lane.name, LIMITS.title) ?? '',
      ...(typeof lane.orientation === 'string' ? { orientation: lane.orientation as TemplateLane['orientation'] } : {}),
      ...(typeof lane.stage === 'string' ? { stage: lane.stage as Stage } : {}),
      ...(number(lane.wipLimit) !== undefined ? { wipLimit: number(lane.wipLimit) } : {}),
      ...(text(lane.description, LIMITS.text) ? { description: text(lane.description, LIMITS.text) } : {}),
    })
  }
  const laneKeys = new Set(lanes.map((l) => l.key))
  if (laneKeys.size !== lanes.length) return null
  if (lanes.some((l) => l.parentKey !== null && !laneKeys.has(l.parentKey))) return null

  return {
    id,
    name,
    band: raw.band === 'program' || raw.band === 'portfolio' ? raw.band : 'team',
    flows,
    lanes,
    ...(requiredText(raw.defaultCardTypeId, LIMITS.id) ? { defaultCardTypeId: requiredText(raw.defaultCardTypeId, LIMITS.id) } : {}),
    ...(raw.wipEnforcement === 'justify' || raw.wipEnforcement === 'block' || raw.wipEnforcement === 'visualize'
      ? { wipEnforcement: raw.wipEnforcement }
      : {}),
  }
}

const parseObjective = (raw: Record<string, unknown>): Objective | null => {
  const id = requiredText(raw.id, LIMITS.id)
  const title = requiredText(raw.title, LIMITS.title)
  if (!id || !title) return null
  return {
    id,
    title,
    period: text(raw.period, 40) ?? '',
    status: raw.status === 'scored' ? 'scored' : 'active',
    ...(number(raw.score) !== undefined ? { score: number(raw.score) } : {}),
  }
}

const parseKeyResult = (raw: Record<string, unknown>): KeyResult | null => {
  const id = requiredText(raw.id, LIMITS.id)
  const objectiveId = requiredText(raw.objectiveId, LIMITS.id)
  const title = requiredText(raw.title, LIMITS.title)
  return id && objectiveId && title ? { id, objectiveId, title } : null
}

/** A template as comparison sees it: fields in a fixed order, lists sorted by key. */
export function canonicalTemplate(template: BoardTemplate): BoardTemplate {
  return {
    id: template.id,
    name: template.name,
    band: template.band,
    flows: [...template.flows]
      .map((f) => ({ key: f.key, kind: f.kind, name: f.name, order: f.order }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    lanes: [...template.lanes]
      .map((l) => ({
        key: l.key,
        flowKey: l.flowKey,
        parentKey: l.parentKey,
        order: l.order,
        name: l.name,
        ...(l.orientation ? { orientation: l.orientation } : {}),
        ...(l.stage ? { stage: l.stage } : {}),
        ...(l.wipLimit !== undefined ? { wipLimit: l.wipLimit } : {}),
        ...(l.description ? { description: l.description } : {}),
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    ...(template.defaultCardTypeId ? { defaultCardTypeId: template.defaultCardTypeId } : {}),
    ...(template.wipEnforcement ? { wipEnforcement: template.wipEnforcement } : {}),
  }
}

export const canonicalObjective = (objective: Objective): Objective => ({
  id: objective.id,
  title: objective.title,
  period: objective.period,
  status: objective.status,
  ...(objective.score !== undefined ? { score: objective.score } : {}),
})

export const canonicalKeyResult = (result: KeyResult): KeyResult => ({
  id: result.id,
  objectiveId: result.objectiveId,
  title: result.title,
})

/**
 * The workspace's words, as the app writes them.
 *
 * The same discipline as the board design: the document is the whole truth about these lists, so a
 * row the sender did not send is gone — which is why a malformed list is refused rather than
 * filtered, and why the parse returns canonical objects a comparison can trust.
 */
export function parseVocabulary(input: unknown): Vocabulary | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>

  const issueTypesRaw = vocabularyRows(raw.issueTypes, VOCABULARY_LIMITS.issueTypes)
  const templatesRaw = vocabularyRows(raw.boardTemplates, VOCABULARY_LIMITS.boardTemplates)
  const objectivesRaw = vocabularyRows(raw.objectives, VOCABULARY_LIMITS.objectives)
  const keyResultsRaw = vocabularyRows(raw.keyResults, VOCABULARY_LIMITS.keyResults)
  if (!issueTypesRaw || !templatesRaw || !objectivesRaw || !keyResultsRaw) return null

  const issueTypes = issueTypesRaw.map(parseIssueType)
  const boardTemplates = templatesRaw.map(parseTemplate)
  const objectives = objectivesRaw.map(parseObjective)
  const keyResults = keyResultsRaw.map(parseKeyResult)
  if (issueTypes.some((t) => t === null) || boardTemplates.some((t) => t === null)) return null
  if (objectives.some((o) => o === null) || keyResults.some((k) => k === null)) return null

  return {
    issueTypes: (issueTypes as IssueType[]).map(canonicalIssueType),
    boardTemplates: (boardTemplates as BoardTemplate[]).map(canonicalTemplate),
    objectives: (objectives as Objective[]).map(canonicalObjective),
    keyResults: (keyResults as KeyResult[]).map(canonicalKeyResult),
    ...(typeof raw.autoArchiveDays === 'number' && raw.autoArchiveDays > 0 ? { autoArchiveDays: raw.autoArchiveDays } : {}),
  }
}

/** A key result whose objective is not in the document would point at nothing. */
export function vocabularyObjectivesKnown(vocabulary: Vocabulary): boolean {
  const ids = new Set(vocabulary.objectives.map((o) => o.id))
  return vocabulary.keyResults.every((k) => ids.has(k.objectiveId))
}
