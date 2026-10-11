// Flowline domain model (v2).
//
// Generic parent/child hierarchy + user-defined issue types + LeanKit-style lane
// boards. A card's board and cell are explicit Placement records; there is no
// level or resolution field anywhere.

/** A user-defined issue type. A label + colour — columns come from the board. */
export interface IssueType {
  id: string
  name: string
  color: string
}

export type SplitOrientation = 'columns' | 'rows'

/**
 * A stage type for a top-level column. Backlog is *uncommitted* inventory; the
 * other three — Not Started / In Progress / Done — are the committed stages. A
 * leaf's status is the stage of the top-level column it sits under, which lets
 * status roll up the hierarchy. Users split these columns to build finer team
 * workflows; sub-lanes inherit the stage.
 */
export type Stage = 'backlog' | 'notStarted' | 'inProgress' | 'done'

/**
 * A LeanKit lane. A lane with no children is a leaf **cell** that holds cards.
 * A lane with children is a **container**; `orientation` says how its children
 * are arranged ('columns' = side by side, 'rows' = stacked). Any leaf can be
 * split into a container of either orientation, recursively — so the grid is
 * non-uniform, exactly like LeanKit.
 */
export interface Lane {
  id: string
  boardId: string
  parentId: string | null
  order: number
  name: string
  /** Present on containers: how children are arranged. */
  orientation?: SplitOrientation
  /** Stage type (top-level columns); inherited by descendants. */
  stage?: Stage
  /** Optional WIP limit (counts placements anywhere in the lane's subtree). */
  wipLimit?: number
  /** Column semantics for dependency derivation (legacy; superseded by `stage`). */
  isStart?: boolean
  isDone?: boolean
  isCancelled?: boolean
}

/** Kanban flight level a board represents. */
export type BoardLevel = 'portfolio' | 'project' | 'team'

/** A board: a container that owns a lane grid. */
export interface Board {
  id: string
  name: string
  level: BoardLevel
  /**
   * Rollup board: an item's column is *derived* from the status of the work at the
   * lowest level of its subtree (mapped onto the board's start/done lanes) rather
   * than stored in its placement. Used for initiative/management boards.
   */
  derived?: boolean
  /** Management boards only: the team boards they aggregate (and show as bands). */
  teamBoardIds?: string[]
}

/** A notable event in an item's history. Append-only. */
export type ItemLogKind = 'created' | 'blocked' | 'unblocked' | 'noted'

export interface ItemLogEntry {
  id: string
  at: number
  kind: ItemLogKind
  note?: string
}

/** A card, without any board/state/level field. */
export interface Item {
  id: string
  title: string
  description?: string
  typeId: string
  size?: number
  assignee?: string
  /** Target completion date, ISO 'YYYY-MM-DD'. Shown on the management dashboard. */
  targetDate?: string
  createdAt: number
  resolvedAt?: number | null
  cancelledAt?: number | null
  /** Reason captured when a soft WIP limit was crossed. */
  lastMoveReason?: string
  /**
   * A special status the user applies explicitly. It is independent of the board
   * cell and of any link — blocking an item never moves it and never counts as WIP.
   */
  blocked?: boolean
  /** Optional reason captured when the item was blocked. */
  blockedReason?: string
  /** Append-only history of notable events (blocked / unblocked / notes). */
  log?: ItemLogEntry[]
}

/** The explicit board + cell a card sits in. One per board. */
export interface Placement {
  id: string
  boardId: string
  itemId: string
  /** The leaf lane (cell) the card sits in. */
  laneId: string
}

export type DepKind = 'FS' | 'SS' | 'FF'
export type DepStatus = 'proposed' | 'confirmed' | 'rejected'

/**
 * An item-to-item link. Links capture **dependency-type relationships only**
 * (finish-to-start / start-to-start / finish-to-finish). They never imply a
 * "blocked" status — blocking is an explicit status the user sets on an item.
 */
export interface ItemLink {
  id: string
  /** Blocker. */
  from: string
  /** Dependent. */
  to: string
  kind: DepKind
  lagDays?: number
  status: DepStatus
  reason?: string
  pinTo?: string
}

/** Structural (decomposition) and objective (attribution) relationships. */
export type EdgeKind = 'decomposition' | 'attribution'

export interface Edge {
  id: string
  kind: EdgeKind
  /** decomposition: parent; attribution: objective. */
  from: string
  /** decomposition: child; attribution: item. */
  to: string
}

/** Objectives and KRs are commitment-limited entities, never cards. */
export interface Objective {
  id: string
  title: string
  period: string
  status: 'active' | 'scored'
  score?: number
}

export interface KeyResult {
  id: string
  objectiveId: string
  title: string
  target?: string
  current?: string
  /** 0–100 progress. */
  progress?: number
}

export interface FlowState {
  issueTypes: IssueType[]
  boards: Board[]
  lanes: Lane[]
  items: Item[]
  placements: Placement[]
  /** Structural + objective relationships (hierarchy, attribution). */
  edges: Edge[]
  /** Item-to-item links: dependency relationships only. */
  links: ItemLink[]
  objectives: Objective[]
  keyResults: KeyResult[]
}
