/**
 * A card's history, read where it is read.
 *
 * The workspace document a browser loads carries cards, not what happened to them: a card's
 * activity is asked for when the drawer opens, and a board's flow reading asks for the moves it
 * charts. Both go through the same two shapes — a bounded page of one card's log, and the moves
 * of one board — so a workspace with years of history costs the same to open as a new one.
 *
 * History is append-only, so the order is `(at, id)`: two entries can share a millisecond, and
 * the id breaks the tie. Every read is scoped by the workspace the item belongs to, never by an
 * id alone.
 */

import type { Database } from '../db'
import type { ItemLogEntry, Stage } from '../../src/domain/types'
import { logEntryFrom } from './read'
import { WORKSPACE_ROW } from './types'

type Row = Record<string, unknown>

/** The most entries one page may carry, and the default when the reader does not say. */
export const LOG_PAGE_DEFAULT = 50
export const LOG_PAGE_MAX = 200
/** The most moves a board's flow reading returns in one call. */
export const MOVES_MAX = 50_000
export const MOVES_DEFAULT = 20_000
/** The most notes a search or mentions read returns. */
export const NOTES_DEFAULT = 100
export const NOTES_MAX = 200

export interface LogPage {
  /** Newest first, within the page. */
  entries: ItemLogEntry[]
  /** Where the next page starts, or null when this page reaches the beginning. */
  nextCursor: string | null
  /** How many entries the card has, so the drawer can say the count before every page is loaded. */
  total: number
}

/** One move as flow metrics read it. */
export interface BoardMove {
  /** The log entry id, so a locally-known move is not counted twice. */
  id: string
  itemId: string
  at: number
  fromStage?: Stage
  toStage: Stage
}

/** One note, with the card it was written on — what search and mentions read. */
export interface NoteEntry {
  itemId: string
  entry: ItemLogEntry
}

/** A cursor is `(at, id)` in base64url, so it is opaque to the caller and safe in a URL. */
const encodeCursor = (at: number, id: string): string =>
  btoa(`${at}:${id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function decodeCursor(cursor: string | undefined): { at: number; id: string } | undefined {
  if (!cursor) return undefined
  try {
    const [at, ...rest] = atob(cursor.replace(/-/g, '+').replace(/_/g, '/')).split(':')
    const value = Number(at)
    const id = rest.join(':')
    return Number.isFinite(value) && id ? { at: value, id } : undefined
  } catch {
    return undefined
  }
}

/** A page size a caller asked for, kept inside the bound the server promises. */
function pageSize(raw: unknown, fallback: number, max: number): number {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.min(max, Math.floor(value))
}

export interface LogPageQuery {
  cursor?: string
  limit?: number | string
}

/**
 * One card's history, newest page first.
 *
 * The card must belong to this workspace; an id from somewhere else is `undefined`, which the
 * route answers as "no such item" rather than as an empty log. The total is counted separately
 * because a page cannot know how much it has not read.
 */
export async function readItemLog(
  db: Database,
  itemId: string,
  workspaceId: string = WORKSPACE_ROW,
  query: LogPageQuery = {},
): Promise<LogPage | undefined> {
  const owned = await db.get<{ id: string }>(
    // scoped by workspace_id in the WHERE below
    'SELECT id FROM items WHERE id = ?1 AND workspace_id = ?2',
    [itemId, workspaceId],
  )
  if (!owned) return undefined

  const limit = pageSize(query.limit, LOG_PAGE_DEFAULT, LOG_PAGE_MAX)
  const before = decodeCursor(query.cursor)
  const rows = await db.all<Row>(
    // scoped by workspace_id: the log is reached through an item this workspace owns.
    `SELECT log.* FROM item_log log -- scoped by workspace_id: the join below names it
       JOIN items item ON item.id = log.item_id AND item.workspace_id = ?1
      WHERE log.item_id = ?2
        ${before ? 'AND (log.at < ?3 OR (log.at = ?3 AND log.id < ?4))' : ''}
      ORDER BY log.at DESC, log.id DESC
      LIMIT ?${before ? 5 : 3}`,
    before ? [workspaceId, itemId, before.at, before.id, limit + 1] : [workspaceId, itemId, limit + 1],
  )

  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const totalRow = await db.get<{ n: number }>(
    // scoped by its item, which the ownership check above put in this workspace
    'SELECT COUNT(*) AS n FROM item_log WHERE item_id = ?1',
    [itemId],
  )

  return {
    entries: page.map(logEntryFrom),
    nextCursor: rows.length > limit && last ? encodeCursor(Number(last.at), String(last.id)) : null,
    total: Number(totalRow?.n ?? page.length),
  }
}

export interface MoveQuery {
  since?: number | string
  limit?: number | string
}

/**
 * The moves of every card on one board, oldest first.
 *
 * Flow metrics rebuild each card's stages from its moves; the window the view draws is a choice
 * made there, not here, so this returns what the board recorded. The cap keeps one pathological
 * board from answering with an unbounded document: when it bites, the *oldest* moves go and the
 * reading is marked truncated, because a chart is read from the present backwards.
 */
export async function readMovements(
  db: Database,
  boardId: string,
  workspaceId: string = WORKSPACE_ROW,
  query: MoveQuery = {},
): Promise<{ moves: BoardMove[]; truncated: boolean }> {
  const limit = pageSize(query.limit, MOVES_DEFAULT, MOVES_MAX)
  const since = Number(query.since)
  const after = Number.isFinite(since) && since > 0 ? Math.floor(since) : 0

  const rows = await db.all<Row>(
    // scoped by workspace_id: a move is read through the card and the placement it belongs to.
    `SELECT * FROM (
        SELECT log.id AS id, log.item_id AS item_id, log.at AS at,
               log.from_stage AS from_stage, log.to_stage AS to_stage
          FROM item_log log -- scoped by workspace_id: the join below names it
          JOIN items item ON item.id = log.item_id AND item.workspace_id = ?1
         WHERE log.kind = 'moved'
           AND log.to_stage IS NOT NULL
           AND log.at >= ?4
           AND (log.board_id IS NULL OR log.board_id = ?2)
           AND EXISTS (
             SELECT 1 FROM placements place -- scoped by workspace_id in the WHERE below
              WHERE place.item_id = log.item_id AND place.board_id = ?2 AND place.workspace_id = ?1
           )
         ORDER BY log.at DESC, log.id DESC
         LIMIT ?3
      ) ORDER BY at, item_id`,
    [workspaceId, boardId, limit + 1, after],
  )

  const kept = rows.slice(-limit)
  return {
    moves: kept.map((row) => {
      const move: BoardMove = {
        id: String(row.id),
        itemId: String(row.item_id),
        at: Number(row.at),
        toStage: String(row.to_stage) as Stage,
      }
      if (typeof row.from_stage === 'string') move.fromStage = row.from_stage as Stage
      return move
    }),
    truncated: rows.length > limit,
  }
}

export interface NoteQuery {
  /** Case-insensitive substring of the note's words. */
  q?: string
  /** Only notes that name this user. */
  mentionOf?: string
  limit?: number | string
}

/**
 * The notes in a workspace, newest first — what search and mentions read.
 *
 * A note is the one kind of history that is content rather than movement: it is searched, and it
 * names people. Both questions are answered here so neither view has to hold every card's log.
 */
export async function readNotes(
  db: Database,
  workspaceId: string = WORKSPACE_ROW,
  query: NoteQuery = {},
): Promise<NoteEntry[]> {
  const limit = pageSize(query.limit, NOTES_DEFAULT, NOTES_MAX)
  const params: unknown[] = [workspaceId]
  const where = ["log.kind = 'noted'"]

  const q = query.q?.trim().toLowerCase()
  if (q) {
    params.push(q)
    where.push(`instr(lower(coalesce(log.note, '')), ?${params.length}) > 0`)
  }
  if (query.mentionOf) {
    // The column is a JSON array of ids; a quoted id cannot be a substring of another id.
    params.push(`"${query.mentionOf}"`)
    where.push(`instr(log.mentions, ?${params.length}) > 0`)
  }
  params.push(limit)

  const rows = await db.all<Row>(
    // scoped by workspace_id: a note is read through the card it was written on.
    `SELECT log.*, log.item_id AS item_id
       FROM item_log log -- scoped by workspace_id: the join below names it
       JOIN items item ON item.id = log.item_id AND item.workspace_id = ?1
      WHERE ${where.join(' AND ')}
      ORDER BY log.at DESC, log.id DESC
      LIMIT ?${params.length}`,
    params,
  )

  return rows.map((row) => ({ itemId: String(row.item_id), entry: logEntryFrom(row) }))
}
