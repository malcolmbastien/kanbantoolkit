/**
 * The workspace, as the browser already stores it.
 *
 * `persistedSlice` in `src/store.ts` is the definition, and this mirrors it deliberately: the point
 * of the read is that the store can take the answer without a translation layer, so a field the
 * browser persists and a field the server returns are the same field. Type-only, so nothing from
 * the client reaches a server bundle.
 */

import type { SavedFilter } from '../../src/domain/filters'
import type {
  Board,
  BoardFlow,
  BoardTemplate,
  Edge,
  Item,
  ItemLink,
  IssueType,
  KeyResult,
  Lane,
  Objective,
  Period,
  Placement,
  User,
} from '../../src/domain/types'

export interface Workspace {
  /** Whose workspace this is. On the server it is the session, never the browser's pointer. */
  meUserId?: string
  users: User[]
  issueTypes: IssueType[]
  items: Item[]
  edges: Edge[]
  links: ItemLink[]
  objectives: Objective[]
  /** The windows objectives are committed for. */
  periods: Period[]
  keyResults: KeyResult[]
  boardTemplates: BoardTemplate[]
  savedFilters: SavedFilter[]
  /** Collapsed columns, remembered across reloads. */
  collapsedLanes: Record<string, boolean>
  /** The board this workspace opens on. */
  boardId: string
  boards: Board[]
  flows: BoardFlow[]
  lanes: Lane[]
  placements: Placement[]
}

/**
 * The workspace's words: the lists the app authors as one document, apart from the board design.
 *
 * Types, templates, periods, objectives and key results are whole-list edits — a rename is a new
 * array, not a patch — so they travel together under one revision of their own. The auto-archive
 * age is deliberately not here: it is the product's constant, not a word the workspace chooses.
 */
export interface Vocabulary {
  issueTypes: IssueType[]
  boardTemplates: BoardTemplate[]
  /** The windows objectives are committed for — a period is a record now, not a label. */
  periods: Period[]
  objectives: Objective[]
  keyResults: KeyResult[]
}

/** The settings row's name, until task 122 gives a workspace an identity of its own. */
export const WORKSPACE_ROW = 'workspace'
