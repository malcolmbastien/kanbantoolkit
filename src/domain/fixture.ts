import type { Edge, FlowState, Item, ItemLink, ItemLogEntry, Lane, Objective, Placement, Stage } from './types'
import { demoWorkspace } from './demo'

/**
 * The world the tests run in.
 *
 * It is built on the same boards as the demo (`demo.ts`) and carries its own work: a handful of
 * cards whose ids and states the unit tests name — a blocked card, a card waiting on another
 * board's initiative, a card with a checklist, a delivered card, an archived one. The demo
 * dataset is for people to look at and will change as the story does; this is for assertions and
 * should stay still, which is the whole reason the two are separate.
 */

const T = Date.UTC(2026, 9, 15, 9, 0, 0)
const DAY = 86_400_000

export function createFixture(): FlowState {
  const { users, issueTypes, boards, lanes, boardTemplates, st, lob, del, p, a, n } = demoWorkspace()
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
    { id: 'kr-activation', objectiveId: 'obj-activation', title: 'Activation rate +10pp' },
    { id: 'kr-completion', objectiveId: 'obj-activation', title: 'Signup completion 90%' },
    { id: 'kr-tickets', objectiveId: 'obj-efficiency', title: 'Support tickets −30%' },
  ]

  /* ------------------------------------------------------------------ *
   * Items
   * ------------------------------------------------------------------ */
  const items: Item[] = []
  const item = (id: string, title: string, typeId: string, extra: Partial<Item> = {}) =>
    items.push({ id, title, typeId, createdAt: T, ...extra })

  /**
   * A card's journey, back-dated. The app records moves as they happen (each one carrying the
   * stage it landed in), so a board seeded today would otherwise have no history at all and the
   * flow view would have nothing to read — which is exactly what the demo must not do.
   */
  const moved = (id: string, at: number, from: Lane, to: Lane, fromStage: Stage, toStage: Stage, boardId = 'b-atlas'): ItemLogEntry => ({
    id,
    at,
    kind: 'moved',
    note: `${from.name} → ${to.name}`,
    boardId,
    fromLaneId: from.id,
    toLaneId: to.id,
    fromStage,
    toStage,
  })

  // Strategic initiatives (company strategy) — the top of the chain. OKRs attach
  // here and everything below inherits through the decomposition.
  item('init-activation', 'Activation Programme', 't-initiative', { assignees: ['u-mb'], targetStartDate: '2026-10-01', targetEndDate: '2027-03-31' })
  item('init-efficiency', 'Operating Efficiency', 't-initiative', { assignees: ['u-ds'], targetStartDate: '2026-10-01', targetEndDate: '2027-03-31' })
  // Deliberately carries no OKR — an L3 coverage gap to demonstrate.
  item('init-explore', 'Exploration Portfolio', 't-initiative', { assignees: ['u-jt'], targetEndDate: '2027-06-30' })
  // Line-of-business initiative.
  item('init-growth', 'Customer Growth', 't-initiative', { assignees: ['u-ds'], targetStartDate: '2026-10-01', targetEndDate: '2027-01-31' })
  // Program initiative (Product Delivery) — bridges the teams to the portfolio.
  item('init-delivery', 'Delivery Excellence', 't-initiative', { assignees: ['u-lm'], targetEndDate: '2027-02-28' })
  // Value-stream initiatives.
  item('init-onboarding', 'Onboarding Redesign', 't-initiative', { assignees: ['u-mb'], targetStartDate: '2026-10-01', targetEndDate: '2026-12-15' })
  item('init-platform', 'Platform Consolidation', 't-initiative', { assignees: ['u-ds'], targetStartDate: '2026-11-01', targetEndDate: '2027-03-31' })

  // Team-level initiatives.
  item('init-signup', 'New signup flow', 't-initiative', { assignees: ['u-rk'], targetEndDate: '2026-11-30' })
  item('init-welcome', 'Welcome experience', 't-initiative', { assignees: ['u-lm'], targetEndDate: '2026-11-15' })
  item('init-gateway', 'API gateway', 't-initiative', { assignees: ['u-jt'], targetEndDate: '2027-02-28' })

  // Cards — Team Atlas.
  item('st-signup-design', 'Design signup screens', 't-story', {
    createdAt: T - 58 * DAY,
    // Long in the making, delivered this week: the slowest card on the board, and the one the
    // flow view's tail is honest about.
    resolvedAt: T - 2 * DAY,
    log: [
      { id: 'log-design-1', at: T - 58 * DAY, kind: 'created' },
      moved('log-design-2', T - 56 * DAY, a.backlog, a.ns, 'backlog', 'notStarted'),
      moved('log-design-3', T - 45 * DAY, a.ns, a.ip, 'notStarted', 'inProgress'),
      moved('log-design-4', T - 2 * DAY, a.ip, a.done, 'inProgress', 'done'),
    ],
  })
  item('st-signup-form', 'Build signup form', 't-story', {
    createdAt: T - 20 * DAY,
    assignees: ['u-rk', 'u-mb'],
    log: [
      { id: 'log-form-1', at: T - 20 * DAY, kind: 'created' },
      moved('log-form-2', T - 14 * DAY, a.backlog, a.ns, 'backlog', 'notStarted'),
      moved('log-form-3', T - 6 * DAY, a.ns, a.dev!, 'notStarted', 'inProgress'),
    ],
    checklist: [
      { id: 'cl-form-1', text: 'Form markup + validation', done: true },
      { id: 'cl-form-2', text: 'Wire up the API call', done: true },
      { id: 'cl-form-3', text: 'Error states', done: false },
      { id: 'cl-form-4', text: 'Analytics events', done: false },
    ],
  })
  item('st-email', 'Email verification', 't-story', {
    createdAt: T - 35 * DAY,
    log: [
      { id: 'log-email-1', at: T - 35 * DAY, kind: 'created' },
      moved('log-email-3', T - 30 * DAY, a.backlog, a.ns, 'backlog', 'notStarted'),
    ],
    checklist: [
      { id: 'cl-email-1', text: 'Draft the template', done: true },
      { id: 'cl-email-2', text: 'Send on signup', done: false },
    ],
  })
  item('st-sso', 'SSO buttons', 't-story', {
    blocked: true,
    blockedReason: 'Gateway contract not ready',
    createdAt: T - 18 * DAY,
    log: [
      { id: 'log-sso-1', at: T - 18 * DAY, kind: 'created' },
      moved('log-sso-3', T - 15 * DAY, a.backlog, a.ns, 'backlog', 'notStarted'),
      moved('log-sso-4', T - 12 * DAY, a.ns, a.test!, 'notStarted', 'inProgress'),
      { id: 'log-sso-2', at: T - 12 * DAY, kind: 'blocked', note: 'Gateway contract not ready' },
    ],
  })
  item('df-signup', 'Signup validation on retry', 't-bug')

  /**
   * Team Atlas' delivered history: cards that were created, worked, done and filed away. They keep
   * their placements — that is what archiving means here, off the board and still linked — so the
   * flow view reads the team's throughput across weeks rather than only its most recent delivery,
   * while the board itself stays about what is in front of the team.
   */
  const filed = (
    id: string,
    title: string,
    typeId: string,
    created: number,
    started: number,
    worked: number,
    done: number,
  ) =>
    item(id, title, typeId, {
      createdAt: created,
      resolvedAt: done,
      archived: true,
      archivedAt: done + DAY,
      log: [
        { id: `${id}-1`, at: created, kind: 'created' },
        moved(`${id}-2`, started, a.backlog, a.ns, 'backlog', 'notStarted'),
        moved(`${id}-3`, worked, a.ns, a.ip, 'notStarted', 'inProgress'),
        moved(`${id}-4`, done, a.ip, a.done, 'inProgress', 'done'),
        { id: `${id}-5`, at: done + DAY, kind: 'archived' },
      ],
    })

  filed('st-export-csv', 'Export the register as CSV', 't-story', T - 64 * DAY, T - 62 * DAY, T - 56 * DAY, T - 49 * DAY)
  filed('st-scim-spike', 'Spike: SCIM provisioning', 't-spike', T - 60 * DAY, T - 59 * DAY, T - 52 * DAY, T - 44 * DAY)
  filed('st-billing-handoff', 'Billing portal handoff', 't-story', T - 52 * DAY, T - 48 * DAY, T - 45 * DAY, T - 37 * DAY)
  filed('st-audit-log', 'Audit log retention', 't-story', T - 45 * DAY, T - 44 * DAY, T - 40 * DAY, T - 30 * DAY)
  filed('st-ratelimit-ui', 'Rate limit messaging', 't-story', T - 38 * DAY, T - 37 * DAY, T - 29 * DAY, T - 23 * DAY)
  filed('st-onboarding-email', 'Onboarding email sequence', 't-story', T - 33 * DAY, T - 27 * DAY, T - 24 * DAY, T - 16 * DAY)
  filed('st-legacy-import', 'Import legacy accounts', 't-story', T - 26 * DAY, T - 25 * DAY, T - 20 * DAY, T - 9 * DAY)

  // Cards — Team Nova.
  item('st-welcome-copy', 'Welcome copy', 't-story')
  item('st-tour', 'Guided tour', 't-story', { assignees: ['u-lm'] })
  item('st-gateway-contract', 'Define gateway contract', 't-story', { assignees: ['u-jt'] })
  item('st-ratelimit', 'Rate limiting', 't-story', {
    blocked: true,
    blockedReason: 'Awaiting capacity review',
    log: [
      { id: 'log-rl-1', at: T + 3_600_000, kind: 'created' },
      { id: 'log-rl-2', at: T + 5 * 3_600_000, kind: 'blocked', note: 'Awaiting capacity review' },
    ],
  })
  item('sp-gateway', 'Spike: gateway options', 't-spike')

  // A filed-away initiative: off the boards, but still linked and searchable.
  item('init-legacy', 'Legacy SSO migration', 't-initiative', {
    assignees: ['u-jt'],
    archived: true,
    archivedAt: T + 86_400_000,
    log: [
      { id: 'log-legacy-1', at: T, kind: 'created' },
      { id: 'log-legacy-2', at: T + 86_400_000, kind: 'archived' },
    ],
  })
  item('st-legacy-a', 'Retire legacy auth endpoint', 't-story', {
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
  const place = (itemId: string, boardId: string, laneId: string, enteredAt?: number) =>
    placements.push({ id: `pl-${++placeSeq}`, boardId, itemId, laneId, ...(enteredAt ? { laneEnteredAt: enteredAt } : {}) })

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
  // A few Atlas stamps tell time's story: Not Started has held one card about a month, and
  // the pieces under way have their own younger ages. The rest predate the stamp on purpose.
  place('st-signup-form', 'b-atlas', a.dev.id, T - 6 * DAY)
  // Delivered and filed away, in the board's Done cell: what a board carries includes its past.
  for (const id of ['st-export-csv', 'st-scim-spike', 'st-billing-handoff', 'st-audit-log', 'st-ratelimit-ui', 'st-onboarding-email', 'st-legacy-import']) {
    place(id, 'b-atlas', a.done.id)
  }
  place('st-email', 'b-atlas', a.ns.id, T - 30 * DAY)
  place('st-sso', 'b-atlas', a.test!.id, T - 12 * DAY)
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

  return {
    users,
    issueTypes,
    boards,
    lanes,
    items,
    placements,
    edges,
    links,
    objectives,
    keyResults,
    boardTemplates,
  }
}
