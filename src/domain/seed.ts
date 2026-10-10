import type { Board, Edge, FlowState, Item, LimitPolicy, Objective, Scope } from './types'

const T = Date.UTC(2026, 9, 1, 9, 0, 0) // fixed clock for a deterministic seed
const DAY = 86_400_000

/* ------------------------------------------------------------------ *
 * Scopes — the structural spine. Enterprise > value streams > teams.
 * ------------------------------------------------------------------ */
const scopes: Scope[] = [
  { id: 'ent', name: 'Northwind Group', kind: 'enterprise', parentId: null },
  { id: 'vs-core', name: 'Core Experience', kind: 'value_stream', parentId: 'ent' },
  { id: 'vs-platform', name: 'Platform Services', kind: 'value_stream', parentId: 'ent' },
  { id: 'team-alpha', name: 'Team Alpha', kind: 'team', parentId: 'vs-core' },
  { id: 'team-bravo', name: 'Team Bravo', kind: 'team', parentId: 'vs-core' },
  { id: 'team-platform', name: 'Team Platform', kind: 'team', parentId: 'vs-platform' },
]

/* ------------------------------------------------------------------ *
 * Objectives — commitment-limited entities. Never in columns.
 * ------------------------------------------------------------------ */
const objectives: Objective[] = [
  { id: 'obj-activation', title: 'Increase activation', period: 'FY26 Q1', status: 'active' },
  { id: 'obj-ttv', title: 'Reduce time-to-value', period: 'FY26 Q1', status: 'active' },
]

const keyResults = [
  { id: 'kr-1', objectiveId: 'obj-activation', title: 'Activation rate +8pp' },
  { id: 'kr-2', objectiveId: 'obj-ttv', title: 'Time-to-value < 3 days' },
]

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */
const items: Item[] = []
let n = 0
const id = (p: string) => `${p}-${++n}`

function item(partial: Omit<Item, 'id' | 'createdAt'> & { id?: string }): Item {
  const created = T - (1_000_000 + (items.length % 40) * DAY)
  const it: Item = { createdAt: created, ...partial, id: partial.id ?? id('it') }
  items.push(it)
  return it
}

// The initiative (one identity across L1/L2/L3 readings).
item({
  id: 'init-onboarding',
  title: 'Onboarding Redesign',
  description: 'Re-cut first-run experience: signup, guided tour, profile, invites.',
  type: 'initiative',
  valueStreamId: 'vs-core',
  teamId: null,
  state: 'Bet',
  size: 40,
  assignee: 'MB',
})

// Epics — Core Experience has 5 (over the seeded limit of 4, for the limit demo).
item({ id: 'ep-signup', title: 'New signup flow', type: 'epic', valueStreamId: 'vs-core', teamId: 'team-alpha', state: 'In Progress', size: 13, assignee: 'RK' })
item({ id: 'ep-tour', title: 'Guided onboarding tour', type: 'epic', valueStreamId: 'vs-core', teamId: 'team-alpha', state: 'Analyze', size: 8, assignee: 'LM' })
item({ id: 'ep-profile', title: 'Profile completeness', type: 'epic', valueStreamId: 'vs-core', teamId: 'team-bravo', state: 'Ready', size: 5, assignee: 'SP' })
item({ id: 'ep-invite', title: 'Invite & team setup', type: 'epic', valueStreamId: 'vs-core', teamId: 'team-bravo', state: 'Backlog', size: 8 })
item({ id: 'ep-experiments', title: 'Onboarding experiments', type: 'epic', valueStreamId: 'vs-core', teamId: 'team-alpha', state: 'Backlog', size: 5 })

// Epics — Platform Services.
item({ id: 'ep-api', title: 'API decision', type: 'epic', valueStreamId: 'vs-platform', teamId: 'team-platform', state: 'In Progress', size: 21, assignee: 'JT' })
item({ id: 'ep-analytics', title: 'Analytics pipeline', type: 'epic', valueStreamId: 'vs-platform', teamId: 'team-platform', state: 'Backlog', size: 13 })

// Stories under signup — enough to show composition pressure on ep-signup.
item({ id: 'st-signup-design', title: 'Design signup form', type: 'story', valueStreamId: 'vs-core', teamId: 'team-alpha', state: 'Done', size: 3, resolvedAt: T - 3 * DAY })
item({ id: 'st-signup-form', title: 'Build signup form', type: 'story', valueStreamId: 'vs-core', teamId: 'team-alpha', state: 'In Progress', size: 5 })
item({ id: 'st-email-verify', title: 'Email verification', type: 'story', valueStreamId: 'vs-core', teamId: 'team-alpha', state: 'Backlog', size: 3 })
item({ id: 'st-sso', title: 'SSO buttons', type: 'story', valueStreamId: 'vs-core', teamId: 'team-alpha', state: 'Review', size: 2 })
for (let i = 0; i < 15; i++) {
  item({
    id: `st-gen-${i}`,
    title: `Signup task ${i + 1}`,
    type: 'story',
    valueStreamId: 'vs-core',
    teamId: 'team-alpha',
    state: i % 5 === 0 ? 'In Progress' : 'Backlog',
    size: (i % 3) + 1,
  })
}
item({ id: 'df-validation', title: 'Signup validation error on retry', type: 'defect', valueStreamId: 'vs-core', teamId: 'team-alpha', state: 'In Progress', size: 2 })

// Stories under tour.
item({ id: 'st-tour-framework', title: 'Tour step framework', type: 'story', valueStreamId: 'vs-core', teamId: 'team-alpha', state: 'In Progress', size: 5 })
item({ id: 'st-tour-copy', title: 'Welcome modal copy', type: 'story', valueStreamId: 'vs-core', teamId: 'team-alpha', state: 'Backlog', size: 1 })
item({ id: 'st-tour-tooltips', title: 'Tooltips', type: 'story', valueStreamId: 'vs-core', teamId: 'team-alpha', state: 'Backlog', size: 2 })

// Stories under profile (Team Bravo).
item({ id: 'st-profile-schema', title: 'Profile fields schema', type: 'story', valueStreamId: 'vs-core', teamId: 'team-bravo', state: 'Backlog', size: 3 })
item({ id: 'st-avatar', title: 'Avatar upload', type: 'story', valueStreamId: 'vs-core', teamId: 'team-bravo', state: 'Backlog', size: 3 })
item({ id: 'st-completeness', title: 'Completeness meter', type: 'story', valueStreamId: 'vs-core', teamId: 'team-bravo', state: 'In Progress', size: 2 })

// Stories under invite.
item({ id: 'st-invite-flow', title: 'Invite flow', type: 'story', valueStreamId: 'vs-core', teamId: 'team-bravo', state: 'Backlog', size: 3 })
item({ id: 'st-invite-roles', title: 'Role picker', type: 'story', valueStreamId: 'vs-core', teamId: 'team-bravo', state: 'Backlog', size: 2 })

// Story under experiments.
item({ id: 'st-exp-config', title: 'Experiment config', type: 'story', valueStreamId: 'vs-core', teamId: 'team-alpha', state: 'Backlog', size: 3 })

// Stories under the Platform epics.
item({ id: 'st-api-contract', title: 'Define API contract', type: 'story', valueStreamId: 'vs-platform', teamId: 'team-platform', state: 'In Progress', size: 5 })
item({ id: 'st-api-versioning', title: 'Versioning strategy', type: 'story', valueStreamId: 'vs-platform', teamId: 'team-platform', state: 'Backlog', size: 3 })
item({ id: 'st-analytics-schema', title: 'Event schema', type: 'story', valueStreamId: 'vs-platform', teamId: 'team-platform', state: 'Backlog', size: 5 })
item({ id: 'st-sdk', title: 'Client SDK generation', type: 'story', valueStreamId: 'vs-platform', teamId: 'team-platform', state: 'Backlog', size: 8 })

/* ------------------------------------------------------------------ *
 * Edges
 * ------------------------------------------------------------------ */
const edges: Edge[] = []
const decompose = (parent: string, children: string[]) =>
  children.forEach((to, i) => edges.push({ id: `dec-${parent}-${i}`, kind: 'decomposition', from: parent, to }))

decompose('init-onboarding', ['ep-signup', 'ep-tour', 'ep-profile', 'ep-invite', 'ep-experiments'])
decompose('ep-signup', ['st-signup-design', 'st-signup-form', 'st-email-verify', 'st-sso', 'df-validation', ...items.filter((i) => i.id.startsWith('st-gen-')).map((i) => i.id)])
decompose('ep-tour', ['st-tour-framework', 'st-tour-copy', 'st-tour-tooltips'])
decompose('ep-profile', ['st-profile-schema', 'st-avatar', 'st-completeness'])
decompose('ep-invite', ['st-invite-flow', 'st-invite-roles'])
decompose('ep-experiments', ['st-exp-config'])
decompose('ep-api', ['st-api-contract', 'st-api-versioning'])
decompose('ep-analytics', ['st-analytics-schema', 'st-sdk'])

// Dependencies. Blocker -> dependent. Only confirmed edges bind.
// ep-api (Platform) blocks three items across two streams — the blocker's own
// board looks perfectly healthy; the badge is the whole point.
edges.push({ id: 'dep-api-profile', kind: 'dependency', from: 'ep-api', to: 'st-profile-schema', dep: { fsKind: 'FS', status: 'confirmed', pinTo: 'st-api-contract', reason: 'Profile writes depend on the API contract' } })
edges.push({ id: 'dep-api-avatar', kind: 'dependency', from: 'ep-api', to: 'st-avatar', dep: { fsKind: 'FS', status: 'confirmed', pinTo: 'st-api-contract', reason: 'Upload endpoint unspecified' } })
edges.push({ id: 'dep-api-sdk', kind: 'dependency', from: 'ep-api', to: 'st-sdk', dep: { fsKind: 'FS', status: 'confirmed', pinTo: 'st-api-contract', reason: 'SDK is generated from the contract' } })
// ep-signup (Core, L2) pins onto a Team Bravo board as a boundary pin.
edges.push({ id: 'dep-signup-completeness', kind: 'dependency', from: 'ep-signup', to: 'st-completeness', dep: { fsKind: 'FS', status: 'confirmed', reason: 'Meter reads events the signup flow emits' } })
// Proposed — awaits confirmation on the blocker's board.
edges.push({ id: 'dep-analytics-invite', kind: 'dependency', from: 'ep-analytics', to: 'st-invite-flow', dep: { fsKind: 'FS', status: 'proposed', reason: 'Invite funnel needs event tracking' } })

// Attribution — informs, never composes. Never counts as WIP.
edges.push({ id: 'attr-1', kind: 'attribution', from: 'obj-activation', to: 'st-signup-form' })
edges.push({ id: 'attr-2', kind: 'attribution', from: 'obj-ttv', to: 'st-signup-form' })

/* ------------------------------------------------------------------ *
 * Limits — optional, per (resolution, itemType, scope).
 * ------------------------------------------------------------------ */
const limits: LimitPolicy[] = [
  {
    id: 'lim-epics-per-stream',
    resolution: 'L2',
    itemType: 'epic',
    scopeId: null,
    limit: 4,
    enforcement: 'soft_block',
    thresholds: { yellow: 3, red: 4 },
    effectiveFrom: T - 30 * DAY,
    effectiveUntil: null,
  },
  {
    id: 'lim-story-wip',
    resolution: 'L3',
    itemType: 'story',
    scopeId: null,
    column: 'In Progress',
    limit: 3,
    enforcement: 'warn',
    thresholds: { yellow: 2, red: 3 },
    effectiveFrom: T - 30 * DAY,
    effectiveUntil: null,
  },
]

/* ------------------------------------------------------------------ *
 * Boards — stored queries, not containers.
 * ------------------------------------------------------------------ */
const boards: Board[] = [
  { id: 'b-portfolio', name: 'Portfolio', resolution: 'L1', scopeId: 'ent' },
  { id: 'b-core-epics', name: 'Core Experience — Epics', resolution: 'L2', scopeId: 'vs-core' },
  { id: 'b-core-flow', name: 'Core Experience — Team Flow', resolution: 'L3', scopeId: 'vs-core' },
  { id: 'b-alpha', name: 'Team Alpha — Flow', resolution: 'L3', scopeId: 'team-alpha' },
  { id: 'b-bravo', name: 'Team Bravo — Flow', resolution: 'L3', scopeId: 'team-bravo' },
  { id: 'b-platform-epics', name: 'Platform Services — Epics', resolution: 'L2', scopeId: 'vs-platform' },
]

export function createSeed(): FlowState {
  return {
    scopes: structuredClone(scopes),
    items: structuredClone(items),
    edges: structuredClone(edges),
    objectives: structuredClone(objectives),
    keyResults: structuredClone(keyResults),
    limits: structuredClone(limits),
    boards: structuredClone(boards),
    sponsors: {},
  }
}
