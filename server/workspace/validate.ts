/**
 * What the server will accept as an item.
 *
 * The client sends a whole card, so the server checks the whole card rather than trusting it: every
 * field is the type it claims to be, every string has a ceiling, and the lists have a length. What
 * comes back is *this* function's object, not the caller's, so nothing unlisted can reach a column.
 */

import type {
  Board,
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
  User,
} from '../../src/domain/types'
import type { Workspace } from './types'

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
    lanes: rows<Lane>(raw.lanes, 2_000),
    placements: rows<Placement>(raw.placements, 20_000),
  }
}
