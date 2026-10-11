import type { Board, Edge, FlowState, IssueType, Item, ItemLink, Lane, Placement, Objective, SplitOrientation } from './types'

const T = Date.UTC(2026, 9, 15, 9, 0, 0)

/* ------------------------------------------------------------------ *
 * Demo org: "Meridian". Two teams, a company portfolio, and a couple of
 * OKRs. Small but complete enough to feel the model.
 * ------------------------------------------------------------------ */
const issueTypes: IssueType[] = [
  { id: 't-initiative', name: 'Initiative', color: '#6366f1' },
  { id: 't-story', name: 'User Story', color: '#0ea5e9' },
  { id: 't-bug', name: 'Bug', color: '#f43f5e' },
  { id: 't-spike', name: 'Spike', color: '#f59e0b' },
  { id: 't-task', name: 'Task', color: '#64748b' },
]

const boards: Board[] = [
  { id: 'b-portfolio', name: 'Company Portfolio', level: 'portfolio', derived: true, teamBoardIds: ['b-atlas', 'b-nova'] },
  { id: 'b-atlas', name: 'Team Atlas', level: 'team', defaultCardTypeId: 't-story' },
  { id: 'b-nova', name: 'Team Nova', level: 'team', defaultCardTypeId: 't-story' },
]

const lanes: Lane[] = []
let seq = 0
function lane(
  boardId: string,
  name: string,
  parentId: string | null,
  order: number,
  opts: Partial<Pick<Lane, 'orientation' | 'wipLimit' | 'stage'>> = {},
): Lane {
  const l: Lane = { id: `lane-${++seq}`, boardId, name, parentId, order, ...opts }
  lanes.push(l)
  return l
}
const root = (boardId: string, orientation: SplitOrientation) => lane(boardId, '', null, 0, { orientation })

// Standard workflow: Backlog (uncommitted) + Not Started / In Progress / Done.
function workflow(boardId: string, splitProgress: boolean) {
  const r = root(boardId, 'columns')
  const backlog = lane(boardId, 'Backlog', r.id, 0, { stage: 'backlog' })
  const ns = lane(boardId, 'Not Started', r.id, 1, { stage: 'notStarted' })
  const ip = lane(boardId, 'In Progress', r.id, 2, { stage: 'inProgress', orientation: splitProgress ? 'columns' : undefined })
  const dev = splitProgress ? lane(boardId, 'Dev', ip.id, 0) : ip
  const test = splitProgress ? lane(boardId, 'Test', ip.id, 1) : undefined
  const done = lane(boardId, 'Done', r.id, 3, { stage: 'done' })
  return { r, backlog, ns, ip, dev, test, done }
}

// Company Portfolio (management): plain columns.
const p = workflow('b-portfolio', false)
// Team boards: In Progress refined into Dev / Test.
const a = workflow('b-atlas', true)
const n = workflow('b-nova', true)

// Demo WIP limits: Not Started is at its limit (yellow); Backlog is over it (red).
a.ns.wipLimit = 1
n.backlog.wipLimit = 2

/* ------------------------------------------------------------------ *
 * Objectives & Key Results (commitment-limited; never in columns)
 * ------------------------------------------------------------------ */
const objectives: Objective[] = [
  { id: 'obj-activation', title: 'Grow activation', period: 'FY26 Q1', status: 'active', score: 45 },
  { id: 'obj-efficiency', title: 'Reduce cost-to-serve', period: 'FY26 Q1', status: 'active' },
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

// Top-level initiatives (company portfolio).
item('init-onboarding', 'Onboarding Redesign', 't-initiative', { size: 34, assignee: 'MB', targetDate: '2026-12-15' })
item('init-platform', 'Platform Consolidation', 't-initiative', { size: 40, assignee: 'DS', targetDate: '2027-03-31' })

// Team-level initiatives.
item('init-signup', 'New signup flow', 't-initiative', { size: 13, assignee: 'RK', targetDate: '2026-11-30' })
item('init-welcome', 'Welcome experience', 't-initiative', { size: 8, assignee: 'LM', targetDate: '2026-11-15' })
item('init-gateway', 'API gateway', 't-initiative', { size: 21, assignee: 'JT', targetDate: '2027-02-28' })

// Cards — Team Atlas.
item('st-signup-design', 'Design signup screens', 't-story', { size: 3 })
item('st-signup-form', 'Build signup form', 't-story', {
  size: 5,
  assignee: 'RK',
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
item('st-tour', 'Guided tour', 't-story', { size: 5, assignee: 'LM' })
item('st-gateway-contract', 'Define gateway contract', 't-story', { size: 5, assignee: 'JT' })
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
  assignee: 'JT',
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

// Company Portfolio.
place('init-onboarding', 'b-portfolio', p.ns.id)
place('init-platform', 'b-portfolio', p.backlog.id) // uncommitted inventory

// Team Atlas — committed onboarding work.
place('init-signup', 'b-atlas', a.ns.id)
place('st-signup-design', 'b-atlas', a.done.id)
place('st-signup-form', 'b-atlas', a.dev.id)
place('st-email', 'b-atlas', a.ns.id)
place('st-sso', 'b-atlas', a.test!.id)
place('df-signup', 'b-atlas', a.test!.id)

// Team Nova — committed welcome work + uncommitted gateway work.
place('init-welcome', 'b-nova', n.ns.id)
place('st-welcome-copy', 'b-nova', n.ns.id)
place('st-tour', 'b-nova', n.dev.id)
place('init-gateway', 'b-nova', n.ns.id)
place('st-gateway-contract', 'b-nova', n.backlog.id)
place('st-ratelimit', 'b-nova', n.backlog.id)
place('sp-gateway', 'b-nova', n.backlog.id)

// Archived work keeps its placement record (its last board/lane) but is hidden.
place('init-legacy', 'b-nova', n.done.id)
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

// Attribution — informs, never counts as WIP.
edge('attribution', 'obj-activation', 'init-onboarding')
edge('attribution', 'obj-activation', 'init-signup')
edge('attribution', 'obj-activation', 'init-welcome')
edge('attribution', 'obj-efficiency', 'init-platform')
edge('attribution', 'obj-efficiency', 'init-gateway')
// One story serving two objectives — still a single unit of work.
edge('attribution', 'obj-activation', 'st-signup-form')
edge('attribution', 'obj-efficiency', 'st-signup-form')

export function createSeed(): FlowState {
  return {
    issueTypes: structuredClone(issueTypes),
    boards: structuredClone(boards),
    lanes: structuredClone(lanes),
    items: structuredClone(items),
    placements: structuredClone(placements),
    edges: structuredClone(edges),
    links: structuredClone(links),
    objectives: structuredClone(objectives),
    keyResults: structuredClone(keyResults),
  }
}
