import { isInitiativeItem } from './board'
import { isComplete, rollupOf } from './derive'
import { ageDays, initiativeScope, matchesFilters, type CardFilters } from './filters'
import { effectiveStage, lanePath, STAGE_LABELS } from './lanes'
import { matchOf, noteMatch, SEARCH_FIELD_ORDER, type SearchHit } from './search'
import type { Edge, Item, ItemLink, ItemLogEntry, IssueType, Lane, Placement, Stage } from './types'

/**
 * Search a board's own live work, and page through the result.
 *
 * This is the reading surface, not the quick finder: same matching vocabulary as the top-bar
 * search (`matchOf` and `noteMatch`), narrowed by the board's existing `CardFilters`, and ordered
 * by the field the hit was found in and then the board's own arrangement. It is pure, so the
 * table, its tests and its URL cannot disagree about what a query found.
 */

/** A note the server answered with, scoped to this board. */
export interface BoardSearchNote {
  itemId: string
  entry: ItemLogEntry
}

export type BoardSearchSort = 'relevance' | 'title' | 'newest'

/** How many rows one page of a board search holds. */
export const BOARD_SEARCH_PAGE_SIZE = 50

export interface BoardSearchInput {
  boardId: string
  query: string
  items: Item[]
  placements: Placement[]
  lanes: Lane[]
  edges: Edge[]
  links: ItemLink[]
  issueTypes: IssueType[]
  filters: CardFilters
  /** Notes the server returned for this board. Local logs are always searched first. */
  notes?: readonly BoardSearchNote[]
  /** A search-only stage narrowing: the leaf's stage, or an initiative's derived section. */
  stage?: Stage | 'all'
  now?: number
}

export interface BoardSearchHit extends SearchHit {
  /** The item's own placement on this board, when it has one. */
  placement?: Placement
  /** The leaf's stage, or an initiative's derived section. */
  stage?: Stage
  /** The Status column: a card's leaf lane path, or an initiative's section. */
  status: string
  /** Whether the item is finished — the same answer a due chip uses. */
  resolved: boolean
  /** The item's position in the board's own arrangement, the tie-break before anything arbitrary. */
  boardIndex: number
}

export interface BoardSearchPage {
  rows: BoardSearchHit[]
  /** 1-based page actually shown, after a page number beyond the end is clamped. */
  page: number
  pages: number
  total: number
}

/** The stage an item reads as: a card's leaf, or an initiative's derived section. */
function stageOfItem(
  item: Item,
  placement: Placement | undefined,
  graph: { items: Item[]; edges: Edge[]; links: ItemLink[]; placements: Placement[]; lanes: Lane[] },
  issueTypes: IssueType[],
): Stage | undefined {
  if (isInitiativeItem(item, issueTypes)) return rollupOf(item.id, graph).bucket
  return placement ? effectiveStage(graph.lanes, placement.laneId) : undefined
}

/** What the Status column says for one item. */
function statusOf(item: Item, placement: Placement | undefined, stage: Stage | undefined, issueTypes: IssueType[], lanes: Lane[]): string {
  if (isInitiativeItem(item, issueTypes)) return stage ? STAGE_LABELS[stage] : 'No section'
  if (placement) {
    const path = lanePath(lanes, placement.laneId).filter(Boolean)
    if (path.length) return path.join(' / ')
  }
  return stage ? STAGE_LABELS[stage] : 'No stage'
}

/**
 * Every live item on the board that matches the query and the filters.
 *
 * The board's own placements are the scope: an item on another board is not a result here, even
 * if its words match. A note is merged only for an item already in that scope, so a note server
 * that answered too widely cannot leak another board's work into this table.
 */
export function searchBoard(input: BoardSearchInput): BoardSearchHit[] {
  const { boardId, query, items, placements, lanes, edges, links, issueTypes, filters } = input
  const q = query.trim()
  if (!q) return []

  const now = input.now ?? Date.now()
  const graph = { items, edges, links, placements, lanes }

  // The board's placements in rank order are the board's own reading order. The item is looked up
  // through the placement, not through the workspace's whole item list, so another board's card
  // cannot appear just because it was found first.
  const ordered = placements
    .filter((placement) => placement.boardId === boardId)
    .map((placement, index) => ({ placement, index }))
    .sort(
      (a, b) =>
        (a.placement.rank ?? Number.MAX_SAFE_INTEGER) - (b.placement.rank ?? Number.MAX_SAFE_INTEGER) ||
        a.index - b.index,
    )
    .map(({ placement }) => ({ placement, item: items.find((item) => item.id === placement.itemId) }))
    .filter((row): row is { placement: Placement; item: Item } => Boolean(row.item) && !row.item!.archived)

  const byId = new Map(ordered.map((row, boardIndex) => [row.item.id, { ...row, boardIndex }]))
  const scope = initiativeScope(filters, graph)
  // The query is the text reading; the board's text filter is the same idea and would narrow the
  // notes away, so it is not applied twice.
  const filtersWithoutText: CardFilters = { ...filters, text: undefined }

  const hits: BoardSearchHit[] = []
  const matched = new Set<string>()
  for (const { item, placement, boardIndex } of byId.values()) {
    const match = matchOf(item, q)
    if (!match) continue
    const itemStage = stageOfItem(item, placement, graph, issueTypes)
    if (input.stage && input.stage !== 'all' && itemStage !== input.stage) continue
    const resolved = isComplete(item.id, graph)
    if (
      !matchesFilters(
        item,
        filtersWithoutText,
        resolved,
        now,
        ageDays(placement, now),
        scope,
        itemStage,
      )
    ) {
      continue
    }
    hits.push({
      item,
      match,
      placement,
      stage: itemStage,
      status: statusOf(item, placement, itemStage, issueTypes, lanes),
      resolved,
      boardIndex,
    })
    matched.add(item.id)
  }

  // A note read from the server is a result only when the card's own fields did not already match
  // it — the field order says a title is a better answer than a comment. The newest note wins.
  for (const note of input.notes ?? []) {
    if (matched.has(note.itemId)) continue
    const row = byId.get(note.itemId)
    if (!row) continue
    const match = noteMatch(note.entry, q)
    if (!match) continue
    const { item, placement, boardIndex } = row
    const itemStage = stageOfItem(item, placement, graph, issueTypes)
    if (input.stage && input.stage !== 'all' && itemStage !== input.stage) continue
    const resolved = isComplete(item.id, graph)
    if (!matchesFilters(item, filtersWithoutText, resolved, now, ageDays(placement, now), scope, itemStage)) continue
    hits.push({
      item,
      match,
      placement,
      stage: itemStage,
      status: statusOf(item, placement, itemStage, issueTypes, lanes),
      resolved,
      boardIndex,
    })
    matched.add(item.id)
  }

  return sortBoardSearchHits(hits, 'relevance')
}

/** Order results by the chosen reading, with the board's own order breaking every tie. */
export function sortBoardSearchHits(hits: readonly BoardSearchHit[], sort: BoardSearchSort): BoardSearchHit[] {
  const byBoard = (a: BoardSearchHit, b: BoardSearchHit) => a.boardIndex - b.boardIndex
  return [...hits].sort((a, b) => {
    if (sort === 'title') return a.item.title.localeCompare(b.item.title) || byBoard(a, b)
    if (sort === 'newest') return b.item.createdAt - a.item.createdAt || byBoard(a, b)
    return SEARCH_FIELD_ORDER[a.match.field] - SEARCH_FIELD_ORDER[b.match.field] || byBoard(a, b)
  })
}

/** One page of a result set, clamped to a page that exists. */
export function pageOf(hits: readonly BoardSearchHit[], page: number, size = BOARD_SEARCH_PAGE_SIZE): BoardSearchPage {
  const total = hits.length
  const pages = Math.max(1, Math.ceil(total / size))
  const shown = Math.min(Math.max(0, page), pages - 1)
  return { rows: hits.slice(shown * size, shown * size + size), page: shown + 1, pages, total }
}
