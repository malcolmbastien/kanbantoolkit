/**
 * The home's two shortcuts: the boards a person keeps, and the ones they opened lately.
 *
 * Both are this browser's, not the workspace's. A favourite is one person's way of finding a board
 * again, and a recent board is a place they were — neither is a fact about the board, and writing
 * either back would move somebody else's home. The store persists them beside the saved filters.
 *
 * Pure and storage-free: the store holds the lists, the home renders them, and these functions are
 * the rules in between (one visit per board, newest first, no board twice, no dead rows).
 */

import type { Board } from './types'

/** How many boards the recent list keeps. Enough to cover a week of moving around, no more. */
export const RECENT_BOARDS_LIMIT = 8

/** One board a person opened, and when. */
export interface BoardVisit {
  boardId: string
  at: number
}

/**
 * Note that a board was opened.
 *
 * The board goes to the front rather than being added again, and the list stays bounded: a person
 * who lives on one board for a month has one entry for it, not thirty.
 */
export function noteVisit(
  recent: readonly BoardVisit[],
  boardId: string,
  at: number,
  limit = RECENT_BOARDS_LIMIT,
): BoardVisit[] {
  return [{ boardId, at }, ...recent.filter((visit) => visit.boardId !== boardId)].slice(0, limit)
}

/** Keep a board on the home, or take it off. Both answers are the whole list, not a diff. */
export function toggleFavourite(ids: readonly string[], boardId: string): string[] {
  return ids.includes(boardId) ? ids.filter((id) => id !== boardId) : [...ids, boardId]
}

/**
 * The starred boards a person can still open, by name.
 *
 * Archived boards are left out: the Archive is where filed work lives, and a shortcut that opens a
 * board the picker no longer offers would be a door to nowhere. Unarchiving brings it back.
 */
export function favouriteBoardList(boards: readonly Board[], ids: readonly string[]): Board[] {
  const wanted = new Set(ids)
  return boards
    .filter((board) => wanted.has(board.id) && !board.archived)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The boards opened lately, newest first, without the starred ones.
 *
 * A board already shown under Favourites is not repeated under Recent: two rows with the same name
 * on one screen is noise, and the favourite is the one the person chose. A board that no longer
 * exists (or is archived) is skipped rather than rendered as a dead row.
 */
export function recentBoardList(
  boards: readonly Board[],
  visits: readonly BoardVisit[],
  favouriteIds: readonly string[],
): Board[] {
  const byId = new Map(boards.map((board) => [board.id, board]))
  const starred = new Set(favouriteIds)
  const seen = new Set<string>()
  const out: Board[] = []
  for (const visit of visits) {
    if (seen.has(visit.boardId) || starred.has(visit.boardId)) continue
    seen.add(visit.boardId)
    const board = byId.get(visit.boardId)
    if (board && !board.archived) out.push(board)
  }
  return out
}

/**
 * The favourite ids a saved state can be trusted with: boards that exist, once each.
 *
 * Kept in the order they were stored — rendering sorts by name today, but the choice of order is
 * the person's if a later slice lets them arrange it.
 */
export function pruneFavourites(ids: readonly string[], boardIds: ReadonlySet<string>): string[] {
  return [...new Set(ids.filter((id) => boardIds.has(id)))]
}

/**
 * The visits a saved state can be trusted with: one per board, the latest, newest first, bounded.
 *
 * Duplicates are resolved by keeping the most recent visit, so a file written by an older build
 * that appended rather than moved still reads as one board in the right place.
 */
export function pruneVisits(
  visits: readonly BoardVisit[],
  boardIds: ReadonlySet<string>,
  limit = RECENT_BOARDS_LIMIT,
): BoardVisit[] {
  const latest = new Map<string, BoardVisit>()
  for (const visit of visits) {
    if (!visit || typeof visit.boardId !== 'string' || typeof visit.at !== 'number') continue
    if (!boardIds.has(visit.boardId)) continue
    const current = latest.get(visit.boardId)
    if (!current || visit.at > current.at) latest.set(visit.boardId, visit)
  }
  return [...latest.values()].sort((a, b) => b.at - a.at).slice(0, limit)
}
