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

/* ------------------------------------------------------------------ *
 * Boards. Every board's top level is the three typed columns.
 * ------------------------------------------------------------------ */
const boards: Board[] = [
  { id: 'b-portfolio', name: 'Digital Transformation Portfolio', level: 'portfolio', derived: true },
  { id: 'b-core', name: 'Core Experience', level: 'project' },
  { id: 'b-platform', name: 'Platform Services', level: 'project' },
  { id: 'b-design', name: 'Design board (sketch)', level: 'team' },
  { id: 'b-team-alpha', name: 'Team Alpha', level: 'team' },
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

// Portfolio (derived): initiatives land by rollup onto the three typed columns.
const pRoot = root('b-portfolio', 'columns')
const pNS = lane('b-portfolio', 'Not Started', pRoot.id, 0, { stage: 'notStarted' })
lane('b-portfolio', 'In Progress', pRoot.id, 1, { stage: 'inProgress' })
lane('b-portfolio', 'Done', pRoot.id, 2, { stage: 'done' })

// Core Experience: three typed columns, each split into team rows. In Progress refines
// Team Alpha into Dev / Test.
const cRoot = root('b-core', 'columns')
const cNS = lane('b-core', 'Not Started', cRoot.id, 0, { stage: 'notStarted', orientation: 'rows' })
const cNSAlpha = lane('b-core', 'Team Alpha', cNS.id, 0)
const cNSBravo = lane('b-core', 'Team Bravo', cNS.id, 1)
const cIP = lane('b-core', 'In Progress', cRoot.id, 1, { stage: 'inProgress', orientation: 'rows' })
const cIPAlpha = lane('b-core', 'Team Alpha', cIP.id, 0, { orientation: 'columns' })
const cIPDev = lane('b-core', 'Dev', cIPAlpha.id, 0)
const cIPTest = lane('b-core', 'Test', cIPAlpha.id, 1)
const cIPBravo = lane('b-core', 'Team Bravo', cIP.id, 1)
const cDone = lane('b-core', 'Done', cRoot.id, 2, { stage: 'done', orientation: 'rows' })
const cDoneAlpha = lane('b-core', 'Team Alpha', cDone.id, 0)
lane('b-core', 'Team Bravo', cDone.id, 1)

// Platform Services: three typed columns.
const plRoot = root('b-platform', 'columns')
const plNS = lane('b-platform', 'Not Started', plRoot.id, 0, { stage: 'notStarted' })
const plIP = lane('b-platform', 'In Progress', plRoot.id, 1, { stage: 'inProgress' })
lane('b-platform', 'Done', plRoot.id, 2, { stage: 'done' })

// Design board (sketch): To Do | Doing | Done, where Doing is row-split into a
// (Build/Test/Deploy) row and a Projects row (Research/Validate).
const dRoot = root('b-design', 'columns')
lane('b-design', 'To Do', dRoot.id, 0, { stage: 'notStarted' })
const dDoing = lane('b-design', 'Doing', dRoot.id, 1, { orientation: 'rows', stage: 'inProgress' })
const dBuildRow = lane('b-design', '', dDoing.id, 0, { orientation: 'columns' })
const dBuild = lane('b-design', 'Build', dBuildRow.id, 0)
lane('b-design', 'Test', dBuildRow.id, 1)
const dDeploy = lane('b-design', 'Deploy', dBuildRow.id, 2)
const dProjects = lane('b-design', 'Projects', dDoing.id, 1, { orientation: 'columns', wipLimit: 4 })
const dResearch = lane('b-design', 'Research', dProjects.id, 0)
lane('b-design', 'Validate', dProjects.id, 1)
const dDone = lane('b-design', 'Done', dRoot.id, 2, { stage: 'done' })

// Team Alpha: the canonical team board — three typed columns, In Progress split into Dev/Test.
const tRoot = root('b-team-alpha', 'columns')
const tNotStarted = lane('b-team-alpha', 'Not Started', tRoot.id, 0, { stage: 'notStarted' })
const tProgress = lane('b-team-alpha', 'In Progress', tRoot.id, 1, { stage: 'inProgress', orientation: 'columns' })
const tDev = lane('b-team-alpha', 'Dev', tProgress.id, 0)
const tTest = lane('b-team-alpha', 'Test', tProgress.id, 1)
const tDone = lane('b-team-alpha', 'Done', tRoot.id, 2, { stage: 'done' })

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
item('it-beta', 'Beta Launch', 't-initiative', { size: 20 })
item('feat-beta', 'Closed beta', 't-feature', { size: 8 })
item('story-beta', 'Ship beta to pilot cohort', 't-story', { size: 5 })
item('it-research', 'Customer Research', 't-initiative', { size: 15 })
item('feat-research', 'Discovery programme', 't-feature', { size: 5 })
item('story-research', 'Discovery interviews', 't-story', { size: 3 })

/* ------------------------------------------------------------------ *
 * Placements — membership + the stored cell. On a derived board the column
 * is computed from the lowest-level work instead.
 * ------------------------------------------------------------------ */
const placements: Placement[] = []
let placeSeq = 0
const place = (itemId: string, boardId: string, laneId: string) =>
  placements.push({ id: `pl-${++placeSeq}`, boardId, itemId, laneId })

// Portfolio (derived) — membership only; the column is the rollup.
place('it-onboarding', 'b-portfolio', pNS.id)
place('it-signup', 'b-portfolio', pNS.id)
place('it-beta', 'b-portfolio', pNS.id)
place('it-research', 'b-portfolio', pNS.id)

// Core Experience — cells live under the typed columns, within team rows.
place('it-tour', 'b-core', cNSAlpha.id)
place('it-profile', 'b-core', cIPBravo.id)
place('it-invite', 'b-core', cNSBravo.id)
place('st-design', 'b-core', cDoneAlpha.id)
place('st-form', 'b-core', cIPDev.id)
place('st-email', 'b-core', cNSAlpha.id)
place('st-sso', 'b-core', cIPTest.id)
for (let i = 0; i < 12; i++) place(`st-gen-${i}`, 'b-core', i % 5 === 0 ? cIPDev.id : cNSAlpha.id)
place('df-validation', 'b-core', cIPTest.id)
place('st-tour-framework', 'b-core', cIPDev.id)
place('st-tour-copy', 'b-core', cNSAlpha.id)
place('st-profile-schema', 'b-core', cNSBravo.id)
place('st-avatar', 'b-core', cNSBravo.id)
place('st-completeness', 'b-core', cIPBravo.id)
place('st-invite-flow', 'b-core', cNSBravo.id)
place('st-invite-roles', 'b-core', cNSBravo.id)
place('st-spike-cache', 'b-core', cIPBravo.id)
place('story-beta', 'b-core', cDoneAlpha.id)
place('story-research', 'b-core', cNSAlpha.id)

// Platform Services.
place('it-api', 'b-platform', plIP.id)
place('it-analytics', 'b-platform', plNS.id)
place('st-api-contract', 'b-platform', plIP.id)
place('st-sdk', 'b-platform', plNS.id)

// Design board.
place('st-gen-0', 'b-design', dBuild.id)
place('st-gen-1', 'b-design', dDeploy.id)
place('st-gen-2', 'b-design', dResearch.id)
place('st-gen-3', 'b-design', dDone.id)

// Team Alpha — the same cards flowing through the team's typed columns.
place('st-gen-6', 'b-team-alpha', tNotStarted.id)
place('st-gen-5', 'b-team-alpha', tDev.id)
place('st-gen-10', 'b-team-alpha', tTest.id)
place('st-design', 'b-team-alpha', tDone.id)

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
decompose('it-beta', ['feat-beta'])
decompose('feat-beta', ['story-beta'])
decompose('it-research', ['feat-research'])
decompose('feat-research', ['story-research'])

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
