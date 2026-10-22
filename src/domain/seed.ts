import { STAGES, STAGE_LABELS } from './lanes'
import { demoWorkspace } from './demo'
import type { Edge, FlowState, Item, ItemLink, ItemLogEntry, Lane, Objective, Placement, Stage } from './types'

export { BUILT_IN_TEMPLATES } from './demo'

/**
 * The demo: what a client sees when they open the app, and what **Reset** puts back.
 *
 * The boards are not here — they live in `demo.ts`, shared with the fixture the tests run against,
 * because "the same boards, different work" is the point of this file. What is here is a quarter
 * of work on them: a programme called *Meridian* growing from self-serve into the enterprise,
 * spread over four altitudes so that every view has something real to say.
 *
 * A few things are deliberately imperfect, because a demo of a board that only shows tidy work
 * demonstrates nothing:
 *
 * - **Team Atlas is waiting on Team Nova.** SSO cannot start until the identity platform lands, so
 *   the boundary lane on Atlas has something to pin, and the initiative above it carries a
 *   dependency risk.
 * - **Two cards are blocked**, one of them in Backlog — blocked work that nobody has picked up.
 * - **Some work is stale, some is unowned, one initiative has nothing under it yet**, so the health
 *   column is not a row of identical green badges.
 * - **One strategic initiative serves no OKR, and one objective is served by nothing**, which is
 *   what the coverage gaps on the strategy map are for.
 *
 * Everything else is meant to read like a company that is doing fine: a queue, work in flight,
 * things delivered and filed away, and a history old enough that Flow has a shape.
 */

/** The demo's own "today". Everything in the demo is placed relative to it, not to the wall clock. */
export const SEED_TODAY = Date.UTC(2026, 9, 15, 9, 0, 0)
const T = SEED_TODAY
const DAY = 86_400_000

/** A day, `n` days before the demo's today. */
const ago = (n: number) => T - n * DAY
/** An ISO date `n` days from today — negative for something already past. */
const day = (n: number) => new Date(T + n * DAY).toISOString().slice(0, 10)

export function createSeed(): FlowState {
  const { users, issueTypes, boards, lanes, boardTemplates, st, lob, del, p, a, n } = demoWorkspace()

  // A board's own vocabulary for its initiatives — deliberately per board, and deliberately not
  // everywhere: the strategic board says what kind of bet each initiative is, the value stream
  // says how the work is shaped, and the two team boards have none at all, which is what "None is
  // the only option" looks like in practice.
  const kindsFor = (boardId: string, defs: [string, string][]) => {
    const made = defs.map(([name, color]) => ({ id: `kind-${boardId}-${name.toLowerCase()}`, name, color }))
    const board = boards.find((b) => b.id === boardId)!
    board.initiativeTypes = made
    return new Map(made.map((k) => [k.name, k.id]))
  }
  const strategyKinds = kindsFor('b-strategy', [
    ['Bet', '#8b5cf6'],
    ['Programme', '#0ea5e9'],
    ['Experiment', '#f59e0b'],
  ])
  const streamKinds = kindsFor('b-portfolio', [
    ['Workstream', '#0ea5e9'],
    ['Enabler', '#64748b'],
  ])

  // Tags, the other half of a board's own vocabulary: a set on any item rather than a choice, and
  // the same word on two boards is two different tags — which is the point of them being per board.
  const tagsFor = (boardId: string, defs: [string, string][]) => {
    const made = defs.map(([name, color]) => ({ id: `tag-${boardId}-${name.toLowerCase()}`, name, color }))
    const board = boards.find((b) => b.id === boardId)!
    board.tags = made
    return new Map(made.map((t) => [t.name, t.id]))
  }
  const atlasTags = tagsFor('b-atlas', [
    ['security', '#f43f5e'],
    ['tech-debt', '#64748b'],
    ['customer-facing', '#0ea5e9'],
  ])
  const novaTags = tagsFor('b-nova', [
    ['security', '#f43f5e'],
    ['data', '#8b5cf6'],
  ])

  const items: Item[] = []
  const placements: Placement[] = []
  const edges: Edge[] = []
  const links: ItemLink[] = []

  const item = (id: string, title: string, typeId: string, extra: Partial<Item> = {}) =>
    items.push({ id, title, typeId, createdAt: ago(60), ...extra })

  const place = (itemId: string, boardId: string, laneId: string, enteredAt?: number) =>
    placements.push({ id: `pl-${itemId}`, boardId, itemId, laneId, ...(enteredAt ? { laneEnteredAt: enteredAt } : {}) })

  const edge = (kind: Edge['kind'], from: string, to: string) => edges.push({ id: `e-${edges.length + 1}`, kind, from, to })
  const decompose = (parent: string, children: string[]) => children.forEach((child) => edge('decomposition', parent, child))
  const link = (from: string, to: string, extra: Partial<ItemLink> = {}) => links.push({ id: `lnk-${links.length + 1}`, from, to, ...extra })

  /**
   * A card's history, derived from where it ended up rather than hand-written: created, then the
   * stages it crossed to get there, spread evenly between the two. A demo card therefore cannot
   * carry a history that disagrees with its column — and Flow, the timeline and the age cue all
   * read the same arrival stamp.
   */
  const journey = (id: string, boardId: string, created: number, arrived: number, stage: Stage): ItemLogEntry[] => {
    const log: ItemLogEntry[] = [{ id: `${id}-l1`, at: created, kind: 'created' }]
    const steps = STAGES.slice(0, STAGES.indexOf(stage) + 1)
    for (let i = 1; i < steps.length; i++) {
      log.push({
        id: `${id}-l${i + 1}`,
        at: Math.round(created + ((arrived - created) * i) / (steps.length - 1)),
        kind: 'moved',
        note: `${STAGE_LABELS[steps[i - 1]]} → ${STAGE_LABELS[steps[i]]}`,
        boardId,
        fromStage: steps[i - 1],
        toStage: steps[i],
      })
    }
    return log
  }

  /**
   * A card and its cell in one call: `created` and `arrived` are days ago, and the stage comes
   * from the column it sits in — so a card's journey, its age and its status cannot drift apart.
   */
  const card = (
    id: string,
    title: string,
    typeId: string,
    boardId: string,
    lane: Lane,
    stage: Stage,
    created: number,
    arrived: number,
    extra: Partial<Item> = {},
  ) => {
    const at = ago(arrived)
    item(id, title, typeId, {
      createdAt: ago(created),
      log: journey(id, boardId, ago(created), at, stage),
      ...(stage === 'done' ? { resolvedAt: at } : {}),
      ...extra,
    })
    place(id, boardId, lane.id, at)
  }

  /* ---------------------------------------------------------------- *
   * The strategy, the line of business and delivery — the top of the
   * chain. OKRs attach to the strategic initiatives; everything below
   * inherits through the decomposition.
   * ---------------------------------------------------------------- */

  item('init-revenue', 'Recurring revenue engine', 't-initiative', {
    assignees: ['u-mb'],
    targetStartDate: '2026-10-01',
    targetEndDate: '2027-03-31',
  })
  item('init-margin', 'Gross margin programme', 't-initiative', { assignees: ['u-ds'], targetEndDate: '2027-06-30' })
  // Serves no OKR on purpose: the coverage gap a strategy map is for.
  item('init-trust', 'Enterprise trust', 't-initiative', { assignees: ['u-jt'], targetEndDate: '2027-01-31' })

  item('init-selfserve', 'Self-serve growth', 't-initiative', { assignees: ['u-mb'], targetEndDate: '2027-02-28' })
  item('init-consolidation', 'Platform consolidation', 't-initiative', { assignees: ['u-ds'], targetEndDate: '2027-05-31' })

  item('init-checkout', 'Checkout & billing', 't-initiative', { assignees: ['u-ds'], targetEndDate: '2027-01-31' })
  item('init-data', 'Data platform', 't-initiative', { assignees: ['u-lm'], targetEndDate: '2027-04-30' })

  item('init-journey', 'Onboarding journey', 't-initiative', { assignees: ['u-mb'], targetEndDate: '2026-12-31' })
  item('init-reliability', 'Reliability programme', 't-initiative', { assignees: ['u-rk'], targetEndDate: '2027-02-28' })
  item('init-sso', 'Enterprise SSO', 't-initiative', { assignees: ['u-jt'], targetEndDate: '2026-12-15' })

  decompose('init-revenue', ['init-selfserve'])
  decompose('init-margin', ['init-consolidation'])
  decompose('init-selfserve', ['init-journey', 'init-checkout'])
  decompose('init-consolidation', ['init-reliability', 'init-data'])
  decompose('init-trust', ['init-sso'])

  /* ---------------------------------------------------------------- *
   * Team Atlas — a refined flow, four initiatives, and a dependency
   * that reaches across to Team Nova.
   * ---------------------------------------------------------------- */

  item('init-signup-redesign', 'Signup redesign', 't-initiative', { assignees: ['u-mb', 'u-rk'], targetEndDate: '2026-12-31' })
  item('init-trial', 'Trial experience', 't-initiative', { assignees: ['u-lm'], targetEndDate: '2027-01-31' })
  item('init-billing', 'Billing migration', 't-initiative', { assignees: ['u-ds'], targetEndDate: '2027-02-28' })
  item('init-slo', 'SLOs & error budgets', 't-initiative', { assignees: ['u-rk'] })

  decompose('init-journey', ['init-signup-redesign', 'init-trial'])
  decompose('init-checkout', ['init-billing'])
  decompose('init-reliability', ['init-slo'])

  card('st-signup-screens', 'Design the signup screens', 't-story', 'b-atlas', a.done, 'done', 62, 40, {
    size: 3,
    assignees: ['u-rk'],
    priority: 'medium',
  })
  card('st-signup-rebuild', 'Rebuild the signup form', 't-story', 'b-atlas', a.dev, 'inProgress', 30, 6, {
    size: 5,
    assignees: ['u-rk', 'u-mb'],
    priority: 'high',
    description: 'One page, one field at a time.\n\nAcceptance: works on a phone, measured, and behind a flag.',
    checklist: [
      { id: 'cl-form-1', text: 'Form markup and validation', done: true },
      { id: 'cl-form-2', text: 'Wire up the API call', done: true },
      { id: 'cl-form-3', text: 'Error states', done: false },
      { id: 'cl-form-4', text: 'Analytics events', done: false },
    ],
  })
  card('st-signup-validation', 'Signup validation on retry', 't-bug', 'b-atlas', a.test!, 'inProgress', 12, 3, {
    size: 2,
    assignees: ['u-mb'],
    priority: 'high',
    targetStartDate: day(-6),
    targetEndDate: day(-1),
  })
  card('st-enterprise-sso', 'Add SSO for enterprise tenants', 't-story', 'b-atlas', a.dev, 'inProgress', 21, 5, {
    size: 5,
    assignees: ['u-jt'],
    priority: 'urgent',
    blocked: true,
    blockedReason: 'Waiting on the identity contract',
    targetStartDate: day(3),
    targetEndDate: day(24),
  })
  card('st-pricing-cache', 'Cache the pricing catalogue', 't-task', 'b-atlas', a.dev, 'inProgress', 16, 2, {
    size: 3,
    assignees: ['u-ds'],
  })
  card('st-payment-retries', 'Payment retries on soft decline', 't-story', 'b-atlas', a.test!, 'inProgress', 24, 4, {
    size: 5,
    assignees: ['u-ds', 'u-mb'],
    priority: 'urgent',
    targetStartDate: day(-10),
    targetEndDate: day(4),
    checklist: [
      { id: 'cl-retry-1', text: 'Retry on a soft decline only', done: true },
      { id: 'cl-retry-2', text: 'Back off between attempts', done: false },
    ],
  })
  card('st-invoice-numbering', 'Migrate invoice numbering', 't-story', 'b-atlas', a.ns, 'notStarted', 19, 9, {
    size: 3,
    // Nobody on it, and overdue: committed work with no owner is exactly what health is for.
    targetStartDate: day(-8),
    targetEndDate: day(-3),
  })
  card('st-coupon-retire', 'Retire the legacy coupon service', 't-task', 'b-atlas', a.ns, 'notStarted', 26, 11, {
    size: 5,
    assignees: ['u-ds'],
    blocked: true,
    blockedReason: 'Needs a decision on grandfathered pricing',
    targetEndDate: day(31),
  })
  card('st-usage-billing', 'Add usage-based billing events', 't-story', 'b-atlas', a.backlog, 'backlog', 8, 8, {
    size: 8,
    assignees: ['u-ds'],
    priority: 'high',
    targetEndDate: day(45),
  })
  card('st-pricing-experiment', 'Split the pricing experiment framework', 't-spike', 'b-atlas', a.backlog, 'backlog', 9, 9, {
    size: 2,
  })
  card('st-trial-funnel', 'Instrument the trial funnel', 't-story', 'b-atlas', a.backlog, 'backlog', 6, 6, {
    size: 3,
    assignees: ['u-lm'],
    priority: 'medium',
    targetEndDate: day(14),
  })
  card('st-rate-limit-msg', 'Rate limit messaging', 't-story', 'b-atlas', a.done, 'done', 70, 44, {
    size: 3,
    assignees: ['u-rk'],
    archived: true,
    archivedAt: ago(43),
  })

  decompose('init-signup-redesign', ['st-signup-screens', 'st-signup-rebuild', 'st-signup-validation'])
  decompose('init-trial', ['st-pricing-experiment', 'st-trial-funnel'])
  decompose('init-billing', ['st-coupon-retire', 'st-invoice-numbering', 'st-payment-retries', 'st-pricing-cache', 'st-usage-billing'])
  decompose('init-slo', ['st-rate-limit-msg'])

  /* ---------------------------------------------------------------- *
   * Team Nova — the identity platform Atlas is waiting on, and the
   * data work underneath the margin programme.
   * ---------------------------------------------------------------- */

  item('init-identity', 'Identity platform', 't-initiative', { assignees: ['u-jt', 'u-ds'], targetEndDate: '2026-12-15' })
  item('init-audit', 'Audit & compliance', 't-initiative', { assignees: ['u-lm'], targetEndDate: '2027-01-31' })
  item('init-lakehouse', 'Lakehouse cutover', 't-initiative', { assignees: ['u-ds'], targetEndDate: '2027-03-31' })
  item('init-observability', 'Observability', 't-initiative', { assignees: ['u-rk'], targetEndDate: '2027-02-28' })
  // Nothing under it yet — the "nothing below" health rule, on purpose.
  item('init-data-quality', 'Data quality guardrails', 't-initiative', { assignees: ['u-lm'], targetEndDate: '2027-04-30' })

  decompose('init-sso', ['init-identity'])
  decompose('init-trust', ['init-audit'])
  decompose('init-data', ['init-lakehouse'])
  decompose('init-reliability', ['init-observability'])

  card('st-identity-contract', 'Define the identity contract', 't-story', 'b-nova', n.dev, 'inProgress', 34, 12, {
    size: 8,
    assignees: ['u-jt', 'u-ds'],
    priority: 'urgent',
    description: 'One contract, three consumers: Atlas, the admin console, and the partner API.',
    checklist: [
      { id: 'cl-id-1', text: 'Token shape agreed', done: true },
      { id: 'cl-id-2', text: 'Tenant scoping agreed', done: true },
      { id: 'cl-id-3', text: 'Documented for consumers', done: false },
    ],
    targetEndDate: day(9),
  })
  card('st-lakehouse-ingest', 'Lakehouse ingest pipeline', 't-story', 'b-nova', n.dev, 'inProgress', 28, 10, {
    size: 13,
    assignees: ['u-ds'],
    priority: 'medium',
    targetStartDate: day(-20),
    targetEndDate: day(-5),
  })
  card('st-error-budget', 'Error budget dashboard', 't-story', 'b-nova', n.dev, 'inProgress', 22, 7, {
    size: 5,
    assignees: ['u-rk'],
    targetEndDate: day(21),
  })
  card('st-scim', 'SCIM provisioning spike', 't-spike', 'b-nova', n.test!, 'inProgress', 20, 5, {
    size: 3,
    assignees: ['u-jt'],
    checklist: [
      { id: 'cl-scim-1', text: 'Read the spec', done: true },
      { id: 'cl-scim-2', text: 'Try the sandbox', done: false },
      { id: 'cl-scim-3', text: 'Write it up', done: false },
    ],
  })
  card('st-audit-retention', 'Audit log retention', 't-story', 'b-nova', n.test!, 'inProgress', 26, 6, {
    size: 2,
    assignees: ['u-lm'],
    priority: 'high',
    targetEndDate: day(16),
  })
  card('st-trial-eligibility', 'Trial eligibility rules', 't-story', 'b-nova', n.ns, 'notStarted', 18, 8, {
    size: 5,
    assignees: ['u-lm'],
    targetEndDate: day(28),
  })
  card('st-cost-attribution', 'Cost attribution per tenant', 't-story', 'b-nova', n.backlog, 'backlog', 11, 11, {
    size: 8,
    priority: 'high',
    targetEndDate: day(60),
  })
  card('st-audit-backfill', 'Backfill the audit index', 't-task', 'b-nova', n.backlog, 'backlog', 10, 10, {
    size: 5,
  })
  card('st-auth-retire', 'Retire the legacy auth endpoint', 't-story', 'b-nova', n.backlog, 'backlog', 15, 15, {
    size: 3,
    assignees: ['u-jt'],
    blocked: true,
    blockedReason: 'Security review pending',
    targetEndDate: day(40),
  })
  card('st-identity-contract-v1', 'Identity contract v1', 't-story', 'b-nova', n.done, 'done', 80, 52, {
    size: 5,
    assignees: ['u-jt'],
  })
  card('st-register-export', 'Export the register as CSV', 't-story', 'b-nova', n.done, 'done', 66, 41, {
    size: 3,
    assignees: ['u-lm'],
    archived: true,
    archivedAt: ago(40),
  })

  // The Atlas card that waits on the identity platform belongs to the SSO outcome it is for —
  // without this it rolls up to nothing and the story the boundary lane tells has no shape.
  decompose('init-sso', ['st-enterprise-sso'])
  decompose('init-identity', ['st-identity-contract', 'st-identity-contract-v1', 'st-scim'])
  decompose('init-audit', ['st-audit-backfill', 'st-audit-retention', 'st-auth-retire'])
  decompose('init-lakehouse', ['st-cost-attribution', 'st-lakehouse-ingest'])
  decompose('init-observability', ['st-error-budget'])
  decompose('init-trial', ['st-trial-eligibility'])

  /* ---------------------------------------------------------------- *
   * Dependencies — links, never a status. The one that matters is the
   * first: Team Atlas cannot finish SSO until Team Nova's identity
   * platform is done, so it shows up in the boundary lane on Atlas.
   * ---------------------------------------------------------------- */

  link('init-identity', 'st-enterprise-sso', { reason: 'SSO is built on the identity platform' })
  link('init-lakehouse', 'st-cost-attribution', { reason: 'Attribution needs the lakehouse tables' })
  link('init-audit', 'st-auth-retire', { reason: 'Retiring auth needs the audit trail in place' })
  link('init-billing', 'st-payment-retries', { reason: 'Retries land with the billing migration' })
  link('st-identity-contract', 'st-enterprise-sso', { reason: 'The SSO buttons consume the contract' })

  /* ---------------------------------------------------------------- *
   * Placements — the work above, in the cells of each board's own flow.
   * ---------------------------------------------------------------- */

  // Company Strategy: strategic initiatives, in the section their rollup names.
  place('init-revenue', 'b-strategy', st.init.ip.id)
  place('init-margin', 'b-strategy', st.init.ip.id)
  place('init-trust', 'b-strategy', st.init.ip.id)

  // Digital line of business.
  place('init-selfserve', 'b-lob', lob.init.ip.id)
  place('init-consolidation', 'b-lob', lob.init.ip.id)

  // Product Delivery — the bridge to the teams.
  place('init-checkout', 'b-delivery', del.init.ip.id)
  place('init-data', 'b-delivery', del.init.ip.id)

  // Growth value stream — where the teams' outcomes are coordinated.
  place('init-journey', 'b-portfolio', p.init.ip.id)
  place('init-reliability', 'b-portfolio', p.init.ip.id)
  place('init-sso', 'b-portfolio', p.init.ip.id)

  // Team Atlas.
  place('init-signup-redesign', 'b-atlas', a.init.ip.id)
  place('init-billing', 'b-atlas', a.init.ip.id)
  place('init-trial', 'b-atlas', a.init.ns.id) // committed, not under way
  place('init-slo', 'b-atlas', a.init.done.id) // delivered: its only card was released

  // Team Nova.
  place('init-identity', 'b-nova', n.init.ip.id)
  place('init-audit', 'b-nova', n.init.ip.id)
  place('init-lakehouse', 'b-nova', n.init.ip.id)
  place('init-observability', 'b-nova', n.init.ip.id)
  place('init-data-quality', 'b-nova', n.init.backlog.id) // unplanned, and it says so

  /* ---------------------------------------------------------------- *
   * What kind of initiative each one is. The kinds are the board's, so an
   * initiative is labelled where it is owned.
   * ---------------------------------------------------------------- */

  const kindOf = (id: string, kindId: string | undefined) => {
    const item = items.find((i) => i.id === id)
    if (item && kindId) item.initiativeTypeId = kindId
  }
  // Only where the board has kinds: a label belongs to the board that owns the outcome, so the
  // line of business and the delivery bridge — which have none — stay plain.
  kindOf('init-revenue', strategyKinds.get('Bet'))
  kindOf('init-trust', strategyKinds.get('Bet'))
  kindOf('init-margin', strategyKinds.get('Programme'))
  kindOf('init-journey', streamKinds.get('Workstream'))
  kindOf('init-reliability', streamKinds.get('Workstream'))
  kindOf('init-sso', streamKinds.get('Workstream'))

  /* ---------------------------------------------------------------- *
   * What each piece of work is about. A set, on cards and initiatives
   * alike — and only where the board that owns it defines the tag.
   * ---------------------------------------------------------------- */

  const tagWith = (id: string, ...tagIds: (string | undefined)[]) => {
    const item = items.find((i) => i.id === id)
    const carried = tagIds.filter((t): t is string => Boolean(t))
    if (item && carried.length > 0) item.tagIds = carried
  }
  tagWith('st-enterprise-sso', atlasTags.get('security'), atlasTags.get('customer-facing'))
  tagWith('st-signup-validation', atlasTags.get('customer-facing'))
  tagWith('st-pricing-cache', atlasTags.get('tech-debt'))
  tagWith('st-coupon-retire', atlasTags.get('tech-debt'))
  tagWith('st-auth-retire', novaTags.get('security'))
  tagWith('st-lakehouse-ingest', novaTags.get('data'))
  tagWith('st-audit-retention', novaTags.get('data'))
  tagWith('st-audit-backfill', novaTags.get('data'))
  // An initiative carries them too: a tag is about what the work is, at any altitude.
  tagWith('init-identity', novaTags.get('security'))
  tagWith('init-audit', novaTags.get('security'))

  /* ---------------------------------------------------------------- *
   * Objectives & Key Results — commitment-limited, never in columns.
   * OKRs attach to *strategic* initiatives only, and everything below
   * inherits through the decomposition.
   * ---------------------------------------------------------------- */

  const objectives: Objective[] = [
    { id: 'obj-activation', title: 'Grow activation', period: 'FY26 Q4', status: 'active', score: 45 },
    { id: 'obj-efficiency', title: 'Reduce cost to serve', period: 'FY26 Q4', status: 'active' },
    // Deliberately unserved: no strategic initiative carries it, which is one of the two gaps
    // the strategy map exists to show.
    { id: 'obj-reliability', title: 'Improve reliability', period: 'FY26 Q4', status: 'active' },
  ]
  const keyResults = [
    { id: 'kr-completion', objectiveId: 'obj-activation', title: 'Signup completion 85%' },
    { id: 'kr-trial-paid', objectiveId: 'obj-activation', title: 'Trial to paid 12%' },
    { id: 'kr-margin', objectiveId: 'obj-efficiency', title: 'Gross margin 78%' },
    { id: 'kr-cost-tenant', objectiveId: 'obj-efficiency', title: 'Cost per tenant −25%' },
  ]

  // Attribution informs and never counts as WIP. `init-trust` is left unmapped on purpose —
  // the other half of the coverage story.
  edge('attribution', 'obj-activation', 'init-revenue')
  edge('attribution', 'obj-efficiency', 'init-margin')

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
