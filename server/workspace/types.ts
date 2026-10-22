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
  BoardTemplate,
  Edge,
  Item,
  ItemLink,
  IssueType,
  KeyResult,
  Lane,
  Objective,
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
  keyResults: KeyResult[]
  boardTemplates: BoardTemplate[]
  autoArchiveDays?: number
  savedFilters: SavedFilter[]
  /** Collapsed columns, remembered across reloads. */
  collapsedLanes: Record<string, boolean>
  /** The board this workspace opens on. */
  boardId: string
  boards: Board[]
  lanes: Lane[]
  placements: Placement[]
}

/** The settings row's name, until task 122 gives a workspace an identity of its own. */
export const WORKSPACE_ROW = 'workspace'
