import { initiativeTypeId } from './board'
import { rollupOf, type Graph } from './derive'
import { STAGES, STAGE_LABELS } from './lanes'
import type { Board, Edge, IssueType, Item, ItemLink, Lane, Placement, Stage, User } from './types'

/**
 * A board built to be too big.
 *
 * Not part of the demo seed, and deliberately: a load test is not a thing to ship in everyone's
 * workspace. It is built on request — `?stress=300` in the URL, or the store's `addStressBoard` —
 * and it is *shaped* like the thing that actually hurts: a programme's cards workflow refined
 * three levels deep (typed columns, then cells, then a swim-lane grid inside In Progress), WIP
 * limits some columns are over, initiatives rolling work up, dependencies, blockers, back-dated
 * histories and a few filed-away deliveries.
 *
 * Everything it makes is prefixed `stress-`, so it can be recognised, replaced and removed
 * without touching a real board: asking for a different size rebuilds it rather than piling a
 * second one on top.
 */

export const STRESS_PREFIX = 'stress-'
export const STRESS_BOARD_ID = `${STRESS_PREFIX}board`
export const STRESS_BOARD_NAME = 'Platform programme (load test)'

export interface StressBoard {
  board: Board
  /** The people the cards reference, so a workspace without them still reads names. */
  users: User[]
  lanes: Lane[]
  items: Item[]
  placements: Placement[]
  edges: Edge[]
  links: ItemLink[]
}

/** A small deterministic generator: the same size always builds the same board. */
function random(seed: number) {
  let state = seed % 2147483647
  if (state <= 0) state += 2147483646
  return () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
}

const DAY = 86_400_000

/** The verbs and objects an enterprise backlog is actually made of. */
const VERBS = ['Migrate', 'Harden', 'Instrument', 'Refactor', 'Document', 'Automate', 'Split', 'Cache', 'Audit', 'Backfill', 'Deprecate', 'Roll out']
const OBJECTS = [
  'the billing service',
  'SSO for enterprise tenants',
  'the audit trail',
  'tenant onboarding',
  'the reporting pipeline',
  'rate limiting',
  'the public API',
  'role-based access',
  'the data export',
  'webhook delivery',
  'the search index',
  'the release pipeline',
  'the notification fan-out',
  'cost attribution',
  'the retention policy',
]
const BLOCKERS = [
  'Waiting on the platform team',
  'Vendor contract not signed',
  'Security review pending',
  'Depends on a schema change',
  'Needs a decision on tenancy',
]
const CHECKLIST_STEPS = ['Write the migration', 'Add a test', 'Update the docs', 'Ship behind a flag', 'Tell support', 'Measure it']
const PEOPLE: User[] = [
  { id: 'stress-u-1', name: 'Amara Osei' },
  { id: 'stress-u-2', name: 'Ben Iversen' },
  { id: 'stress-u-3', name: 'Chen Wei' },
  { id: 'stress-u-4', name: 'Dara Nwosu' },
  { id: 'stress-u-5', name: 'Elif Kaya' },
  { id: 'stress-u-6', name: 'Farid Haddad' },
  { id: 'stress-u-7', name: 'Greta Lindqvist' },
  { id: 'stress-u-8', name: 'Hana Suzuki' },
]

/** The card types a board offers, in the weights a real backlog has. */
function cardTypes(types: IssueType[]): IssueType[] {
  const wanted = ['User Story', 'Bug', 'Task', 'Epic', 'Spike']
  const found = wanted.map((name) => types.find((t) => t.name === name)).filter((t): t is IssueType => Boolean(t))
  return found.length > 0 ? found : [{ id: 't-story', name: 'User Story', color: '#0ea5e9' }]
}

/**
 * A lane builder over one board's workflow, keeping every lane it made so the result needs no
 * second walk. The two workflows share the board, so their lane ids share a namespace: the
 * prefix is what keeps a cards cell from answering to an initiatives one.
 */
function laneBuilder(boardId: string, workflow: 'cards' | 'initiatives') {
  const lanes: Lane[] = []
  let seq = 0
  const lane = (name: string, parentId: string | null, order: number, opts: Partial<Pick<Lane, 'orientation' | 'wipLimit' | 'stage' | 'description'>> = {}) => {
    const l: Lane = { id: `${STRESS_PREFIX}lane-${workflow}-${++seq}`, boardId, name, parentId, order, workflow, ...opts }
    lanes.push(l)
    return l
  }
  return { lanes, lane }
}

/**
 * The cards workflow, refined the way a programme refines one.
 *
 * The shape matters more than the names. `In Progress` is a **columns** split whose children are
 * **rows** splits with children of their own — the swim-lane grid, which is the heaviest thing
 * this app can be asked to draw. `Done` splits into what was accepted and what actually shipped,
 * because a programme needs both.
 */
function cardsWorkflow(boardId: string) {
  const { lanes, lane } = laneBuilder(boardId, 'cards')
  const root = lane('', null, 0, { orientation: 'columns' })
  const backlog = lane('Backlog', root.id, 0, {
    stage: 'backlog',
    wipLimit: 40,
    description: 'Unrefined intake. Nothing is pulled from here without a size and an owner.',
  })
  const notStarted = lane('Not Started', root.id, 1, { stage: 'notStarted', orientation: 'columns' })
  const inProgress = lane('In Progress', root.id, 2, { stage: 'inProgress', orientation: 'columns' })
  const done = lane('Done', root.id, 3, { stage: 'done', orientation: 'columns' })

  const ready = lane('Ready', notStarted.id, 0, { wipLimit: 12 })
  const blocked = lane('Blocked', notStarted.id, 1, {
    description: 'Waiting on something outside this team. Nothing sits here without a reason.',
  })

  // Every child of In Progress is a rows split with children of its own — the swim-lane grid,
  // which is the shape that makes a board expensive to draw.
  const development = lane('Development', inProgress.id, 0, { orientation: 'rows' })
  const testing = lane('Testing', inProgress.id, 1, { orientation: 'rows' })
  const review = lane('Review', inProgress.id, 2, { orientation: 'rows', wipLimit: 8 })

  const backend = lane('Backend', development.id, 0)
  const frontend = lane('Frontend', development.id, 1)
  const automation = lane('Automation', testing.id, 0)
  const manual = lane('Manual', testing.id, 1)
  const peer = lane('Peer', review.id, 0, { description: 'Two reviewers, or one reviewer and a passing pipeline.' })
  const security = lane('Security', review.id, 1)
  const accepted = lane('Accepted', done.id, 0)
  const released = lane('Released', done.id, 1)

  return {
    lanes,
    /** The cells, by the name a person would use for them — the weights below read this. */
    cell: new Map<string, Lane>([
      ['Backlog', backlog],
      ['Ready', ready],
      ['Blocked', blocked],
      ['Backend', backend],
      ['Frontend', frontend],
      ['Automation', automation],
      ['Manual', manual],
      ['Peer', peer],
      ['Security', security],
      ['Accepted', accepted],
      ['Released', released],
    ]),
    section: new Map<Stage, Lane>([
      ['backlog', backlog],
      ['notStarted', notStarted],
      ['inProgress', inProgress],
      ['done', done],
    ]),
  }
}

/** The initiatives workflow: the same four sections, with cells a programme arranges work in. */
function initiativesWorkflow(boardId: string) {
  const { lanes, lane } = laneBuilder(boardId, 'initiatives')
  const root = lane('', null, 0, { orientation: 'columns' })
  const backlog = lane('Backlog', root.id, 0, { stage: 'backlog' })
  const notStarted = lane('Not Started', root.id, 1, { stage: 'notStarted', orientation: 'columns' })
  const inProgress = lane('In Progress', root.id, 2, { stage: 'inProgress', orientation: 'columns' })
  const done = lane('Done', root.id, 3, { stage: 'done' })

  const h1 = lane('FY26 H1', notStarted.id, 0)
  const h2 = lane('FY26 H2', notStarted.id, 1)
  const atlas = lane('Atlas', inProgress.id, 0)
  const nova = lane('Nova', inProgress.id, 1)
  const data = lane('Data', inProgress.id, 2)

  return {
    lanes,
    cells: [backlog, h1, h2, atlas, nova, data, done],
    byName: new Map([['Atlas', atlas], ['Nova', nova], ['Data', data], ['FY26 H1', h1], ['FY26 H2', h2]]),
    section: new Map<Stage, Lane>([
      ['backlog', backlog],
      ['notStarted', notStarted],
      ['inProgress', inProgress],
      ['done', done],
    ]),
  }
}

/** The initiatives, and the cell each one prefers inside its own derived section. */
const INITIATIVES: { id: string; title: string; cell?: string; parent?: string }[] = [
  { id: `${STRESS_PREFIX}init-programme`, title: 'Platform programme', cell: 'FY26 H1' },
  { id: `${STRESS_PREFIX}init-atlas`, title: 'Atlas workstream', cell: 'Atlas', parent: `${STRESS_PREFIX}init-programme` },
  { id: `${STRESS_PREFIX}init-nova`, title: 'Nova workstream', cell: 'Nova', parent: `${STRESS_PREFIX}init-programme` },
  { id: `${STRESS_PREFIX}init-data`, title: 'Data workstream', cell: 'Data', parent: `${STRESS_PREFIX}init-programme` },
  { id: `${STRESS_PREFIX}init-atlas-api`, title: 'Atlas: tenant API', cell: 'Atlas', parent: `${STRESS_PREFIX}init-atlas` },
  { id: `${STRESS_PREFIX}init-atlas-ui`, title: 'Atlas: admin console', cell: 'Atlas', parent: `${STRESS_PREFIX}init-atlas` },
  { id: `${STRESS_PREFIX}init-nova-billing`, title: 'Nova: billing migration', cell: 'Nova', parent: `${STRESS_PREFIX}init-nova` },
  { id: `${STRESS_PREFIX}init-nova-sso`, title: 'Nova: enterprise SSO', cell: 'Nova', parent: `${STRESS_PREFIX}init-nova` },
  { id: `${STRESS_PREFIX}init-data-lake`, title: 'Data: lakehouse cutover', cell: 'Data', parent: `${STRESS_PREFIX}init-data` },
]

/** The team initiatives a card can roll up to — the leaves of the tree above. */
const TEAM_INITIATIVES = INITIATIVES.filter((i) => !INITIATIVES.some((o) => o.parent === i.id))

/**
 * Build the board. `cards` is the only number that matters; everything else is shape, and the
 * shape is what the app is being asked to survive.
 */
export function stressBoard(cards = 300, types: IssueType[] = [], now = Date.now()): StressBoard {
  const rand = random(cards * 7919 + 13)
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]
  const chance = (p: number) => rand() < p

  const board: Board = {
    id: STRESS_BOARD_ID,
    name: STRESS_BOARD_NAME,
    band: 'team',
    description:
      'A board built to be too big: a programme\u2019s columns, refined three levels deep, with a swim-lane grid inside In Progress. It is a load test, not demo data \u2014 rebuild it at any size with ?stress=<cards>, and Reset removes it.',
    defaultCardTypeId: cardTypes(types)[0].id,
    wipEnforcement: 'visualize',
  }

  const cardsFlow = cardsWorkflow(board.id)
  const initFlow = initiativesWorkflow(board.id)
  const lanes = [...cardsFlow.lanes, ...initFlow.lanes]
  const laneById = new Map(lanes.map((l) => [l.id, l]))

  /** The stage a cell inherits from the typed column above it. */
  const stageOfLane = (laneId: string): Stage => {
    let cur: Lane | undefined = laneById.get(laneId)
    while (cur && !cur.stage) cur = cur.parentId ? laneById.get(cur.parentId) : undefined
    return cur?.stage ?? 'backlog'
  }

  const cardTypeList = cardTypes(types)
  const initiativeType = initiativeTypeId(types) ?? 't-initiative'
  const items: Item[] = []
  const placements: Placement[] = []
  const edges: Edge[] = []
  const links: ItemLink[] = []

  // ---- Cards ---------------------------------------------------------------------------------
  // A weighted spread across the cells, so the columns look like a real programme rather than an
  // even smear: the queue is the biggest column and Release is the smallest.
  const cell = (name: string) => cardsFlow.cell.get(name)!
  const weights: [Lane, number][] = [
    [cell('Backlog'), 24],
    [cell('Ready'), 12],
    [cell('Blocked'), 5],
    [cell('Backend'), 11],
    [cell('Frontend'), 10],
    [cell('Automation'), 8],
    [cell('Manual'), 7],
    [cell('Peer'), 6],
    [cell('Security'), 4],
    [cell('Accepted'), 8],
    [cell('Released'), 5],
  ]
  const totalWeight = weights.reduce((sum, [, w]) => sum + w, 0)

  for (let i = 0; i < cards; i++) {
    const id = `${STRESS_PREFIX}card-${i + 1}`
    const title = `${pick(VERBS)} ${pick(OBJECTS)}`
    const createdAt = now - Math.floor(5 + rand() * 115) * DAY
    const assignees = chance(0.25) ? [] : [...new Set([pick(PEOPLE).id, ...(chance(0.35) ? [pick(PEOPLE).id] : [])])]

    // Where it sits now, then the walk that got it there — the history the flow view reads.
    let roll = rand() * totalWeight
    let landing = weights[0][0]
    for (const [lane, weight] of weights) {
      roll -= weight
      if (roll <= 0) {
        landing = lane
        break
      }
    }
    const stage = stageOfLane(landing.id)
    const log: Item['log'] = [{ id: `${id}-log-1`, at: createdAt, kind: 'created' }]
    const walk = STAGES.slice(0, STAGES.indexOf(stage) + 1)
    let at = createdAt
    for (let step = 1; step < walk.length; step++) {
      at = Math.min(now - DAY, at + Math.floor(1 + rand() * 14) * DAY)
      const from = walk[step - 1]
      const to = walk[step]
      log.push({
        id: `${id}-log-${step + 1}`,
        at,
        kind: 'moved',
        note: `${STAGE_LABELS[from]} → ${STAGE_LABELS[to]}`,
        boardId: board.id,
        fromStage: from,
        toStage: to,
      })
    }
    const resolved = stage === 'done'
    const archived = resolved && chance(0.12)

    items.push({
      id,
      title,
      typeId: pick(cardTypeList).id,
      createdAt,
      log,
      ...(assignees.length > 0 ? { assignees } : {}),
      ...(chance(0.4) ? { priority: pick(['urgent', 'high', 'medium', 'low'] as const) } : {}),
      ...(chance(0.3) ? { description: `${title}.\n\nAcceptance: behind a flag, documented, and covered by an automated check.` } : {}),
      ...(chance(0.25)
        ? {
            checklist: Array.from({ length: 2 + Math.floor(rand() * 4) }, (_, k) => ({
              id: `${id}-check-${k + 1}`,
              text: pick(CHECKLIST_STEPS),
              done: chance(0.5),
            })),
          }
        : {}),
      ...(chance(0.04) ? { blocked: true, blockedReason: pick(BLOCKERS) } : {}),
      ...(chance(0.35)
        ? {
            targetStartDate: new Date(createdAt + 7 * DAY).toISOString().slice(0, 10),
            targetEndDate: new Date(createdAt + Math.floor(20 + rand() * 60) * DAY).toISOString().slice(0, 10),
          }
        : {}),
      ...(resolved ? { resolvedAt: at } : {}),
      ...(archived ? { archived: true, archivedAt: at + DAY } : {}),
    })
    placements.push({
      id: `${id}-place`,
      boardId: board.id,
      itemId: id,
      laneId: landing.id,
      laneEnteredAt: at,
      rank: placements.filter((p) => p.laneId === landing.id).length,
    })
  }

  // ---- Initiatives ---------------------------------------------------------------------------
  for (const init of INITIATIVES) {
    items.push({
      id: init.id,
      title: init.title,
      typeId: initiativeType,
      createdAt: now - 150 * DAY,
      log: [{ id: `${init.id}-log-1`, at: now - 150 * DAY, kind: 'created' }],
    })
  }
  for (const init of INITIATIVES) {
    if (init.parent) edges.push({ id: `${init.parent}-${init.id}`, kind: 'decomposition', from: init.parent, to: init.id })
  }
  // A quarter of the cards roll up to a team initiative: enough for real rollups, health rules
  // and flow metrics to have something to disagree about.
  for (const card of items) {
    if (!card.id.startsWith(`${STRESS_PREFIX}card-`) || !chance(0.25)) continue
    const parent = pick(TEAM_INITIATIVES)
    edges.push({ id: `${parent.id}-${card.id}`, kind: 'decomposition', from: parent.id, to: card.id })
  }

  // ---- Dependencies --------------------------------------------------------------------------
  const cardIds = items.filter((i) => i.id.startsWith(`${STRESS_PREFIX}card-`)).map((i) => i.id)
  for (let i = 0; i < Math.max(1, Math.floor(cards * 0.03)); i++) {
    const dependent = pick(cardIds)
    const dependency = pick(cardIds)
    if (dependent === dependency || links.some((l) => l.from === dependency && l.to === dependent)) continue
    links.push({ id: `${STRESS_PREFIX}link-${i + 1}`, from: dependency, to: dependent, reason: 'Sequenced deliberately' })
  }

  // ---- Where the initiatives sit --------------------------------------------------------------
  // A section is *derived* from the work below it, so each initiative is placed in the section
  // its own rollup names — the model's rule applied by the generator, not worked around.
  // The live placements array: an initiative's section is derived from the work below it, so the
  // rollup has to see the cells the cards actually sit in — and each placement added here is
  // visible to the next initiative's rollup, because it is the same array.
  const graph: Graph = { items, edges, links, placements, lanes }
  for (const init of INITIATIVES) {
    const section = initFlow.section.get(rollupOf(init.id, graph).bucket) ?? initFlow.section.get('backlog')!
    const inSection = (cell: Lane) => {
      let cur: Lane | undefined = cell
      while (cur && cur.id !== section.id) cur = cur.parentId ? laneById.get(cur.parentId) : undefined
      return cur?.id === section.id
    }
    const candidates = initFlow.cells.filter(inSection)
    const preferred = init.cell ? initFlow.byName.get(init.cell) : undefined
    const laneId = preferred && inSection(preferred) ? preferred.id : candidates[0]?.id ?? section.id
    placements.push({
      id: `${init.id}-place`,
      boardId: board.id,
      itemId: init.id,
      laneId,
      rank: placements.filter((p) => p.laneId === laneId).length,
    })
  }

  return { board, users: PEOPLE, lanes, items, placements, edges, links }
}
