import type { Board, BoardTemplate, Edge, FlowState, IssueType, Item, ItemLink, Lane, Placement, Objective, User, Workflow } from './types'

const T = Date.UTC(2026, 9, 15, 9, 0, 0)

/* ------------------------------------------------------------------ *
 * Demo org: "Meridian". Two teams, a company portfolio, and a couple of
 * OKRs. Small but complete enough to feel the model.
 * ------------------------------------------------------------------ */
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
  { id: 'b-strategy', name: 'Company Strategy', band: 'portfolio', linkedBoardIds: ['b-lob', 'b-delivery'] },
  { id: 'b-lob', name: 'Digital line of business', band: 'program', linkedBoardIds: ['b-portfolio'] },
  // A Program that bridges the two team boards straight to the portfolio.
  { id: 'b-delivery', name: 'Product Delivery', band: 'program', linkedBoardIds: ['b-atlas', 'b-nova'] },
  { id: 'b-portfolio', name: 'Growth value stream', band: 'program', linkedBoardIds: ['b-atlas', 'b-nova'] },
  { id: 'b-atlas', name: 'Team Atlas', band: 'team', defaultCardTypeId: 't-story' },
  { id: 'b-nova', name: 'Team Nova', band: 'team', defaultCardTypeId: 't-story' },
]

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
    cardTypeIds: ['t-epic', 't-story'],
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

/* ------------------------------------------------------------------ *
 * Objectives & Key Results (commitment-limited; never in columns)
 * ------------------------------------------------------------------ */
const objectives: Objective[] = [
  { id: 'obj-activation', title: 'Grow activation', period: 'FY26 Q1', status: 'active', score: 45 },
  { id: 'obj-efficiency', title: 'Reduce cost-to-serve', period: 'FY26 Q1', status: 'active' },
  // Deliberately unserved — no strategic initiative carries it (an L3 coverage gap).
  { id: 'obj-reliability', title: 'Improve reliability', period: 'FY26 Q1', status: 'active' },
]
const keyResults = [
  { id: 'kr-activation', objectiveId: 'obj-activation', title: 'Activation rate +10pp', progress: 30 },
  { id: 'kr-completion', objectiveId: 'obj-activation', title: 'Signup completion 90%', progress: 60 },
  { id: 'kr-tickets', objectiveId: 'obj-efficiency', title: 'Support tickets −30%', progress: 10 },
]

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */
const items: Item[] = []
const item = (id: string, title: string, typeId: string, extra: Partial<Item> = {}) =>
  items.push({ id, title, typeId, createdAt: T, ...extra })

// Strategic initiatives (company strategy) — the top of the chain. OKRs attach
// here and everything below inherits through the decomposition.
item('init-activation', 'Activation Programme', 't-initiative', { size: 74, assignees: ['u-mb'], targetStartDate: '2026-10-01', targetEndDate: '2027-03-31' })
item('init-efficiency', 'Operating Efficiency', 't-initiative', { size: 62, assignees: ['u-ds'], targetStartDate: '2026-10-01', targetEndDate: '2027-03-31' })
// Deliberately carries no OKR — an L3 coverage gap to demonstrate.
item('init-explore', 'Exploration Portfolio', 't-initiative', { size: 12, assignees: ['u-jt'], targetEndDate: '2027-06-30' })
// Line-of-business initiative.
item('init-growth', 'Customer Growth', 't-initiative', { size: 55, assignees: ['u-ds'], targetStartDate: '2026-10-01', targetEndDate: '2027-01-31' })
// Program initiative (Product Delivery) — bridges the teams to the portfolio.
item('init-delivery', 'Delivery Excellence', 't-initiative', { size: 24, assignees: ['u-lm'], targetEndDate: '2027-02-28' })
// Value-stream initiatives.
item('init-onboarding', 'Onboarding Redesign', 't-initiative', { size: 34, assignees: ['u-mb'], targetStartDate: '2026-10-01', targetEndDate: '2026-12-15' })
item('init-platform', 'Platform Consolidation', 't-initiative', { size: 40, assignees: ['u-ds'], targetStartDate: '2026-11-01', targetEndDate: '2027-03-31' })

// Team-level initiatives.
item('init-signup', 'New signup flow', 't-initiative', { size: 13, assignees: ['u-rk'], targetEndDate: '2026-11-30' })
item('init-welcome', 'Welcome experience', 't-initiative', { size: 8, assignees: ['u-lm'], targetEndDate: '2026-11-15' })
item('init-gateway', 'API gateway', 't-initiative', { size: 21, assignees: ['u-jt'], targetEndDate: '2027-02-28' })

// Cards — Team Atlas.
item('st-signup-design', 'Design signup screens', 't-story', { size: 3 })
item('st-signup-form', 'Build signup form', 't-story', {
  size: 5,
  assignees: ['u-rk', 'u-mb'],
  checklist: [
    { id: 'cl-form-1', text: 'Form markup + validation', done: true },
    { id: 'cl-form-2', text: 'Wire up the API call', done: true },
    { id: 'cl-form-3', text: 'Error states', done: false },
    { id: 'cl-form-4', text: 'Analytics events', done: false },
  ],
})
item('st-email', 'Email verification', 't-story', {
  size: 3,
  checklist: [
    { id: 'cl-email-1', text: 'Draft the template', done: true },
    { id: 'cl-email-2', text: 'Send on signup', done: false },
  ],
})
item('st-sso', 'SSO buttons', 't-story', {
  size: 2,
  blocked: true,
  blockedReason: 'Gateway contract not ready',
  log: [
    { id: 'log-sso-1', at: T, kind: 'created' },
    { id: 'log-sso-2', at: T + 2 * 3_600_000, kind: 'blocked', note: 'Gateway contract not ready' },
  ],
})
item('df-signup', 'Signup validation on retry', 't-bug', { size: 2 })

// Cards — Team Nova.
item('st-welcome-copy', 'Welcome copy', 't-story', { size: 1 })
item('st-tour', 'Guided tour', 't-story', { size: 5, assignees: ['u-lm'] })
item('st-gateway-contract', 'Define gateway contract', 't-story', { size: 5, assignees: ['u-jt'] })
item('st-ratelimit', 'Rate limiting', 't-story', {
  size: 3,
  blocked: true,
  blockedReason: 'Awaiting capacity review',
  log: [
    { id: 'log-rl-1', at: T + 3_600_000, kind: 'created' },
    { id: 'log-rl-2', at: T + 5 * 3_600_000, kind: 'blocked', note: 'Awaiting capacity review' },
  ],
})
item('sp-gateway', 'Spike: gateway options', 't-spike', { size: 2 })

// A filed-away initiative: off the boards, but still linked and searchable.
item('init-legacy', 'Legacy SSO migration', 't-initiative', {
  size: 13,
  assignees: ['u-jt'],
  archived: true,
  archivedAt: T + 86_400_000,
  log: [
    { id: 'log-legacy-1', at: T, kind: 'created' },
    { id: 'log-legacy-2', at: T + 86_400_000, kind: 'archived' },
  ],
})
item('st-legacy-a', 'Retire legacy auth endpoint', 't-story', {
  size: 3,
  archived: true,
  archivedAt: T + 86_400_000,
  log: [
    { id: 'log-legacy-a-1', at: T, kind: 'created' },
    { id: 'log-legacy-a-2', at: T + 86_400_000, kind: 'archived' },
  ],
})

/* ------------------------------------------------------------------ *
 * Placements
 * ------------------------------------------------------------------ */
const placements: Placement[] = []
let placeSeq = 0
const place = (itemId: string, boardId: string, laneId: string) =>
  placements.push({ id: `pl-${++placeSeq}`, boardId, itemId, laneId })

// Company strategy + line of business. Initiatives are placed in the board's *initiatives*
// workflow — the team's card lanes are a different tree.
place('init-activation', 'b-strategy', st.init.ns.id)
place('init-efficiency', 'b-strategy', st.init.ns.id)
place('init-explore', 'b-strategy', st.init.backlog.id) // uncommitted inventory
place('init-growth', 'b-lob', lob.init.ns.id)
place('init-delivery', 'b-delivery', del.init.ns.id)

// Growth value stream.
place('init-onboarding', 'b-portfolio', p.init.ns.id)
place('init-platform', 'b-portfolio', p.init.backlog.id) // uncommitted inventory

// Team Atlas — committed onboarding work.
place('init-signup', 'b-atlas', a.init.ns.id)
place('st-signup-design', 'b-atlas', a.done.id)
place('st-signup-form', 'b-atlas', a.dev.id)
place('st-email', 'b-atlas', a.ns.id)
place('st-sso', 'b-atlas', a.test!.id)
place('df-signup', 'b-atlas', a.test!.id)

// Team Nova — committed welcome work + uncommitted gateway work.
place('init-welcome', 'b-nova', n.init.ns.id)
place('st-welcome-copy', 'b-nova', n.ns.id)
place('st-tour', 'b-nova', n.dev.id)
place('init-gateway', 'b-nova', n.init.ns.id)
place('st-gateway-contract', 'b-nova', n.backlog.id)
place('st-ratelimit', 'b-nova', n.backlog.id)
place('sp-gateway', 'b-nova', n.backlog.id)

// Archived work keeps its placement record (its last board/lane) but is hidden.
place('init-legacy', 'b-nova', n.init.done.id)
place('st-legacy-a', 'b-nova', n.done.id)

/* ------------------------------------------------------------------ *
 * Edges
 * ------------------------------------------------------------------ */
const edges: Edge[] = []
let edgeSeq = 0
const edge = (kind: Edge['kind'], from: string, to: string) =>
  edges.push({ id: `e-${++edgeSeq}`, kind, from, to })
const decompose = (parent: string, children: string[]) =>
  children.forEach((c) => edge('decomposition', parent, c))

// The chain: strategic → line of business → value stream → team → cards.
decompose('init-activation', ['init-growth'])
decompose('init-efficiency', ['init-delivery'])
decompose('init-growth', ['init-onboarding', 'init-platform'])
decompose('init-onboarding', ['init-signup', 'init-welcome'])
decompose('init-platform', ['init-gateway'])
decompose('init-signup', ['st-signup-design', 'st-signup-form', 'st-email', 'st-sso', 'df-signup'])
decompose('init-welcome', ['st-welcome-copy', 'st-tour'])
decompose('init-gateway', ['st-gateway-contract', 'st-ratelimit', 'sp-gateway'])
decompose('init-legacy', ['st-legacy-a'])

// Links: the only item-to-item connection — "to depends on from". They never set an
// item's blocked status.
const links: ItemLink[] = []
let linkSeq = 0
const link = (from: string, to: string, extra: Partial<ItemLink> = {}) =>
  links.push({ id: `lnk-${++linkSeq}`, from, to, ...extra })

// A Platform dependency of Team Atlas work (cross-team).
link('init-gateway', 'st-email', { reason: 'Email verification needs the gateway contract' })
link('init-gateway', 'st-sso', { reason: 'SSO goes through the gateway' })
link('st-signup-form', 'st-tour', { reason: 'Tour depends on the new signup flow' })

// Attribution — informs, never counts as WIP. OKRs map to initiatives only;
// cards map to initiatives through the hierarchy, never to objectives directly.
edge('attribution', 'obj-activation', 'init-activation')
edge('attribution', 'obj-efficiency', 'init-efficiency')

export function createSeed(): FlowState {
  return {
    users: structuredClone(users),
    issueTypes: structuredClone(issueTypes),
    boards: structuredClone(boards),
    lanes: structuredClone(lanes),
    items: structuredClone(items),
    placements: structuredClone(placements),
    edges: structuredClone(edges),
    links: structuredClone(links),
    objectives: structuredClone(objectives),
    keyResults: structuredClone(keyResults),
    boardTemplates: structuredClone(BUILT_IN_TEMPLATES),
  }
}
