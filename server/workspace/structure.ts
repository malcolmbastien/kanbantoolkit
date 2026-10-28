/**
 * The board design: the one part of a workspace that is a document rather than a record.
 *
 * Boards, lanes and placements are a tree — a placement is a position inside a lane, and a lane is
 * a column of a board — so they are written together or not at all. That is the opposite of an item,
 * which is its own record with its own revision: two cards can move at once, but two people
 * redesigning the same board cannot both be right.
 *
 * The revision is what keeps that honest. A sender says which design it started from; if the stored
 * one has moved past it the write is refused with the revision that is there, and the client reads
 * again rather than guessing which board the other person meant. It is the same shape the item
 * write uses, applied to something larger.
 *
 * A placement whose item the server has not met yet is skipped: items arrive one at a time through
 * their own path, and a position is late rather than lost — the next write carries it.
 */

import type { Board, Lane, Placement } from '../../src/domain/types'
import type { Database } from '../db'

type Value = string | number | bigint | null | Uint8Array

type Row = Record<string, unknown>

/** Which revision this workspace's design is at. A workspace nobody has designed is at zero. */
export async function readStructureRev(db: Database, workspaceId: string): Promise<number> {
  const row = await db.get<{ rev: number | null }>(
    'SELECT rev FROM workspace_structure WHERE workspace_id = ?1',
    [workspaceId],
  )
  return row?.rev ?? 0
}

/** The id ceiling the item parser uses, so a design cannot carry an id an item could not. */
const ID = 100

const idOf = (row: unknown): string | undefined => {
  if (!row || typeof row !== 'object') return undefined
  const id = (row as Row).id
  return typeof id === 'string' && id.length > 0 && id.length <= ID ? id : undefined
}

/**
 * What the route will accept as a design.
 *
 * The rows are trusted to be the shapes they claim (the client's own types, and a reader that
 * cannot make sense of them fails loudly); what is checked here is the part a database cannot:
 * every lane is on a board that is in the payload, and every placement is in a lane that is. Items
 * are checked against the table, because they live outside this document.
 */
export function readDesign(input: unknown): { boards: Board[]; lanes: Lane[]; placements: Placement[] } | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Row
  const rows = <T>(value: unknown, limit: number): T[] => {
    if (!Array.isArray(value)) return []
    const seen = new Set<string>()
    const kept: T[] = []
    for (const row of value.slice(0, limit)) {
      const id = idOf(row)
      if (!id || seen.has(id)) continue
      seen.add(id)
      kept.push(row as T)
    }
    return kept
  }

  const boards = rows<Board>(raw.boards, 200)
  const boardIds = new Set(boards.map((board) => board.id))
  const lanes = rows<Lane>(raw.lanes, 2_000).filter((lane) => boardIds.has(lane.boardId))
  const laneIds = new Set(lanes.map((lane) => lane.id))
  const placements = rows<Placement>(raw.placements, 20_000).filter((placement) => laneIds.has(placement.laneId))
  return { boards, lanes, placements }
}

export interface DesignWrite {
  boards: Board[]
  lanes: Lane[]
  placements: Placement[]
  /** What was written, so a caller can say what happened. */
  placed: number
  skipped: number
}

/**
 * Replace the design, in one transaction, and keep every item's own position honest.
 *
 * `placements` is the whole truth about where cards sit: a row that is not in the payload is gone
 * from the design, which is what a deleted card or a retired board looks like by the time it gets
 * here. The items themselves are not touched — this writes where they are, not what they are.
 */
export async function writeDesign(
  db: Database,
  workspaceId: string,
  design: { boards: Board[]; lanes: Lane[]; placements: Placement[] },
  /** The revision the sender worked from, already checked against the stored one. */
  rev: number,
): Promise<DesignWrite> {
  // Items are their own records; a placement for one the server has never seen is skipped rather
  // than refused, because it is arriving behind its card, not instead of it.
  const known = new Set(
    (await db.all<{ id: string }>('SELECT id FROM items WHERE workspace_id = ?1', [workspaceId])).map((row) => row.id),
  )
  const placements = design.placements.filter((placement) => known.has(placement.itemId))

  const statements: { sql: string; params: Value[] }[] = [
    { sql: 'DELETE FROM placements WHERE workspace_id = ?1', params: [workspaceId] },
    { sql: 'DELETE FROM lanes WHERE workspace_id = ?1', params: [workspaceId] },
    // A board's own vocabularies — its kinds and its tags — belong to it through a foreign key, so
    // replacing the board takes them with it and they are written back below.
    { sql: 'DELETE FROM boards WHERE workspace_id = ?1', params: [workspaceId] },
  ]

  for (const [index, board] of design.boards.entries()) {
    statements.push({
      sql: `INSERT OR REPLACE INTO boards (id, workspace_id, name, band, description, archived, archived_at,
              linked_board_ids, default_card_type_id, default_drop_lane_id, wip_enforcement, position)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      params: [
        board.id,
        workspaceId,
        board.name ?? '',
        board.band ?? 'team',
        board.description ?? '',
        board.archived ? 1 : 0,
        board.archivedAt ?? null,
        JSON.stringify(board.linkedBoardIds ?? []),
        board.defaultCardTypeId ?? null,
        board.defaultDropLaneId ?? null,
        board.wipEnforcement ?? 'visualize',
        index,
      ],
    })
    for (const [position, kind] of (board.initiativeTypes ?? []).entries()) {
      statements.push({
        sql: `INSERT OR REPLACE INTO board_initiative_types (workspace_id, board_id, id, name, color, position)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        params: [workspaceId, board.id, kind.id, kind.name, kind.color, position],
      })
    }
    for (const [position, tag] of (board.tags ?? []).entries()) {
      statements.push({
        sql: `INSERT OR REPLACE INTO board_tags (workspace_id, board_id, id, name, color, position)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        params: [workspaceId, board.id, tag.id, tag.name, tag.color, position],
      })
    }
  }

  // Lanes go in with no parent first: a child may be listed before its parent, and a foreign key
  // does not wait for the rest of the array. The second pass is what makes the tree.
  for (const lane of design.lanes) {
    statements.push({
      sql: `INSERT OR REPLACE INTO lanes (id, workspace_id, board_id, parent_id, position, name, workflow,
              orientation, stage, wip_limit, description)
            VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      params: [
        lane.id,
        workspaceId,
        lane.boardId,
        lane.order ?? 0,
        lane.name ?? '',
        lane.workflow ?? 'cards',
        lane.orientation ?? null,
        lane.stage ?? null,
        lane.wipLimit ?? null,
        lane.description ?? '',
      ],
    })
  }
  for (const lane of design.lanes) {
    if (!lane.parentId) continue
    statements.push({
      sql: 'UPDATE lanes SET parent_id = ?1 WHERE id = ?2 AND workspace_id = ?3',
      params: [lane.parentId, lane.id, workspaceId],
    })
  }

  for (const placement of placements) {
    statements.push({
      sql: `INSERT OR REPLACE INTO placements (id, workspace_id, board_id, item_id, lane_id, lane_entered_at, rank)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      params: [
        placement.id,
        workspaceId,
        placement.boardId ?? design.lanes.find((lane) => lane.id === placement.laneId)?.boardId ?? '',
        placement.itemId,
        placement.laneId,
        placement.laneEnteredAt ?? null,
        placement.rank ?? 0,
      ],
    })
  }

  statements.push({
    sql: `INSERT INTO workspace_structure (workspace_id, rev) VALUES (?1, ?2)
          ON CONFLICT (workspace_id) DO UPDATE SET rev = excluded.rev`,
    params: [workspaceId, rev + 1],
  })

  await db.batch(statements)
  return { boards: design.boards, lanes: design.lanes, placements, placed: placements.length, skipped: design.placements.length - placements.length }
}
