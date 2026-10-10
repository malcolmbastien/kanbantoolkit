import type { Board, Edge, FlowState, IssueType, Item, Lane, Placement, Objective, SplitOrientation } from './types'

const T = Date.UTC(2026, 9, 1, 9, 0, 0)

const issueTypes: IssueType[] = [
  { id: 't-initiative', name: 'Initiative', color: '#6366f1' },
  { id: 't-feature', name: 'Feature', color: '#8b5cf6' },
  { id: 't-story', name: 'User Story', color: '#0ea5e9' },
  { id: 't-task', name: 'Task', color: '#64748b' },
  { id: 't-bug', name: 'Bug', color: '#f43f5e' },
  { id: 't-spike', name: 'Spike', color: '#f59e0b' },
]

const boards: Board[] = [
  { id: 'b-portfolio', name: 'Digital Transformation Portfolio' },
  { id: 'b-core', name: 'Core Experience' },
  { id: 'b-platform', name: 'Platform Services' },
  { id: 'b-design', name: 'Design board (sketch)' },
]

/* ------------------------------------------------------------------ *
 * Lanes — a recursive tree. A leaf is a cell; a container arranges its
 * children in columns (side by side) or rows (stacked).
 * ------------------------------------------------------------------ */
const lanes: Lane[] = []
let seq = 0
function lane(
  boardId: string,
  name: string,
  parentId: string | null,
  order: number,
  opts: Partial<Pick<Lane, 'orientation' | 'wipLimit' | 'isStart' | 'isDone' | 'isCancelled'>> = {},
): Lane {
  const l: Lane = { id: `lane-${++seq}`, boardId, name, parentId, order, ...opts }
  lanes.push(l)
  return l
}
const roots: Record<string, Lane> = {}
const root = (boardId: string, orientation: SplitOrientation) => {
  const r = lane(boardId, '', null, 0, { orientation })
  roots[boardId] = r
  return r
}

// Portfolio: a single row of state columns.
const pRoot = root('b-portfolio', 'columns')
lane('b-portfolio', 'Idea', pRoot.id, 0, { isStart: true })
lane('b-portfolio', 'Option', pRoot.id, 1)
const pBet = lane('b-portfolio', 'Bet', pRoot.id, 2)
const pCommitted = lane('b-portfolio', 'Committed', pRoot.id, 3, { isDone: true })
lane('b-portfolio', 'Rejected', pRoot.id, 4, { isCancelled: true })
lane('b-portfolio', 'Dormant', pRoot.id, 5, { isStart: true })

// Core Experience: two team rows; Team Alpha's In Progress is split, Team Bravo's is not
// (a local split — the grid is deliberately non-uniform).
const cRoot = root('b-core', 'rows')

const alpha = lane('b-core', 'Team Alpha', cRoot.id, 0, { orientation: 'columns', wipLimit: 12 })
const aBacklog = lane('b-core', 'Backlog', alpha.id, 0, { isStart: true })
const aProgress = lane('b-core', 'In Progress', alpha.id, 1, { orientation: 'columns' })
const aDev = lane('b-core', 'Dev', aProgress.id, 0)
const aTest = lane('b-core', 'Test', aProgress.id, 1)
lane('b-core', 'Review', alpha.id, 2)
const aDone = lane('b-core', 'Done', alpha.id, 3, { isDone: true })

const bravo = lane('b-core', 'Team Bravo', cRoot.id, 1, { orientation: 'columns', wipLimit: 8 })
const bBacklog = lane('b-core', 'Backlog', bravo.id, 0, { isStart: true })
const bProgress = lane('b-core', 'In Progress', bravo.id, 1)
lane('b-core', 'Review', bravo.id, 2)
const bReview = lanes[lanes.length - 1]
const bDone = lane('b-core', 'Done', bravo.id, 3, { isDone: true })

// Platform: columns only.
const plRoot = root('b-platform', 'columns')
const plBacklog = lane('b-platform', 'Backlog', plRoot.id, 0, { isStart: true })
const plProgress = lane('b-platform', 'In Progress', plRoot.id, 1)
const plDone = lane('b-platform', 'Done', plRoot.id, 2, { isDone: true })

// Design board — mirrors the hand-drawn sketch: To Do | Doing | Done, where Doing is
// row-split into a (Build/Test/Deploy) row and a Projects row (Research/Validate).
const dRoot = root('b-design', 'columns')
lane('b-design', 'To Do', dRoot.id, 0, { isStart: true })
const dDoing = lane('b-design', 'Doing', dRoot.id, 1, { orientation: 'rows' })
const dBuildRow = lane('b-design', '', dDoing.id, 0, { orientation: 'columns' })
const dBuild = lane('b-design', 'Build', dBuildRow.id, 0)
lane('b-design', 'Test', dBuildRow.id, 1)
const dDeploy = lane('b-design', 'Deploy', dBuildRow.id, 2)
const dProjects = lane('b-design', 'Projects', dDoing.id, 1, { orientation: 'columns', wipLimit: 4 })
const dResearch = lane('b-design', 'Research', dProjects.id, 0)
lane('b-design', 'Validate', dProjects.id, 1)
const dDone = lane('b-design', 'Done', dRoot.id, 2, { isDone: true })

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */
const items: Item[] = []
const item = (id: string, title: string, typeId: string, extra: Partial<Item> = {}) =>
  items.push({ id, title, typeId, createdAt: T, ...extra })

item('it-onboarding', 'Onboarding Redesign', 't-initiative', { size: 40, assignee: 'MB' })
item('it-signup', 'New signup flow', 't-feature', { size: 13, assignee: 'RK' })
item('it-tour', 'Guided onboarding tour', 't-feature', { size: 8, assignee: 'LM' })
item('it-profile', 'Profile completeness', 't-feature', { size: 5, assignee: 'SP' })
item('it-invite', 'Invite & team setup', 't-feature', { size: 8 })
item('it-api', 'API decision', 't-feature', { size: 21, assignee: 'JT' })
item('it-analytics', 'Analytics pipeline', 't-feature', { size: 13 })

item('st-design', 'Design signup form', 't-story', { size: 3 })
item('st-form', 'Build signup form', 't-story', { size: 5 })
item('st-email', 'Email verification', 't-story', { size: 3 })
item('st-sso', 'SSO buttons', 't-story', { size: 2 })
for (let i = 0; i < 12; i++) item(`st-gen-${i}`, `Signup task ${i + 1}`, 't-story', { size: (i % 3) + 1 })
item('df-validation', 'Signup validation error on retry', 't-bug', { size: 2 })
item('st-tour-framework', 'Tour step framework', 't-story', { size: 5 })
item('st-tour-copy', 'Welcome modal copy', 't-story', { size: 1 })
item('st-profile-schema', 'Profile fields schema', 't-story', { size: 3 })
item('st-avatar', 'Avatar upload', 't-story', { size: 3 })
item('st-completeness', 'Completeness meter', 't-story', { size: 2 })
item('st-invite-flow', 'Invite flow', 't-story', { size: 3 })
item('st-invite-roles', 'Role picker', 't-story', { size: 2 })
item('st-spike-cache', 'Spike: cache strategy', 't-spike', { size: 2 })
item('st-api-contract', 'Define API contract', 't-story', { size: 5 })
item('st-sdk', 'Client SDK generation', 't-story', { size: 8 })

/* ------------------------------------------------------------------ *
 * Placements — one per board; a card sits in a leaf cell (lane).
 * ------------------------------------------------------------------ */
const placements: Placement[] = []
let placeSeq = 0
const place = (itemId: string, boardId: string, laneId: string) =>
  placements.push({ id: `pl-${++placeSeq}`, boardId, itemId, laneId })

place('it-onboarding', 'b-portfolio', pBet.id)
// one card, two boards:
place('it-signup', 'b-core', aDev.id)
place('it-signup', 'b-portfolio', pCommitted.id)

place('it-tour', 'b-core', aBacklog.id)
place('it-profile', 'b-core', bReview.id)
place('it-invite', 'b-core', bBacklog.id)

place('st-design', 'b-core', aDone.id)
place('st-form', 'b-core', aDev.id)
place('st-email', 'b-core', aBacklog.id)
place('st-sso', 'b-core', aTest.id)
for (let i = 0; i < 12; i++) place(`st-gen-${i}`, 'b-core', i % 5 === 0 ? aDev.id : aBacklog.id)
place('df-validation', 'b-core', aTest.id)
place('st-tour-framework', 'b-core', aDev.id)
place('st-tour-copy', 'b-core', aBacklog.id)
place('st-profile-schema', 'b-core', bBacklog.id)
place('st-avatar', 'b-core', bBacklog.id)
place('st-completeness', 'b-core', bProgress.id)
place('st-invite-flow', 'b-core', bBacklog.id)
place('st-invite-roles', 'b-core', bBacklog.id)
place('st-spike-cache', 'b-core', bProgress.id)

place('it-api', 'b-platform', plProgress.id)
place('it-analytics', 'b-platform', plBacklog.id)
place('st-api-contract', 'b-platform', plProgress.id)
place('st-sdk', 'b-platform', plBacklog.id)

// Design board — a few cards so the nested layout reads.
place('st-gen-0', 'b-design', dBuild.id)
place('st-gen-1', 'b-design', dDeploy.id)
place('st-gen-2', 'b-design', dResearch.id)
place('st-gen-3', 'b-design', dDone.id)

// Silence unused-var checks on lanes only referenced structurally.
void bDone
void plDone

/* ------------------------------------------------------------------ *
 * Edges
 * ------------------------------------------------------------------ */
const edges: Edge[] = []
let edgeSeq = 0
const edge = (kind: Edge['kind'], from: string, to: string, dep?: Edge['dep']) =>
  edges.push({ id: `e-${++edgeSeq}`, kind, from, to, dep })
const decompose = (parent: string, children: string[]) => children.forEach((c) => edge('decomposition', parent, c))

decompose('it-onboarding', ['it-signup', 'it-tour', 'it-profile', 'it-invite'])
decompose('it-signup', ['st-design', 'st-form', 'st-email', 'st-sso', 'df-validation', ...items.filter((i) => i.id.startsWith('st-gen-')).map((i) => i.id)])
decompose('it-tour', ['st-tour-framework', 'st-tour-copy'])
decompose('it-profile', ['st-profile-schema', 'st-avatar', 'st-completeness', 'st-spike-cache'])
decompose('it-invite', ['st-invite-flow', 'st-invite-roles'])
decompose('it-api', ['st-api-contract'])
decompose('it-analytics', ['st-sdk'])

edge('dependency', 'it-api', 'st-profile-schema', { fsKind: 'FS', status: 'confirmed', pinTo: 'st-api-contract', reason: 'Profile writes depend on the API contract' })
edge('dependency', 'it-api', 'st-sdk', { fsKind: 'FS', status: 'confirmed', pinTo: 'st-api-contract', reason: 'SDK is generated from the contract' })
edge('dependency', 'it-signup', 'st-completeness', { fsKind: 'FS', status: 'confirmed', reason: 'Meter reads events the signup flow emits' })
edge('dependency', 'it-analytics', 'st-invite-flow', { fsKind: 'FS', status: 'proposed', reason: 'Invite funnel needs event tracking' })

edge('attribution', 'obj-activation', 'st-form')
edge('attribution', 'obj-ttv', 'st-form')

const objectives: Objective[] = [
  { id: 'obj-activation', title: 'Increase activation', period: 'FY26 Q1', status: 'active' },
  { id: 'obj-ttv', title: 'Reduce time-to-value', period: 'FY26 Q1', status: 'active' },
]
const keyResults = [
  { id: 'kr-1', objectiveId: 'obj-activation', title: 'Activation rate +8pp' },
  { id: 'kr-2', objectiveId: 'obj-ttv', title: 'Time-to-value < 3 days' },
]

export function createSeed(): FlowState {
  return {
    issueTypes: structuredClone(issueTypes),
    boards: structuredClone(boards),
    lanes: structuredClone(lanes),
    items: structuredClone(items),
    placements: structuredClone(placements),
    edges: structuredClone(edges),
    objectives: structuredClone(objectives),
    keyResults: structuredClone(keyResults),
    sponsors: {},
  }
}
