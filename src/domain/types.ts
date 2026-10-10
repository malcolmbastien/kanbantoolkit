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

export type LaneAxis = 'vertical' | 'horizontal'

/**
 * A LeanKit lane. Vertical lanes are process columns; horizontal lanes are
 * swimlanes. Either can be split into ordered sub-lanes (parentId points up).
 */
export interface Lane {
  id: string
  boardId: string
  axis: LaneAxis
  parentId: string | null
  name: string
  order: number
  /** Optional per-lane WIP limit. */
  wipLimit?: number
  /** Column semantics for dependency derivation. */
  isStart?: boolean
  isDone?: boolean
  isCancelled?: boolean
}

/** A board: a container that owns a lane grid. */
export interface Board {
  id: string
  name: string
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

/** The explicit "board + cell" a card sits in. One per board. */
export interface Placement {
  id: string
  boardId: string
  itemId: string
  /** Leaf vertical lane (the column). */
  columnLaneId: string
  /** Leaf horizontal lane (the row), if any. */
  rowLaneId: string | null
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
