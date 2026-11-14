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

/**
 * Append history to a card, without taking a revision.
 *
 * A move is arrangement: its log entry is a fact about the card, but bumping the card's version on
 * every drag would make a card somebody is editing impossible to rearrange. Best-effort on purpose —
 * the entry is already in this browser's log, and the next save of the card carries it anyway; this
 * is the shortcut that lets another device's flow reading see the move before that happens.
 */
export async function appendHistory(itemId: string, entries: ItemLogEntry[]): Promise<boolean> {
  if (!hosted() || !entries.length) return false
  try {
    const response = await fetch(`/api/workspace/items/${encodeURIComponent(itemId)}/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries }),
    })
    return response.ok
  } catch {
    return false
  }
}

/** One page of one card's history. */
export async function fetchItemLog(itemId: string, cursor?: string | null): Promise<LogPage | undefined> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return getJson<LogPage>(`/api/workspace/items/${encodeURIComponent(itemId)}/log${query}`)
}

/**
 * The most pages one drawer open will read. A reading calculated from one page is a shorter age
 * than the card has had, so the whole log is read; the cap keeps a pathological card from fetching
 * without end, and a cursor that survives it is shown as history still to load.
 */
export const HISTORY_PAGE_LIMIT = 40

/**
 * A card's whole log, for a reading that must not be computed from its first page.
 *
 * Every page is followed before the answer is returned. A failure part-way through answers what
 * arrived and the cursor to continue from, which is the same contract as one page: the caller can
 * show the reading it has and say that history remains.
 */
export async function fetchWholeItemLog(itemId: string): Promise<LogPage | undefined> {
  const first = await fetchItemLog(itemId)
  if (!first) return undefined
  let entries = first.entries
  let cursor = first.nextCursor
  let total = first.total
  // A cursor that repeats is a server bug; following it would loop forever.
  const seen = new Set<string>()
  let pages = 1
  while (cursor && pages < HISTORY_PAGE_LIMIT && !seen.has(cursor)) {
    seen.add(cursor)
    const page = await fetchItemLog(itemId, cursor)
    if (!page) return { entries, nextCursor: cursor, total }
    entries = mergeLog(entries, page.entries)
    cursor = page.nextCursor
    total = page.total
    pages += 1
  }
  return { entries, nextCursor: cursor, total }
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
