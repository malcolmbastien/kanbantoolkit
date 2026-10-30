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

import type { Item, Placement } from '../../src/domain/types'
import type { Database, Statement } from '../db'
import type { Workspace } from './types'
import type { Vocabulary } from './types'
import { WORKSPACE_ROW } from './types'

/** Children before parents, so a delete never trips a foreign key. */
const TABLES = [
  'workspace_structure',
  'item_log',
  'item_checklist',
  'placements',
  'lanes',
  'board_flows',
  'board_initiative_types',
  'board_tags',
  'boards',
  'items',
  'edges',
  'links',
  'key_results',
  'objectives',
  'template_lanes',
  'template_flows',
  'board_templates',
  'people',
  'issue_types',
  'workspace',
] as const

type Row = Record<string, unknown>

/**
 * The tables that carry a `workspace_id` of their own.
 *
 * The children — a checklist, a log, a board's kinds and tags, a template's lanes — belong through
 * their parent, and are scoped by it: an item's checklist cannot be in a different workspace from
 * the item, so a second column would be a second thing to keep true.
 *
 * The settings row is absent for a different reason: its primary key *is* the workspace id, so it
 * carries the workspace as its identity rather than as a second column saying the same thing.
 */
const SCOPED = new Set([
  'workspace_structure',
  'people',
  'issue_types',
  'boards',
  'board_flows',
  'lanes',
  'items',
  'item_log',
  'placements',
  'edges',
  'links',
  'objectives',
  'key_results',
  'board_templates',
])

/**
 * How a table that carries no `workspace_id` of its own is cleared: through the parent the scope
 * already names, or — for the settings row — by its own primary key, which is the workspace.
 */
const CHILD_DELETE: Record<string, string> = {
  workspace: 'DELETE FROM workspace WHERE id = ?1',
  item_checklist: 'DELETE FROM item_checklist WHERE item_id IN (SELECT id FROM items WHERE workspace_id = ?1)',
  item_log: 'DELETE FROM item_log WHERE item_id IN (SELECT id FROM items WHERE workspace_id = ?1)',
  board_initiative_types:
    'DELETE FROM board_initiative_types WHERE board_id IN (SELECT id FROM boards WHERE workspace_id = ?1)',
  board_tags: 'DELETE FROM board_tags WHERE board_id IN (SELECT id FROM boards WHERE workspace_id = ?1)',
  template_lanes:
    'DELETE FROM template_lanes WHERE template_id IN (SELECT id FROM board_templates WHERE workspace_id = ?1)',
  template_flows:
    'DELETE FROM template_flows WHERE template_id IN (SELECT id FROM board_templates WHERE workspace_id = ?1)',
}

const value = <T>(input: T | undefined | null): T | null => input ?? null
const flag = (input: boolean | undefined): number | null => (input === undefined ? null : input ? 1 : 0)
const json = (input: unknown): string | null => (input === undefined ? null : JSON.stringify(input))

function add(statements: Statement[], table: string, row: Row, workspaceId: string): void {
  const scoped = SCOPED.has(table) ? { ...row, workspace_id: workspaceId } : row
  const columns = Object.keys(scoped)
  statements.push({
    sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, index) => `?${index + 1}`).join(', ')})`,
    params: Object.values(scoped),
  })
}

/** One item's row, checklist and history. Shared by the whole-workspace write and the item write. */
function addItem(statements: Statement[], item: Item, workspaceId: string): void {
    add(statements, 'items', {
      id: item.id,
      title: item.title,
      description: value(item.description),
      type_id: item.typeId,
      created_by_id: value(item.createdById),
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
      discarded: flag(item.discarded),
    }, workspaceId)

    for (const [position, entry] of (item.checklist ?? []).entries()) {
      add(statements, 'item_checklist', {
        item_id: item.id,
        id: entry.id,
        text: entry.text,
        done: entry.done ? 1 : 0,
        position,
      }, workspaceId)
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
      }, workspaceId)
    }
}

/**
 * One item, replaced whole.
 *
 * The server owns the revision: it is given the one the change was based on, and stores that plus
 * one. The children are cleared first because D1 does not cascade a foreign key by default, and a
 * history that outlived its item would be worse than a slow delete.
 */
export async function writeItem(db: Database, item: Item, workspaceId: string, key?: string): Promise<void> {
  return writeItemAndPlacements(db, item, [], workspaceId, key)
}

/**
 * An item and the placements a change touched, in one transaction.
 *
 * A create is a card *and* its cell, and a move is the item's history *and* the arrangement — so the
 * two cannot be separate statements with a moment between them. Placements are upserted by id, so the
 * same writer serves a new placement and the renumbering of every card in the lane it landed in.
 *
 * This is the only place the API writes arrangement: the app's own moves are still the browser's
 * (task 118 never grew a placement route), which is why `/api/v1` is the first door that puts a move
 * in the database rather than in a cache.
 *
 * **An item write keeps the card where it is.** The row is replaced (delete, then insert) because
 * every column is rewritten, and placements reference the item with `ON DELETE CASCADE` — so the
 * delete takes the card's cells with it. They are read first and written back before the caller's
 * own placements, which then win by id. Without this, editing a card silently took it off its board.
 */
export async function writeItemAndPlacements(
  db: Database,
  item: Item,
  placements: Placement[],
  workspaceId: string,
  key?: string,
  audit?: Statement,
): Promise<void> {
  // Where the card already sits, read before the row it hangs from is replaced.
  const existing = await db.all<{
    id: string
    board_id: string
    item_id: string
    lane_id: string
    lane_entered_at: number | null
    rank: number | null
  }>('SELECT * FROM placements WHERE item_id = ?1 AND workspace_id = ?2', [item.id, workspaceId])

  const statements: Statement[] = [
    { sql: 'DELETE FROM item_checklist WHERE item_id = ?1', params: [item.id] },
    // scoped by its item
    { sql: 'DELETE FROM item_log WHERE item_id = ?1', params: [item.id] },
    { sql: 'DELETE FROM items WHERE id = ?1 AND workspace_id = ?2', params: [item.id, workspaceId] },
  ]
  addItem(statements, item, workspaceId)

  // Back where it was, before the caller's own placements — a move may renumber the lane, and that
  // write must be the one that lands.
  for (const row of existing) {
    statements.push({
      sql: `INSERT OR REPLACE INTO placements (id, board_id, item_id, lane_id, lane_entered_at, rank, workspace_id)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      params: [row.id, row.board_id, row.item_id, row.lane_id, row.lane_entered_at, row.rank, workspaceId],
    })
  }

  // The trail shares the transaction, as every other access change does: a write that landed must
  // be explainable, and one that failed must not leave a claim that it happened.
  if (audit) statements.push(audit)

  for (const placement of placements) {
    statements.push({
      sql: `INSERT INTO placements (id, board_id, item_id, lane_id, lane_entered_at, rank, workspace_id)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT (id) DO UPDATE SET
              lane_id = excluded.lane_id,
              lane_entered_at = excluded.lane_entered_at,
              rank = excluded.rank`,
      params: [
        placement.id,
        placement.boardId,
        placement.itemId,
        placement.laneId,
        value(placement.laneEnteredAt),
        value(placement.rank),
        workspaceId,
      ],
    })
  }

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

/** The item a keyed change wrote, so a replay can answer with it rather than with "done". */
export async function appliedItemOf(db: Database, key: string): Promise<{ itemId: string; rev: number } | undefined> {
  const row = await db.get<{ item_id: string; rev: number }>('SELECT item_id, rev FROM applied_writes WHERE key = ?1', [key])
  return row ? { itemId: row.item_id, rev: row.rev } : undefined
}

/** Types, templates, objectives and key results, as rows — shared by the import and the document. */
function addVocabulary(statements: Statement[], vocabulary: Vocabulary, workspaceId: string): void {
  for (const type of vocabulary.issueTypes) {
    add(statements, 'issue_types', { id: type.id, name: type.name, color: type.color }, workspaceId)
  }

  for (const template of vocabulary.boardTemplates) {
    add(statements, 'board_templates', {
      id: template.id,
      name: template.name,
      band: template.band,
      default_card_type_id: value(template.defaultCardTypeId),
      wip_enforcement: value(template.wipEnforcement),
    }, workspaceId)
    for (const flow of template.flows ?? []) {
      add(statements, 'template_flows', {
        template_id: template.id,
        key: flow.key,
        kind: flow.kind,
        name: flow.name,
        position: flow.order,
      }, workspaceId)
    }
    for (const lane of template.lanes) {
      add(statements, 'template_lanes', {
        template_id: template.id,
        key: lane.key,
        flow_key: lane.flowKey,
        parent_key: value(lane.parentKey),
        position: lane.order,
        name: lane.name,
        orientation: value(lane.orientation),
        stage: value(lane.stage),
        wip_limit: value(lane.wipLimit),
        description: value(lane.description),
      }, workspaceId)
    }
  }

  for (const objective of vocabulary.objectives) {
    add(statements, 'objectives', {
      id: objective.id,
      title: objective.title,
      period: objective.period,
      status: objective.status,
      score: value(objective.score),
    }, workspaceId)
  }

  for (const result of vocabulary.keyResults) {
    add(statements, 'key_results', { id: result.id, objective_id: result.objectiveId, title: result.title }, workspaceId)
  }
}

/**
 * Replace the workspace's vocabulary, in one transaction, and keep its revision honest.
 *
 * The document is the whole truth about these lists: a row the sender did not send is gone, the way
 * a board's design does not keep a lane it was not told about. The sender says which revision it
 * worked from; the route has already checked it, and this writes the next one.
 */
export async function writeVocabulary(
  db: Database,
  workspaceId: string,
  vocabulary: Vocabulary,
  rev: number,
): Promise<void> {
  const statements: Statement[] = [
    // Children before parents, and only this workspace's rows.
    { sql: 'DELETE FROM template_lanes WHERE template_id IN (SELECT id FROM board_templates WHERE workspace_id = ?1)', params: [workspaceId] },
    { sql: 'DELETE FROM template_flows WHERE template_id IN (SELECT id FROM board_templates WHERE workspace_id = ?1)', params: [workspaceId] },
    { sql: 'DELETE FROM board_templates WHERE workspace_id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM issue_types WHERE workspace_id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM objectives WHERE workspace_id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM key_results WHERE workspace_id = ?1', params: [workspaceId] },
  ]
  addVocabulary(statements, vocabulary, workspaceId)
  // The policy and the revision land together with the lists: a write that half-arrived could not
  // be refused next time, because the number it left behind would say it had.
  statements.push({
    sql: `INSERT INTO workspace (id, auto_archive_days, vocabulary_rev) VALUES (?1, ?2, ?3)
          ON CONFLICT (id) DO UPDATE SET
            auto_archive_days = excluded.auto_archive_days,
            vocabulary_rev = excluded.vocabulary_rev`,
    params: [workspaceId, value(vocabulary.autoArchiveDays), rev + 1],
  })
  await db.batch(statements)
}

export async function writeWorkspace(
  db: Database,
  workspace: Workspace,
  workspaceId: string,
  audit?: Statement,
): Promise<void> {
  // Only this workspace's rows: the import replaces one workspace, and another workspace's work is
  // not this transaction's to remove.
  const statements: Statement[] = TABLES.map((table) =>
    SCOPED.has(table)
      ? { sql: `DELETE FROM ${table} WHERE workspace_id = ?1`, params: [workspaceId] }
      : { sql: CHILD_DELETE[table], params: [workspaceId] },
  )

  for (const user of workspace.users) {
    add(statements, 'people', { id: user.id, name: user.name, avatar_url: value(user.avatarUrl) }, workspaceId)
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
    }, workspaceId)
    for (const [position, kind] of (board.initiativeTypes ?? []).entries()) {
      add(statements, 'board_initiative_types', {
        board_id: board.id,
        id: kind.id,
        name: kind.name,
        color: kind.color,
        position,
      }, workspaceId)
    }
    for (const [position, tag] of (board.tags ?? []).entries()) {
      add(statements, 'board_tags', {
        board_id: board.id,
        id: tag.id,
        name: tag.name,
        color: tag.color,
        position,
      }, workspaceId)
    }
  })

  // A board's flows go in before its lanes: a lane names its flow, and a foreign key does not wait.
  for (const flow of workspace.flows ?? []) {
    add(statements, 'board_flows', {
      id: flow.id,
      board_id: flow.boardId,
      kind: flow.kind,
      name: flow.name,
      position: flow.order,
    }, workspaceId)
  }

  // The tree is built flat and wired afterwards, because a lane in the array can be a grandchild of
  // one that comes later — and a foreign key does not care about the order an array happened to use.
  for (const lane of workspace.lanes) {
    add(statements, 'lanes', {
      id: lane.id,
      board_id: lane.boardId,
      parent_id: null,
      position: lane.order,
      name: lane.name,
      flow_id: lane.flowId,
      orientation: value(lane.orientation),
      stage: value(lane.stage),
      wip_limit: value(lane.wipLimit),
      description: value(lane.description),
    }, workspaceId)
  }
  for (const lane of workspace.lanes) {
    if (lane.parentId) {
      statements.push({
      sql: 'UPDATE lanes SET parent_id = ?1 WHERE id = ?2 AND workspace_id = ?3',
      params: [lane.parentId, lane.id, workspaceId],
    })
    }
  }

  for (const item of workspace.items) {
    addItem(statements, item, workspaceId)
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
    }, workspaceId)
  }

  for (const edge of workspace.edges) {
    add(statements, 'edges', { id: edge.id, kind: edge.kind, from_id: edge.from, to_id: edge.to }, workspaceId)
  }

  for (const link of workspace.links) {
    add(statements, 'links', { id: link.id, from_id: link.from, to_id: link.to, reason: value(link.reason) }, workspaceId)
  }

  // An imported design is the first one this workspace has: the revision says so, and a client that
  // adopts it knows which design its next write is based on.
  statements.push({
    sql: 'INSERT INTO workspace_structure (workspace_id, rev) VALUES (?1, 1) ON CONFLICT (workspace_id) DO UPDATE SET rev = 1',
    params: [workspaceId],
  })

  // The words a workspace owns — its types, templates and objectives — go in through the same
  // writer the vocabulary route uses, so one document has one shape.
  addVocabulary(statements, workspace, workspaceId)

  add(statements, 'workspace', {
    id: WORKSPACE_ROW,
    board_id: workspace.boardId || null,
    auto_archive_days: value(workspace.autoArchiveDays),
    saved_filters: json(workspace.savedFilters),
    collapsed_lanes: json(workspace.collapsedLanes),
  }, workspaceId)

  // The import and the record of it are one transaction: an import nobody can explain is not one.
  if (audit) statements.push(audit)
  await db.batch(statements)
}
