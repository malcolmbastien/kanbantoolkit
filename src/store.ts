import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ancestorsOf, childrenOf, defaultColumns, effectiveStage, isLeaf, leafLanes, leavesUnder, nextRank, placementsInOrder, STAGES, STAGE_LABELS, subtreeIds } from '@/domain/lanes'
import { canLinkBoard, canRetype, defaultDropLane, duplicateBoard as copyBoardDesign, initiativeTypeId, isInitiativeItem, isStrategicInitiative, lanesFromTemplate, templateFromBoard } from '@/domain/board'
import { decompositionParent, descendants, rollupOf, statusOf, withChecklistEntry, withChecklistEntryText, withToggledChecklistEntry, withoutChecklistEntry } from '@/domain/derive'
import { hasActiveFilters, NO_FILTERS, type CardFilters, type SavedFilter } from '@/domain/filters'
import { createSeed, BUILT_IN_TEMPLATES } from '@/domain/seed'
import { uid as makeUid } from '@/lib/utils'
import type { Board, BoardBand, BoardTemplate, Edge, FlowState, IssueType, Item, ItemLogEntry, KeyResult, Lane, Objective, Placement, SplitOrientation, TemplateLane, User } from '@/domain/types'

export interface Draft {
  boards: FlowState['boards']
  lanes: FlowState['lanes']
  placements: FlowState['placements']
  boardId: string
}

/** A pending confirmation, rendered by the global ConfirmDialog. */
export interface ConfirmRequest {
  title: string
  body?: string
  confirmLabel?: string
  /** Destructive actions get a red confirm button. */
  danger?: boolean
  onConfirm: () => void
}

/**
 * A move that would exceed a WIP limit on a `justify` board: the move is held
 * until the user supplies a reason, rendered by ReasonDialog.
 */
export interface WipPrompt {
  itemId: string
  boardId: string
  laneId: string
  /** The lane whose limit would be exceeded. */
  laneName: string
  limit: number
}

/** The open card context menu, anchored at a viewport position. */
export interface CardMenuState {
  itemId: string
  x: number
  y: number
}

export interface ViewState {
  boardId: string
  selectedItemId: string | null
  search: string
  /** Board design controls (split / add / rename / delete lanes) only show in edit mode. */
  editMode: boolean
  /** Snapshot taken on entering edit mode; Cancel restores it, Save drops it. */
  draft: Draft | null
  /** Focus lens: highlight this item and its ancestors/descendants; dim the rest. */
  lensId: string | null
  /** Show the board settings dialog. */
  showBoardSettings: boolean
  /** Show the Objectives & KRs view instead of a board. */
  showObjectives: boolean
  /** Show the management dashboard for the current board (management boards only). */
  showDashboard: boolean
  /** Show the timeline view — the board's initiatives laid out over time. */
  showTimeline: boolean
  /** Show the Archive view (filed-away items) instead of a board. */
  showArchive: boolean
  /** Show the board workspace — every board in the organisation — instead of a board. */
  showBoards: boolean
  /** Collapsed top-level columns, keyed by lane id. Persisted. */
  collapsedLanes: Record<string, boolean>
  /** Card filters panel open (a right-side panel, like the item panel). */
  showFilters: boolean
  /** Active card filters applied to the current board. */
  filters: CardFilters
  /**
   * Named filter sets the board can re-apply — the one deliberately persisted piece of
   * filter state. Filter *state* is view state; the collection of saved sets is data.
   */
  savedFilters: SavedFilter[]
  /**
   * An external dependency (from the boundary lane) being inspected; the local
   * cards that wait on it are highlighted on the board. View-only.
   */
  boundaryId: string | null
  /**
   * The card waiting for a parent, if one is. Set from the card's context menu, cleared by
   * picking an initiative, by Escape, or by clicking anything that is not one. The shape
   * `boundaryId` already has: one id in the store and the board reads it. View-only.
   */
  parentPickId: string | null
  /**
   * The initiative waiting for a card, if one is — the same act from the other end. One edge
   * either way, so one mode with a direction rather than two mechanisms. View-only.
   */
  childPickId: string | null
  /**
   * Multi-select group (shift+click on cards). Non-empty hides the item panel
   * and shows the bulk-action bar. View-only.
   */
  multiSelect: string[]
  /** Pending confirmation (destructive actions) — rendered by ConfirmDialog. */
  confirm: ConfirmRequest | null
  /** A move held back by a `justify` WIP limit — rendered by ReasonDialog. */
  wipPrompt: WipPrompt | null
  /** The open card context menu (a topmost layer for Escape/click-away). */
  cardMenu: CardMenuState | null
}
export interface Actions {
  selectBoard: (id: string) => void
  openItem: (id: string | null) => void
  setSearch: (q: string) => void
  beginEdit: () => void
  saveEdit: () => void
  cancelEdit: () => void
  toggleLens: (id: string) => void
  setLens: (id: string | null) => void
  clearLens: () => void
  setObjectives: (v: boolean) => void
  /** The board itself as the active view — a tab, not a toggle: every view flag clears. */
  setBoard: () => void
  /** Open/close the board settings dialog. */
  toggleBoardSettings: () => void
  setDashboard: (v: boolean) => void
  setTimeline: (v: boolean) => void
  setArchive: (v: boolean) => void
  toggleBoards: () => void
  setBoards: (v: boolean) => void
  /** Toggle the filters side panel (closes the item panel when opening). */
  toggleFilters: () => void
  /** Merge a patch into the active card filters. */
  setFilters: (patch: Partial<CardFilters>) => void
  /** Save the active filters as a named set. */
  saveFilter: (name: string) => void
  /** Apply a saved filter set in full — it replaces whatever is active. */
  applySavedFilter: (id: string) => void
  /** Forget a saved filter set. */
  removeSavedFilter: (id: string) => void
  /** Add/remove a card type from the type filter. */
  toggleFilterType: (typeId: string) => void
  clearFilters: () => void
  /** Select/clear the boundary-lane external dependency to highlight its local dependents. */
  toggleBoundary: (id: string) => void

  /** Shift+click a card: add/remove it from the multi-select group (seeding from the open card). */
  toggleMultiSelect: (id: string) => void
  clearMultiSelect: () => void
  /** Bulk actions over the multi-select group. */
  moveCardsToLane: (itemIds: string[], laneId: string) => void
  setItemsType: (itemIds: string[], typeId: string) => void
  /** Add an assignee by full name to an item (creating the user if new). */
  addAssignee: (itemId: string, name: string) => void
  /** Add an assignee by full name to every listed item (creating the user if new). */
  addItemsAssignee: (itemIds: string[], name: string) => void
  /** Clear every assignee on the listed items. */
  clearItemsAssignees: (itemIds: string[]) => void
  /** Remove one assignee (by user id) from every listed item. */
  removeItemsAssignee: (itemIds: string[], userId: string) => void
  setItemsSize: (itemIds: string[], size: number | undefined) => void
  setItemsTargetStart: (itemIds: string[], date: string | undefined) => void
  setItemsTargetEnd: (itemIds: string[], date: string | undefined) => void
  /** Block every listed item (an optional reason, recorded in each item's log). */
  blockItems: (itemIds: string[], reason?: string) => void
  unblockItems: (itemIds: string[], note?: string) => void
  archiveItems: (itemIds: string[]) => void
  deleteItems: (itemIds: string[]) => void

  /** Ask the user to confirm a destructive action (a styled in-app modal). */
  askConfirm: (request: ConfirmRequest) => void
  closeConfirm: () => void
  /** Supply a reason for a held-back WIP move, or drop it. */
  confirmWipPrompt: (reason: string) => void
  cancelWipPrompt: () => void
  /** Open/close the card context menu. */
  openCardMenu: (itemId: string, x: number, y: number) => void
  closeCardMenu: () => void

  addObjective: (title: string, period: string) => void
  updateObjective: (id: string, patch: Partial<Objective>) => void
  removeObjective: (id: string) => void
  addKeyResult: (objectiveId: string, title: string) => void
  updateKeyResult: (id: string, patch: Partial<KeyResult>) => void
  removeKeyResult: (id: string) => void
  /** Link a board under another (aggregation). Refused if it would create a cycle. */
  addLinkedBoard: (parentId: string, childId: string) => void
  removeLinkedBoard: (parentId: string, childId: string) => void
  resetDemo: () => void

  addIssueType: (name: string, color: string) => string
  updateIssueType: (id: string, patch: Partial<IssueType>) => void
  removeIssueType: (id: string) => void

  /**
   * Create a board. `open` (the default) switches to it in edit mode, as the TopBar's create
   * does; the board workspace passes false so a new board simply lands in the list without
   * leaving it. `templateId` supplies the design — otherwise the standard typed columns.
   */
  addBoard: (name: string, band?: BoardBand, open?: boolean, templateId?: string) => void
  /**
   * Save a board's *design* as a reusable template: its lane tree, card types and WIP
   * policy. Its items, placements and linked boards are deliberately left behind.
   */
  saveBoardAsTemplate: (boardId: string, name?: string) => void
  /**
   * Start a template from scratch: a name and the flight level of the boards it will
   * create. It begins as the standard typed columns; save a board as a template to
   * capture a richer design.
   */
  newBoardTemplate: (name: string, band: BoardBand) => void
  removeBoardTemplate: (id: string) => void
  renameBoardTemplate: (id: string, name: string) => void
  /**
   * Write a template's lanes back after an edit. The lane logic itself is pure and lives
   * in the domain (`templateSplitLane`, `templateAddLane`, …); this stores the result.
   */
  setTemplateLanes: (templateId: string, lanes: TemplateLane[]) => void
  /** Change a template's settings — its board type, card types, default type, WIP policy. */
  updateBoardTemplate: (id: string, patch: Partial<Omit<BoardTemplate, 'id' | 'lanes'>>) => void
  removeBoard: (id: string) => void
  /**
   * Retire a board without destroying it: hidden from the picker, the workspace's list and
   * the aggregation bands, while its lanes, items, placements and edges are untouched.
   */
  archiveBoard: (id: string) => void
  unarchiveBoard: (id: string) => void
  /**
   * Deep-copy a board's design — its lanes, settings and links — with fresh ids. Its work
   * is deliberately left behind: items live in placements, and copying them would copy the
   * work itself. The copy lands in the list without switching to it, as a new board does.
   */
  duplicateBoard: (boardId: string, name?: string) => void
  renameBoard: (id: string, name: string) => void
  setBoardBand: (id: string, band: BoardBand) => void
  setBoardDefaultCardType: (id: string, typeId: string | undefined) => void
  /**
   * Move a selection to another board. It lands in that board's default drop column — the same
   * cell a new card would go to, which is what that setting is for.
   */
  moveCardsToBoard: (itemIds: string[], boardId: string) => void
  /** The cell new cards land in, and where a card moved onto this board lands. */
  setBoardDefaultDropLane: (id: string, laneId: string | undefined) => void
  /** Set which card types are allowed on a board (empty = every card type). */
  setBoardWipEnforcement: (id: string, mode: 'visualize' | 'justify' | 'block') => void

  addCard: (input: { boardId: string; typeId: string; laneId: string; title: string }) => void
  moveCard: (itemId: string, boardId: string, laneId: string, reason?: string) => void
  /**
   * Move an initiative between the cells of its section. The section itself is
   * derived from the work below, so a move that would cross it is refused — only
   * the arrangement within a section is the user's to set.
   */
  moveInitiative: (itemId: string, boardId: string, laneId: string) => void
  /** Land an initiative at a position in a cell — a rank within the cell, like a card's. */
  moveInitiativeToIndex: (itemId: string, boardId: string, laneId: string, index: number) => void
  /** Move a card one place up or down within its lane (delta -1 = up). */
  /** Land a card at a position in a lane, counting the cards already there. */
  moveCardToIndex: (itemId: string, boardId: string, laneId: string, index: number) => void
  setItemFields: (id: string, patch: Partial<Item>) => void

  /** Checklist inside a card — sub-tasks (never schedulable, never WIP). */
  addChecklistItem: (itemId: string, text: string) => void
  toggleChecklistItem: (itemId: string, entryId: string) => void
  /** Reorder a checklist entry within its card (delta -1 = up, +1 = down). */
  moveChecklistItem: (itemId: string, entryId: string, delta: number) => void
  removeChecklistItem: (itemId: string, entryId: string) => void

  splitLane: (laneId: string, orientation: SplitOrientation, count?: number) => void
  addLane: (parentId: string) => void
  /** Insert a new sibling lane immediately after this one. */
  insertLaneAfter: (laneId: string) => void
  /** Duplicate a lane and its whole sub-lane subtree (cards are not copied). */
  duplicateLane: (laneId: string) => void
  toggleCollapse: (laneId: string) => void
  /** Reorder a lane within its parent (delta -1 = left/up, +1 = right/down). */
  moveLane: (laneId: string, delta: number) => void
  setLaneOrientation: (laneId: string, orientation: SplitOrientation) => void
  removeLane: (laneId: string) => void
  renameLane: (laneId: string, name: string) => void
  setLaneWip: (laneId: string, wipLimit: number | undefined) => void
  /** Set a lane's policy text (entry/exit rules). */
  setLaneDescription: (laneId: string, description: string | undefined) => void

  setParent: (childId: string, parentId: string | null) => void
  /** The card waiting for a parent, if one is. See `parentPickId` in the view state. */
  startParentPick: (itemId: string) => void
  cancelParentPick: () => void
  /** The initiative waiting for a card, if one is. See `childPickId` in the view state. */
  startChildPick: (itemId: string) => void
  cancelChildPick: () => void
  /**
   * A card's checklist — its sub-tasks. They are not work of their own: no placement, no WIP,
   * no status beyond ticked. An initiative has children instead, and they are items.
   */
  addChecklistEntry: (itemId: string, text: string) => void
  /** Rename an entry. Clearing the text removes it. */
  setChecklistEntryText: (itemId: string, entryId: string, text: string) => void
  toggleChecklistEntry: (itemId: string, entryId: string) => void
  removeChecklistEntry: (itemId: string, entryId: string) => void
  /** Create a team-level initiative on a team board, linked (as a child) to a management initiative. */
  linkTeamInitiative: (parentId: string, boardId: string, title: string) => void

  /** Link two items: `dependentId` depends on `dependencyId`. Immediate — no approval step. */
  addDependency: (dependencyId: string, dependentId: string, reason?: string) => void
  setAttribution: (itemId: string, objectiveId: string, on: boolean) => void

  /** Explicitly block/unblock an item — a status independent of any link. */
  blockItem: (itemId: string, reason?: string) => void
  unblockItem: (itemId: string, note?: string) => void
  addLogNote: (itemId: string, note: string) => void

  /** File an item away (cascades to its whole subtree); stays searchable and in links. */
  archiveItem: (itemId: string) => void
  unarchiveItem: (itemId: string) => void
  /** Archive every resolved (Done) item on a board. */
  archiveDoneOnBoard: (boardId: string) => void
  /** Auto-archive Done items older than N days (0/undefined turns it off). */
  setAutoArchiveDays: (days?: number) => void
  runAutoArchive: () => void
  /** Delete a card and every relationship it participates in. */
  deleteItem: (itemId: string) => void
}

export type Store = FlowState & ViewState & Actions

const uid = makeUid

/**
 * Put a card at a position in a lane: before a card, after a card, or at the end. The lane
 * is renumbered to a clean 0..n-1 as it lands, so a lane that predates rank ends up ordered
 * rather than keeping whatever numbers happened to be there.
 */
function placeCard(
  set: (partial: Partial<Store>) => void,
  state: Store,
  moving: Placement,
  laneId: string,
  atOf: (ordered: Placement[]) => number,
  { stampDone = true }: { stampDone?: boolean } = {},
) {
  // The cards already in the lane, without the one in the air: the position is in *that*
  // list, because that is the list the card lands in.
  const rest = state.placements.filter((p) => p.laneId === laneId && p.id !== moving.id)
  const ordered = placementsInOrder(rest, laneId)
  const at = Math.max(0, Math.min(atOf(ordered), ordered.length))
  ordered.splice(at, 0, moving)
  const rankById = new Map(ordered.map((p, i) => [p.id, i]))
  const stage = effectiveStage(state.lanes, laneId)
  set({
    placements: state.placements.map((p) => {
      if (p.id === moving.id) return { ...p, laneId, laneEnteredAt: Date.now(), rank: rankById.get(p.id) ?? 0 }
      return rankById.has(p.id) ? { ...p, rank: rankById.get(p.id)! } : p
    }),
    // The Done stamp belongs to leaf work only: an initiative's completion is derived from the
    // work beneath it, so landing one in a Done cell must never write resolvedAt onto it.
    items: stampDone
      ? state.items.map((i) => {
          if (i.id !== moving.itemId) return i
          if (stage === 'done' && !i.resolvedAt) return { ...i, resolvedAt: Date.now() }
          if (stage !== 'done' && i.resolvedAt) return { ...i, resolvedAt: null }
          return i
        })
      : state.items,
  })
}

/**
 * Move a placement into a lane: stamp when it arrived — the clock card age reads — and rank
 * it last, because arriving in a lane means arriving at the bottom of it.
 */
const toLane = (placements: Placement[], p: Placement, laneId: string): Placement => ({
  ...p,
  laneId,
  laneEnteredAt: Date.now(),
  rank: nextRank(placements, laneId),
})

/** The first lane (target or ancestor) whose WIP limit a move would exceed. */
function exceededLane(
  state: Pick<FlowState, 'lanes' | 'placements'>,
  boardId: string,
  laneId: string,
  existingLaneId: string | undefined,
): Lane | undefined {
  const limited = [state.lanes.find((l) => l.id === laneId), ...ancestorsOf(state.lanes, laneId)]
  for (const l of limited) {
    if (!l || l.wipLimit === undefined) continue
    const subtree = new Set(subtreeIds(state.lanes, l.id))
    const count = state.placements.filter((p) => p.boardId === boardId && subtree.has(p.laneId)).length
    const alreadyInside = existingLaneId ? subtree.has(existingLaneId) : false
    if (count + (alreadyInside ? 0 : 1) > l.wipLimit) return l
  }
  return undefined
}

/** Find a user by full name (case-insensitive), or create one. */
function ensureUser(users: User[], name: string): { id: string; users: User[] } {
  const trimmed = name.trim()
  const existing = users.find((u) => u.name.toLowerCase() === trimmed.toLowerCase())
  if (existing) return { id: existing.id, users }
  const id = uid()
  return { id, users: [...users, { id, name: trimmed }] }
}

const logEntry = (kind: ItemLogEntry['kind'], note?: string): ItemLogEntry => ({
  id: uid(),
  at: Date.now(),
  kind,
  ...(note ? { note } : {}),
})

/**
 * Expand item ids to the union of their subtrees, cascading only from *roots* (ids
 * whose ancestor is not also in the set) so a cascade never double-processes work.
 */
function subtreeRoots(ids: string[], graph: Pick<FlowState, 'items' | 'edges' | 'links' | 'placements' | 'lanes'>): Set<string> {
  const have = new Set(ids)
  const roots = ids.filter((id) => {
    let cur = decompositionParent(id, graph.edges)
    while (cur) {
      if (have.has(cur)) return false
      cur = decompositionParent(cur, graph.edges)
    }
    return true
  })
  const out = new Set<string>()
  for (const r of roots) {
    out.add(r)
    for (const d of descendants(r, graph)) out.add(d)
  }
  return out
}

const initialView: ViewState = {
  boardId: 'b-portfolio',
  selectedItemId: null,
  search: '',
  editMode: false,
  draft: null,
  lensId: null,
  showObjectives: false,
  showBoardSettings: false,
  showDashboard: false,
  showTimeline: false,
  showArchive: false,
  showBoards: false,
  collapsedLanes: {},
  showFilters: false,
  filters: NO_FILTERS,
  savedFilters: [],
  boundaryId: null,
  parentPickId: null,
  childPickId: null,
  multiSelect: [],
  confirm: null,
  wipPrompt: null,
  cardMenu: null,
}

/**
 * Backfills fields added after earlier persisted versions:
 * - `Board.level` (boards saved before the flight-level badge existed);
 * - item-to-item `links` (v9 kept dependencies inside `edges`);
 * - dropped link approval status + rejected links (v11);
 * - OKR attribution limited to initiatives (v12);
 * - `targetDate` split into target start / end dates (v13);
 * - a single `assignee` became a list of assignees (v14);
 * - assignees became user ids backed by a `users` directory (v15);
 * - `Board.level` became `Board.band` (team/program/portfolio) and
 *   `teamBoardIds` became `linkedBoardIds` (v16/v17);
 * - OKRs attach only to strategic initiatives — attribution pointing lower down
 *   is dropped (v18).
 * Exported for testing.
 */
export function migrateState(persisted: unknown): Partial<Store> {
  const p = (persisted ?? {}) as Record<string, unknown>
  // v16: `Board.level` became `Board.band`, and `teamBoardIds` became the
  // depth-agnostic `linkedBoardIds`. v17: the band values were renamed to the
  // flight-level vocabulary (team / program / portfolio). An old 'portfolio' level
  // (an aggregating board) becomes a *program*, while a v16 'strategic' band
  // becomes the new *portfolio*.
  if (Array.isArray(p.boards)) {
    p.boards = (p.boards as (Record<string, unknown> & { level?: string; teamBoardIds?: string[] })[]).map((b) => {
      const { level, teamBoardIds, ...rest } = b
      const existing = typeof rest.band === 'string' ? rest.band : undefined
      const raw = existing ?? (level === 'portfolio' || level === 'project' ? 'program' : 'team')
      const band: BoardBand =
        raw === 'coordination' || raw === 'program' ? 'program' : raw === 'strategic' || raw === 'portfolio' ? 'portfolio' : 'team'
      return { ...rest, band, ...(teamBoardIds ? { linkedBoardIds: teamBoardIds } : {}) }
    })
  }
  // v27: card types belong to the workspace, not to a board. Every board offers all of them,
  // so the per-board subset is gone — a board either has a type, which is to say everyone does,
  // or the type does not exist. Same for a template: it designs a flow, not a shortlist.
  const withoutCardTypeIds = (rows: unknown) =>
    (Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []).map((row) => {
      const next = { ...row }
      delete next.cardTypeIds
      return next
    })
  if (Array.isArray(p.boards)) p.boards = withoutCardTypeIds(p.boards)
  if (Array.isArray(p.boardTemplates)) p.boardTemplates = withoutCardTypeIds(p.boardTemplates)
  // v9 → v10: item-to-item dependencies became first-class `links`; `edges`
  // now holds only hierarchy (decomposition) and objective (attribution).
  // v11: links no longer carry an approval status.
  if (!Array.isArray(p.links)) {
    type LegacyEdge = {
      id: string
      kind: 'decomposition' | 'dependency' | 'attribution'
      from: string
      to: string
      dep?: { status?: string; reason?: string }
    }
    const edges = Array.isArray(p.edges) ? (p.edges as LegacyEdge[]) : []
    p.links = edges
      .filter((e) => e.kind === 'dependency' && e.dep?.status !== 'rejected')
      .map((e) => ({ id: e.id, from: e.from, to: e.to, reason: e.dep?.reason }))
    p.edges = edges.filter((e) => e.kind !== 'dependency').map(({ id, kind, from, to }) => ({ id, kind, from, to }))
  } else {
    // Drop links that were rejected (they were never real dependencies) and
    // strip the now-removed status field.
    p.links = (p.links as { id: string; from: string; to: string; status?: string; reason?: string }[])
      .filter((l) => l.status !== 'rejected')
      .map((l) => ({ id: l.id, from: l.from, to: l.to, ...(l.reason ? { reason: l.reason } : {}) }))
  }
  // v12: OKR attribution is reserved for initiatives — cards map to initiatives
  // through the hierarchy. Drop any attribution edges pointing at a non-initiative.
  if (Array.isArray(p.edges) && Array.isArray(p.items) && Array.isArray(p.issueTypes)) {
    const initId = (p.issueTypes as { id: string; name: string }[]).find((t) => t.name === 'Initiative')?.id
    if (initId) {
      const typeOf = new Map((p.items as { id: string; typeId: string }[]).map((i) => [i.id, i.typeId]))
      p.edges = (p.edges as { kind: string; to: string }[]).filter((e) => e.kind !== 'attribution' || typeOf.get(e.to) === initId)
    }
  }
  // v13: a single targetDate became a target start / end pair. Old data keeps its
  // date as the end date.
  if (Array.isArray(p.items)) {
    p.items = (p.items as (Item & { targetDate?: string })[]).map((i) => {
      if (!('targetDate' in i)) return i
      const { targetDate, ...rest } = i
      return { ...rest, ...(targetDate ? { targetEndDate: targetDate } : {}) }
    })
  }
  // v14: a single assignee became a list of assignees.
  if (Array.isArray(p.items)) {
    p.items = (p.items as (Item & { assignee?: string })[]).map((i) => {
      if (!('assignee' in i)) return i
      const { assignee, ...rest } = i
      return { ...rest, ...(assignee ? { assignees: [assignee] } : {}) }
    })
  }
  // v15: assignees became user ids backed by a `users` directory. Build users from
  // the old name strings and map each item's assignees to the new ids.
  if (Array.isArray(p.items)) {
    const users: User[] = Array.isArray(p.users) ? (p.users as User[]) : []
    const byName = new Map(users.map((u) => [u.name.toLowerCase(), u.id]))
    const resolve = (value: string): string => {
      if (users.some((u) => u.id === value)) return value // already an id
      const key = value.trim().toLowerCase()
      const existing = byName.get(key)
      if (existing) return existing
      const id = `u-${key.replace(/[^a-z0-9]+/g, '-')}`
      users.push({ id, name: value.trim() })
      byName.set(key, id)
      return id
    }
    p.items = (p.items as (Item & { assignees?: string[] })[]).map((i) =>
      Array.isArray(i.assignees) ? { ...i, assignees: i.assignees.map(resolve) } : i,
    )
    p.users = users
  }
  // v18: OKRs attach only to strategic initiatives (an Initiative on a portfolio
  // board). Anything mapped lower down inherits through the decomposition instead,
  // so those edges are dropped.
  if (
    Array.isArray(p.edges) &&
    Array.isArray(p.items) &&
    Array.isArray(p.placements) &&
    Array.isArray(p.boards) &&
    Array.isArray(p.issueTypes)
  ) {
    const ctx = {
      items: p.items as Item[],
      placements: p.placements as Placement[],
      boards: p.boards as Board[],
      issueTypes: p.issueTypes as IssueType[],
    }
    p.edges = (p.edges as Edge[]).filter((e) => e.kind !== 'attribution' || isStrategicInitiative(e.to, ctx))
  }
  // v19: `Board.derived` (the "rollup board" flag) is gone — a parent's status already
  // rolls up from the work beneath it, with no per-board mode. Drop the stale flag.
  if (Array.isArray(p.boards)) {
    p.boards = (p.boards as (Board & { derived?: boolean })[]).map(({ derived: _derived, ...rest }) => rest)
  }
  // v20: boards gained `archived` / `archivedAt`. Both are optional, so nothing needs
  // backfilling — an absent flag simply means "not archived". Normalise instead: a board
  // that is not archived should carry neither key.
  if (Array.isArray(p.boards)) {
    p.boards = (p.boards as Board[]).map((b) => {
      if (b.archived) return b
      const { archived: _a, archivedAt: _at, ...rest } = b
      return rest
    })
  }
  // v21: board templates became a persisted collection. Older state simply has none.
  if (!Array.isArray(p.boardTemplates)) p.boardTemplates = []
  // v22: templates the product ships with. A built-in belongs to the app, not to a user's
  // data, so add any the stored state is missing — otherwise it would take a Reset to
  // appear for anyone who already had state.
  {
    const stored = p.boardTemplates as BoardTemplate[]
    const have = new Set(stored.map((t) => t.id))
    p.boardTemplates = [...stored, ...BUILT_IN_TEMPLATES.filter((t) => !have.has(t.id))]
  }
  // v23: and keep a built-in in step when its definition changes — the same ownership
  // rule, applied to updates rather than additions. Templates the user made are untouched.
  if (Array.isArray(p.boardTemplates)) {
    const builtIn = new Map(BUILT_IN_TEMPLATES.map((t) => [t.id, t]))
    p.boardTemplates = (p.boardTemplates as BoardTemplate[]).map((t) => builtIn.get(t.id) ?? t)
  }
  // v24: the two workflows became independent lane trees. Every lane that existed was the
  // shared one, so it is the **cards** workflow now; each board gains the **initiatives**
  // workflow it should always have started with — the four typed sections, one cell each.
  // An initiative placed in what was a card lane moves to the section matching that lane's
  // stage; its cell inside is arrangement, and the default tree has exactly one.
  if (Array.isArray(p.lanes)) {
    const stored = p.lanes as Lane[]
    const all: Lane[] = stored.map((l) => (l.workflow ? l : { ...l, workflow: 'cards' as const }))
    const initiatives: Lane[] = []
    for (const board of (p.boards as Board[]) ?? []) {
      // Idempotent: a board that already has an initiatives tree keeps it.
      if (all.some((l) => l.boardId === board.id && l.workflow === 'initiatives')) continue
      const root: Lane = {
        id: uid(),
        boardId: board.id,
        parentId: null,
        order: 0,
        name: '',
        orientation: 'columns',
        workflow: 'initiatives',
      }
      initiatives.push(root, ...defaultColumns(board.id, root.id, 'initiatives', uid))
    }
    p.lanes = [...all, ...initiatives]

    const initiativeType = initiativeTypeId((p.issueTypes as IssueType[]) ?? [])
    if (initiativeType && Array.isArray(p.placements)) {
      const byId = new Map(all.map((l) => [l.id, l]))
      const itemById = new Map(((p.items as Item[]) ?? []).map((i) => [i.id, i]))
      const lanes = p.lanes as Lane[]
      p.placements = (p.placements as Placement[]).map((pl) => {
        if (itemById.get(pl.itemId)?.typeId !== initiativeType) return pl
        const lane = byId.get(pl.laneId)
        if (!lane || lane.workflow === 'initiatives') return pl
        const stage = effectiveStage(all, pl.laneId)
        const section = lanes.find(
          (l) => l.boardId === pl.boardId && l.workflow === 'initiatives' && l.parentId !== null && l.stage === stage,
        )
        return section ? { ...pl, laneId: section.id } : pl
      })
    }
  }
  // v25: sub-tasks became a system type rather than a user choice — a decomposition child
  // is a Sub-task, and the panel no longer offers a type when adding one. Add it for
  // states that predate it, the way built-in templates arrive.
  if (Array.isArray(p.issueTypes) && !(p.issueTypes as IssueType[]).some((t) => t.name === 'Sub-task')) {
    p.issueTypes = [...(p.issueTypes as IssueType[]), { id: 't-subtask', name: 'Sub-task', color: '#94a3b8' }]
  }
  // The Feature Flow template offers Epic and Story, so the Epic type has to exist for
  // states that predate it.
  if (Array.isArray(p.issueTypes) && !(p.issueTypes as IssueType[]).some((t) => t.name === 'Epic')) {
    p.issueTypes = [...(p.issueTypes as IssueType[]), { id: 't-epic', name: 'Epic', color: '#8b5cf6' }]
  }
  // v28: named filter sets became persisted data — the deliberate exception to filters
  // being view state. Older state simply has none.
  if (!Array.isArray(p.savedFilters)) p.savedFilters = []
  return p as Partial<Store>
}

/**
 * Persisted-state migration. The board model has been reshaped several times, so any
 * state older than v5 is reseeded with the current demo design.
 */
export function migratePersisted(persisted: unknown, version: number): Partial<Store> {
  if (version < 9) return createSeed() as unknown as Partial<Store>
  return migrateState(persisted)
}

/**
 * The slice of state written to localStorage. View-only state (selection, filters,
 * multi-select, boundary focus, a pending confirm) is excluded. Saved filter sets are
 * the deliberate exception: the named sets are a user's data, not a view.
 * While editing, the
 * pre-edit (draft) design substitutes the live one so a reload reverts unsaved
 * layout changes.
 *
 * Exported for testing.
 */
export function persistedSlice(s: Store): Partial<Store> {
  const design = s.draft ?? { boards: s.boards, lanes: s.lanes, placements: s.placements, boardId: s.boardId }
  return {
    users: s.users,
    issueTypes: s.issueTypes,
    items: s.items,
    edges: s.edges,
    links: s.links,
    objectives: s.objectives,
    keyResults: s.keyResults,
    boardTemplates: s.boardTemplates,
    autoArchiveDays: s.autoArchiveDays,
    savedFilters: s.savedFilters,
    // Collapsed columns are remembered across reloads.
    collapsedLanes: s.collapsedLanes,
    boardId: design.boardId,
    boards: design.boards,
    lanes: design.lanes,
    placements: design.placements,
  }
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...createSeed(),
      ...initialView,

      selectBoard: (boardId) => set({ boardId, selectedItemId: null, showDashboard: false, showTimeline: false, showArchive: false, showBoards: false, boundaryId: null, multiSelect: [], cardMenu: null }),
      openItem: (selectedItemId) => set({ selectedItemId, multiSelect: [], ...(selectedItemId ? { showFilters: false } : {}) }),
      setSearch: (search) => set({ search }),
      toggleFilters: () => {
        const show = !get().showFilters
        // One side panel at a time: opening filters dismisses an open card.
        set({ showFilters: show, ...(show ? { selectedItemId: null } : {}) })
      },
      saveFilter: (name) => {
        const trimmed = name.trim()
        if (!trimmed) return
        const f = get().filters
        if (!hasActiveFilters(f)) return
        // Copy arrays as they go in: a saved set must never alias the live filter state, or
        // toggling a checkbox later would edit the past.
        const filters: CardFilters = {
          ...f,
          text: f.text?.trim() || undefined,
          typeIds: [...f.typeIds],
          assigneeIds: [...f.assigneeIds],
          priorities: [...f.priorities],
        }
        set({ savedFilters: [...get().savedFilters, { id: uid(), name: trimmed, filters }] })
      },
      applySavedFilter: (id) => {
        const saved = get().savedFilters.find((s) => s.id === id)
        if (!saved) return
        // A full replacement, not a merge — applying a named set means adopting it, and
        // clearing afterwards leaves exactly NO_FILTERS, so no residue can linger.
        set({
          filters: {
            ...saved.filters,
            typeIds: [...saved.filters.typeIds],
            assigneeIds: [...saved.filters.assigneeIds],
            priorities: [...saved.filters.priorities],
          },
        })
      },
      removeSavedFilter: (id) => {
        set({ savedFilters: get().savedFilters.filter((s) => s.id !== id) })
      },
      setFilters: (patch) => set({ filters: { ...get().filters, ...patch } }),
      toggleFilterType: (typeId) => {
        const f = get().filters
        const typeIds = f.typeIds.includes(typeId) ? f.typeIds.filter((t) => t !== typeId) : [...f.typeIds, typeId]
        set({ filters: { ...f, typeIds } })
      },
      clearFilters: () => set({ filters: NO_FILTERS }),
      toggleBoundary: (id) => set({ boundaryId: get().boundaryId === id ? null : id }),

      startParentPick: (itemId) => set({ parentPickId: itemId, cardMenu: null }),
      cancelParentPick: () => set({ parentPickId: null }),
      startChildPick: (itemId) => set({ childPickId: itemId, cardMenu: null }),
      cancelChildPick: () => set({ childPickId: null }),

      toggleMultiSelect: (id) => {
        const s = get()
        // Seed from the open card so a shift+click on a second card starts a group.
        const base = s.multiSelect.length > 0 ? s.multiSelect : s.selectedItemId ? [s.selectedItemId] : []
        const group = base.includes(id) ? base.filter((x) => x !== id) : [...base, id]
        set({ multiSelect: group, selectedItemId: null, showFilters: false })
      },
      clearMultiSelect: () => set({ multiSelect: [] }),
      askConfirm: (confirm) => set({ confirm }),
      closeConfirm: () => set({ confirm: null }),
      confirmWipPrompt: (reason) => {
        const prompt = get().wipPrompt
        set({ wipPrompt: null })
        if (prompt) get().moveCard(prompt.itemId, prompt.boardId, prompt.laneId, reason.trim())
      },
      cancelWipPrompt: () => set({ wipPrompt: null }),
      openCardMenu: (itemId, x, y) => set({ cardMenu: { itemId, x, y } }),
      closeCardMenu: () => set({ cardMenu: null }),

      moveCardsToBoard: (itemIds, targetBoardId) => {
        const state = get()
        const ids = new Set(itemIds)
        // A board with nowhere to put them cannot take them, and doing nothing is better than
        // dropping the cards on the floor. Moving a board to itself is not a move.
        if (targetBoardId === state.boardId) return
        const lane = defaultDropLane(state.boards.find((b) => b.id === targetBoardId), state.lanes, targetBoardId)
        if (!lane) return
        const stage = effectiveStage(state.lanes, lane.id)
        const at = nextRank(state.placements, lane.id)
        set({
          // A move, not a copy: the card leaves the board it was on, because one card counted by
          // two boards is counted twice. Any placement it already had on the target goes too —
          // one per board — and one is written for every card, so a card that had no placement
          // at all still arrives.
          placements: [
            ...state.placements.filter((p) => !(ids.has(p.itemId) && (p.boardId === state.boardId || p.boardId === targetBoardId))),
            ...state.items
              .filter((i) => ids.has(i.id))
              .map((i, n) => ({
                id: uid(),
                boardId: targetBoardId,
                itemId: i.id,
                laneId: lane.id,
                laneEnteredAt: Date.now(),
                rank: at + n,
              })),
          ],
          // Keep the auto-archive clock in step with the stage they land in.
          items: state.items.map((i) => {
            if (!ids.has(i.id)) return i
            if (stage === 'done' && !i.resolvedAt) return { ...i, resolvedAt: Date.now() }
            if (stage !== 'done' && i.resolvedAt) return { ...i, resolvedAt: null }
            return i
          }),
          // They are not on this board any more, so they are not selected on it either.
          multiSelect: [],
        })
      },

      moveCardsToLane: (itemIds, laneId) => {
        const state = get()
        const ids = new Set(itemIds)
        const stage = effectiveStage(state.lanes, laneId)
        set({
          // Only this board's placements move.
          placements: (() => {
            // The selection keeps its relative order and lands as a block at the end.
            const moving = placementsInOrder(state.placements.filter((p) => p.boardId === state.boardId), laneId)
            const ordered = state.placements
              .filter((p) => p.boardId === state.boardId && ids.has(p.itemId))
              .sort((a, b) => moving.indexOf(a) - moving.indexOf(b))
            const base = nextRank(state.placements, laneId)
            const rankOf = new Map(ordered.map((p, i) => [p.id, base + i]))
            return state.placements.map((p) => {
              if (p.boardId !== state.boardId || !ids.has(p.itemId)) return p
              return { ...p, laneId, laneEnteredAt: Date.now(), rank: rankOf.get(p.id) ?? base }
            })
          })(),
          // Keep the auto-archive clock in step with the target stage.
          items: state.items.map((i) => {
            if (!ids.has(i.id)) return i
            if (stage === 'done' && !i.resolvedAt) return { ...i, resolvedAt: Date.now() }
            if (stage !== 'done' && i.resolvedAt) return { ...i, resolvedAt: null }
            return i
          }),
        })
      },

      setItemsType: (itemIds, typeId) => {
        const state = get()
        const ids = new Set(itemIds)
        // An initiative cannot be retyped into a card type, and nothing becomes an
        // initiative — see `canRetype`. Refused rather than corrected.
        set({
          items: state.items.map((i) =>
            ids.has(i.id) && canRetype(i, typeId, state.issueTypes) ? { ...i, typeId } : i,
          ),
        })
      },

      addAssignee: (itemId, name) => {
        const state = get()
        const { id, users } = ensureUser(state.users, name)
        set({
          users,
          items: state.items.map((i) =>
            i.id === itemId && !(i.assignees ?? []).includes(id) ? { ...i, assignees: [...(i.assignees ?? []), id] } : i,
          ),
        })
      },
      addItemsAssignee: (itemIds, name) => {
        const state = get()
        const { id, users } = ensureUser(state.users, name)
        const ids = new Set(itemIds)
        set({
          users,
          items: state.items.map((i) =>
            ids.has(i.id) && !(i.assignees ?? []).includes(id) ? { ...i, assignees: [...(i.assignees ?? []), id] } : i,
          ),
        })
      },
      clearItemsAssignees: (itemIds) => {
        const ids = new Set(itemIds)
        set({ items: get().items.map((i) => (ids.has(i.id) ? { ...i, assignees: undefined } : i)) })
      },
      removeItemsAssignee: (itemIds, userId) => {
        const ids = new Set(itemIds)
        set({
          items: get().items.map((i) => {
            if (!ids.has(i.id)) return i
            const next = (i.assignees ?? []).filter((a) => a !== userId)
            return { ...i, assignees: next.length > 0 ? next : undefined }
          }),
        })
      },
      setItemsSize: (itemIds, size) => {
        const ids = new Set(itemIds)
        set({ items: get().items.map((i) => (ids.has(i.id) ? { ...i, size } : i)) })
      },
      setItemsTargetStart: (itemIds, targetStartDate) => {
        const ids = new Set(itemIds)
        set({ items: get().items.map((i) => (ids.has(i.id) ? { ...i, targetStartDate } : i)) })
      },
      setItemsTargetEnd: (itemIds, targetEndDate) => {
        const ids = new Set(itemIds)
        set({ items: get().items.map((i) => (ids.has(i.id) ? { ...i, targetEndDate } : i)) })
      },
      blockItems: (itemIds, reason) => {
        const note = reason?.trim() || undefined
        const ids = new Set(itemIds)
        set({
          items: get().items.map((i) =>
            ids.has(i.id) ? { ...i, blocked: true, blockedReason: note, log: [...(i.log ?? []), logEntry('blocked', note)] } : i,
          ),
        })
      },
      unblockItems: (itemIds, note) => {
        const text = note?.trim() || undefined
        const ids = new Set(itemIds)
        set({
          items: get().items.map((i) =>
            ids.has(i.id) ? { ...i, blocked: false, blockedReason: undefined, log: [...(i.log ?? []), logEntry('unblocked', text)] } : i,
          ),
        })
      },

      archiveItems: (itemIds) => {
        const state = get()
        const ids = subtreeRoots(itemIds, state)
        if (ids.size === 0) return
        const at = Date.now()
        set({
          items: state.items.map((i) =>
            ids.has(i.id) && !i.archived ? { ...i, archived: true, archivedAt: at, log: [...(i.log ?? []), logEntry('archived')] } : i,
          ),
          multiSelect: [],
        })
      },

      deleteItems: (itemIds) => {
        const state = get()
        const ids = new Set(itemIds)
        set({
          items: state.items.filter((i) => !ids.has(i.id)),
          placements: state.placements.filter((p) => !ids.has(p.itemId)),
          edges: state.edges.filter(
            (e) =>
              !(e.kind === 'decomposition' && (ids.has(e.from) || ids.has(e.to))) &&
              !(e.kind === 'attribution' && ids.has(e.to)),
          ),
          links: state.links.filter((l) => !ids.has(l.from) && !ids.has(l.to)),
          selectedItemId: state.selectedItemId && ids.has(state.selectedItemId) ? null : state.selectedItemId,
          multiSelect: [],
        })
      },

      beginEdit: () => {
        const s = get()
        if (s.editMode) return
        set({
          editMode: true,
          draft: {
            boards: structuredClone(s.boards),
            lanes: structuredClone(s.lanes),
            placements: structuredClone(s.placements),
            boardId: s.boardId,
          },
        })
      },
      saveEdit: () => set({ editMode: false, draft: null }),
      toggleLens: (id) => set({ lensId: get().lensId === id ? null : id }),
      setLens: (id) => set({ lensId: id }),
      clearLens: () => set({ lensId: null }),
      toggleBoardSettings: () => set({ showBoardSettings: !get().showBoardSettings }),
      setObjectives: (v) => set({ showObjectives: v, ...(v ? { showDashboard: false, showTimeline: false, showArchive: false, showBoards: false } : {}) }),
      // The nav is tabs, not toggles: a tab selects its view and never switches off, and the
      // Board tab is the board itself — every view flag clears, the workspace with it.
      setBoard: () => set({ showObjectives: false, showDashboard: false, showTimeline: false, showArchive: false, showBoards: false }),
      setDashboard: (v) => set({ showDashboard: v, ...(v ? { showObjectives: false, showTimeline: false, showArchive: false, showBoards: false } : {}) }),
      setTimeline: (v) => set({ showTimeline: v, ...(v ? { showObjectives: false, showDashboard: false, showArchive: false, showBoards: false } : {}) }),
      setArchive: (v) => set({ showArchive: v, ...(v ? { showObjectives: false, showDashboard: false, showTimeline: false, showBoards: false } : {}) }),
      toggleBoards: () => {
        const on = !get().showBoards
        set({
          showBoards: on,
          showObjectives: false,
          showDashboard: false,
          showTimeline: false,
          showArchive: false,
          // The workspace is organisation-level, so a board's side panel has no place in it.
          ...(on ? { showFilters: false, selectedItemId: null } : {}),
        })
      },
      setBoards: (v) =>
        set({
          showBoards: v,
          ...(v
            ? { showObjectives: false, showDashboard: false, showTimeline: false, showArchive: false, showFilters: false, selectedItemId: null }
            : {}),
        }),

      addObjective: (title, period) =>
        set({ objectives: [...get().objectives, { id: uid(), title, period, status: 'active' }] }),
      updateObjective: (id, patch) =>
        set({ objectives: get().objectives.map((o) => (o.id === id ? { ...o, ...patch } : o)) }),
      removeObjective: (id) =>
        set({
          objectives: get().objectives.filter((o) => o.id !== id),
          keyResults: get().keyResults.filter((k) => k.objectiveId !== id),
          edges: get().edges.filter((e) => !(e.kind === 'attribution' && e.from === id)),
        }),
      addKeyResult: (objectiveId, title) =>
        set({ keyResults: [...get().keyResults, { id: uid(), objectiveId, title }] }),
      updateKeyResult: (id, patch) =>
        set({ keyResults: get().keyResults.map((k) => (k.id === id ? { ...k, ...patch } : k)) }),
      removeKeyResult: (id) => set({ keyResults: get().keyResults.filter((k) => k.id !== id) }),

      addLinkedBoard: (parentId, childId) => {
        const state = get()
        if (!canLinkBoard(state.boards, parentId, childId)) return
        set({
          boards: state.boards.map((b) =>
            b.id === parentId && !(b.linkedBoardIds ?? []).includes(childId)
              ? { ...b, linkedBoardIds: [...(b.linkedBoardIds ?? []), childId] }
              : b,
          ),
        })
      },
      removeLinkedBoard: (parentId, childId) =>
        set({
          boards: get().boards.map((b) =>
            b.id === parentId ? { ...b, linkedBoardIds: (b.linkedBoardIds ?? []).filter((t) => t !== childId) } : b,
          ),
        }),
      cancelEdit: () => {
        const d = get().draft
        if (!d) {
          set({ editMode: false })
          return
        }
        set({ editMode: false, draft: null, boards: d.boards, lanes: d.lanes, placements: d.placements, boardId: d.boardId })
      },
      resetDemo: () => set({ ...createSeed(), ...initialView }),

      addIssueType: (name, color) => {
        const id = uid()
        set({ issueTypes: [...get().issueTypes, { id, name, color }] })
        return id
      },
      updateIssueType: (id, patch) =>
        set({ issueTypes: get().issueTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
      removeIssueType: (id) => set({ issueTypes: get().issueTypes.filter((t) => t.id !== id) }),

      addBoard: (name, band, open = true, templateId) => {
        const boardId = uid()
        const template = templateId ? get().boardTemplates.find((t) => t.id === templateId) : undefined
        // A template's band is the sensible default; an explicit band always wins.
        const resolvedBand = band ?? template?.band ?? 'team'
        const board: Board = {
          id: boardId,
          name,
          band: resolvedBand,
          ...(resolvedBand !== 'team' ? { linkedBoardIds: [] } : {}),
          ...(template?.defaultCardTypeId ? { defaultCardTypeId: template.defaultCardTypeId } : {}),
          ...(template?.wipEnforcement ? { wipEnforcement: template.wipEnforcement } : {}),
        }
        // Two independent trees. A template designs the **cards** workflow — a team's own
        // flow — while the **initiatives** workflow always starts standard: the shape the
        // organisation reads is not the team's design, and refining one never moves the other.
        const cardsRoot: Lane = { id: uid(), boardId, parentId: null, order: 0, name: '', orientation: 'columns', workflow: 'cards' }
        const initRoot: Lane = { id: uid(), boardId, parentId: null, order: 0, name: '', orientation: 'columns', workflow: 'initiatives' }
        const cards: Lane[] = template
          ? lanesFromTemplate(template, boardId, cardsRoot.id, uid)
          : defaultColumns(boardId, cardsRoot.id, 'cards', uid)
        const initiatives = defaultColumns(boardId, initRoot.id, 'initiatives', uid)
        set({
          boards: [...get().boards, board],
          lanes: [...get().lanes, cardsRoot, initRoot, ...cards, ...initiatives],
          ...(open ? { boardId, editMode: true } : {}),
        })
      },

      saveBoardAsTemplate: (boardId, name) => {
        const state = get()
        const board = state.boards.find((b) => b.id === boardId)
        if (!board) return
        const label = (name ?? board.name).trim() || board.name
        set({ boardTemplates: [...state.boardTemplates, templateFromBoard(uid(), label, board, state.lanes)] })
      },
      newBoardTemplate: (name, band) => {
        const label = name.trim()
        if (!label) return
        const template: BoardTemplate = {
          id: uid(),
          name: label,
          band,
          // The standard typed columns — the same starting point a plain board gets.
          lanes: STAGES.map((s, i) => ({
            key: `k${i}`,
            parentKey: null,
            order: i,
            name: STAGE_LABELS[s],
            stage: s,
          })),
        }
        set({ boardTemplates: [...get().boardTemplates, template] })
      },
      removeBoardTemplate: (id) => set({ boardTemplates: get().boardTemplates.filter((t) => t.id !== id) }),
      renameBoardTemplate: (id, name) =>
        set({ boardTemplates: get().boardTemplates.map((t) => (t.id === id ? { ...t, name } : t)) }),
      setTemplateLanes: (templateId, lanes) =>
        set({ boardTemplates: get().boardTemplates.map((t) => (t.id === templateId ? { ...t, lanes } : t)) }),
      updateBoardTemplate: (id, patch) =>
        set({ boardTemplates: get().boardTemplates.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),

      removeBoard: (id) => {
        const state = get()
        if (state.boards.length <= 1) return
        const laneIds = new Set(state.lanes.filter((l) => l.boardId === id).map((l) => l.id))
        const boards = state.boards
          .filter((b) => b.id !== id)
          .map((b) => (b.linkedBoardIds ? { ...b, linkedBoardIds: b.linkedBoardIds.filter((t) => t !== id) } : b))
        set({
          boards,
          lanes: state.lanes.filter((l) => l.boardId !== id),
          placements: state.placements.filter((p) => p.boardId !== id && !laneIds.has(p.laneId)),
          boardId: state.boardId === id ? boards[0].id : state.boardId,
        })
      },

      archiveBoard: (id) =>
        set({
          boards: get().boards.map((b) => (b.id === id ? { ...b, archived: true, archivedAt: Date.now() } : b)),
        }),
      unarchiveBoard: (id) =>
        set({
          // Drop the flags rather than setting false, so persisted state stays clean.
          boards: get().boards.map((b) => {
            if (b.id !== id) return b
            const { archived: _a, archivedAt: _at, ...rest } = b
            return rest
          }),
        }),

      duplicateBoard: (boardId, name) => {
        const state = get()
        const board = state.boards.find((b) => b.id === boardId)
        if (!board) return
        const copy = copyBoardDesign(board, state.lanes, uid, name)
        set({ boards: [...state.boards, copy.board], lanes: [...state.lanes, ...copy.lanes] })
      },

      renameBoard: (id, name) => set({ boards: get().boards.map((b) => (b.id === id ? { ...b, name } : b)) }),
      setBoardBand: (id, band) => set({ boards: get().boards.map((b) => (b.id === id ? { ...b, band } : b)) }),
      setBoardDefaultCardType: (id, defaultCardTypeId) =>
        set({ boards: get().boards.map((b) => (b.id === id ? { ...b, defaultCardTypeId } : b)) }),

      setBoardDefaultDropLane: (id, defaultDropLaneId) =>
        set({ boards: get().boards.map((b) => (b.id === id ? { ...b, defaultDropLaneId } : b)) }),

      setBoardWipEnforcement: (id, wipEnforcement) =>
        set({ boards: get().boards.map((b) => (b.id === id ? { ...b, wipEnforcement } : b)) }),

      addCard: ({ boardId, typeId, laneId, title }) => {
        const item: Item = { id: uid(), title, typeId, createdAt: Date.now(), log: [logEntry('created')] }
        const placement: Placement = {
          id: uid(),
          boardId,
          itemId: item.id,
          laneId,
          laneEnteredAt: Date.now(),
          rank: nextRank(get().placements, laneId),
        }
        set({ items: [...get().items, item], placements: [...get().placements, placement] })
      },

      moveCard: (itemId, boardId, laneId, reason) => {
        const state = get()
        // Cards live in the cards workflow; an initiative cell is never a destination.
        if (state.lanes.find((l) => l.id === laneId)?.workflow !== 'cards') return
        const existing = state.placements.find((p) => p.itemId === itemId && p.boardId === boardId)
        if (existing && existing.laneId === laneId) return
        // WIP enforcement on the target lane (or any limited ancestor).
        const board = state.boards.find((b) => b.id === boardId)
        const mode = board?.wipEnforcement ?? 'visualize'
        if (mode !== 'visualize') {
          const breached = exceededLane(state, boardId, laneId, existing?.laneId)
          if (breached) {
            if (mode === 'block') return
            // 'justify': hold the move until the user supplies a reason.
            if (reason === undefined) {
              set({
                wipPrompt: { itemId, boardId, laneId, laneName: breached.name || 'lane', limit: breached.wipLimit ?? 0 },
              })
              return
            }
          }
        }
        const placements = existing
          ? state.placements.map((p) => (p.id === existing.id ? toLane(state.placements, p, laneId) : p))
          : [
              ...state.placements,
              { id: uid(), boardId, itemId, laneId, laneEnteredAt: Date.now(), rank: nextRank(state.placements, laneId) },
            ]
        // Track when work enters/leaves Done — the clock auto-archive reads.
        const stage = effectiveStage(state.lanes, laneId)
        const items = state.items.map((i) => {
          if (i.id !== itemId) return i
          let next: Item = i
          if (stage === 'done' && !i.resolvedAt) next = { ...next, resolvedAt: Date.now() }
          if (stage !== 'done' && i.resolvedAt) next = { ...next, resolvedAt: null }
          // A justified WIP overrun is recorded on the card and in its log.
          if (reason) next = { ...next, lastMoveReason: reason, log: [...(i.log ?? []), logEntry('limit', reason)] }
          return next
        })
        set({ placements, items })
      },


      /**
       * Land a card at a position in a lane. The lane is renumbered to a clean 0..n-1 as it
       * is placed, so a lane that predates rank ends up ordered rather than keeping whatever
       * numbers happened to be there.
       *
       * `index` counts the cards that are already there, without the one being placed — the
       * list the card lands in.
       */
      moveCardToIndex: (itemId, boardId, laneId, index) => {
        const state = get()
        const moving = state.placements.find((p) => p.itemId === itemId && p.boardId === boardId)
        if (!moving) return
        placeCard(set, state, moving, laneId, () => index)
      },

      moveInitiative: (itemId, boardId, laneId) => {
        const state = get()
        const target = state.lanes.find((l) => l.id === laneId)
        // Initiatives are arranged in the initiatives workflow — never in a card lane.
        if (!target || target.workflow !== 'initiatives') return
        // The section is derived from the work below — a move may rearrange a cell
        // within it, never cross into another one.
        const graph = { items: state.items, edges: state.edges, links: state.links, placements: state.placements, lanes: state.lanes }
        if (effectiveStage(state.lanes, laneId) !== rollupOf(itemId, graph).bucket) return
        const existing = state.placements.find((p) => p.itemId === itemId && p.boardId === boardId)
        if (existing && existing.laneId === laneId) return
        const placements = existing
          ? state.placements.map((p) => (p.id === existing.id ? toLane(state.placements, p, laneId) : p))
          : [
              ...state.placements,
              { id: uid(), boardId, itemId, laneId, laneEnteredAt: Date.now(), rank: nextRank(state.placements, laneId) },
            ]
        set({ placements })
      },

      // A rank within a cell, like a card's within a lane: the initiatives of a cell are a
      // list a person orders. The section still bounds the move, and a container is still
      // not a place an initiative can go.
      moveInitiativeToIndex: (itemId, boardId, laneId, index) => {
        const state = get()
        const target = state.lanes.find((l) => l.id === laneId)
        if (!target || target.workflow !== 'initiatives') return
        if (!isLeaf(state.lanes, laneId)) return
        const graph = { items: state.items, edges: state.edges, links: state.links, placements: state.placements, lanes: state.lanes }
        if (effectiveStage(state.lanes, laneId) !== rollupOf(itemId, graph).bucket) return
        const moving = state.placements.find((p) => p.itemId === itemId && p.boardId === boardId)
        if (!moving) return
        placeCard(set, state, moving, laneId, () => index, { stampDone: false })
      },

      setItemFields: (id, patch) =>
        set({
          items: get().items.map((i) => {
            if (i.id !== id) return i
            // The panel's type control is hidden for an initiative, but the guard lives
            // here too: the rule is the model's, not the UI's.
            if (!patch.typeId || canRetype(i, patch.typeId, get().issueTypes)) return { ...i, ...patch }
            const { typeId: _reserved, ...rest } = patch
            return { ...i, ...rest }
          }),
        }),

      addChecklistItem: (itemId, text) => {
        const t = text.trim()
        if (!t) return
        set({
          items: get().items.map((i) =>
            i.id === itemId ? { ...i, checklist: [...(i.checklist ?? []), { id: uid(), text: t, done: false }] } : i,
          ),
        })
      },
      toggleChecklistItem: (itemId, entryId) =>
        set({
          items: get().items.map((i) =>
            i.id === itemId
              ? { ...i, checklist: (i.checklist ?? []).map((c) => (c.id === entryId ? { ...c, done: !c.done } : c)) }
              : i,
          ),
        }),
      moveChecklistItem: (itemId, entryId, delta) =>
        set({
          items: get().items.map((i) => {
            if (i.id !== itemId) return i
            const list = [...(i.checklist ?? [])]
            const idx = list.findIndex((c) => c.id === entryId)
            const to = idx + delta
            if (idx < 0 || to < 0 || to >= list.length) return i
            ;[list[idx], list[to]] = [list[to], list[idx]]
            return { ...i, checklist: list }
          }),
        }),
      removeChecklistItem: (itemId, entryId) =>
        set({
          items: get().items.map((i) =>
            i.id === itemId ? { ...i, checklist: (i.checklist ?? []).filter((c) => c.id !== entryId) } : i,
          ),
        }),

      /** Split a leaf cell into a container of the given orientation, with N sub-lanes. */
      splitLane: (laneId, orientation, count = 2) => {
        const state = get()
        const lane = state.lanes.find((l) => l.id === laneId)
        if (!lane || !isLeaf(state.lanes, laneId)) return
        const children: Lane[] = Array.from({ length: count }, (_, i) => ({
          id: uid(),
          boardId: lane.boardId,
          parentId: laneId,
          order: i,
          name: orientation === 'rows' ? `Row ${i + 1}` : `Column ${i + 1}`,
          workflow: lane.workflow,
        }))
        const placements = state.placements.map((p) => (p.laneId === laneId ? toLane(state.placements, p, children[0].id) : p))
        set({
          lanes: state.lanes.map((l) => (l.id === laneId ? { ...l, orientation } : l)).concat(children),
          placements,
        })
      },

      setLaneOrientation: (laneId, orientation) => {
        const state = get()
        const lane = state.lanes.find((l) => l.id === laneId)
        if (!lane || lane.parentId === null) return // never flip the board root
        set({ lanes: state.lanes.map((l) => (l.id === laneId ? { ...l, orientation } : l)) })
      },

      moveLane: (laneId, delta) => {
        const state = get()
        const lane = state.lanes.find((l) => l.id === laneId)
        if (!lane || lane.parentId === null) return // the board root has no siblings
        const parent = state.lanes.find((l) => l.id === lane.parentId)
        if (!parent || parent.parentId === null) return // top-level columns are fixed in place
        const siblings = childrenOf(state.lanes, lane.parentId)
        const idx = siblings.findIndex((s) => s.id === laneId)
        const j = idx + delta
        if (idx < 0 || j < 0 || j >= siblings.length) return
        const reordered = [...siblings]
        const [moved] = reordered.splice(idx, 1)
        reordered.splice(j, 0, moved)
        // Renumber siblings so order stays a clean 0..n-1 sequence.
        const orderById = new Map(reordered.map((s, i) => [s.id, i]))
        set({ lanes: state.lanes.map((l) => (orderById.has(l.id) ? { ...l, order: orderById.get(l.id)! } : l)) })
      },

      addLane: (parentId) => {
        const state = get()
        const parent = state.lanes.find((l) => l.id === parentId)
        if (!parent) return
        // The top-level columns are fixed (three typed stages); refine by splitting.
        if (parent.parentId === null) return
        const order = childrenOf(state.lanes, parentId).length
        const name = parent.orientation === 'rows' ? `Row ${order + 1}` : `Column ${order + 1}`
        const child: Lane = { id: uid(), boardId: parent.boardId, parentId, order, name, workflow: parent.workflow }
        const lanes = state.lanes.map((l) => (l.id === parentId ? { ...l, orientation: parent.orientation ?? 'columns' } : l))
        set({ lanes: lanes.concat([child]) })
      },

      insertLaneAfter: (laneId) => {
        const state = get()
        const lane = state.lanes.find((l) => l.id === laneId)
        if (!lane || lane.parentId === null) return
        const parent = state.lanes.find((l) => l.id === lane.parentId)
        // Top-level columns are fixed in place; insert only among sub-lanes.
        if (!parent || parent.parentId === null) return
        const siblings = childrenOf(state.lanes, lane.parentId)
        const idx = siblings.findIndex((s) => s.id === laneId)
        const orientation = parent.orientation ?? 'columns'
        const child: Lane = {
          id: uid(),
          boardId: lane.boardId,
          parentId: lane.parentId,
          order: idx + 1,
          name: orientation === 'rows' ? `Row ${siblings.length + 1}` : `Column ${siblings.length + 1}`,
          workflow: lane.workflow,
        }
        const lanes = state.lanes.map((l) =>
          l.parentId === lane.parentId && l.order > idx ? { ...l, order: l.order + 1 } : l,
        )
        set({ lanes: [...lanes, child] })
      },

      duplicateLane: (laneId) => {
        const state = get()
        const src = state.lanes.find((l) => l.id === laneId)
        if (!src || src.parentId === null) return
        const parent = state.lanes.find((l) => l.id === src.parentId)
        if (!parent || parent.parentId === null) return // don't clone top-level columns
        const ids = subtreeIds(state.lanes, laneId)
        const idMap = new Map(ids.map((id) => [id, uid()]))
        const siblings = childrenOf(state.lanes, src.parentId)
        const idx = siblings.findIndex((s) => s.id === laneId)
        const clones: Lane[] = ids.map((id) => {
          const l = state.lanes.find((x) => x.id === id)!
          const clone: Lane = {
            ...l,
            id: idMap.get(id)!,
            parentId: l.parentId && idMap.has(l.parentId) ? idMap.get(l.parentId)! : l.parentId,
          }
          if (id === laneId) {
            clone.name = `${l.name} copy`
            clone.order = idx + 1
          }
          return clone
        })
        const lanes = state.lanes.map((l) =>
          l.parentId === src.parentId && l.order > idx ? { ...l, order: l.order + 1 } : l,
        )
        set({ lanes: [...lanes, ...clones] })
      },

      toggleCollapse: (laneId) =>
        set({ collapsedLanes: { ...get().collapsedLanes, [laneId]: !get().collapsedLanes[laneId] } }),

      removeLane: (laneId) => {
        const state = get()
        const lane = state.lanes.find((l) => l.id === laneId)
        if (!lane || lane.parentId === null) return
        const parent = state.lanes.find((l) => l.id === lane.parentId)
        if (parent?.parentId === null) return // top-level columns are fixed; refine, don't delete
        const parentId = lane.parentId
        const ids = new Set(subtreeIds(state.lanes, laneId))
        let lanes = state.lanes.filter((l) => !ids.has(l.id))

        // A split left with one child is not a split, so the child folds away too and the parent
        // becomes the cell its cards live in. Without this the parent still has a child, so the
        // surface looks for cards in the parent's *own* cell, finds none, and everything that was
        // in the surviving cell goes invisible — which reads as losing it.
        const left = childrenOf(lanes, parentId)
        const folded = left.length === 1 ? new Set(subtreeIds(lanes, left[0].id)) : null
        if (folded) lanes = lanes.filter((l) => !folded.has(l.id))

        // Where the cards go: the first surviving leaf under the parent, or the parent itself
        // once it has become one. Never nowhere — a delete must not be able to discard a card.
        const target = leavesUnder(lanes, parentId)[0]?.id ?? parentId
        set({
          lanes,
          placements: state.placements.map((p) =>
            ids.has(p.laneId) || folded?.has(p.laneId) ? toLane(state.placements, p, target) : p,
          ),
        })
      },


      renameLane: (laneId, name) => set({ lanes: get().lanes.map((l) => (l.id === laneId ? { ...l, name } : l)) }),
      setLaneWip: (laneId, wipLimit) =>
        set({ lanes: get().lanes.map((l) => (l.id === laneId ? { ...l, wipLimit } : l)) }),
      setLaneDescription: (laneId, description) =>
        set({ lanes: get().lanes.map((l) => (l.id === laneId ? { ...l, description } : l)) }),

      setParent: (childId, parentId) => {
        const state = get()
        // A parent is always an initiative. A card rolls up to an outcome, and an initiative's
        // parent is another initiative, so connections run one way and the type can only fall
        // going down the tree — which means nothing can ever be its own ancestor. That is a
        // stronger answer than refusing a subtree, and a simpler one: a loop is not something to
        // detect, it is something that cannot be written down.
        if (parentId && !isInitiativeItem(state.items.find((i) => i.id === parentId), state.issueTypes)) return
        let edges = state.edges.filter((e) => !(e.kind === 'decomposition' && e.to === childId))
        if (parentId && parentId !== childId) edges = [...edges, { id: uid(), kind: 'decomposition', from: parentId, to: childId }]
        set({ edges })
      },

      addChecklistEntry: (itemId, text) => {
        const value = text.trim()
        if (!value) return
        set({ items: get().items.map((i) => (i.id === itemId ? withChecklistEntry(i, { id: uid(), text: value, done: false }) : i)) })
      },

      setChecklistEntryText: (itemId, entryId, text) => {
        set({ items: get().items.map((i) => (i.id === itemId ? withChecklistEntryText(i, entryId, text) : i)) })
      },

      toggleChecklistEntry: (itemId, entryId) => {
        set({ items: get().items.map((i) => (i.id === itemId ? withToggledChecklistEntry(i, entryId) : i)) })
      },

      removeChecklistEntry: (itemId, entryId) => {
        set({ items: get().items.map((i) => (i.id === itemId ? withoutChecklistEntry(i, entryId) : i)) })
      },

      linkTeamInitiative: (parentId, boardId, title) => {
        const state = get()
        const lane = leafLanes(state.lanes, boardId, 'initiatives')[0]
        const typeId = state.issueTypes.find((t) => t.name === 'Initiative')?.id ?? state.issueTypes[0]?.id
        if (!lane || !typeId) return
        const item: Item = { id: uid(), title, typeId, createdAt: Date.now() }
        set({
          items: [...state.items, item],
          placements: [...state.placements, { id: uid(), boardId, itemId: item.id, laneId: lane.id, laneEnteredAt: Date.now() }],
          edges: [...state.edges, { id: uid(), kind: 'decomposition', from: parentId, to: item.id }],
        })
      },

      addDependency: (dependencyId, dependentId, reason) => {
        if (dependencyId === dependentId) return
        const state = get()
        if (state.links.some((l) => l.from === dependencyId && l.to === dependentId)) return
        set({ links: [...state.links, { id: uid(), from: dependencyId, to: dependentId, reason }] })
      },

      setAttribution: (itemId, objectiveId, on) => {
        const state = get()
        // OKRs attach to strategic initiatives only — an Initiative placed on a
        // portfolio-band board. Everything below inherits through the decomposition.
        if (on && !isStrategicInitiative(itemId, state)) return
        const existing = state.edges.find((e) => e.kind === 'attribution' && e.from === objectiveId && e.to === itemId)
        if (on && !existing) set({ edges: [...state.edges, { id: uid(), kind: 'attribution', from: objectiveId, to: itemId }] })
        else if (!on && existing) set({ edges: state.edges.filter((e) => e.id !== existing.id) })
      },

      blockItem: (itemId, reason) => {
        const note = reason?.trim() || undefined
        set({
          items: get().items.map((i) =>
            i.id === itemId
              ? { ...i, blocked: true, blockedReason: note, log: [...(i.log ?? []), logEntry('blocked', note)] }
              : i,
          ),
        })
      },

      unblockItem: (itemId, note) => {
        const text = note?.trim() || undefined
        set({
          items: get().items.map((i) =>
            i.id === itemId
              ? { ...i, blocked: false, blockedReason: undefined, log: [...(i.log ?? []), logEntry('unblocked', text)] }
              : i,
          ),
        })
      },

      addLogNote: (itemId, note) =>
        set({
          items: get().items.map((i) => (i.id === itemId ? { ...i, log: [...(i.log ?? []), logEntry('noted', note)] } : i)),
        }),

      archiveItem: (itemId) => {
        const state = get()
        const at = Date.now()
        const ids = new Set([itemId, ...descendants(itemId, state)])
        set({
          items: state.items.map((i) =>
            ids.has(i.id) && !i.archived
              ? { ...i, archived: true, archivedAt: at, log: [...(i.log ?? []), logEntry('archived')] }
              : i,
          ),
        })
      },

      unarchiveItem: (itemId) => {
        const state = get()
        const ids = new Set([itemId, ...descendants(itemId, state)])
        set({
          items: state.items.map((i) =>
            ids.has(i.id) && i.archived
              ? { ...i, archived: false, archivedAt: undefined, log: [...(i.log ?? []), logEntry('unarchived')] }
              : i,
          ),
        })
      },

      archiveDoneOnBoard: (boardId) => {
        const state = get()
        // Items placed in a Done lane on this board (via one of their placements).
        const doneIds = [
          ...new Set(
            state.placements
              .filter((p) => p.boardId === boardId && effectiveStage(state.lanes, p.laneId) === 'done')
              .map((p) => p.itemId)
              .filter((id) => {
                const it = state.items.find((i) => i.id === id)
                return it && !it.archived
              }),
          ),
        ]
        const ids = subtreeRoots(doneIds, state)
        if (ids.size === 0) return
        const at = Date.now()
        set({
          items: state.items.map((i) =>
            ids.has(i.id) && !i.archived
              ? { ...i, archived: true, archivedAt: at, log: [...(i.log ?? []), logEntry('archived')] }
              : i,
          ),
        })
      },

      setAutoArchiveDays: (days) => set({ autoArchiveDays: days && days > 0 ? days : undefined }),

      runAutoArchive: () => {
        const state = get()
        const days = state.autoArchiveDays ?? 0
        if (days <= 0) return
        const cutoff = Date.now() - days * 86_400_000
        const candidates = state.items.filter(
          (i) => !i.archived && statusOf(i.id, state).resolved && (i.resolvedAt ?? i.createdAt) <= cutoff,
        )
        const ids = subtreeRoots(candidates.map((i) => i.id), state)
        if (ids.size === 0) return
        const at = Date.now()
        set({
          items: state.items.map((i) =>
            ids.has(i.id) && !i.archived
              ? { ...i, archived: true, archivedAt: at, log: [...(i.log ?? []), logEntry('archived')] }
              : i,
          ),
        })
      },

      deleteItem: (itemId) => {
        const state = get()
        set({
          items: state.items.filter((i) => i.id !== itemId),
          placements: state.placements.filter((p) => p.itemId !== itemId),
          // Drop the card's parent edge AND its children's edges (children lose their parent);
          // plus any attribution to the card. Links in either direction are removed too.
          edges: state.edges.filter(
            (e) =>
              !(e.kind === 'decomposition' && (e.from === itemId || e.to === itemId)) &&
              !(e.kind === 'attribution' && e.to === itemId),
          ),
          links: state.links.filter((l) => l.from !== itemId && l.to !== itemId),
          selectedItemId: state.selectedItemId === itemId ? null : state.selectedItemId,
        })
      },
    }),
    {
      name: 'flowline-state-v3',
      version: 28,
      // Reshaped board model; older state is reseeded (see migratePersisted).
      migrate: (persisted, version) => migratePersisted(persisted, version) as Store,
      // While editing, persist the pre-edit (draft) design so a reload reverts to it.
      partialize: persistedSlice,
    },
  ),
)
