import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { addLaneNode, defaultColumns, duplicateLaneNode, effectiveStage, insertLaneAfterNode, isLeaf, lanePath, leafLanes, moveLaneNode, nextRank, placementsInOrder, removeLaneNodes, setLaneOrientationNode, splitLaneNodes, STAGES, STAGE_LABELS } from '@/domain/lanes'
import { moveCard as moveCardOperation, moveInitiative as moveInitiativeOperation, moveSentence, movedEntry } from '@/domain/move'
import { boardTags, canLinkBoard, canRetype, canSetParent, defaultDropLane, duplicateBoard as copyBoardDesign, initiativeTypeById, initiativeTypeId, initiativesCarrying, isInitiativeItem, isStrategicInitiative, itemsCarryingTag, lanesFromTemplate, NONE_TYPE, NONE_TYPE_ID, placementOn, templateFromBoard } from '@/domain/board'
import { canPlaceInSection, decompositionParent, descendants, statusOf, uncommittedBelow, withChecklistEntry, withChecklistEntryText, withToggledChecklistEntry, withoutChecklistEntry } from '@/domain/derive'
import { hasActiveFilters, NO_FILTERS, type CardFilters, type SavedFilter } from '@/domain/filters'
import { STRESS_PREFIX, stressBoard } from '@/domain/stressBoard'
import { createSeed, BUILT_IN_TEMPLATES } from '@/domain/seed'
import { workspaceVocabulary } from '@/domain/demo'
import { quarantineUnreadable } from '@/lib/quarantine'
import { announce } from '@/lib/announce'
import { chooseRepository } from '@/lib/repository'
import { queue, newKey, type QueuedWrite } from '@/lib/queue'
import type { CommitAnswer } from '@/lib/repository'
import { useAuth } from '@/lib/auth'
import { isFrozen, useSync } from '@/lib/sync'
import { onLiveItem, startLive, stopLive } from '@/lib/live'
import { reflectAccount } from '@/lib/workspaceSync'
import { uid as makeUid } from '@/lib/utils'
import type { ViewName } from '@/lib/url'
import type { Board, BoardBand, BoardTemplate, Edge, FlowState, InitiativeType, IssueType, Item, ItemLogEntry, KeyResult, Lane, Objective, Placement, SplitOrientation, Tag, TemplateLane, User } from '@/domain/types'

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
  /**
   * The place the card was dropped at, when the gesture had one. A drop is a move *and* a
   * position, and the prompt interrupts the gesture: held without this, answering it later
   * landed the card at the end of the lane rather than where it was put.
   */
  index?: number
}

/** The open card context menu, anchored at a viewport position. */
export interface CardMenuState {
  itemId: string
  x: number
  y: number
}

/** Whose browser this is: My work reads it. Persisted with the workspace like the users it points into. */
interface WorkspaceIdentity {
  meUserId?: string
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
  showAdmin: boolean
  /** The My work drawer open — a left-side panel over whatever surface is in front. */
  showMyWork: boolean
  /** Show the flow metrics view for the current board — derived, read-only. */
  showMetrics: boolean
  /**
   * Items opened lately, newest first — the command palette's empty state. View state, and
   * deliberately not persisted: it is about this session, not about the work.
   */
  recentItemIds: string[]
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
   * An external dependency (from the boundary workflow) being inspected; the local
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
  /**
   * The initiative card a card in the air would become a child of. View state, and the one piece
   * of the drag that has to be shared: the card is lifted by the surface it came from and dropped
   * on a card another surface drew, so neither of them can hold it alone.
   */
  dropTargetId: string | null
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
  /** Go to a view by name — the URL's names, and the one door for all seven. */
  setView: (view: ViewName) => void
  /** Open/close the board settings dialog. */
  toggleBoardSettings: () => void
  setDashboard: (v: boolean) => void
  setTimeline: (v: boolean) => void
  setArchive: (v: boolean) => void
  /** The board's flow metrics — derived from movement history, never stored. */
  setMetrics: (v: boolean) => void
  toggleBoards: () => void
  setBoards: (v: boolean) => void
  /** The workspace's own administration: copies and storage. Not a board surface. */
  setAdmin: (v: boolean) => void
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
  /** The initiative a card in the air would become a child of — see `dropTargetId`. */
  setDropTarget: (dropTargetId: string | null) => void

  addObjective: (title: string, period: string) => void
  updateObjective: (id: string, patch: Partial<Objective>) => void
  removeObjective: (id: string) => void
  addKeyResult: (objectiveId: string, title: string) => void
  updateKeyResult: (id: string, patch: Partial<KeyResult>) => void
  removeKeyResult: (id: string) => void
  /** Link a board under another (aggregation). Refused if it would create a cycle. */
  addLinkedBoard: (parentId: string, childId: string) => void
  removeLinkedBoard: (parentId: string, childId: string) => void
  /** Open or close the My work drawer. It does not change the surface in front. */
  setMyWork: (v: boolean) => void
  /** Whose work My work shows (undefined until the person picks themselves). */
  setUser: (id: string | undefined) => void
  resetDemo: () => void
  /**
   * Replace the workspace with an imported one; validated at the picker, trusted, migrated and
   * whitelisted here. A file with no boards is refused unless the caller says it means it: an
   * account's empty workspace is a real answer, and a file with nothing in it is not a workspace.
   */
  importWorkspace: (state: Record<string, unknown>, version: number, options?: { allowEmpty?: boolean }) => void
  /** Begin from an empty workspace, with the app's own vocabulary and nothing else. */
  startEmptyWorkspace: () => void

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
   * capture a richer design. Answers the new template's id so the caller can open it.
   */
  newBoardTemplate: (name: string, band: BoardBand) => string | undefined
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
  /** Write the board's own description. */
  setBoardDescription: (id: string, description: string) => void
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
  /**
   * Give an initiative its kind — or `undefined` for None. Refused for anything that is not an
   * initiative, and for an id no board defines: the rule is the model's, not the panel's.
   */
  setInitiativeKind: (itemId: string, kindId: string | undefined) => void
  /** The same for a whole selection — a kind is set on whatever in it is an initiative. */
  setItemsKind: (itemIds: string[], kindId: string | undefined) => void
  /** A board's own vocabulary for its initiatives. None is not an entry here — it is absence. */
  addInitiativeType: (boardId: string, name: string, color: string) => void
  updateInitiativeType: (boardId: string, id: string, patch: Partial<InitiativeType>) => void
  /**
   * Remove a kind. **Refused while any initiative still carries it** — refused rather than
   * corrected, never a silent blanking; the settings panel says how many carry it and disables
   * the control. (The opposite of `removeIssueType`, which filters and leaves items pointing at
   * nothing.)
   */
  removeInitiativeType: (boardId: string, id: string) => void
  /**
   * Add or remove one of a board's tags on an item — a card or an initiative alike. Adding is
   * refused for a tag that board does not define; removing is always allowed, so an item can
   * always be cleared even if its tag is long gone.
   */
  toggleItemTag: (boardId: string, itemId: string, tagId: string) => void
  /** A board's own tags, like its kinds and for the same reason. */
  addTag: (boardId: string, name: string, color: string) => string | undefined
  updateTag: (boardId: string, id: string, patch: Partial<Tag>) => void
  /** Refused while any item still carries it, and the settings say how many do. */
  removeTag: (boardId: string, id: string) => void
  /**
   * Build the load-test board (see `stressBoard`) and open it. Asking again *replaces* it, so the
   * size can be changed without piling boards up, and everything it made is recognised by the
   * `stress-` prefix it carries — a real board is never touched, and Reset removes it with
   * everything else.
   */
  addStressBoard: (cards: number) => void
  /**
   * Copy a card: the same shape, none of the original's commitments. The copy carries the
   * title, type, description and a fresh checklist (new entry ids, nothing ticked) —
   * never assignees, dates, priority, blocking, resolvedAt, a parent or links.
   *
   * A copy lands where the original sits, so it needs a cell: copying an item that has no
   * placement on the current board creates nothing and answers `undefined`, and the caller
   * says why rather than the copy landing somewhere nobody chose.
   */
  duplicateCard: (itemId: string) => string | undefined
  /**
   * Move a card between lanes — the one seam a board's WIP policy can intercept, because every
   * path into a lane goes through it: a drop, the card menu, the bulk bar.
   *
   * It answers whether the card is now in `laneId`. `true` when it moved, and when it was
   * already there — nothing to do, but that is the caller's business and not the policy's.
   * `false` when the move did not happen: a `block` limit refused it, or a `justify` limit held
   * it until a reason arrives (`wipPrompt`). A caller that also has a position to write must
   * write nothing on `false` — a drop that wrote it anyway landed the card the policy had just
   * stopped, with no reason recorded and nothing to answer.
   *
   * `opts.index` is the place the gesture offered. It is read only when the move is held, so
   * that answering the prompt lands the card where it was dropped rather than at the end.
   */
  moveCard: (
    itemId: string,
    boardId: string,
    laneId: string,
    opts?: { reason?: string; index?: number },
  ) => boolean
  /**
   * Move an initiative between the cells of its section. The section itself is
   * derived from the work below, so a move that would cross it is refused — only
   * the arrangement within a section is the user's to set.
   */
  moveInitiative: (itemId: string, boardId: string, laneId: string) => void
  /** Land an initiative at a position in a cell — a rank within the cell, like a card's. */
  moveInitiativeToIndex: (itemId: string, boardId: string, laneId: string, index: number) => void
  /** Move a card one place up or down within its lane (delta -1 = up). */
  reorderCard: (itemId: string, delta: number) => void
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
  /**
   * The same for a whole selection, in one write. `false` when the rule refuses any of it — and
   * nothing is written then, so a refused gesture changes no item.
   */
  setParents: (itemIds: string[], parentId: string) => boolean
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
  /** Remove a dependency link. Both directions are in the dependent's own history. */
  removeDependency: (dependencyId: string, dependentId: string) => void
  setAttribution: (itemId: string, objectiveId: string, on: boolean) => void

  /** Explicitly block/unblock an item — a status independent of any link. */
  blockItem: (itemId: string, reason?: string) => void
  unblockItem: (itemId: string, note?: string) => void
  addLogNote: (itemId: string, note: string) => void
  /**
   * Record a free-text edit once the person has finished typing it. The panel calls this on
   * blur: a title is typed a letter at a time, and a history of every keystroke is not a
   * history. `before` is what the field held when it was focused.
   */
  logTextEdit: (itemId: string, field: 'title' | 'description', before: string) => void

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

export type Store = FlowState & WorkspaceIdentity & ViewState & Actions

/**
 * Is the board itself the surface in front? Every other view — dashboard, timeline, archive,
 * objectives, boards — shows work without the board's cells around it, so an action
 * that needs a cell (duplicating a card, which lands where the original sits) has nothing to
 * act on there. One definition, read by the surfaces that ask.
 */
export const isBoardSurface = (
  s: Pick<
    ViewState,
    'showDashboard' | 'showTimeline' | 'showArchive' | 'showObjectives' | 'showBoards' | 'showMetrics' | 'showAdmin'
  >,
): boolean =>
  !s.showDashboard &&
  !s.showTimeline &&
  !s.showArchive &&
  !s.showObjectives &&
  !s.showBoards &&
  !s.showMetrics &&
  !s.showAdmin

const uid = makeUid

/**
 * A move said out loud: the card's title and the lane's path, never an id — a message is read,
 * and an id read aloud is noise. Used by the announcer at the move seam, so the pointer, the menu,
 * the keyboard and the bulk bar all speak the same sentence.
 */
/**
 * Committed work over uncommitted work is a warning the app raises rather than a rule it enforces
 * (`uncommittedBelow`), and a move is what usually raises it. Read before and after, so only the
 * raising is announced — a warning that was already there is not news.
 */
function raisedWarning(before: number, after: number): string {
  if (after <= before) return ''
  return ` Warning: ${after} item${after === 1 ? '' : 's'} below ${after === 1 ? 'is' : 'are'} still in Backlog.`
}

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

/**
 * The one write path for an item's own content.
 *
 * Every content change — a field, a tag, a parent, a log entry — goes through here, so a change
 * has one shape: the items whose objects changed get a new revision, and nothing else moves. A
 * lock and a sync will both want to stand here later, and neither should have to find twenty call
 * sites to do it.
 *
 * Placements are deliberately not routed here. A move writes the item's log and its Done stamp,
 * but it is arrangement rather than content: a revision that changed every time a card was
 * dragged would tell a lock nothing useful, and would make a card someone is editing impossible
 * to rearrange.
 */
function writeItems(state: Pick<Store, 'items'>, change: (item: Item) => Item): Item[] {
  const base = state.items
  const next = base.map(change)
  const sent: Array<{ item: Item; baseRev: number }> = []

  // A map hands back the same object for everything it left alone, so "what changed" is a
  // reference comparison — exact, and cheap.
  const result = next.map((item, index) => {
    if (item === base[index]) return item
    const updated = { ...item, rev: (base[index].rev ?? 0) + 1 }
    sent.push({ item: updated, baseRev: base[index].rev ?? 0 })
    return updated
  })

  // Optimistic by construction: the change is in the store before anything is sent, so typing never
  // waits on a network. The answer arrives later, and it is the version that is kept.
  if (sent.length) enqueue(sent)
  return result
}

/**
 * A new item, on its way to the server as well as into the store.
 *
 * Making a card is a write like any other, and the server hears about one the same way whether a
 * card was typed into or created: with the item and the revision behind it — which, for a card
 * nobody has seen before, is the first one. Without this a card made on an instance lived only in
 * the browser that made it, while the board it sat on went to the server.
 */
function createdItem(item: Item): Item {
  const first: Item = { ...item, rev: 1 }
  enqueue([{ item: first, baseRev: 0 }])
  return first
}

/**
 * One write at a time, in the order the changes were made.
 *
 * Typing is many changes, and each is based on the revision the one before it produced. Firing them
 * at once would let the second overtake the first and be refused by the server — a conflict with
 * ourselves, which no person could act on. The chain is the smallest thing that cannot happen to.
 */
let sending: Promise<void> = Promise.resolve()

function enqueue(sent: Array<{ item: Item; baseRev: number }>): void {
  // A card's write is in flight until the server answers it. The design sync waits on this count,
  // because a placement sent before its card is known is skipped by the server — and a skipped
  // placement is how an item ends up belonging to no board.
  useSync.setState((state) => ({ pending: state.pending + sent.length }))
  sending = sending
    .then(() => sendChanges(sent))
    .catch(() => {
      // `sendChanges` reports per item; a throw here is the chain's own, and it must not stop the next.
    })
    .finally(() => {
      useSync.setState((state) => ({ pending: Math.max(0, state.pending - sent.length) }))
    })
}

/**
 * Send accepted changes, and keep whichever version comes back.
 *
 * A refusal is not an error to swallow: the server's newer card is adopted (its version is the
 * truth) and the refusal is published, so the app can say that this edit did not land rather than
 * pretend it did. A server that cannot be reached says so once, and the local change stands until
 * the queue in task 118.4 can hold it.
 */
async function sendChanges(sent: Array<{ item: Item; baseRev: number }>): Promise<void> {
  for (const { item, baseRev } of sent) {
    // A card whose write was refused is frozen: the local change stands, but nothing more travels
    // for it until the person copies the words or takes the server's version.
    if (isFrozen(item.id)) continue

    const key = newKey()

    // While the connection is known to be down, a change is held rather than thrown at a socket
    // that will not answer. The key is made now so the retry is the same change, not a new one.
    if (useSync.getState().unreachable) {
      hold({ key, item, baseRev, at: Date.now() })
      continue
    }

    const answer = await repository.commitItem(item, baseRev, key)

    if (answer.kind === 'unreachable') {
      hold({ key, item, baseRev, at: Date.now() })
      continue
    }

    settle(answer, item, item.rev ?? 0)
  }
}

/** Put an accepted change where a connection can find it later. */
function hold(entry: QueuedWrite): void {
  if (!queue.add(entry)) useSync.getState().full()
  useSync.getState().setWaiting(queue.size())
  scheduleRetry()
}

/** Take the server's answer: it is the version that is kept, or the refusal that is named. */
type Settled = Exclude<CommitAnswer, { kind: 'unreachable' }>

function settle(answer: Settled, item: Item, sentRev: number): void {
  if (answer.kind === 'refused') {
    // The words stay where they were typed. The server's version is *offered* by the drawer, not
    // written over what the person was in the middle of saying — losing that is the worst outcome,
    // and a refusal replayed is the lost update the revision exists to prevent.
    useSync.getState().refuse({
      id: item.id,
      title: item.title,
      at: Date.now(),
      reason: answer.reason,
      ...(answer.holderName ? { holderName: answer.holderName } : {}),
      ...(answer.item ? { server: answer.item } : {}),
    })
    return
  }

  useSync.getState().resolve(item.id)

  // The server's version wins unless this tab has already moved past what was sent — the one case
  // where keeping the local one is not a second truth but a newer one.
  const server = answer.item
  if (server && (server.rev ?? 0) !== sentRev) {
    useStore.setState((state) => ({
      items: state.items.map((local) =>
        local.id === server.id && (local.rev ?? 0) === sentRev ? server : local,
      ),
    }))
  }
}

let flushing = false
/** How long to wait before trying a held queue again. `online` fires at once when it can. */
const RETRY_MS = 5_000
let retry: ReturnType<typeof setTimeout> | undefined

/**
 * A retry a few seconds from now.
 *
 * `online` is the timely signal, but it is a signal about a network interface, not about a server
 * that went away and came back. Without this, a queue whose flush met a 502 would wait for a person
 * to reload — which R4 says it must not.
 */
function scheduleRetry(): void {
  if (retry !== undefined) return
  retry = setTimeout(() => {
    retry = undefined
    void flushQueue()
  }, RETRY_MS)
}

/**
 * Send what was held, in the order it was made, once.
 *
 * Flushing stops at the first answer that does not arrive, so the order is never rearranged around
 * a gap. An entry is removed only when the server has answered it — applied or refused — because a
 * refusal is an answer and must not be retried.
 */
export async function flushQueue(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    for (const entry of queue.all()) {
      const answer = await repository.commitItem(entry.item, entry.baseRev, entry.key)
      if (answer.kind === 'unreachable') {
        useSync.getState().unreachableNow()
        scheduleRetry()
        break
      }

      useSync.getState().reachable()
      queue.remove(entry.key)
      settle(answer, entry.item, entry.item.rev ?? 0)
    }
  } finally {
    flushing = false
    const left = queue.size()
    useSync.getState().setWaiting(left)
    if (left === 0 && retry !== undefined) {
      clearTimeout(retry)
      retry = undefined
    }
  }
}

/** The first lane (target or ancestor) whose WIP limit a move would exceed. */
/** Find a user by full name (case-insensitive), or create one. */
function ensureUser(users: User[], name: string): { id: string; users: User[] } {
  const trimmed = name.trim()
  const existing = users.find((u) => u.name.toLowerCase() === trimmed.toLowerCase())
  if (existing) return { id: existing.id, users }
  const id = uid()
  return { id, users: [...users, { id, name: trimmed }] }
}

/**
 * Whose changes these are: `meUserId`, where a plain helper can see it.
 *
 * The store keeps the identity; this is the same value kept in step by a subscription, so a log
 * entry is stamped at the moment it is written rather than at twenty call sites — and cannot fall
 * out of step with the store, which a copy set at each door could. Absent when nobody has said who
 * they are, which is the honest answer and the one the drawer shows as a blank.
 */
let currentAuthor: string | undefined

/**
 * The creator, at the moment an item is made.
 *
 * The same source the log's `by` comes from — this browser's person — and absent when nobody has said
 * who they are, which is the honest answer for a workspace that predates the record. A field of its
 * own rather than only the log entry, because the creator is a fact about the item that the API, an
 * agent and the panel all read without walking a history.
 */
const creator = (): { createdById?: string } => (currentAuthor ? { createdById: currentAuthor } : {})

const logEntry = (kind: ItemLogEntry['kind'], note?: string): ItemLogEntry => ({
  id: uid(),
  at: Date.now(),
  kind,
  ...(note ? { note } : {}),
  ...(currentAuthor ? { by: currentAuthor } : {}),
})

/**
 * The history entry a move leaves, with this store's clock and author.
 *
 * The shape is the domain's (`movedEntry`): a lane edit rehomes cards too, and it must say so in the
 * same words a drag does — otherwise the same event would read two ways depending on which code
 * noticed it.
 */
const moved = (lanes: Lane[], boardId: string, from: string | undefined, to: string, why?: string) =>
  movedEntry(lanes, boardId, from, to, { id: uid, at: Date.now(), by: currentAuthor, why })

/**
 * The field edits worth keeping in a history: the decisions — a retype, a
 * reprioritisation, a re-date, a reassignment. Free text is not here, because it arrives one
 * keystroke at a time (see `logTextEdit`), and neither are `blocked`/`resolvedAt`, which have
 * their own events and their own clocks.
 */
const FIELD_LOG: { key: keyof Item; label: string }[] = [
  { key: 'typeId', label: 'type' },
  { key: 'priority', label: 'priority' },
  { key: 'targetStartDate', label: 'target start' },
  { key: 'targetEndDate', label: 'target end' },
  { key: 'assignees', label: 'assignees' },
]

const clip = (text: string) => (text.length > 48 ? `${text.slice(0, 47)}…` : text)

/** The entries for the fields this patch actually changed, in the order they are listed above. */
function fieldEditEntries(before: Item, after: Item, state: Store): ItemLogEntry[] {
  const entries: ItemLogEntry[] = []
  for (const { key, label } of FIELD_LOG) {
    const from = before[key]
    const to = after[key]
    if (JSON.stringify(from) === JSON.stringify(to)) continue
    const name = (value: unknown): string => {
      // People read as people, or as nobody — the empty list and the missing field are the
      // same state and must not read as two.
      if (key === 'assignees') {
        const ids = (value as string[] | undefined) ?? []
        return ids.map((id) => state.users.find((u) => u.id === id)?.name ?? id).join(', ') || 'nobody'
      }
      if (value === undefined || value === null || value === '') return 'none'
      if (key === 'typeId') return state.issueTypes.find((t) => t.id === value)?.name ?? String(value)
      return String(value)
    }
    entries.push(logEntry('edited', `${label}: ${name(from)} → ${name(to)}`))
  }
  return entries
}

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
  // The store's fallback is the board. The app's home is the workspace home, applied from the URL
  // before the first paint (`useUrl`), so a link that names a board still opens that board without
  // loading the home screen first.
  showBoards: false, showAdmin: false,
  showMyWork: false,
  showMetrics: false,
  recentItemIds: [],
  collapsedLanes: {},
  showFilters: false,
  filters: NO_FILTERS,
  savedFilters: [],
  boundaryId: null,
  parentPickId: null,
  childPickId: null,
  multiSelect: [],
  dropTargetId: null,
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
  // None is a built-in card type, always available. State from before it existed gains it here,
  // the way the built-in templates and the reserved types arrive.
  if (Array.isArray(p.issueTypes) && !(p.issueTypes as IssueType[]).some((t) => t.name === 'None')) {
    p.issueTypes = [...(p.issueTypes as IssueType[]), NONE_TYPE]
  }
  // v28: named filter sets became persisted data — the deliberate exception to filters
  // being view state. Older state simply has none.
  if (!Array.isArray(p.savedFilters)) p.savedFilters = []
  // v31: an initiative serves one objective, not several — attribution is a choice, not a set.
  // State from before the rule keeps the first objective each initiative was mapped to; the rest
  // were choices the model no longer offers, and keeping them would make the map, the OKR view and
  // the panel disagree with the rule they now keep. (v12 dropped attributions that pointed at
  // non-initiatives for the same reason: an edge the model would refuse is not an edge.)
  if (Array.isArray(p.edges)) {
    const mapped = new Set<string>()
    p.edges = (p.edges as Edge[]).filter((e) => {
      if (e.kind !== 'attribution') return true
      if (mapped.has(e.to)) return false
      mapped.add(e.to)
      return true
    })
  }
  // v33: a key result is a statement, not a measurement — its `progress`, `target` and `current`
  // fields are gone, because a number entered by hand cannot be connected to the work. The title
  // stays: it is what the objective means, and the numbers in it are the ones a person wrote.
  if (Array.isArray(p.keyResults)) {
    p.keyResults = (p.keyResults as (KeyResult & { target?: string; current?: string; progress?: number })[]).map((k) => {
      const { target: _t, current: _c, progress: _p, ...rest } = k
      return rest
    })
  }
  // v35: an item records who created it. State written before the field has the answer in its own
  // log — the 'created' entry carries `by` whenever the person was known — so the field is filled
  // from there rather than left blank for ever. An item whose log says nothing stays without one:
  // a name invented for it would be a guess dressed as a fact.
  if (Array.isArray(p.items)) {
    p.items = (p.items as (Item & { createdById?: string })[]).map((i) => {
      if (i.createdById) return i
      const by = (i.log ?? []).find((entry) => entry.kind === 'created')?.by
      return by ? { ...i, createdById: by } : i
    })
  }
  // v34: the board stopped counting points — a card has no estimate, and progress is the number
  // of issues done over the number below. State written before that loses the field, so a number
  // the model no longer has cannot come back through a reload, an import or a backup.
  if (Array.isArray(p.items)) {
    p.items = (p.items as (Item & { size?: number })[]).map((i) => {
      if (!('size' in i)) return i
      const { size: _gone, ...rest } = i
      return rest
    })
  }
  // v29: a board carries its own description. Backfill with the empty string.
  if (Array.isArray(p.boards)) {
    p.boards = (p.boards as unknown[]).map((b) => {
      const board = b as Record<string, unknown>
      return typeof board.description === 'string' ? board : { ...board, description: '' }
    })
  }
  return p as Partial<Store>
}

/**
 * Persisted-state migration. The board model has been reshaped several times, so any
 * state older than v5 is reseeded with the current demo design.
 */
export function migratePersisted(persisted: unknown, version: number): Partial<Store> {
  // A workspace below the migration floor is never replaced by the demo: the boot check moves it
  // aside before the store is created, so reaching here is a bug — and the honest answer to a bug
  // is to refuse, not to seed over someone's work.
  if (version < MIN_MIGRATABLE_VERSION) {
    throw new Error(
      `Cannot migrate a workspace written at version ${version}; this build migrates ${MIN_MIGRATABLE_VERSION} and later.`,
    )
  }
  // v30 added meUserId (whose browser this is): optional, so an old file reads undefined
  // with nothing to backfill — migrateState passes it through untouched.
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
/** The key the workspace lives under. Named once: the boot check reads it before the store does. */
export const PERSIST_KEY = 'kanbantoolkit-state-v3'

/** Chosen once (R4): the store is given an adapter and never asks which one it was given. */
const repository = chooseRepository()
/** The current persisted workspace shape — every schema change bumps it with a migrate. */
export const PERSIST_VERSION = 35
/**
 * The oldest shape this build can migrate. Below it there is no migration, only a guess — and a
 * guess is not what a person's workspace gets.
 */
export const MIN_MIGRATABLE_VERSION = 9

export function persistedSlice(s: Store): Partial<Store> {
  const design = s.draft ?? { boards: s.boards, lanes: s.lanes, placements: s.placements, boardId: s.boardId }
  return {
    // Whose browser this is: My work reads it, like the users directory it points into.
    meUserId: s.meUserId,
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

/**
 * The keys a workspace file carries — exactly what `persistedSlice` writes. An import
 * copies only these, so an unknown key in a file (a view flag, a widget hanging off
 * state) can never leak into the store.
 */
export const WORKSPACE_KEYS = [
  'meUserId',
  'users',
  'issueTypes',
  'items',
  'edges',
  'links',
  'objectives',
  'keyResults',
  'boardTemplates',
  'autoArchiveDays',
  'savedFilters',
  'collapsedLanes',
  'boardId',
  'boards',
  'lanes',
  'placements',
] as const

// Before the store exists: anything this build cannot read is moved aside, untouched, so the demo
// that boots in its place is never mistaken for the person's workspace.
quarantineUnreadable({ build: PERSIST_VERSION, minKnown: MIN_MIGRATABLE_VERSION })

/**
 * Take another tab's workspace. Used by the tab channel; the persist write it causes is suppressed
 * by the channel, so adopting a change does not echo it back as a new one.
 */
export function adoptWorkspace(state: Record<string, unknown>): void {
  useStore.setState(state as Partial<Store>)
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...createSeed(),
      ...initialView,

      selectBoard: (boardId) =>
        // Objectives are a portfolio board's own surface, so opening another board leaves it.
        set({
          boardId,
          selectedItemId: null,
          showDashboard: false,
          showTimeline: false,
          showArchive: false,
          showBoards: false,
          showAdmin: false,
          showObjectives: false,
          boundaryId: null,
          multiSelect: [],
          cardMenu: null,
                  dropTargetId: null,
        }),
      openItem: (selectedItemId) => {
        const s = get()
        const opened = selectedItemId ? s.items.find((i) => i.id === selectedItemId) : undefined
        // The selection is what sets focus. An initiative is read for its lineage — what it rolls
        // up to and what it is made of — so opening one enters focus, wherever the click came
        // from: the initiative card itself, a card's parent chip, the drawer's hierarchy, search.
        // Opening an ordinary card ends it, and so does closing the selection.
        //
        // Re-opening the item that is already focused keeps it, so the selection that set the
        // focus does not blink it off and on again.
        const lensId =
          opened && isInitiativeItem(opened, s.issueTypes)
            ? opened.id
            : selectedItemId === s.lensId
              ? s.lensId
              : null
        set({
          selectedItemId,
          multiSelect: [],
          lensId,
          // Opening or closing a card ends the boundary lens. It is a highlight of *one*
          // relationship, and a card's own panel is the next focus — leaving the board dimmed
          // behind the drawer would say two things at once.
          boundaryId: null,
          ...(selectedItemId
            ? {
                showFilters: false,
                showMyWork: false,
                              // Opening a card is what "recently" means: the list is the order cards were
                // opened in, and re-opening one moves it back to the front rather than doubling it.
                recentItemIds: [selectedItemId, ...s.recentItemIds.filter((id) => id !== selectedItemId)].slice(0, 8),
              }
            : {}),
        })
      },
      setSearch: (search) => set({ search }),
      toggleFilters: () => {
        const show = !get().showFilters
        // One side panel at a time: opening filters dismisses an open card or My work.
        set({ showFilters: show, ...(show ? { selectedItemId: null, showMyWork: false } : {}) })
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
          tagIds: [...f.tagIds],
        }
        // Saved against the board it was built on: a preset is one board's way of reading itself.
        set({ savedFilters: [...get().savedFilters, { id: uid(), name: trimmed, boardId: get().boardId, filters }] })
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
        // A group is a different selection from the open card, so the focus the open card may have
        // set ends with it — a highlighted lineage under a bulk action would read as part of the
        // group.
        set({ multiSelect: group, selectedItemId: null, showFilters: false, lensId: null })
      },
      clearMultiSelect: () => set({ multiSelect: [] }),
      askConfirm: (confirm) => set({ confirm }),
      closeConfirm: () => set({ confirm: null }),
      confirmWipPrompt: (reason) => {
        const prompt = get().wipPrompt
        set({ wipPrompt: null })
        if (!prompt) return
        // The move the prompt held back, now allowed — carrying the place the gesture offered, so
        // a drop interrupted by the prompt still lands where it was dropped.
        const took = get().moveCard(prompt.itemId, prompt.boardId, prompt.laneId, {
          reason: reason.trim(),
          index: prompt.index,
        })
        if (!took || prompt.index === undefined) return
        get().moveCardToIndex(prompt.itemId, prompt.boardId, prompt.laneId, prompt.index)
      },
      cancelWipPrompt: () => set({ wipPrompt: null }),
      openCardMenu: (itemId, x, y) => set({ cardMenu: { itemId, x, y } }),
      closeCardMenu: () => set({ cardMenu: null }),
      // Called on every pointer move while a card is in the air, so it writes only on a change:
      // a store write re-renders the board, and the pointer moves many times per second.
      setDropTarget: (dropTargetId) => {
        if (get().dropTargetId === dropTargetId) return
        set({ dropTargetId })
      },

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
            // Each card in the group records its own move, from the cell it was in. An item
            // with no placement here is not moved by this, so it records nothing.
            const from = state.placements.find((p) => p.itemId === i.id && p.boardId === state.boardId)?.laneId
            const entry = from && from !== laneId ? { log: [...(i.log ?? []), moved(state.lanes, state.boardId, from, laneId)] } : {}
            const next = { ...i, ...entry }
            if (stage === 'done' && !next.resolvedAt) return { ...next, resolvedAt: Date.now() }
            if (stage !== 'done' && next.resolvedAt) return { ...next, resolvedAt: null }
            return next
          }),
        })
        const count = itemIds.length
        announce(`${count} card${count === 1 ? '' : 's'} moved to ${lanePath(state.lanes, laneId).join(' / ') || 'another lane'}.`)
      },

      setItemsType: (itemIds, typeId) => {
        const state = get()
        const ids = new Set(itemIds)
        // An initiative cannot be retyped into a card type, and nothing becomes an
        // initiative — see `canRetype`. Refused rather than corrected.
        set({
          items: writeItems(state, (i) =>
            ids.has(i.id) && canRetype(i, typeId, state.issueTypes) ? { ...i, typeId } : i,
          ),
        })
      },

      addAssignee: (itemId, name) => {
        const state = get()
        const { id, users } = ensureUser(state.users, name)
        set({
          users,
          items: writeItems(state, (i) =>
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
          items: writeItems(state, (i) =>
            ids.has(i.id) && !(i.assignees ?? []).includes(id) ? { ...i, assignees: [...(i.assignees ?? []), id] } : i,
          ),
        })
      },
      clearItemsAssignees: (itemIds) => {
        const ids = new Set(itemIds)
        set({ items: writeItems(get(), (i) => (ids.has(i.id) ? { ...i, assignees: undefined } : i)) })
      },
      removeItemsAssignee: (itemIds, userId) => {
        const ids = new Set(itemIds)
        set({
          items: writeItems(get(), (i) => {
            if (!ids.has(i.id)) return i
            const next = (i.assignees ?? []).filter((a) => a !== userId)
            return { ...i, assignees: next.length > 0 ? next : undefined }
          }),
        })
      },
      setItemsTargetStart: (itemIds, targetStartDate) => {
        const ids = new Set(itemIds)
        set({ items: writeItems(get(), (i) => (ids.has(i.id) ? { ...i, targetStartDate } : i)) })
      },
      setItemsTargetEnd: (itemIds, targetEndDate) => {
        const ids = new Set(itemIds)
        set({ items: writeItems(get(), (i) => (ids.has(i.id) ? { ...i, targetEndDate } : i)) })
      },
      blockItems: (itemIds, reason) => {
        const note = reason?.trim() || undefined
        const ids = new Set(itemIds)
        set({
          items: writeItems(get(), (i) =>
            ids.has(i.id) ? { ...i, blocked: true, blockedReason: note, log: [...(i.log ?? []), logEntry('blocked', note)] } : i,
          ),
        })
      },
      unblockItems: (itemIds, note) => {
        const text = note?.trim() || undefined
        const ids = new Set(itemIds)
        set({
          items: writeItems(get(), (i) =>
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
          items: writeItems(state, (i) =>
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
      setMyWork: (v) =>
        set({
          showMyWork: v,
          // The right side holds one drawer: My work takes the place of an open card or filter panel.
          ...(v ? { selectedItemId: null, showFilters: false } : {}),
        }),
      /** Whose work the My work view shows — no default: the person picks themselves. */
      setUser: (id: string | undefined) => set({ meUserId: id }),
      /**
       * OKRs are a portfolio board's own work. The view opens from that board's Strategy map and
       * nowhere else — not from a team or programme board, and not from a URL that names it there.
       * Closing it is always allowed.
       */
      setObjectives: (v) => {
        const board = get().boards.find((b) => b.id === get().boardId)
        if (v && board?.band !== 'portfolio') return
        set({ showObjectives: v, ...(v ? { showDashboard: false, showTimeline: false, showArchive: false, showBoards: false, showAdmin: false, showMetrics: false } : {}) })
      },
      // The nav is tabs, not toggles: a tab selects its view and never switches off, and the
      // Board tab is the board itself — every view flag clears, the workspace with it.
      setBoard: () => set({ showObjectives: false, showDashboard: false, showTimeline: false, showArchive: false, showBoards: false, showAdmin: false, showMetrics: false }),
      /**
       * Go to a view by name — what a URL says, and the one door for all seven.
       *
       * It delegates to the tab setters rather than clearing the flags again, so the rules about
       * which view clears what (the workspace drops a board's side panel) live in one place. The
       * names are the URL's; `viewOf` in `lib/url` is the other direction, and the round trip
       * between the two is tested.
       */
      setView: (view) => {
        const s = get()
        if (view === 'dashboard') s.setDashboard(true)
        else if (view === 'timeline') s.setTimeline(true)
        else if (view === 'flow') s.setMetrics(true)
        else if (view === 'archive') s.setArchive(true)
        else if (view === 'boards') s.setBoards(true)
        else if (view === 'admin') s.setAdmin(true)
        else if (view === 'objectives') s.setObjectives(true)
        else s.setBoard()
      },
      setDashboard: (v) => set({ showDashboard: v, ...(v ? { showObjectives: false, showTimeline: false, showArchive: false, showBoards: false, showAdmin: false, showMetrics: false } : {}) }),
      setTimeline: (v) => set({ showTimeline: v, ...(v ? { showObjectives: false, showDashboard: false, showArchive: false, showBoards: false, showAdmin: false, showMetrics: false } : {}) }),
      setArchive: (v) => set({ showArchive: v, ...(v ? { showObjectives: false, showDashboard: false, showTimeline: false, showBoards: false, showAdmin: false, showMetrics: false } : {}) }),
      // Flow is a board's own view: derived from its cards, so it sits with the board tabs and
      // clears them like every other view does.
      setMetrics: (v) =>
        set({
          showMetrics: v,
          ...(v ? { showObjectives: false, showDashboard: false, showTimeline: false, showArchive: false, showBoards: false, showAdmin: false } : {}),
        }),
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
            ? { showObjectives: false, showDashboard: false, showTimeline: false, showArchive: false, showAdmin: false, showFilters: false, selectedItemId: null }
            : {}),
        }),

      // Admin is organisation-level, like the workspace: it closes a board's side panels with it.
      setAdmin: (v) =>
        set({
          showAdmin: v,
          ...(v
            ? { showObjectives: false, showDashboard: false, showTimeline: false, showArchive: false, showBoards: false, showMetrics: false, showFilters: false, selectedItemId: null }
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
      resetDemo: () => set({ ...createSeed(), meUserId: undefined, ...initialView }),
      importWorkspace: (state, version, options) => {
        // Validation happened at the file picker; here the migrated shape is whitelisted —
        // only what the app persists comes across, so an unknown key cannot leak in — and
        // every entity the file does not mention starts empty.
        const migrated = migratePersisted(state, version) as Record<string, unknown>
        const blank: Record<string, unknown> = {
          users: [],
          issueTypes: [],
          items: [],
          edges: [],
          links: [],
          objectives: [],
          keyResults: [],
          boardTemplates: [],
          autoArchiveDays: undefined,
          savedFilters: [],
          collapsedLanes: {},
          meUserId: undefined,
          boardId: undefined,
          boards: [],
          lanes: [],
          placements: [],
        }
        const data: Record<string, unknown> = {}
        for (const k of WORKSPACE_KEYS) data[k] = k in migrated ? migrated[k] : blank[k]
        // A workspace without a vocabulary cannot hold a card — a board made in it has no type to
        // make one with. So the app's own types are merged in wherever they are missing: the issue
        // types and the board templates belong to the application rather than to anyone's data.
        //
        // Merge by name, not "only when the list is empty": a migration may have added some types
        // (Sub-task and Epic) to an otherwise empty list, and a workspace without the Initiative
        // type is one where "New initiative" cannot make anything.
        const vocabulary = workspaceVocabulary()
        const existingTypes = Array.isArray(data.issueTypes) ? (data.issueTypes as IssueType[]) : []
        const typeNames = new Set(existingTypes.map((type) => type.name))
        const typeIds = new Set(existingTypes.map((type) => type.id))
        const missingTypes = vocabulary.issueTypes
          .filter((type) => !typeNames.has(type.name))
          // An id already in use by a different-named type is not reused: the row is keyed by id.
          .map((type) => (typeIds.has(type.id) ? { ...type, id: uid() } : type))
        data.issueTypes = [...existingTypes, ...missingTypes]
        if (!Array.isArray(data.boardTemplates) || (data.boardTemplates as unknown[]).length === 0) {
          data.boardTemplates = vocabulary.boardTemplates
        }
        const boards = data.boards as { id: string }[]
        if (boards.length === 0 && !options?.allowEmpty) return
        const ids = new Set(boards.map((b) => b.id))
        // Land on the workspace's own board when it exists, else the first one written. A workspace
        // with no boards is a real answer — a fresh instance is one — and it lands on the board
        // list, which is where a board is made rather than a board with nothing in it.
        const boardId = typeof data.boardId === 'string' && ids.has(data.boardId) ? data.boardId : boards[0]?.id
        // The workspace was replaced, not the session's place in it: whatever surface the
        // person is on (a board, the workspace, the timeline) keeps showing, now fed by the
        // imported data. Focus-like state (selection, filters, drafting, settling) resets.
        const s = get()
        const view = {
          ...initialView,
          showObjectives: s.showObjectives,
          showDashboard: s.showDashboard,
          showTimeline: s.showTimeline,
          showArchive: s.showArchive,
          // An empty workspace has nothing else to show, so it says so on the board list.
          showBoards: boards.length === 0 ? true : s.showBoards,
          showMyWork: s.showMyWork,
        }
        set({ ...view, ...data, boardId } as Partial<Store>)
      },

      /**
       * A workspace with nothing in it, keeping the vocabulary every workspace has.
       *
       * This is what a fresh instance gives its first administrator: no boards, no cards, no
       * people — and the issue types and board templates the app ships, because a board with no
       * type cannot hold a card, and "empty" means "nothing of yours yet" rather than "nothing at
       * all".
       */
      startEmptyWorkspace: () => {
        const { issueTypes, boardTemplates } = workspaceVocabulary()
        set({
          ...initialView,
          showBoards: true,
          users: [],
          issueTypes,
          boardTemplates,
          boards: [],
          lanes: [],
          placements: [],
          items: [],
          edges: [],
          links: [],
          objectives: [],
          keyResults: [],
          savedFilters: [],
          collapsedLanes: {},
          meUserId: undefined,
          boardId: undefined,
        } as Partial<Store>)
      },

      addIssueType: (name, color) => {
        const label = name.trim()
        // None is built in: a second one would be two labels with one meaning.
        if (!label || label.toLowerCase() === 'none') return NONE_TYPE_ID
        const id = uid()
        set({ issueTypes: [...get().issueTypes, { id, name: label, color }] })
        return id
      },
      updateIssueType: (id, patch) => {
        // Built-in means built-in: the None label is never renamed or recoloured, and no other
        // type may take its name.
        if (id === NONE_TYPE_ID) return
        if (patch.name && patch.name.trim().toLowerCase() === 'none') return
        set({ issueTypes: get().issueTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
      },
      removeIssueType: (id) => {
        if (id === NONE_TYPE_ID) return
        set({ issueTypes: get().issueTypes.filter((t) => t.id !== id) })
      },

      addBoard: (name, band, open = true, templateId) => {
        const boardId = uid()
        const template = templateId ? get().boardTemplates.find((t) => t.id === templateId) : undefined
        // A template's band is the sensible default; an explicit band always wins.
        const resolvedBand = band ?? template?.band ?? 'team'
        const board: Board = {
          id: boardId,
          name,
          band: resolvedBand,
          description: '',
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
        if (!label) return undefined
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
        return template.id
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
      setBoardDescription: (id, description) =>
        set({ boards: get().boards.map((b) => (b.id === id ? { ...b, description } : b)) }),
      setBoardBand: (id, band) => set({ boards: get().boards.map((b) => (b.id === id ? { ...b, band } : b)) }),
      setBoardDefaultCardType: (id, defaultCardTypeId) =>
        set({ boards: get().boards.map((b) => (b.id === id ? { ...b, defaultCardTypeId } : b)) }),

      setBoardDefaultDropLane: (id, defaultDropLaneId) =>
        set({ boards: get().boards.map((b) => (b.id === id ? { ...b, defaultDropLaneId } : b)) }),

      setBoardWipEnforcement: (id, wipEnforcement) =>
        set({ boards: get().boards.map((b) => (b.id === id ? { ...b, wipEnforcement } : b)) }),

      addCard: ({ boardId, typeId, laneId, title }) => {
        const item = createdItem({ id: uid(), title, typeId, createdAt: Date.now(), ...creator(), log: [logEntry('created')] })
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

      setInitiativeKind: (itemId, kindId) => get().setItemsKind([itemId], kindId),

      setItemsKind: (itemIds, kindId) => {
        const state = get()
        // An id no board defines is refused: the panel only offers what exists, and the model does
        // not keep labels that cannot be read back.
        if (kindId !== undefined && !initiativeTypeById(state.boards, kindId)) return
        const ids = new Set(itemIds)
        set({
          items: writeItems(state, (i) =>
            // Only an initiative carries a kind. Refused per item rather than merely hidden by the
            // callers, because the rule is the model's: a card's label is its `typeId` and nothing
            // else. A mixed selection sets the kind on the initiatives in it and leaves the rest.
            ids.has(i.id) && isInitiativeItem(i, state.issueTypes) ? { ...i, initiativeTypeId: kindId } : i,
          ),
        })
      },

      addInitiativeType: (boardId, name, color) => {
        const trimmed = name.trim()
        // Nothing may be called None: None is the *absence* of a kind, so a kind with that name
        // would be a second thing meaning the same, and the picker could not tell them apart.
        if (!trimmed || /^none$/i.test(trimmed)) return
        set({
          boards: get().boards.map((b) =>
            b.id === boardId
              ? { ...b, initiativeTypes: [...(b.initiativeTypes ?? []), { id: uid(), name: trimmed, color }] }
              : b,
          ),
        })
      },

      updateInitiativeType: (boardId, id, patch) => {
        // The same guard as `addInitiativeType`: renaming a kind to None is refused too.
        const next = patch.name === undefined ? patch : { ...patch, name: patch.name.trim() }
        if (next.name !== undefined && /^none$/i.test(next.name)) return
        set({
          boards: get().boards.map((b) =>
            b.id === boardId
              ? { ...b, initiativeTypes: (b.initiativeTypes ?? []).map((t) => (t.id === id ? { ...t, ...next } : t)) }
              : b,
          ),
        })
      },

      removeInitiativeType: (boardId, id) => {
        const state = get()
        // In use: refused, and the settings panel says how many carry it. Nothing is blanked
        // behind anyone's back — the items keep saying what they said.
        if (initiativesCarrying(state.items, id) > 0) return
        set({
          boards: state.boards.map((b) =>
            b.id === boardId ? { ...b, initiativeTypes: (b.initiativeTypes ?? []).filter((t) => t.id !== id) } : b,
          ),
        })
      },

      toggleItemTag: (boardId, itemId, tagId) => {
        const state = get()
        const item = state.items.find((i) => i.id === itemId)
        if (!item) return
        const carried = item.tagIds ?? []
        if (carried.includes(tagId)) {
          // Always allowed: an item can be cleared whatever happened to the definition.
          set({ items: writeItems(state, (i) => (i.id === itemId ? { ...i, tagIds: carried.filter((t) => t !== tagId) } : i)) })
          return
        }
        // Adding needs the tag to belong to *this* board: the picker offers that board's tags, and
        // the model does not take labels from nowhere.
        if (!boardTags(state.boards.find((b) => b.id === boardId)).some((t) => t.id === tagId)) return
        set({ items: writeItems(state, (i) => (i.id === itemId ? { ...i, tagIds: [...carried, tagId] } : i)) })
      },

      addTag: (boardId, name, color) => {
        const trimmed = name.trim()
        if (!trimmed) return undefined
        // The id comes back so a caller can apply the tag it just defined — defining and using it
        // is one gesture in the panel, even though it is two facts in the model.
        const tag: Tag = { id: uid(), name: trimmed, color }
        set({
          boards: get().boards.map((b) => (b.id === boardId ? { ...b, tags: [...(b.tags ?? []), tag] } : b)),
        })
        return tag.id
      },

      updateTag: (boardId, id, patch) => {
        const next = patch.name === undefined ? patch : { ...patch, name: patch.name.trim() }
        if (next.name !== undefined && !next.name) return
        set({
          boards: get().boards.map((b) =>
            b.id === boardId ? { ...b, tags: (b.tags ?? []).map((t) => (t.id === id ? { ...t, ...next } : t)) } : b,
          ),
        })
      },

      removeTag: (boardId, id) => {
        const state = get()
        // In use: refused, with the count the settings panel shows. Never a silent blanking.
        if (itemsCarryingTag(state.items, id) > 0) return
        set({
          boards: state.boards.map((b) => (b.id === boardId ? { ...b, tags: (b.tags ?? []).filter((t) => t.id !== id) } : b)),
        })
      },

      addStressBoard: (cards) => {
        const state = get()
        const made = stressBoard(cards, state.issueTypes, Date.now())
        const isStress = (id: string) => id.startsWith(STRESS_PREFIX)
        set({
          boards: [...state.boards.filter((b) => !isStress(b.id)), made.board],
          lanes: [...state.lanes.filter((l) => !isStress(l.id)), ...made.lanes],
          items: [...state.items.filter((i) => !isStress(i.id)), ...made.items],
          placements: [...state.placements.filter((p) => !isStress(p.itemId)), ...made.placements],
          edges: [...state.edges.filter((e) => !isStress(e.from) && !isStress(e.to)), ...made.edges],
          links: [...state.links.filter((l) => !isStress(l.from) && !isStress(l.to)), ...made.links],
          users: [...state.users.filter((u) => !isStress(u.id)), ...made.users],
          // It opens as the board itself: a load test is for looking at, and whatever view was in
          // front belongs to whatever was being looked at before.
          boardId: made.board.id,
          selectedItemId: null,
          editMode: false,
          draft: null,
          lensId: null,
          multiSelect: [],
          boundaryId: null,
          filters: NO_FILTERS,
          showObjectives: false,
          showDashboard: false,
          showTimeline: false,
          showArchive: false,
          showBoards: false, showAdmin: false,
          showMetrics: false,
        })
      },

      duplicateCard: (itemId) => {
        const state = get()
        const src = state.items.find((i) => i.id === itemId)
        const at = placementOn(state.placements, itemId, state.boardId)
        // No cell, no copy. A card read inside another board's band, or opened from a surface
        // that has no board behind it, has nowhere here to land — and a record put down
        // somewhere nobody chose is worse than a refusal that can be explained.
        if (!src || !at) return undefined
        // A copy is a card: an initiative's type is what makes it one and its *section* is
        // derived from the work below, so a copied initiative would be placed in a cell it
        // cannot read in. The menu never offers it; the store never mints one.
        if (isInitiativeItem(src, state.issueTypes)) return undefined
        // Design mode is not for making work. A placement made now would be dropped by Cancel
        // while the copy itself survived — a card left with no cell at all.
        if (state.editMode) return undefined
        const item = createdItem({
          id: uid(),
          title: `${src.title} copy`,
          typeId: src.typeId,
          createdAt: Date.now(),
          // A copy is made by whoever makes it, not by whoever made the original.
          ...creator(),
          log: [logEntry('created')],
          // Shape, not state: the description and the steps are what make this record the
          // record it is; the assignees, dates and reasons are judgements about *that* card.
          ...(src.description !== undefined ? { description: src.description } : {}),
          // A copied checklist is a fresh set of steps, never a set already ticked.
          ...(src.checklist?.length
            ? { checklist: src.checklist.map((c) => ({ id: uid(), text: c.text, done: false })) }
            : {}),
        })
        const placement: Placement = {
          id: uid(),
          boardId: state.boardId,
          itemId: item.id,
          laneId: at.laneId,
          laneEnteredAt: Date.now(),
          rank: nextRank(state.placements, at.laneId),
        }
        // One write, and the copy exists only where it is also placed. `placeCard` then
        // renumbers the lane and seats it directly below the original. `stampDone: false`
        // because a copy is created rather than moved: like a brand new card, landing in Done
        // does not tick it resolved.
        placeCard(
          set,
          { ...state, items: [...state.items, item], placements: [...state.placements, placement] },
          placement,
          at.laneId,
          (ordered) => ordered.findIndex((p) => p.id === at.id) + 1,
          { stampDone: false },
        )
        return item.id
      },

      moveCard: (itemId, boardId, laneId, opts) => {
        const state = get()
        // The rule is `src/domain/move.ts` — the same one `/api/v1` and an agent's `move_item` ask.
        // What is the store's own is what a person hears and what the prompt holds.
        const outcome = moveCardOperation(
          { items: state.items, placements: state.placements, lanes: state.lanes, boards: state.boards, edges: state.edges, links: state.links },
          { itemId, boardId, laneId, reason: opts?.reason },
          { at: Date.now(), by: currentAuthor, id: uid },
        )

        if (outcome.kind === 'refused') {
          // A refusal under `block` is said: a drop that just does not happen looks identical to a
          // drop the board did not see. The other refusals (a cell of the other workflow, a lane
          // that is gone) are the pointer being over nothing, and silence is the right answer.
          if (outcome.refusal.code === 'wip_blocked') {
            const title = state.items.find((i) => i.id === itemId)?.title ?? 'The card'
            announce(`${title} was not moved: ${outcome.refusal.details.laneName} is at its limit of ${outcome.refusal.details.limit}.`)
          }
          return false
        }

        if (outcome.kind === 'held') {
          announce(`Move held: ${outcome.laneName} is at its limit of ${outcome.limit}. A reason is needed.`)
          set({
            wipPrompt: {
              itemId,
              boardId,
              laneId,
              laneName: outcome.laneName,
              limit: outcome.limit,
              ...(opts?.index === undefined ? {} : { index: opts.index }),
            },
          })
          return false
        }

        // Already there: nothing moved, nothing to say, and the answer is yes — a caller with a
        // position of its own may still write it.
        if (outcome.positionOnly) return true

        // A move is also the moment a warning can arrive: committed work over Backlog work is
        // noticed rather than blocked, and somebody who cannot see the card's badge needs to hear it.
        const graphOf = (items: typeof state.items, placements: typeof state.placements) => ({
          items,
          edges: state.edges,
          links: state.links,
          placements,
          lanes: state.lanes,
        })
        const raised = raisedWarning(
          uncommittedBelow(itemId, graphOf(state.items, state.placements)),
          uncommittedBelow(itemId, graphOf(outcome.items, outcome.placements)),
        )

        set({ placements: outcome.placements, items: outcome.items })
        // Said after the write, so what is announced is what the board now shows.
        announce(`${moveSentence(state, itemId, laneId)}${raised}`)
        return true
      },

      /**
       * A card's position, changed from the keyboard.
       *
       * Reordering is the one arrangement a pointer does better — you see where it is going. From
       * the keyboard there is nothing to see, so it moves one place at a time and says where it
       * landed, and the ends are stated rather than silently ignored.
       */
      reorderCard: (itemId, delta) => {
        const state = get()
        const placement = state.placements.find((p) => p.itemId === itemId && p.boardId === state.boardId)
        if (!placement) return
        const ordered = placementsInOrder(
          state.placements.filter((p) => p.boardId === state.boardId),
          placement.laneId,
        )
        const at = ordered.findIndex((p) => p.itemId === itemId)
        if (at === -1) return

        const title = state.items.find((i) => i.id === itemId)?.title ?? 'The card'
        const where = lanePath(state.lanes, placement.laneId).join(' / ') || 'its lane'
        const step = delta < 0 ? -1 : 1
        const to = at + step
        if (to < 0 || to >= ordered.length) {
          announce(`${title} is already ${step < 0 ? 'first' : 'last'} in ${where}.`)
          return
        }

        get().moveCardToIndex(itemId, state.boardId, placement.laneId, to)
        announce(`${title} is now ${to + 1} of ${ordered.length} in ${where}.`)
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
        // Dropping a card where it already is lands it at a *position*, not in a new cell, so
        // the history says nothing: a log of every drag would be noise, not a journey.
        const items =
          moving.laneId === laneId
            ? state.items
            : state.items.map((i) =>
                i.id === itemId ? { ...i, log: [...(i.log ?? []), moved(state.lanes, boardId, moving.laneId, laneId)] } : i,
              )
        placeCard(set, { ...state, items }, moving, laneId, () => index)
      },

      moveInitiative: (itemId, boardId, laneId) => {
        const state = get()
        // The same operation the cards workflow uses — one rule, two workflows: the section an
        // initiative's work derives is what a move may never cross.
        const outcome = moveInitiativeOperation(
          { items: state.items, placements: state.placements, lanes: state.lanes, boards: state.boards, edges: state.edges, links: state.links },
          { itemId, boardId, laneId },
          { at: Date.now(), by: currentAuthor, id: uid },
        )
        const title = state.items.find((i) => i.id === itemId)?.title ?? 'The initiative'

        if (outcome.kind === 'refused') {
          // A section is derived, and a move can never cross one: said, so a drop that appears to
          // do nothing is understood rather than repeated. A lane from the other workflow is not
          // worth a sentence — the pointer was over nothing.
          if (outcome.refusal.code === 'section_fixed') {
            announce(`${title} was not moved: its section is decided by the work below it.`)
          }
          return
        }
        // A hold is a cards-workflow thing (WIP is the team's own lane policy), so an initiative
        // never sees one; if it ever could, saying nothing would be the wrong answer here.
        if (outcome.kind === 'held') {
          announce(outcome.message)
          return
        }
        if (outcome.positionOnly) return

        set({ placements: outcome.placements, items: outcome.items })
        announce(`${title} moved to ${lanePath(state.lanes, laneId).join(' / ') || 'another cell'}.`)
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
        if (!canPlaceInSection(itemId, laneId, graph)) return
        const moving = state.placements.find((p) => p.itemId === itemId && p.boardId === boardId)
        if (!moving) return
        // A rank within the same cell is an arrangement, not a move.
        const items =
          moving.laneId === laneId
            ? state.items
            : state.items.map((i) =>
                i.id === itemId ? { ...i, log: [...(i.log ?? []), moved(state.lanes, boardId, moving.laneId, laneId)] } : i,
              )
        placeCard(set, { ...state, items }, moving, laneId, () => index, { stampDone: false })
      },

      setItemFields: (id, patch) => {
        const state = get()
        set({
          items: writeItems(state, (i) => {
            if (i.id !== id) return i
            // The panel's type control is hidden for an initiative, but the guard lives
            // here too: the rule is the model's, not the UI's.
            const allowed = !patch.typeId || canRetype(i, patch.typeId, state.issueTypes)
            // The creator records an act that has already happened, so a patch that carries one is
            // ignored rather than obeyed; the type is reserved by the rule above, and only a retype
            // the model allows gets through.
            const { typeId, createdById: _creator, ...rest } = patch
            const next: Item = { ...i, ...rest, ...(allowed && typeId ? { typeId } : {}) }
            // What changed is part of the record — and a change the model refused changed
            // nothing, so it says nothing.
            const entries = fieldEditEntries(i, next, state)
            return entries.length > 0 ? { ...next, log: [...(next.log ?? []), ...entries] } : next
          }),
        })
      },

      addChecklistItem: (itemId, text) => {
        const t = text.trim()
        if (!t) return
        set({
          items: writeItems(get(), (i) =>
            i.id === itemId ? { ...i, checklist: [...(i.checklist ?? []), { id: uid(), text: t, done: false }] } : i,
          ),
        })
      },
      toggleChecklistItem: (itemId, entryId) =>
        set({
          items: writeItems(get(), (i) =>
            i.id === itemId
              ? { ...i, checklist: (i.checklist ?? []).map((c) => (c.id === entryId ? { ...c, done: !c.done } : c)) }
              : i,
          ),
        }),
      moveChecklistItem: (itemId, entryId, delta) =>
        set({
          items: writeItems(get(), (i) => {
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
          items: writeItems(get(), (i) =>
            i.id === itemId ? { ...i, checklist: (i.checklist ?? []).filter((c) => c.id !== entryId) } : i,
          ),
        }),

      /** Split a leaf cell into a container of the given orientation, with N sub-lanes. */
      splitLane: (laneId, orientation, count = 2) => {
        const state = get()
        const lane = state.lanes.find((l) => l.id === laneId)
        if (!lane) return
        // The kernel carries the rulebook; the board adds only what a Lane carries beyond a node.
        const { nodes, created, firstChildId } = splitLaneNodes(state.lanes, laneId, orientation, uid, count)
        if (created.length === 0) return
        // The kernel only knows nodes; the board's lanes carry a board and a workflow too.
        const createdIds = new Set(created.map((c) => c.id))
        const lanes = nodes.map((n) => (createdIds.has(n.id) ? { ...n, boardId: lane.boardId, workflow: lane.workflow } : n))
        const placements = state.placements.map((p) => (p.laneId === laneId ? toLane(state.placements, p, firstChildId) : p))
        // The cards in the split cell change cell because the board was edited, not because a
        // person moved them — so the history records the move and says what made it.
        const movedIds = new Set(state.placements.filter((p) => p.laneId === laneId).map((p) => p.itemId))
        const items = state.items.map((i) =>
          movedIds.has(i.id)
            ? { ...i, log: [...(i.log ?? []), moved(lanes, lane.boardId, laneId, firstChildId, 'lane split')] }
            : i,
        )
        set({ lanes, placements, items })
      },

      setLaneOrientation: (laneId, orientation) => set({ lanes: setLaneOrientationNode(get().lanes, laneId, orientation) }),

      moveLane: (laneId, delta) => set({ lanes: moveLaneNode(get().lanes, laneId, delta) }),

      addLane: (parentId) => {
        const state = get()
        const parent = state.lanes.find((l) => l.id === parentId)
        if (!parent) return
        const { nodes, created } = addLaneNode(state.lanes, parentId, uid)
        if (!created) return // the board root stays four columns; refine by splitting
        set({
          lanes: nodes.map((n) => (n.id === created.id ? { ...n, boardId: parent.boardId, workflow: parent.workflow } : n)),
        })
      },

      insertLaneAfter: (laneId) => {
        const state = get()
        const lane = state.lanes.find((l) => l.id === laneId)
        if (!lane) return
        const { nodes, created } = insertLaneAfterNode(state.lanes, laneId, uid)
        if (!created) return // typed columns are fixed in place; insert only among sub-lanes
        set({
          lanes: nodes.map((n) => (n.id === created.id ? { ...n, boardId: lane.boardId, workflow: lane.workflow } : n)),
        })
      },

      duplicateLane: (laneId) => {
        const state = get()
        const src = state.lanes.find((l) => l.id === laneId)
        if (!src) return
        // Clones are spread from the original lanes, so they carry the board and
        // workflow with them — the kernel only knows nodes.
        const { nodes } = duplicateLaneNode(state.lanes, laneId, uid)
        set({ lanes: nodes })
      },

      toggleCollapse: (laneId) =>
        set({ collapsedLanes: { ...get().collapsedLanes, [laneId]: !get().collapsedLanes[laneId] } }),

      removeLane: (laneId) => {
        const state = get()
        const lane = state.lanes.find((l) => l.id === laneId)
        if (!lane) return
        // The kernel refuses the typed columns, removes the sub-tree, folds a split left
        // with one child, and says where cards go — the first surviving leaf under the
        // parent, or the parent itself once it is a cell. Never nowhere.
        const { nodes, vanished, to } = removeLaneNodes(state.lanes, laneId)
        if (vanished.size === 0) return // top-level columns are fixed; refine, don't delete
        // Where each card came from, read before the lanes go: the note must say it even though
        // that lane no longer exists by the time anyone reads it.
        const from = new Map(state.placements.filter((p) => vanished.has(p.laneId)).map((p) => [p.itemId, p.laneId]))
        set({
          lanes: nodes,
          placements: state.placements.map((p) => (vanished.has(p.laneId) ? toLane(state.placements, p, to) : p)),
          items: state.items.map((i) =>
            from.has(i.id)
              ? { ...i, log: [...(i.log ?? []), moved(state.lanes, lane.boardId, from.get(i.id), to, 'lane removed')] }
              : i,
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
        const before = decompositionParent(childId, state.edges)
        // A parent is always an initiative, and an item is never its own ancestor — the rule
        // lives in `canSetParent`, where a drop preview reads it too. Refused rather than
        // corrected, and refused *before* the old parent is dropped: asking for something
        // impossible must not quietly detach the item instead.
        const after = parentId && canSetParent(childId, parentId, state, state.issueTypes) ? parentId : undefined
        const child = state.items.find((i) => i.id === childId)?.title ?? 'The item'
        const target = state.items.find((i) => i.id === parentId)?.title ?? 'that item'
        if (parentId && !after) {
          announce(`${child} cannot roll up to ${target}: a parent must be an initiative, and nothing can be its own ancestor.`)
          return
        }
        // Nothing changed, nothing to say: the log records decisions, not gestures.
        if ((before ?? undefined) === after) return
        const title = (id: string | undefined) => state.items.find((i) => i.id === id)?.title ?? id
        const edges = state.edges.filter((e) => !(e.kind === 'decomposition' && e.to === childId))
        set({
          edges: after ? [...edges, { id: uid(), kind: 'decomposition', from: after, to: childId }] : edges,
          items: writeItems(state, (i) =>
            i.id === childId
              ? {
                  ...i,
                  log: [
                    ...(i.log ?? []),
                    logEntry('edited', after ? `Rolls up to ${title(after)}` : `No longer rolls up to ${title(before)}`),
                  ],
                }
              : i,
          ),
        })
        announce(after ? `${child} now rolls up to ${title(after)}.` : `${child} no longer rolls up to anything.`)
      },

      setParents: (itemIds, parentId) => {
        const state = get()
        if (itemIds.length === 0) return false
        // One rule, judged for the whole selection *before* anything is written: a gesture that
        // half-applies is worse than one that refuses. The list the user chose from excludes what
        // this would refuse, so a refusal here means the hierarchy moved under them.
        if (!itemIds.every((id) => canSetParent(id, parentId, state, state.issueTypes))) return false
        const ids = new Set(itemIds)
        const parent = state.items.find((i) => i.id === parentId)
        set({
          edges: [
            // The old parent goes with the new one in a single write: an item has one at most.
            ...state.edges.filter((e) => !(e.kind === 'decomposition' && ids.has(e.to))),
            ...itemIds.map((id) => ({ id: uid(), kind: 'decomposition' as const, from: parentId, to: id })),
          ],
          items: writeItems(state, (i) =>
            // Only what changed is recorded: the log is decisions, not gestures.
            ids.has(i.id) && decompositionParent(i.id, state.edges) !== parentId
              ? { ...i, log: [...(i.log ?? []), logEntry('edited', `Rolls up to ${parent?.title ?? parentId}`)] }
              : i,
          ),
        })
        return true
      },

      addChecklistEntry: (itemId, text) => {
        const value = text.trim()
        if (!value) return
        set({ items: writeItems(get(), (i) => (i.id === itemId ? withChecklistEntry(i, { id: uid(), text: value, done: false }) : i)) })
      },

      setChecklistEntryText: (itemId, entryId, text) => {
        set({ items: writeItems(get(), (i) => (i.id === itemId ? withChecklistEntryText(i, entryId, text) : i)) })
      },

      toggleChecklistEntry: (itemId, entryId) => {
        set({ items: writeItems(get(), (i) => (i.id === itemId ? withToggledChecklistEntry(i, entryId) : i)) })
      },

      removeChecklistEntry: (itemId, entryId) => {
        set({ items: writeItems(get(), (i) => (i.id === itemId ? withoutChecklistEntry(i, entryId) : i)) })
      },

      linkTeamInitiative: (parentId, boardId, title) => {
        const state = get()
        const lane = leafLanes(state.lanes, boardId, 'initiatives')[0]
        const typeId = state.issueTypes.find((t) => t.name === 'Initiative')?.id ?? state.issueTypes[0]?.id
        if (!lane || !typeId) return
        const item = createdItem({ id: uid(), title, typeId, createdAt: Date.now(), ...creator(), log: [logEntry('created')] })
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
        const waitsOn = state.items.find((i) => i.id === dependencyId)?.title ?? 'something'
        set({
          links: [...state.links, { id: uid(), from: dependencyId, to: dependentId, reason }],
          // The relationship belongs in the dependent's history: it is the card whose plans
          // changed. The other end keeps its own story when someone looks at it.
          items: writeItems(state, (i) =>
            i.id === dependentId ? { ...i, log: [...(i.log ?? []), logEntry('linked', `waits on ${waitsOn}`)] } : i,
          ),
        })
      },

      removeDependency: (dependencyId, dependentId) => {
        const state = get()
        if (!state.links.some((l) => l.from === dependencyId && l.to === dependentId)) return
        const waited = state.items.find((i) => i.id === dependencyId)?.title ?? 'something'
        set({
          links: state.links.filter((l) => !(l.from === dependencyId && l.to === dependentId)),
          items: writeItems(state, (i) =>
            i.id === dependentId ? { ...i, log: [...(i.log ?? []), logEntry('unlinked', `no longer waits on ${waited}`)] } : i,
          ),
        })
      },

      setAttribution: (itemId, objectiveId, on) => {
        const state = get()
        // OKRs attach to strategic initiatives only — an Initiative placed on a
        // portfolio-band board. Everything below inherits through the decomposition.
        if (on && !isStrategicInitiative(itemId, state)) return
        const serves = state.edges.filter((e) => e.kind === 'attribution' && e.to === itemId)
        if (!on) {
          set({ edges: state.edges.filter((e) => !(e.kind === 'attribution' && e.from === objectiveId && e.to === itemId)) })
          return
        }
        // An initiative serves **one** objective, so mapping it to a second *moves* it — the same
        // shape as `setParent`, where at most one and choosing again is how you change your mind.
        // Nothing accumulates, and nothing is refused: the choice replaces the choice.
        if (serves.some((e) => e.from === objectiveId)) return
        set({
          edges: [
            ...state.edges.filter((e) => !(e.kind === 'attribution' && e.to === itemId)),
            { id: uid(), kind: 'attribution', from: objectiveId, to: itemId },
          ],
        })
      },

      blockItem: (itemId, reason) => {
        const note = reason?.trim() || undefined
        set({
          items: writeItems(get(), (i) =>
            i.id === itemId
              ? { ...i, blocked: true, blockedReason: note, log: [...(i.log ?? []), logEntry('blocked', note)] }
              : i,
          ),
        })
      },

      unblockItem: (itemId, note) => {
        const text = note?.trim() || undefined
        set({
          items: writeItems(get(), (i) =>
            i.id === itemId
              ? { ...i, blocked: false, blockedReason: undefined, log: [...(i.log ?? []), logEntry('unblocked', text)] }
              : i,
          ),
        })
      },

      addLogNote: (itemId, note) =>
        set({
          items: writeItems(get(), (i) => (i.id === itemId ? { ...i, log: [...(i.log ?? []), logEntry('noted', note)] } : i)),
        }),

      logTextEdit: (itemId, field, before) => {
        const state = get()
        const item = state.items.find((i) => i.id === itemId)
        if (!item) return
        const now = field === 'title' ? item.title : item.description ?? ''
        if (now.trim() === before.trim()) return
        const note = field === 'title' ? `title: "${clip(before.trim())}" → "${clip(now.trim())}"` : 'description edited'
        set({
          items: writeItems(state, (i) => (i.id === itemId ? { ...i, log: [...(i.log ?? []), logEntry('edited', note)] } : i)),
        })
      },

      archiveItem: (itemId) => {
        const state = get()
        const at = Date.now()
        const ids = new Set([itemId, ...descendants(itemId, state)])
        set({
          items: writeItems(state, (i) =>
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
          items: writeItems(state, (i) =>
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
          items: writeItems(state, (i) =>
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
          items: writeItems(state, (i) =>
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
      name: PERSIST_KEY,
      version: PERSIST_VERSION,
      // Where the workspace lives is the adapter's business, not the store's: `chooseRepository`
      // answers with the browser's own storage today, and with the server's once the write path
      // exists (task 118.3). Everything below is unchanged either way.
      storage: createJSONStorage(() => repository.storage),
      // Reshaped board model; older state is reseeded (see migratePersisted).
      migrate: (persisted, version) => migratePersisted(persisted, version) as Store,
      // While editing, persist the pre-edit (draft) design so a reload reverts to it.
      partialize: persistedSlice,
    },
  ),
)

// The identity a log entry is stamped with, kept in step with the store rather than at each door:
// a copy set at every entry point could fall out of step, and a wrong author is worse than none.
currentAuthor = useStore.getState().meUserId
useStore.subscribe((state) => {
  currentAuthor = state.meUserId
})

// What was held before this page loaded is still held, and the toolbar says so from the first draw.
useSync.setState({ waiting: queue.size() })

if (typeof window !== 'undefined') {
  // A connection that comes back is the moment a queue can move; the person does not reload.
  window.addEventListener('online', () => {
    useSync.getState().reachable()
    void flushQueue()
  })
}

// Signing in is what makes a held change sendable at all, and what makes a change elsewhere visible.
useAuth.subscribe((state) => {
  if (state.user) {
    const userId = state.user.id
    // What the account holds, once the queue has moved: adopting before the flush would write over
    // work that was accepted here and has not been sent yet.
    void flushQueue().then(() => reflectAccount(userId))
    startLive()
  } else {
    stopLive()
  }
})

/**
 * A card that changed elsewhere.
 *
 * Adopted only when the revision is greater, which is what makes an echo a no-op: the tab that
 * wrote already holds that revision, so it has nothing to do and writes nothing back.
 */
onLiveItem((item) => {
  useStore.setState((state) => {
    const index = state.items.findIndex((local) => local.id === item.id)
    // Nothing to do when this tab already has it — which is what an echo is, and why answering one
    // would be writing back what you were just told.
    if (index < 0 || (item.rev ?? 0) <= (state.items[index].rev ?? 0)) return state

    const items = [...state.items]
    items[index] = item
    return { items }
  })
})

if (typeof document !== 'undefined') {
  // A tab that is looked at again catches up before it is read.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) startLive()
  })
}
