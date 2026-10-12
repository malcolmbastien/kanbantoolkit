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

/**
 * A person. Items reference users by id; surfaces show the full name (dropdowns)
 * or the initials / photo (cards).
 */
export interface User {
  id: string
  /** Full name, e.g. 'Riley Kim'. */
  name: string
  /** Optional profile photo (data URL or path). Falls back to initials. */
  avatarUrl?: string
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
  /**
   * Optional policy text — the lane's rules of play (entry/exit criteria, etc.).
   * Shown on the lane header via an info icon when present.
   */
  description?: string
}

/**
 * The lens a board presents, named by flight level. Depth is structural (a board
 * can aggregate boards at any depth); the band picks the view:
 * - `team`      — L1 operational: renders work (lanes, cards, WIP).
 * - `program`   — L2 coordination: aggregates linked boards and shows the interfaces.
 * - `portfolio` — L3 strategic: the top of an aggregation — demand vs capability.
 */
export type BoardBand = 'team' | 'program' | 'portfolio'

/** A board: a container that owns a lane grid and/or aggregates other boards. */
export interface Board {
  id: string
  name: string
  band: BoardBand
  /**
   * Retired: hidden from the board picker, the board workspace's list and the aggregation
   * bands, but never destroyed — its lanes, items, placements and edges are untouched.
   * Aggregation edges are deliberately kept, so unarchiving restores the graph exactly;
   * the board is *filtered* from the surfaces instead. `archiveBoard` / `unarchiveBoard`.
   */
  archived?: boolean
  /** When it was retired. */
  archivedAt?: number
  /**
   * Boards this one aggregates (coordination/strategic). Any depth and any mix —
   * teams or other coordination boards — so long as the graph stays acyclic.
   */
  linkedBoardIds?: string[]
  /**
   * The card types allowed on this board (a subset of the non-Initiative types).
   * Empty/undefined means every card type is available.
   */
  cardTypeIds?: string[]
  /** Type a new card gets on this board (never the reserved Initiative type). */
  defaultCardTypeId?: string
  /**
   * How per-lane WIP limits are enforced on this board:
   * `visualize` (default) — tint at/over the limit, moves always allowed;
   * `justify` — allow exceeding a limit, but ask for a reason (recorded as a comment);
   * `block` — reject a move that would push a lane (or a limited ancestor) over its limit.
   */
  wipEnforcement?: 'visualize' | 'justify' | 'block'
}

/**
 * A lane inside a template. `key` wires parents to children *within the template*; real
 * lane ids are minted on instantiation, so a template can be used any number of times.
 */
export interface TemplateLane {
  key: string
  /** `null` means "a child of the board root" — the root itself is structural, not stored. */
  parentKey: string | null
  order: number
  name: string
  orientation?: SplitOrientation
  stage?: Stage
  wipLimit?: number
  description?: string
}

/**
 * A board *design*, not its work: the lane tree, which card types it allows and how it
 * enforces WIP. It carries no items, placements or linked boards — those are
 * org-specific, and a template is meant to be reused across the organisation.
 */
export interface BoardTemplate {
  id: string
  name: string
  band: BoardBand
  lanes: TemplateLane[]
  cardTypeIds?: string[]
  defaultCardTypeId?: string
  wipEnforcement?: 'visualize' | 'justify' | 'block'
}

/** A notable event in an item's history. Append-only. */
export type ItemLogKind = 'created' | 'blocked' | 'unblocked' | 'archived' | 'unarchived' | 'noted' | 'limit'

/**
 * A checklist entry inside a card — finer-grained work than a schedulable card.
 * It has no placement, never counts as WIP, and never affects rollup.
 */
export interface ChecklistEntry {
  id: string
  text: string
  done: boolean
}

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
  /** Assignee user ids (see `User`). A card or initiative can have several. */
  assignees?: string[]
  /** Target start / end dates, ISO 'YYYY-MM-DD'. Shown on the management dashboard. */
  targetStartDate?: string
  targetEndDate?: string
  createdAt: number
  resolvedAt?: number | null
  /** Reason captured when a soft WIP limit was crossed. */
  lastMoveReason?: string
  /**
   * A special status the user applies explicitly. It is independent of the board
   * cell and of any link — blocking an item never moves it and never counts as WIP.
   */
  blocked?: boolean
  /** Optional reason captured when the item was blocked. */
  blockedReason?: string
  /**
   * Filed away: archived items leave the boards (cards workflow, initiatives
   * workflow, boundary pins, lane counts) but stay in the data — they remain
   * searchable and still appear in linked-issue surfaces (hierarchy, links).
   * Archiving a parent cascades to its whole subtree.
   */
  archived?: boolean
  /** When the item was archived. */
  archivedAt?: number
  /** Append-only history of notable events (blocked / unblocked / notes). */
  log?: ItemLogEntry[]
  /**
   * A lightweight checklist — sub-tasks that live inside the card. They are
   * never schedulable work: no placement, no WIP, no rollup.
   */
  checklist?: ChecklistEntry[]
}

/** The explicit board + cell a card sits in. One per board. */
export interface Placement {
  id: string
  boardId: string
  itemId: string
  /** The leaf lane (cell) the card sits in. */
  laneId: string
}

/**
 * A dependency link between two items: the card that depends on another (`to`)
 * and the card it depends on (`from`). This is the only way two items are
 * connected. A link never implies a "blocked" status — blocking is an explicit
 * status set on a single item.
 */
export interface ItemLink {
  id: string
  /** The card depended upon. */
  from: string
  /** The card that depends on it. */
  to: string
  reason?: string
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
  users: User[]
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
  /** Reusable board designs. Part of the workspace's data, not of any one board. */
  boardTemplates: BoardTemplate[]
  /** Auto-archive Done items after this many days (0/undefined = off). */
  autoArchiveDays?: number
}
