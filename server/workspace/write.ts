/**
 * Writing a whole workspace.
 *
 * There is one writer, and it replaces the workspace rather than reconciling it: that is what the
 * first sign-in import needs, and what a test needs to put a known workspace in front of the read.
 * The incremental write path — a change with the revision it was based on — is task 118.3, and it
 * will sit beside this rather than replace it.
 *
 * Everything goes through one transaction, because a half-written workspace is worse than none.
 */

import type { Item } from '../../src/domain/types'
import type { Database, Statement } from '../db'
import type { Workspace } from './types'
import { WORKSPACE_ROW } from './types'

/** Children before parents, so a delete never trips a foreign key. */
const TABLES = [
  'item_log',
  'item_checklist',
  'placements',
  'lanes',
  'board_initiative_types',
  'board_tags',
  'boards',
  'items',
  'edges',
  'links',
  'key_results',
  'objectives',
  'template_lanes',
  'board_templates',
  'people',
  'issue_types',
  'workspace',
] as const

type Row = Record<string, unknown>

const value = <T>(input: T | undefined | null): T | null => input ?? null
const flag = (input: boolean | undefined): number | null => (input === undefined ? null : input ? 1 : 0)
const json = (input: unknown): string | null => (input === undefined ? null : JSON.stringify(input))

function add(statements: Statement[], table: string, row: Row): void {
  const columns = Object.keys(row)
  statements.push({
    sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, index) => `?${index + 1}`).join(', ')})`,
    params: Object.values(row),
  })
}

/** One item's row, checklist and history. Shared by the whole-workspace write and the item write. */
function addItem(statements: Statement[], item: Item): void {
    add(statements, 'items', {
      id: item.id,
      title: item.title,
      description: value(item.description),
      type_id: item.typeId,
      size: value(item.size),
      initiative_type_id: value(item.initiativeTypeId),
      tag_ids: json(item.tagIds),
      assignees: json(item.assignees),
      priority: value(item.priority),
      target_start_date: value(item.targetStartDate),
      target_end_date: value(item.targetEndDate),
      created_at: item.createdAt,
      rev: value(item.rev),
      resolved_at: item.resolvedAt === undefined ? null : item.resolvedAt,
      last_move_reason: value(item.lastMoveReason),
      blocked: flag(item.blocked),
      blocked_reason: value(item.blockedReason),
      archived: flag(item.archived),
      archived_at: value(item.archivedAt),
    })

    for (const [position, entry] of (item.checklist ?? []).entries()) {
      add(statements, 'item_checklist', {
        item_id: item.id,
        id: entry.id,
        text: entry.text,
        done: entry.done ? 1 : 0,
        position,
      })
    }

    for (const entry of item.log ?? []) {
      add(statements, 'item_log', {
        item_id: item.id,
        id: entry.id,
        at: entry.at,
        kind: entry.kind,
        by_user: value(entry.by),
        note: value(entry.note),
        from_lane_id: value(entry.fromLaneId),
        to_lane_id: value(entry.toLaneId),
        from_stage: value(entry.fromStage),
        to_stage: value(entry.toStage),
        board_id: value(entry.boardId),
      })
    }
}

/**
 * One item, replaced whole.
 *
 * The server owns the revision: it is given the one the change was based on, and stores that plus
 * one. The children are cleared first because D1 does not cascade a foreign key by default, and a
 * history that outlived its item would be worse than a slow delete.
 */
export async function writeItem(db: Database, item: Item, key?: string): Promise<void> {
  const statements: Statement[] = [
    { sql: 'DELETE FROM item_checklist WHERE item_id = ?1', params: [item.id] },
    { sql: 'DELETE FROM item_log WHERE item_id = ?1', params: [item.id] },
    { sql: 'DELETE FROM items WHERE id = ?1', params: [item.id] },
  ]
  addItem(statements, item)

  // The feed a second device reads. Written with the change, so a change that landed is a change
  // that is announced, and a batch that failed announced nothing.
  statements.push({ sql: 'INSERT INTO changes (item_id, rev) VALUES (?1, ?2)', params: [item.id, item.rev ?? 0] })

  if (key) {
    // The key is recorded in the same batch as the change it names: either both land or neither
    // does, which is what makes a retry safe rather than merely likely to be safe.
    statements.push({ sql: 'INSERT OR IGNORE INTO applied_writes (key, item_id, rev) VALUES (?1, ?2, ?3)', params: [key, item.id, item.rev ?? 0] })
    statements.push({ sql: "DELETE FROM applied_writes WHERE at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')" })
  }

  await db.batch(statements)
}

/** Whether this change has already been applied, so a retry can be answered instead of redone. */
export async function alreadyApplied(db: Database, key: string): Promise<boolean> {
  return Boolean(await db.get('SELECT 1 AS applied FROM applied_writes WHERE key = ?1', [key]))
}

export async function writeWorkspace(db: Database, workspace: Workspace, audit?: Statement): Promise<void> {
  const statements: Statement[] = TABLES.map((table) => ({ sql: `DELETE FROM ${table}` }))

  for (const user of workspace.users) {
    add(statements, 'people', { id: user.id, name: user.name, avatar_url: value(user.avatarUrl) })
  }

  for (const type of workspace.issueTypes) {
    add(statements, 'issue_types', { id: type.id, name: type.name, color: type.color })
  }

  workspace.boards.forEach((board, index) => {
    add(statements, 'boards', {
      id: board.id,
      name: board.name,
      band: board.band,
      description: board.description ?? '',
      archived: flag(board.archived),
      archived_at: value(board.archivedAt),
      linked_board_ids: json(board.linkedBoardIds),
      default_card_type_id: value(board.defaultCardTypeId),
      default_drop_lane_id: value(board.defaultDropLaneId),
      wip_enforcement: value(board.wipEnforcement),
      position: index,
    })
    for (const [position, kind] of (board.initiativeTypes ?? []).entries()) {
      add(statements, 'board_initiative_types', {
        board_id: board.id,
        id: kind.id,
        name: kind.name,
        color: kind.color,
        position,
      })
    }
    for (const [position, tag] of (board.tags ?? []).entries()) {
      add(statements, 'board_tags', {
        board_id: board.id,
        id: tag.id,
        name: tag.name,
        color: tag.color,
        position,
      })
    }
  })

  // The tree is built flat and wired afterwards, because a lane in the array can be a grandchild of
  // one that comes later — and a foreign key does not care about the order an array happened to use.
  for (const lane of workspace.lanes) {
    add(statements, 'lanes', {
      id: lane.id,
      board_id: lane.boardId,
      parent_id: null,
      position: lane.order,
      name: lane.name,
      workflow: lane.workflow,
      orientation: value(lane.orientation),
      stage: value(lane.stage),
      wip_limit: value(lane.wipLimit),
      description: value(lane.description),
    })
  }
  for (const lane of workspace.lanes) {
    if (lane.parentId) {
      statements.push({ sql: 'UPDATE lanes SET parent_id = ?1 WHERE id = ?2', params: [lane.parentId, lane.id] })
    }
  }

  for (const item of workspace.items) {
    addItem(statements, item)
    statements.push({ sql: 'INSERT INTO changes (item_id, rev) VALUES (?1, ?2)', params: [item.id, item.rev ?? 0] })
  }

  for (const placement of workspace.placements) {
    add(statements, 'placements', {
      id: placement.id,
      board_id: placement.boardId,
      item_id: placement.itemId,
      lane_id: placement.laneId,
      lane_entered_at: value(placement.laneEnteredAt),
      rank: value(placement.rank),
    })
  }

  for (const edge of workspace.edges) {
    add(statements, 'edges', { id: edge.id, kind: edge.kind, from_id: edge.from, to_id: edge.to })
  }

  for (const link of workspace.links) {
    add(statements, 'links', { id: link.id, from_id: link.from, to_id: link.to, reason: value(link.reason) })
  }

  for (const objective of workspace.objectives) {
    add(statements, 'objectives', {
      id: objective.id,
      title: objective.title,
      period: objective.period,
      status: objective.status,
      score: value(objective.score),
    })
  }

  for (const result of workspace.keyResults) {
    add(statements, 'key_results', { id: result.id, objective_id: result.objectiveId, title: result.title })
  }

  for (const template of workspace.boardTemplates) {
    add(statements, 'board_templates', {
      id: template.id,
      name: template.name,
      band: template.band,
      default_card_type_id: value(template.defaultCardTypeId),
      wip_enforcement: value(template.wipEnforcement),
    })
    for (const lane of template.lanes) {
      add(statements, 'template_lanes', {
        template_id: template.id,
        key: lane.key,
        parent_key: value(lane.parentKey),
        position: lane.order,
        name: lane.name,
        orientation: value(lane.orientation),
        stage: value(lane.stage),
        wip_limit: value(lane.wipLimit),
        description: value(lane.description),
      })
    }
  }

  add(statements, 'workspace', {
    id: WORKSPACE_ROW,
    board_id: workspace.boardId || null,
    auto_archive_days: value(workspace.autoArchiveDays),
    saved_filters: json(workspace.savedFilters),
    collapsed_lanes: json(workspace.collapsedLanes),
  })

  // The import and the record of it are one transaction: an import nobody can explain is not one.
  if (audit) statements.push(audit)
  await db.batch(statements)
}
