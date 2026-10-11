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
 * A stage type for a top-level column. Exactly three — Not Started / In Progress /
 * Done — and this is what lets status roll up the hierarchy: a leaf's status is the
 * stage of the top-level column it ultimately sits under. Users split these columns
 * to build finer team workflows; sub-lanes inherit the stage.
 */
export type Stage = 'notStarted' | 'inProgress' | 'done'

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

/** A card, without any board/state/level field. */
export interface Item {
  id: string
  title: string
  description?: string
  typeId: string
  size?: number
  assignee?: string
  createdAt: number
  resolvedAt?: number | null
  cancelledAt?: number | null
  /** Reason captured when a soft WIP limit was crossed. */
  lastMoveReason?: string
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
export type EdgeKind = 'decomposition' | 'dependency' | 'attribution'

export interface DependencyDetail {
  fsKind: DepKind
  lagDays?: number
  status: DepStatus
  reason?: string
  pinTo?: string
}

export interface Edge {
  id: string
  kind: EdgeKind
  /** decomposition: parent; dependency: blocker; attribution: objective. */
  from: string
  /** decomposition: child; dependency: dependent; attribution: item. */
  to: string
  dep?: DependencyDetail
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
}

export interface SponsorRecord {
  decision: 'committed' | 'rejected' | 'dormant'
  reason?: string
  at: number
}

export interface FlowState {
  issueTypes: IssueType[]
  boards: Board[]
  lanes: Lane[]
  items: Item[]
  placements: Placement[]
  edges: Edge[]
  objectives: Objective[]
  keyResults: KeyResult[]
  sponsors: Record<string, SponsorRecord>
}
