// Kanban Toolkit domain model (v2).
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
 * A board's own label for an initiative: a name and a colour, and nothing else. It says what kind
 * of initiative this is — a bet, a programme, an experiment — and every kind behaves identically:
 * no lifecycle, no columns, no WIP, and no effect on rollup, health, dependencies or metrics.
 *
 * Named a "type" in the model, because that is the model's word for a label (`IssueType`), and
 * called **Kind** in the interface, where "Type" already means the reserved Initiative type — the
 * one thing that makes an item an initiative at all. The two words differing is deliberate: they
 * are two different things, and `Item.typeId` is never one of these.
 */
export interface InitiativeType {
  id: string
  name: string
  color: string
}

/**
 * A board's own tag: a name and a colour, and nothing else. Where an initiative *kind* says what
 * sort of initiative something is (one per initiative, from a short list), a tag says what it is
 * *about* — and an item carries several, added freely. Like a kind it is a label: no lifecycle, no
 * columns, no WIP, nothing derived from it. The only thing that reads a tag is a filter.
 */
export interface Tag {
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
  /**
   * Which workflow this lane belongs to.
   *
   * A board carries **two independent lane trees**: the **cards** workflow — where the
   * team's cards live, with its own column names, splits and WIP limits — and the
   * **initiatives** workflow, the external representation management reads: typed
   * sections and the cells initiatives are arranged in. They share a shape, not a fate:
   * renaming or splitting one never touches the other, which is what lets a team rework
   * its board without changing what the organisation sees.
   *
   * A subtree never mixes the two, so any walk from a lane stays inside its own workflow.
   */
  workflow: Workflow
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
   * The kinds this board's initiatives can be: its own vocabulary for the outcomes it owns.
   *
   * Deliberately per board, unlike `IssueType`, which is workspace-wide — a card type is the
   * *work* vocabulary everyone doing that work shares, while an initiative kind is what a board
   * says about its own outcomes, and a portfolio board's "Bet" means nothing on a team board.
   * v27 deleted per-board card-type subsets for the opposite reason; this is not a shortlist of
   * the workspace's types, it is a board's own labels.
   *
   * Absent or empty means None only. **None is the absence of a value, not an entry in this
   * list**: `Item.initiativeTypeId === undefined` *is* None, so there is no row anyone can delete
   * and old state reads as None with no backfill.
   */
  initiativeTypes?: InitiativeType[]
  /**
   * The tags this board's work can carry: its own vocabulary, like `initiativeTypes` and for the
   * same reason — a team board's "tech-debt" means nothing on a portfolio board. Absent or empty
   * means no tags at all, which is the empty state rather than an option: a set of tags is a set,
   * so there is no "None" entry here to protect.
   */
  tags?: Tag[]
  /**
   * The board's own voice: what it is and how to read it, in the team's words. The board
   * board settings edits it in place, and the command palette searches it.
   */
  description: string
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
   * Type a new card gets on this board (never the reserved Initiative type). Every card type
   * is available on every board: a type is a workspace-wide label, so a board either has it —
   * which is to say everyone does — or the type does not exist.
   */
  defaultCardTypeId?: string
  /**
   * The cell a new card lands in — and where a card moved onto this board will land.
   *
   * A board's first leaf is a reasonable guess and a poor answer: it is a cell a team would
   * never choose, and it changes the moment they split the column before it. Absent means the
   * first leaf, so a board that has never said still behaves as it did.
   */
  defaultDropLaneId?: string
  /**
   * How per-lane WIP limits are enforced on this board:
   * `visualize` (default) — tint at/over the limit, moves always allowed;
   * `justify` — allow exceeding a limit, but ask for a reason (recorded as a comment);
   * `block` — reject a move that would push a lane (or a limited ancestor) over its limit.
   */
  wipEnforcement?: 'visualize' | 'justify' | 'block'
}

/**
 * A board's two workflows. Each is its own lane tree, rooted separately; a lane belongs to
 * exactly one of them.
 *
 * - `cards`       — the team's own flow. Cards live in its leaves.
 * - `initiatives` — the external representation: typed sections, and the cells initiatives
 *                   are arranged in. It starts as the standard four sections and is refined
 *                   on its own, never by the cards workflow's splits.
 */
export type Workflow = 'cards' | 'initiatives'

/**
 * A lane inside a template. `key` wires parents to children *within the template*; real
 * lane ids are minted on instantiation, so a template can be used any number of times.
 *
 * Templates describe the **cards** workflow — a team's design. The initiatives workflow a
 * board starts with is the standard one, not the template's.
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
  defaultCardTypeId?: string
  wipEnforcement?: 'visualize' | 'justify' | 'block'
}

/** A notable event in an item's history. Append-only. */
export type ItemLogKind =
  | 'created'
  | 'moved'
  | 'edited'
  | 'linked'
  | 'unlinked'
  | 'blocked'
  | 'unblocked'
  | 'archived'
  | 'unarchived'
  | 'noted'
  | 'limit'

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
  /**
   * Who made the change, as a user id — or absent when nobody was named. Optional because a
   * history written before identities existed has no author to claim, and inventing one would be
   * worse than the blank.
   */
  by?: string
  /** What happened, in the words of the moment — a move's lane names as they were then. */
  note?: string
  /**
   * For a move: the cell it came from and the one it went to. Linkage, not display — the note
   * is what a person reads, and it stays true after a lane is renamed or removed, which is why
   * neither the note nor the panel ever looks a lane up. Optional, so an entry written before
   * these existed, or by an event that is not a move, carries neither.
   */
  fromLaneId?: string
  toLaneId?: string
  /**
   * The stage the move landed in, and — when it is known — the one it left. Stages rather than
   * lane ids alone, because the four stages are fixed while a team is free to rename, split and
   * rearrange its columns: a history written in stages cannot be corrupted by a later board
   * design, which is what the flow metrics are read from.
   */
  fromStage?: Stage
  toStage?: Stage
  /** The board the move happened on: a card can sit on more than one, and each board's flow
   * reads only its own moves. */
  boardId?: string
}

/** A card, without any board/state/level field. */
export interface Item {
  id: string
  title: string
  description?: string
  typeId: string
  /**
   * Who created it: a user id, written once when the item is made and never edited. Absent on work
   * that predates the record — a name invented for it would be a guess dressed as a fact.
   */
  createdById?: string
  /**
   * An initiative's kind — a board's own label for it (see `InitiativeType`), never a card's:
   * `setInitiativeKind` refuses one on a card. Absent means None. This is *not* `typeId`, which
   * is what makes an item an initiative in the first place.
   */
  initiativeTypeId?: string
  /**
   * The tags this item carries (see `Tag`), on a card or an initiative alike. Ids, never copies:
   * a tag renamed renames everywhere at once. Absent or empty is no tags.
   */
  tagIds?: string[]
  /** Assignee user ids (see `User`). A card or initiative can have several. */
  assignees?: string[]
  /**
   * Priority — a judgement the team makes, so unlike level, dependency state and status
   * it is stored rather than derived. It never affects rollup, WIP or status.
   */
  priority?: 'urgent' | 'high' | 'medium' | 'low'
  /** Target start / end dates, ISO 'YYYY-MM-DD'. Shown on the management dashboard. */
  targetStartDate?: string
  targetEndDate?: string
  createdAt: number
  /**
   * The item's revision: incremented once per accepted change to its own **content**. Optional,
   * so a workspace written before this existed reads without a migration — absent means "never
   * revised". A placement is arrangement, not content, and never moves it (see `store.ts`).
   */
  rev?: number
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
  /**
   * When the card entered that lane. Stamped on every lane change, and absent for
   * placements that predate it — so age is shown only where it is known, never invented.
   */
  laneEnteredAt?: number
  /**
   * The card's position within its lane — the order a person put it in. Positional, like
   * `Lane.order`, not a typed priority: the order cards sit in *is* how a board expresses
   * priority. Absent for placements that predate it, which keep their existing order.
   */
  rank?: number
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

/**
 * A key result: what an objective says it means, in the words of the people who set it.
 *
 * A line of text and nothing else. A number entered by hand cannot be connected to the work, so
 * it can disagree with the work and no test can find the disagreement. The completeness of an
 * objective is read from the initiatives that serve it instead — see `objectiveRollup`.
 */
export interface KeyResult {
  id: string
  objectiveId: string
  title: string
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
