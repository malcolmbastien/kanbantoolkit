/**
 * A board's activity stream.
 *
 * It is a board-scoped event log, not an item history: a card event carries only the item id, a
 * deletion carries no card at all, and a design change is one board-level sentence. The stream is
 * written by the client where the change is accepted, with the server as the authority for the
 * actor and the clock. That keeps this table out of the workspace document and out of `item_log`:
 * a card's log is deleted with the card, while the board stream must still remember that a card
 * was deleted without remembering which one.
 */

import type { Database } from '../db'
import type { BoardActivityEvent, BoardActivityKind } from '../../src/domain/types'

export const BOARD_ACTIVITY_PAGE = 50
export const BOARD_ACTIVITY_MAX = 100
const SUMMARY_MAX = 300
const ID_MAX = 100

const KINDS = new Set<BoardActivityKind>([
  'card.created',
  'card.updated',
  'card.deleted',
  'board.updated',
])

const CARD_KINDS = new Set<BoardActivityKind>(['card.created', 'card.updated', 'card.deleted'])

export interface BoardActivityPage {
  events: BoardActivityEvent[]
  nextCursor: string | null
  total: number
}

type Row = Record<string, unknown>

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const maybeText = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

/** Whether the board is one this workspace can read. */
export async function boardExists(db: Database, boardId: string, workspaceId: string): Promise<boolean> {
  return Boolean(await db.get('SELECT 1 AS seen FROM boards WHERE id = ?1 AND workspace_id = ?2', [boardId, workspaceId]))
}

function eventFrom(row: Row): BoardActivityEvent {
  const actorId = maybeText(row.actor_id)
  const via = maybeText(row.via)
  const itemId = maybeText(row.item_id)
  const summary = maybeText(row.summary)
  return {
    id: text(row.id),
    boardId: text(row.board_id),
    at: typeof row.at === 'number' ? row.at : Number(row.at ?? 0),
    ...(actorId ? { actorId } : {}),
    ...(via ? { via } : {}),
    kind: text(row.kind) as BoardActivityKind,
    ...(itemId ? { itemId } : {}),
    ...(summary ? { summary } : {}),
  }
}

/** One page, newest first, with a cursor made of the last row's sort pair. */
export async function readBoardActivity(
  db: Database,
  boardId: string,
  workspaceId: string,
  options: { cursor?: string; limit?: string } = {},
): Promise<BoardActivityPage> {
  const requested = Number(options.limit)
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(BOARD_ACTIVITY_MAX, Math.floor(requested))
    : BOARD_ACTIVITY_PAGE
  let cursorAt: number | undefined
  let cursorId: string | undefined
  if (options.cursor) {
    const [at, id] = options.cursor.split('|')
    const parsed = Number(at)
    if (Number.isFinite(parsed) && id) {
      cursorAt = parsed
      cursorId = id
    }
  }

  const cutoff = cursorAt !== undefined && cursorId !== undefined
    ? 'AND (at < ?3 OR (at = ?3 AND id < ?4))'
    : ''
  const params: unknown[] = cursorAt !== undefined && cursorId !== undefined
    ? [workspaceId, boardId, cursorAt, cursorId, limit + 1]
    : [workspaceId, boardId, limit + 1]
  const rows = await db.all<Row>(
    `SELECT id, board_id, at, actor_id, via, kind, item_id, summary
       FROM board_activity
      WHERE workspace_id = ?1 AND board_id = ?2 ${cutoff}
      ORDER BY at DESC, id DESC
      LIMIT ?${params.length}`,
    params,
  )
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const total = await db.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM board_activity WHERE workspace_id = ?1 AND board_id = ?2',
    [workspaceId, boardId],
  )
  return {
    events: page.map(eventFrom),
    nextCursor: rows.length > limit && last ? `${last.at}|${last.id}` : null,
    total: Number(total?.n ?? 0),
  }
}

/**
 * Write one event. `redactItemId` is the id of a card that has just been deleted: it is used only
 * to clear the reference from earlier rows, then forgotten. The deletion event itself stores no
 * card id, title or snapshot.
 */
export async function writeBoardActivity(
  db: Database,
  workspaceId: string,
  boardId: string,
  input: { event?: unknown; redactItemId?: unknown },
  actorId: string,
  via?: string,
): Promise<BoardActivityEvent | undefined> {
  const raw = input.event
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const event = raw as Record<string, unknown>
  const id = typeof event.id === 'string' ? event.id.slice(0, ID_MAX) : ''
  const kind = typeof event.kind === 'string' ? (event.kind as BoardActivityKind) : undefined
  if (!id || !kind || !KINDS.has(kind)) return undefined
  if (event.boardId !== undefined && event.boardId !== boardId) return undefined

  // The client names the item, never a title or a snapshot. A deleted event may not name one at all.
  const itemId = kind === 'card.deleted'
    ? undefined
    : typeof event.itemId === 'string' && event.itemId
      ? event.itemId
      : undefined
  if (CARD_KINDS.has(kind) && kind !== 'card.deleted' && !itemId) return undefined

  const summary = kind === 'board.updated'
    ? typeof event.summary === 'string'
      ? event.summary.trim().slice(0, SUMMARY_MAX)
      : ''
    : undefined
  if (kind === 'board.updated' && !summary) return undefined

  const at = Date.now()
  const statements: { sql: string; params: unknown[] }[] = []
  if (kind === 'card.deleted' && typeof input.redactItemId === 'string' && input.redactItemId) {
    statements.push({
      sql: 'UPDATE board_activity SET item_id = NULL WHERE workspace_id = ?1 AND board_id = ?2 AND item_id = ?3',
      params: [workspaceId, boardId, input.redactItemId.slice(0, ID_MAX)],
    })
  }

  statements.push({
    sql: `INSERT INTO board_activity (id, workspace_id, board_id, at, actor_id, via, kind, item_id, summary)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT (id) DO UPDATE SET
       at = excluded.at,
       actor_id = excluded.actor_id,
       via = excluded.via,
       kind = excluded.kind,
       item_id = excluded.item_id,
       summary = excluded.summary
     WHERE board_activity.workspace_id = excluded.workspace_id
       AND board_activity.board_id = excluded.board_id`,
    params: [id, workspaceId, boardId, at, actorId, via ?? null, kind, itemId ?? null, summary ?? null],
  })
  // The redaction and the anonymous row land together: a crash between them would leave earlier
  // events naming a card the stream now says was deleted.
  await db.batch(statements)
  return {
    id,
    boardId,
    at,
    actorId,
    ...(via ? { via } : {}),
    kind,
    ...(itemId ? { itemId } : {}),
    ...(summary ? { summary } : {}),
  }
}
