/**
 * Reading the whole workspace.
 *
 * One query per table, assembled in memory, returned in the shape `persistedSlice` already writes.
 * That is deliberate for a first version: it proves the schema and the shape before any of the
 * harder questions — a change with a revision, a queue, a lease — are answered on top of it.
 *
 * Order is part of the answer. Boards, lanes and lists come back in the order they were written, not
 * in whatever order the database happened to return, so two reads of the same workspace agree and a
 * test can compare them.
 */

import type { SavedFilter } from '../../src/domain/filters'
import type {
  Board,
  BoardBand,
  BoardTemplate,
  Edge,
  EdgeKind,
  Item,
  ItemLink,
  ItemLogEntry,
  ItemLogKind,
  IssueType,
  KeyResult,
  Lane,
  Objective,
  Placement,
  SplitOrientation,
  Stage,
  User,
  Workflow,
} from '../../src/domain/types'
import type { Database } from '../db'
import type { Workspace } from './types'
import { WORKSPACE_ROW } from './types'

type Row = Record<string, unknown>

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const maybeText = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const count = (value: unknown): number => (typeof value === 'number' ? value : 0)
const maybeCount = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined)
const maybeFlag = (value: unknown): boolean | undefined =>
  value === null || value === undefined ? undefined : value === 1
const parse = <T>(value: unknown): T | undefined => (typeof value === 'string' ? (JSON.parse(value) as T) : undefined)

function group<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const id = key(row)
    const bucket = groups.get(id)
    if (bucket) bucket.push(row)
    else groups.set(id, [row])
  }
  return groups
}

async function readBoards(db: Database): Promise<Board[]> {
  const [boards, kinds, tags] = await Promise.all([
    db.all<Row>('SELECT * FROM boards ORDER BY position, id'),
    db.all<Row>('SELECT * FROM board_initiative_types ORDER BY board_id, position'),
    db.all<Row>('SELECT * FROM board_tags ORDER BY board_id, position'),
  ])

  const kindsByBoard = group(kinds, (row) => text(row.board_id))
  const tagsByBoard = group(tags, (row) => text(row.board_id))

  return boards.map((row) => {
    const id = text(row.id)
    const board: Board = {
      id,
      name: text(row.name),
      band: text(row.band) as BoardBand,
      description: text(row.description),
    }

    const boardKinds = kindsByBoard.get(id) ?? []
    if (boardKinds.length) {
      board.initiativeTypes = boardKinds.map((kind) => ({
        id: text(kind.id),
        name: text(kind.name),
        color: text(kind.color),
      }))
    }

    const boardTags = tagsByBoard.get(id) ?? []
    if (boardTags.length) {
      board.tags = boardTags.map((tag) => ({ id: text(tag.id), name: text(tag.name), color: text(tag.color) }))
    }

    const archived = maybeFlag(row.archived)
    if (archived !== undefined) board.archived = archived
    const archivedAt = maybeCount(row.archived_at)
    if (archivedAt !== undefined) board.archivedAt = archivedAt
    const linked = parse<string[]>(row.linked_board_ids)
    if (linked !== undefined) board.linkedBoardIds = linked
    const cardType = maybeText(row.default_card_type_id)
    if (cardType !== undefined) board.defaultCardTypeId = cardType
    const dropLane = maybeText(row.default_drop_lane_id)
    if (dropLane !== undefined) board.defaultDropLaneId = dropLane
    const enforcement = maybeText(row.wip_enforcement)
    if (enforcement !== undefined) board.wipEnforcement = enforcement as Board['wipEnforcement']

    return board
  })
}

async function readLanes(db: Database): Promise<Lane[]> {
  const rows = await db.all<Row>('SELECT * FROM lanes ORDER BY board_id, workflow, position, id')
  return rows.map((row) => {
    const lane: Lane = {
      id: text(row.id),
      boardId: text(row.board_id),
      parentId: typeof row.parent_id === 'string' ? row.parent_id : null,
      order: count(row.position),
      name: text(row.name),
      workflow: text(row.workflow) as Workflow,
    }
    const orientation = maybeText(row.orientation)
    if (orientation !== undefined) lane.orientation = orientation as SplitOrientation
    const stage = maybeText(row.stage)
    if (stage !== undefined) lane.stage = stage as Stage
    const limit = maybeCount(row.wip_limit)
    if (limit !== undefined) lane.wipLimit = limit
    const description = maybeText(row.description)
    if (description !== undefined) lane.description = description
    return lane
  })
}

async function readItems(db: Database): Promise<Item[]> {
  const [items, checklists, logs] = await Promise.all([
    db.all<Row>('SELECT * FROM items ORDER BY created_at, id'),
    db.all<Row>('SELECT * FROM item_checklist ORDER BY item_id, position'),
    db.all<Row>('SELECT * FROM item_log ORDER BY item_id, at, id'),
  ])

  const checklistByItem = group(checklists, (row) => text(row.item_id))
  const logByItem = group(logs, (row) => text(row.item_id))

  return items.map((row) => {
    const id = text(row.id)
    return itemFrom(row, checklistByItem.get(id) ?? [], logByItem.get(id) ?? [])
  })
}

/**
 * One item, from its row and its two child lists. Extracted so a write can answer with the server's
 * version of a single card rather than reading the whole table to find it.
 */
function itemFrom(row: Row, checklist: Row[], log: Row[]): Item {
  const id = text(row.id)
  const item: Item = {

      id,
      title: text(row.title),
      typeId: text(row.type_id),
      createdAt: count(row.created_at),
    }

    const description = maybeText(row.description)
    if (description !== undefined) item.description = description
    const size = maybeCount(row.size)
    if (size !== undefined) item.size = size
    const initiativeTypeId = maybeText(row.initiative_type_id)
    if (initiativeTypeId !== undefined) item.initiativeTypeId = initiativeTypeId
    const tagIds = parse<string[]>(row.tag_ids)
    if (tagIds !== undefined) item.tagIds = tagIds
    const assignees = parse<string[]>(row.assignees)
    if (assignees !== undefined) item.assignees = assignees
    const priority = maybeText(row.priority)
    if (priority !== undefined) item.priority = priority as Item['priority']
    const start = maybeText(row.target_start_date)
    if (start !== undefined) item.targetStartDate = start
    const end = maybeText(row.target_end_date)
    if (end !== undefined) item.targetEndDate = end
    const rev = maybeCount(row.rev)
    if (rev !== undefined) item.rev = rev
    if (row.resolved_at !== null) item.resolvedAt = maybeCount(row.resolved_at) ?? null
    const reason = maybeText(row.last_move_reason)
    if (reason !== undefined) item.lastMoveReason = reason
    const blocked = maybeFlag(row.blocked)
    if (blocked !== undefined) item.blocked = blocked
    const blockedReason = maybeText(row.blocked_reason)
    if (blockedReason !== undefined) item.blockedReason = blockedReason
    const archived = maybeFlag(row.archived)
    if (archived !== undefined) item.archived = archived
    const archivedAt = maybeCount(row.archived_at)
    if (archivedAt !== undefined) item.archivedAt = archivedAt

    if (checklist.length) {
      item.checklist = checklist.map((entry) => ({
        id: text(entry.id),
        text: text(entry.text),
        done: entry.done === 1,
      }))
    }

    if (log.length) {
      item.log = log.map((entry) => {
        const line: ItemLogEntry = {
          id: text(entry.id),
          at: count(entry.at),
          kind: text(entry.kind) as ItemLogKind,
        }
        const by = maybeText(entry.by_user)
        if (by !== undefined) line.by = by
        const note = maybeText(entry.note)
        if (note !== undefined) line.note = note
        const fromLaneId = maybeText(entry.from_lane_id)
        if (fromLaneId !== undefined) line.fromLaneId = fromLaneId
        const toLaneId = maybeText(entry.to_lane_id)
        if (toLaneId !== undefined) line.toLaneId = toLaneId
        const fromStage = maybeText(entry.from_stage)
        if (fromStage !== undefined) line.fromStage = fromStage as Stage
        const toStage = maybeText(entry.to_stage)
        if (toStage !== undefined) line.toStage = toStage as Stage
        const boardId = maybeText(entry.board_id)
        if (boardId !== undefined) line.boardId = boardId
        return line
      })
    }

  return item
}

/**
 * Several items, by id — what a client that has been away needs in one request.
 *
 * The ids are bounded by the caller (a poll asks for a page, not for everything), because both D1
 * and the file driver have a limit on how many values one statement may carry.
 */
export async function readItemsByIds(db: Database, ids: string[]): Promise<Item[]> {
  if (!ids.length) return []
  const marks = ids.map((_, index) => `?${index + 1}`).join(', ')
  const [items, checklists, logs] = await Promise.all([
    db.all<Row>(`SELECT * FROM items WHERE id IN (${marks})`, ids),
    db.all<Row>(`SELECT * FROM item_checklist WHERE item_id IN (${marks}) ORDER BY position`, ids),
    db.all<Row>(`SELECT * FROM item_log WHERE item_id IN (${marks}) ORDER BY at, id`, ids),
  ])

  const checklistByItem = group(checklists, (row) => text(row.item_id))
  const logByItem = group(logs, (row) => text(row.item_id))

  return items.map((row) => {
    const id = text(row.id)
    return itemFrom(row, checklistByItem.get(id) ?? [], logByItem.get(id) ?? [])
  })
}

/** One item, by id — the version the server holds, which is the one a refusal answers with. */
export async function readItem(db: Database, id: string): Promise<Item | undefined> {
  const row = await db.get<Row>('SELECT * FROM items WHERE id = ?1', [id])
  if (!row) return undefined
  const [checklist, log] = await Promise.all([
    db.all<Row>('SELECT * FROM item_checklist WHERE item_id = ?1 ORDER BY position', [id]),
    db.all<Row>('SELECT * FROM item_log WHERE item_id = ?1 ORDER BY at, id', [id]),
  ])
  return itemFrom(row, checklist, log)
}


async function readTemplates(db: Database): Promise<BoardTemplate[]> {
  const [templates, lanes] = await Promise.all([
    db.all<Row>('SELECT * FROM board_templates ORDER BY id'),
    db.all<Row>('SELECT * FROM template_lanes ORDER BY template_id, position'),
  ])
  const lanesByTemplate = group(lanes, (row) => text(row.template_id))

  return templates.map((row) => {
    const id = text(row.id)
    const template: BoardTemplate = {
      id,
      name: text(row.name),
      band: text(row.band) as BoardBand,
      lanes: (lanesByTemplate.get(id) ?? []).map((lane) => ({
        key: text(lane.key),
        parentKey: typeof lane.parent_key === 'string' ? lane.parent_key : null,
        order: count(lane.position),
        name: text(lane.name),
        ...(maybeText(lane.orientation) !== undefined
          ? { orientation: text(lane.orientation) as SplitOrientation }
          : {}),
        ...(maybeText(lane.stage) !== undefined ? { stage: text(lane.stage) as Stage } : {}),
        ...(maybeCount(lane.wip_limit) !== undefined ? { wipLimit: count(lane.wip_limit) } : {}),
        ...(maybeText(lane.description) !== undefined ? { description: text(lane.description) } : {}),
      })),
    }
    const cardType = maybeText(row.default_card_type_id)
    if (cardType !== undefined) template.defaultCardTypeId = cardType
    const enforcement = maybeText(row.wip_enforcement)
    if (enforcement !== undefined) template.wipEnforcement = enforcement as BoardTemplate['wipEnforcement']
    return template
  })
}

async function readSettings(db: Database): Promise<{ boardId: string; autoArchiveDays?: number; savedFilters: SavedFilter[]; collapsedLanes: Record<string, boolean> }> {
  const row = await db.get<Row>('SELECT * FROM workspace WHERE id = ?1', [WORKSPACE_ROW])
  const autoArchiveDays = row ? maybeCount(row.auto_archive_days) : undefined
  return {
    boardId: row ? text(row.board_id) : '',
    ...(autoArchiveDays !== undefined ? { autoArchiveDays } : {}),
    savedFilters: (row ? parse<SavedFilter[]>(row.saved_filters) : undefined) ?? [],
    collapsedLanes: (row ? parse<Record<string, boolean>>(row.collapsed_lanes) : undefined) ?? {},
  }
}

export async function readWorkspace(db: Database): Promise<Workspace> {
  const [settings, boards, lanes, items, placements, edges, links, objectives, keyResults, boardTemplates, users, issueTypes] =
    await Promise.all([
      readSettings(db),
      readBoards(db),
      readLanes(db),
      readItems(db),
      db.all<Row>('SELECT * FROM placements ORDER BY id'),
      db.all<Row>('SELECT * FROM edges ORDER BY id'),
      db.all<Row>('SELECT * FROM links ORDER BY id'),
      db.all<Row>('SELECT * FROM objectives ORDER BY id'),
      db.all<Row>('SELECT * FROM key_results ORDER BY id'),
      readTemplates(db),
      db.all<Row>('SELECT * FROM people ORDER BY id'),
      db.all<Row>('SELECT * FROM issue_types ORDER BY id'),
    ])

  return {
    ...settings,
    users: users.map((row): User => {
      const user: User = { id: text(row.id), name: text(row.name) }
      const avatarUrl = maybeText(row.avatar_url)
      if (avatarUrl !== undefined) user.avatarUrl = avatarUrl
      return user
    }),
    issueTypes: issueTypes.map(
      (row): IssueType => ({ id: text(row.id), name: text(row.name), color: text(row.color) }),
    ),
    items,
    edges: edges.map(
      (row): Edge => ({ id: text(row.id), kind: text(row.kind) as EdgeKind, from: text(row.from_id), to: text(row.to_id) }),
    ),
    links: links.map((row): ItemLink => {
      const link: ItemLink = { id: text(row.id), from: text(row.from_id), to: text(row.to_id) }
      const reason = maybeText(row.reason)
      if (reason !== undefined) link.reason = reason
      return link
    }),
    objectives: objectives.map((row): Objective => {
      const objective: Objective = {
        id: text(row.id),
        title: text(row.title),
        period: text(row.period),
        status: text(row.status) as Objective['status'],
      }
      const score = maybeCount(row.score)
      if (score !== undefined) objective.score = score
      return objective
    }),
    keyResults: keyResults.map(
      (row): KeyResult => ({ id: text(row.id), objectiveId: text(row.objective_id), title: text(row.title) }),
    ),
    boardTemplates,
    boards,
    lanes,
    placements: placements.map((row): Placement => {
      const placement: Placement = {
        id: text(row.id),
        boardId: text(row.board_id),
        itemId: text(row.item_id),
        laneId: text(row.lane_id),
      }
      const entered = maybeCount(row.lane_entered_at)
      if (entered !== undefined) placement.laneEnteredAt = entered
      const rank = maybeCount(row.rank)
      if (rank !== undefined) placement.rank = rank
      return placement
    }),
  }
}
