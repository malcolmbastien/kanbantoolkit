import type { Board, BoardTemplate, IssueType, Lane, User, Workflow } from './types'

/**
 * The fixed part of the demo workspace: who works here, what a card can be, the six boards and
 * the lane designs a client is meant to see.
 *
 * The *work* on those boards is not here. There are two datasets built on this — `seed.ts`, which
 * is the demo the app loads and resets to, and `fixture.ts`, which is the smaller world the tests
 * run against — and they share these boards so that "the same boards, different work" is true by
 * construction rather than by two copies agreeing with each other.
 *
 * The boards, their flight levels and their links are what a client reads first, so they are the
 * part worth being able to change in one place.
 */
const issueTypes: IssueType[] = [
  { id: 't-initiative', name: 'Initiative', color: '#6366f1' },
  { id: 't-story', name: 'User Story', color: '#0ea5e9' },
  { id: 't-epic', name: 'Epic', color: '#8b5cf6' },
  { id: 't-bug', name: 'Bug', color: '#f43f5e' },
  { id: 't-spike', name: 'Spike', color: '#f59e0b' },
  { id: 't-task', name: 'Task', color: '#64748b' },
  // Not a card type: it is what a decomposition child is, and the panel never offers it.
  { id: 't-subtask', name: 'Sub-task', color: '#94a3b8' },
]

/** Demo people. Items reference these by id; cards show initials (or a photo). */
const users: User[] = [
  { id: 'u-mb', name: 'Maya Blake' },
  { id: 'u-ds', name: 'Diego Santos' },
  { id: 'u-rk', name: 'Riley Kim' },
  { id: 'u-lm', name: 'Lena Moreau' },
  { id: 'u-jt', name: 'Jonah Tran' },
]

const boards: Board[] = [
  { id: 'b-strategy', name: 'Company Strategy', band: 'portfolio', description: 'Where objectives and their coverage live — a strategic lens, not a workflow: the whole organisation reads it.', linkedBoardIds: ['b-lob', 'b-delivery'] },
  { id: 'b-lob', name: 'Digital line of business', band: 'program', description: 'The digital line of business — its initiatives aggregate the boards beneath.', linkedBoardIds: ['b-portfolio'] },
  // A Program that bridges the two team boards straight to the portfolio.
  { id: 'b-delivery', name: 'Product Delivery', band: 'program', description: 'The delivery bridge: the two team boards’ initiatives, rolled up for management.', linkedBoardIds: ['b-atlas', 'b-nova'] },
  { id: 'b-portfolio', name: 'Growth value stream', band: 'program', description: 'A coordination board over Team Atlas and Team Nova — it shows work, it does not hold it.', linkedBoardIds: ['b-atlas', 'b-nova'] },
  { id: 'b-atlas', name: 'Team Atlas', band: 'team', description: 'Team Atlas’s own flow, as the team designed it — everything below the typed columns is theirs to rework.', defaultCardTypeId: 't-story' },
  { id: 'b-nova', name: 'Team Nova', band: 'team', description: 'Team Nova’s own flow — its lanes, limits and policies are what the board does.', defaultCardTypeId: 't-story' },
]
/**
 * The lanes a dataset places work into. `dev` and `test` only exist on the boards whose In
 * Progress column is refined, which is why `test` is optional — the model allows both shapes and
 * the demo shows both.
 */
export interface WorkflowLanes {
  r: Lane
  backlog: Lane
  ns: Lane
  ip: Lane
  done: Lane
  dev: Lane
  test?: Lane
  init: { r: Lane; backlog: Lane; ns: Lane; ip: Lane; done: Lane }
}

/**
 * Templates the product ships with.
 *
 * These are part of the *app*, not of a user's data, so the persist migration adds any
 * that a stored state is missing (v22) rather than waiting for a Reset — a built-in
 * template should reach people who already had state before it existed.
 */
export const BUILT_IN_TEMPLATES: BoardTemplate[] = [
  /**
   * The Scrum workflow, from the reference board. Four top-level columns, one per stage —
   * a board's root is always exactly that, and a fifth would be a column with a stage that
   * already exists.
   *
   * The reference board draws *Ready for Delivery* and *Done* as two green columns; here
   * they are the two cells of the Done column, which is what they are: accepted work and
   * released work, both done, in one stage.
   */
  {
    id: 'tpl-feature-flow',
    name: 'Feature Flow',
    band: 'team',
    // Two card types, as the board it came from uses.
    defaultCardTypeId: 't-story',
    lanes: [
      { key: 'k0', parentKey: null, order: 0, name: 'Pool of Ideas', stage: 'backlog' },
      {
        key: 'k1',
        parentKey: null,
        order: 1,
        name: 'Not Started',
        stage: 'notStarted',
        orientation: 'columns',
      },
      {
        key: 'k2',
        parentKey: 'k1',
        order: 0,
        name: 'Feature Preparation',
        orientation: 'columns',
        wipLimit: 10,
        description: 'Business case showing value, cost of delay, size estimate and design outline.',
      },
      { key: 'k3', parentKey: 'k2', order: 0, name: 'In Progress', wipLimit: 3 },
      { key: 'k4', parentKey: 'k2', order: 1, name: 'Ready', wipLimit: 10 },
      {
        key: 'k5',
        parentKey: 'k1',
        order: 1,
        name: 'Feature Selected',
        wipLimit: 5,
        description: 'Selection at the replenishment meeting chaired by the Product Director.',
      },
      { key: 'k6', parentKey: 'k1', order: 2, name: 'User Story Identified', wipLimit: 30 },
      {
        key: 'k7',
        parentKey: null,
        order: 2,
        name: 'In Progress',
        stage: 'inProgress',
        orientation: 'columns',
      },
      {
        key: 'k8',
        parentKey: 'k7',
        order: 0,
        name: 'User Story Preparation',
        orientation: 'columns',
        wipLimit: 15,
        description: 'Small, well-understood, testable, and agreed with the Product Director and the team.',
      },
      { key: 'k9', parentKey: 'k8', order: 0, name: 'In Progress' },
      { key: 'k10', parentKey: 'k8', order: 1, name: 'Ready' },
      {
        key: 'k11',
        parentKey: 'k7',
        order: 1,
        name: 'User Story Development',
        orientation: 'columns',
        wipLimit: 15,
        description: "As per the team's Definition of Done.",
      },
      { key: 'k12', parentKey: 'k11', order: 0, name: 'In Progress' },
      { key: 'k13', parentKey: 'k11', order: 1, name: 'Ready (Done)' },
      {
        key: 'k14',
        parentKey: 'k7',
        order: 2,
        name: 'Feature Acceptance',
        orientation: 'columns',
        wipLimit: 8,
      },
      { key: 'k15', parentKey: 'k14', order: 0, name: 'In Progress' },
      { key: 'k16', parentKey: 'k14', order: 1, name: 'Ready' },
      {
        key: 'k17',
        parentKey: null,
        order: 3,
        name: 'Done',
        stage: 'done',
        orientation: 'columns',
      },
      {
        key: 'k18',
        parentKey: 'k17',
        order: 0,
        name: 'Deployment',
        wipLimit: 5,
        description: 'Risk assessed per the continuous deployment policy.',
      },
      { key: 'k19', parentKey: 'k17', order: 1, name: 'Delivered' },
    ],
  },
  {
    id: 'tpl-scrum',
    name: 'Scrum',
    band: 'team',
    lanes: [
      { key: 'k0', parentKey: null, order: 0, name: 'Product Backlog', stage: 'backlog' },
      { key: 'k1', parentKey: null, order: 1, name: 'Ready to Start', stage: 'notStarted', orientation: 'columns' },
      { key: 'k2', parentKey: 'k1', order: 0, name: 'Backlog Refinement' },
      { key: 'k3', parentKey: 'k1', order: 1, name: 'Current Sprint' },
      { key: 'k4', parentKey: null, order: 2, name: 'In Progress', stage: 'inProgress', orientation: 'columns' },
      { key: 'k5', parentKey: 'k4', order: 0, name: 'Working on' },
      { key: 'k6', parentKey: 'k4', order: 1, name: 'Ready for Review' },
      { key: 'k7', parentKey: 'k4', order: 2, name: 'Review' },
      { key: 'k8', parentKey: null, order: 3, name: 'Done', stage: 'done', orientation: 'columns' },
      { key: 'k9', parentKey: 'k8', order: 0, name: 'Ready for Delivery' },
      { key: 'k10', parentKey: 'k8', order: 1, name: 'Done' },
    ],
  },
]

export interface DemoWorkspace {
  users: User[]
  issueTypes: IssueType[]
  boards: Board[]
  lanes: Lane[]
  boardTemplates: BoardTemplate[]
  /** The lane handles a dataset places work with, one per board. */
  st: WorkflowLanes
  lob: WorkflowLanes
  del: WorkflowLanes
  p: WorkflowLanes
  a: WorkflowLanes
  n: WorkflowLanes
}

/** Build the workspace: fresh lanes every call, so two datasets in one process cannot share them. */
export function demoWorkspace(): DemoWorkspace {
const lanes: Lane[] = []
let seq = 0
function lane(
  boardId: string,
  name: string,
  parentId: string | null,
  order: number,
  workflow: Workflow,
  opts: Partial<Pick<Lane, 'orientation' | 'wipLimit' | 'stage'>> = {},
): Lane {
  const l: Lane = { id: `lane-${++seq}`, boardId, name, parentId, order, workflow, ...opts }
  lanes.push(l)
  return l
}
const root = (boardId: string, workflow: Workflow) => lane(boardId, '', null, 0, workflow, { orientation: 'columns' })

/** The standard four typed columns, one cell each — where either workflow starts. */
function columns(boardId: string, workflow: Workflow) {
  const r = root(boardId, workflow)
  const backlog = lane(boardId, 'Backlog', r.id, 0, workflow, { stage: 'backlog' })
  const ns = lane(boardId, 'Not Started', r.id, 1, workflow, { stage: 'notStarted' })
  const ip = lane(boardId, 'In Progress', r.id, 2, workflow, { stage: 'inProgress' })
  const done = lane(boardId, 'Done', r.id, 3, workflow, { stage: 'done' })
  return { r, backlog, ns, ip, done }
}

// The team's own flow, plus the initiatives workflow the board starts with. The two are
// independent: In Progress splits into Dev / Test for the cards, while the initiatives
// workflow keeps its four standard sections — a team refines its board, the organisation
// still reads the same shape.
function workflow(boardId: string, splitProgress: boolean) {
  const c = columns(boardId, 'cards')
  if (splitProgress) c.ip.orientation = 'columns'
  const dev = splitProgress ? lane(boardId, 'Dev', c.ip.id, 0, 'cards') : c.ip
  const test = splitProgress ? lane(boardId, 'Test', c.ip.id, 1, 'cards') : undefined
  const init = columns(boardId, 'initiatives')
  return { ...c, dev, test, init }
}

// A four-altitude demo: teams roll up to a value stream, to a line of business,
// to the company strategy. Coordination/strategic boards aggregate, so their
// lanes are plain columns.
const st = workflow('b-strategy', false)
const lob = workflow('b-lob', false)
const del = workflow('b-delivery', false)
const p = workflow('b-portfolio', false)
// Team boards: In Progress refined into Dev / Test.
const a = workflow('b-atlas', true)
const n = workflow('b-nova', true)

// Demo WIP limits: Not Started is at its limit (yellow); Backlog is over it (red).
a.ns.wipLimit = 1
n.backlog.wipLimit = 2

// Demo lane policies (shown via the lane's info icon).
a.ns.description =
  'Pull one card at a time. A card may only enter once it is sized and has a clear owner.'
a.test!.description =
  'Definition of done: reviewed, automated checks green, and deployed to staging before it can move to Done.'
  return {
    users: structuredClone(users),
    issueTypes: structuredClone(issueTypes),
    boards: structuredClone(boards),
    lanes,
    boardTemplates: structuredClone(BUILT_IN_TEMPLATES),
    st,
    lob,
    del,
    p,
    a,
    n,
  }
}
