/**
 * A card's history, asked for where it is read (task 192).
 *
 * The workspace document carries cards, not what happened to them: loading a board no longer
 * loads every move and every note ever written. The drawer asks for one card's page, the flow view
 * asks for one board's moves, and search and mentions ask for notes. Each falls back to what this
 * browser already holds, because a static deployment has no server to ask — and the same build is
 * both deployments.
 *
 * Every read answers `undefined` when it cannot be made. That is not an error to show: it means
 * "this deployment does not serve history", and the caller reads the local copy instead.
 */

import type { ItemLogEntry, Stage } from '@/domain/types'
import type { StageMove } from '@/domain/metrics'
import { useAuth } from './auth'

export interface LogPage {
  /** Newest first, within the page. */
  entries: ItemLogEntry[]
  nextCursor: string | null
  /** How many entries the card has, including pages not loaded yet. */
  total: number
}

/** One move, as the board's flow reading receives it. */
export interface BoardMove {
  id: string
  itemId: string
  at: number
  fromStage?: Stage
  toStage: Stage
}

export interface NoteEntry {
  itemId: string
  entry: ItemLogEntry
}

/** Whether to ask a server at all: a static deployment has nobody to answer. */
const hosted = () => Boolean(useAuth.getState().user)

async function getJson<T>(path: string): Promise<T | undefined> {
  if (!hosted()) return undefined
  try {
    const response = await fetch(path, { headers: { accept: 'application/json' } })
    if (!response.ok) return undefined
    return (await response.json()) as T
  } catch {
    // A host that answers an API path with the app's HTML is a static host; a dropped connection
    // is a connection. Either way the caller has a local copy to fall back to.
    return undefined
  }
}

/** One page of one card's history. */
export async function fetchItemLog(itemId: string, cursor?: string | null): Promise<LogPage | undefined> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return getJson<LogPage>(`/api/workspace/items/${encodeURIComponent(itemId)}/log${query}`)
}

/** One board's moves, for the flow reading. */
export async function fetchMovements(boardId: string): Promise<{ moves: BoardMove[]; truncated: boolean } | undefined> {
  return getJson<{ moves: BoardMove[]; truncated: boolean }>(
    `/api/workspace/movements?boardId=${encodeURIComponent(boardId)}`,
  )
}

/** The notes whose words match a query. */
export async function fetchNoteHits(query: string): Promise<NoteEntry[] | undefined> {
  const answer = await getJson<{ notes: NoteEntry[] }>(`/api/workspace/notes?q=${encodeURIComponent(query)}`)
  return answer?.notes
}

/** The notes that name the signed-in person. */
export async function fetchMentions(): Promise<NoteEntry[] | undefined> {
  const answer = await getJson<{ notes: NoteEntry[] }>('/api/workspace/notes?mention=me')
  return answer?.notes
}

/**
 * What this browser knows and what the server just said, as one history.
 *
 * Entries are keyed by id, so the union is also the deduplication. The server's copy wins a tie:
 * it is the record. The order is the log's own — `(at, id)` ascending, which is what every view
 * reverses when it wants the newest first.
 */
export function mergeLog(local: readonly ItemLogEntry[] | undefined, remote: readonly ItemLogEntry[] | undefined): ItemLogEntry[] {
  if (!local?.length && !remote?.length) return []
  const byId = new Map<string, ItemLogEntry>()
  for (const entry of local ?? []) byId.set(entry.id, entry)
  for (const entry of remote ?? []) byId.set(entry.id, entry)
  return [...byId.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
}

/** One card's moves, from a page of its history — the shape `flowRecordFromMoves` reads. */
export function movesOf(entries: readonly ItemLogEntry[] | undefined): StageMove[] {
  return (entries ?? [])
    .filter((entry) => entry.kind === 'moved' && entry.toStage)
    .map((entry) => ({
      at: entry.at,
      to: entry.toStage as Stage,
      ...(entry.fromStage ? { from: entry.fromStage } : {}),
    }))
}
