import type { Board, Edge, FlowState, IssueType, Item, Lane, Placement, Objective } from './types'

const T = Date.UTC(2026, 9, 1, 9, 0, 0)

/* ------------------------------------------------------------------ *
 * Custom issue types — labels + colour. Columns live on boards, not types.
 * ------------------------------------------------------------------ */
const issueTypes: IssueType[] = [
  { id: 't-initiative', name: 'Initiative', color: '#6366f1' },
  { id: 't-feature', name: 'Feature', color: '#8b5cf6' },
  { id: 't-story', name: 'User Story', color: '#0ea5e9' },
  { id: 't-task', name: 'Task', color: '#64748b' },
  { id: 't-bug', name: 'Bug', color: '#f43f5e' },
  { id: 't-spike', name: 'Spike', color: '#f59e0b' },
]

/* ------------------------------------------------------------------ *
 * Boards — each owns a LeanKit lane tree.
 * ------------------------------------------------------------------ */
const boards: Board[] = [
  { id: 'b-portfolio', name: 'Digital Transformation Portfolio' },
  { id: 'b-core', name: 'Core Experience' },
  { id: 'b-platform', name: 'Platform Services' },
]

const lanes: Lane[] = []
let laneSeq = 0
function lane(
  boardId: string,
  axis: 'vertical' | 'horizontal',
  name: string,
  order: number,
  parentId: string | null = null,
  flags: Partial<Pick<Lane, 'isStart' | 'isDone' | 'isCancelled' | 'wipLimit'>> = {},
): Lane {
  const l: Lane = { id: `lane-${++laneSeq}`, boardId, axis, parentId, name, order, ...flags }
  lanes.push(l)
  return l
}

// Portfolio board: vertical (initiative lifecycle), no horizontal lanes.
lane('b-portfolio', 'vertical', 'Idea', 0, null, { isStart: true })
lane('b-portfolio', 'vertical', 'Option', 1)
const pBet = lane('b-portfolio', 'vertical', 'Bet', 2)
const pCommitted = lane('b-portfolio', 'vertical', 'Committed', 3, null, { isDone: true })
lane('b-portfolio', 'vertical', 'Rejected', 4, null, { isCancelled: true })
lane('b-portfolio', 'vertical', 'Dormant', 5, null, { isStart: true })

// Core Experience board: a column split (In Progress -> Dev / Test).
const coreBacklog = lane('b-core', 'vertical', 'Backlog', 0, null, { isStart: true })
const coreProgress = lane('b-core', 'vertical', 'In Progress', 1)
const coreDev = lane('b-core', 'vertical', 'Dev', 0, coreProgress.id)
const coreTest = lane('b-core', 'vertical', 'Test', 1, coreProgress.id)
const coreReview = lane('b-core', 'vertical', 'Review', 2)
const coreDone = lane('b-core', 'vertical', 'Done', 3, null, { isDone: true })
const coreAlpha = lane('b-core', 'horizontal', 'Team Alpha', 0, null, { wipLimit: 10 })
const coreBravo = lane('b-core', 'horizontal', 'Team Bravo', 1, null, { wipLimit: 8 })

// Platform board.
const platBacklog = lane('b-platform', 'vertical', 'Backlog', 0, null, { isStart: true })
const platProgress = lane('b-platform', 'vertical', 'In Progress', 1)
lane('b-platform', 'vertical', 'Done', 2, null, { isDone: true })
const platTeam = lane('b-platform', 'horizontal', 'Team Platform', 0)

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */
const items: Item[] = []
const item = (id: string, title: string, typeId: string, extra: Partial<Item> = {}) => {
  items.push({ id, title, typeId, createdAt: T, ...extra })
}

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
 * Placements — the explicit board + cell (a card can be on several boards)
 * ------------------------------------------------------------------ */
const placements: Placement[] = []
let placeSeq = 0
function place(itemId: string, boardId: string, columnLaneId: string, rowLaneId: string | null = null) {
  placements.push({ id: `pl-${++placeSeq}`, boardId, itemId, columnLaneId, rowLaneId })
}

// Portfolio board.
place('it-onboarding', 'b-portfolio', pBet.id)

// it-signup sits on TWO boards — one identity, two renderings.
place('it-signup', 'b-core', coreDev.id, coreAlpha.id)
place('it-signup', 'b-portfolio', pCommitted.id)

// Core Experience board.
place('it-tour', 'b-core', coreBacklog.id, coreAlpha.id)
place('it-profile', 'b-core', coreReview.id, coreBravo.id)
place('it-invite', 'b-core', coreBacklog.id, coreBravo.id)

place('st-design', 'b-core', coreDone.id, coreAlpha.id)
place('st-form', 'b-core', coreDev.id, coreAlpha.id)
place('st-email', 'b-core', coreBacklog.id, coreAlpha.id)
place('st-sso', 'b-core', coreTest.id, coreAlpha.id)
for (let i = 0; i < 12; i++) {
  place(`st-gen-${i}`, 'b-core', i % 5 === 0 ? coreDev.id : coreBacklog.id, coreAlpha.id)
}
place('df-validation', 'b-core', coreTest.id, coreAlpha.id)

place('st-tour-framework', 'b-core', coreDev.id, coreAlpha.id)
place('st-tour-copy', 'b-core', coreBacklog.id, coreAlpha.id)

place('st-profile-schema', 'b-core', coreBacklog.id, coreBravo.id)
place('st-avatar', 'b-core', coreBacklog.id, coreBravo.id)
place('st-completeness', 'b-core', coreDev.id, coreBravo.id)

place('st-invite-flow', 'b-core', coreBacklog.id, coreBravo.id)
place('st-invite-roles', 'b-core', coreBacklog.id, coreBravo.id)
place('st-spike-cache', 'b-core', coreProgress.id, coreBravo.id)

// Platform board.
place('it-api', 'b-platform', platProgress.id, platTeam.id)
place('it-analytics', 'b-platform', platBacklog.id, platTeam.id)
place('st-api-contract', 'b-platform', platProgress.id, platTeam.id)
place('st-sdk', 'b-platform', platBacklog.id, platTeam.id)

/* ------------------------------------------------------------------ *
 * Edges — one parent per child (decomposition), dependencies, attribution
 * ------------------------------------------------------------------ */
const edges: Edge[] = []
let edgeSeq = 0
const edge = (kind: Edge['kind'], from: string, to: string, dep?: Edge['dep']) =>
  edges.push({ id: `e-${++edgeSeq}`, kind, from, to, dep })

const decompose = (parent: string, children: string[]) =>
  children.forEach((c) => edge('decomposition', parent, c))

decompose('it-onboarding', ['it-signup', 'it-tour', 'it-profile', 'it-invite'])
decompose('it-signup', [
  'st-design',
  'st-form',
  'st-email',
  'st-sso',
  'df-validation',
  ...items.filter((i) => i.id.startsWith('st-gen-')).map((i) => i.id),
])
decompose('it-tour', ['st-tour-framework', 'st-tour-copy'])
decompose('it-profile', ['st-profile-schema', 'st-avatar', 'st-completeness', 'st-spike-cache'])
decompose('it-invite', ['st-invite-flow', 'st-invite-roles'])
decompose('it-api', ['st-api-contract'])
decompose('it-analytics', ['st-sdk'])

// Dependencies (blocker -> dependent). Confirmed edges bind.
edge('dependency', 'it-api', 'st-profile-schema', { fsKind: 'FS', status: 'confirmed', pinTo: 'st-api-contract', reason: 'Profile writes depend on the API contract' })
edge('dependency', 'it-api', 'st-sdk', { fsKind: 'FS', status: 'confirmed', pinTo: 'st-api-contract', reason: 'SDK is generated from the contract' })
edge('dependency', 'it-signup', 'st-completeness', { fsKind: 'FS', status: 'confirmed', reason: 'Meter reads events the signup flow emits' })
edge('dependency', 'it-analytics', 'st-invite-flow', { fsKind: 'FS', status: 'proposed', reason: 'Invite funnel needs event tracking' })

// Attribution — informs, never counts.
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
