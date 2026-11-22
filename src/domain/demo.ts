import { NONE_TYPE } from './board'
import { withInitiatives } from './template'
import type { Board, BoardFlow, BoardTemplate, IssueType, Lane, TemplateFlow, TemplateLane, User } from './types'

/**
 * The fixed part of the demo workspace: who works here, what a card can be, the six boards and
 * the lane designs a client is meant to see.
 *
 * The *work* on those boards is not here. There are two datasets built on this — `seed.ts`, which
 * is the demo the app loads and resets to, and `fixture.ts`, which is the smaller world the tests
 * run against — and they share these boards so that "the same boards, different work" is true by
 * construction rather than by two copies agreeing with each other.
 *
 * The boards, their types and their links are what a client reads first, so they are the
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
  // The built-in “no type” — a real label, always available, never edited or removed.
  NONE_TYPE,
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
/** A second cards flow's lanes and its flow, for the board that carries one. */
export interface SupportLanes {
  flow: BoardFlow
  r: Lane
  backlog: Lane
  ns: Lane
  ip: Lane
  done: Lane
}

export interface WorkflowLanes {
  r: Lane
  backlog: Lane
  ns: Lane
  ip: Lane
  done: Lane
  dev: Lane
  test?: Lane
  init: { r: Lane; backlog: Lane; ns: Lane; ip: Lane; done: Lane }
  /**
   * Team Atlas carries a second cards flow — a support queue beside the team's own — so the demo
   * shows a board with two trees rather than only ever one.
   */
  support?: SupportLanes
}

/**
 * Templates the product ships with.
 *
 * These are part of the *app*, not of a user's data, so the persist migration adds any
 * that a stored state is missing (v22) rather than waiting for a Reset — a built-in
 * template should reach people who already had state before it existed.
 */
/**
 * A built-in template is one cards flow — the design a team starts from. The draft type is the
 * template without its flow scaffolding, so the literals below stay about the lanes and the flow is
 * added once, here.
 */
const TEMPLATE_FLOW: TemplateFlow = { key: 'f0', kind: 'cards', name: 'Cards', order: 0 }
type TemplateDraft = Omit<BoardTemplate, 'flows' | 'lanes'> & {
  /** The flows this template describes. A draft without them is one flow named Cards. */
  flows?: TemplateFlow[]
  /** Lanes name their flow when the template has more than one; otherwise the only flow is theirs. */
  lanes: Array<Omit<TemplateLane, 'flowKey'> & { flowKey?: string }>
}

const TEMPLATE_DRAFTS: TemplateDraft[] = [
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
        description: 'Business case showing value, cost of delay and a design outline.',
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
  {
    /**
     * An upstream/downstream kanban as one flow, end to end.
     *
     * Discovery and delivery used to be two cards flows, with the hand-off a move between them. As
     * one flow they still read in the same order: a card is found and shaped, becomes ready to pull,
     * is worked on and accepted, then finishes. The four roots are the typed stages the model
     * requires, and the old flows' cells sit directly inside them as columns. Upstream's Discovery
     * analysis is named differently from downstream's Analysis, so no two columns in the flow read
     * the same.
     */
    id: 'tpl-upstream-kanban',
    name: 'Upstream Kanban',
    band: 'team',
    defaultCardTypeId: 't-story',
    flows: [{ key: 'f0', kind: 'cards', name: 'End to end', order: 0 }],
    lanes: [
      { key: 'c0', flowKey: 'f0', parentKey: null, order: 0, name: 'Backlog', stage: 'backlog', orientation: 'columns' },
      { key: 'c2', flowKey: 'f0', parentKey: 'c0', order: 0, name: 'Idea', description: 'A problem, a request or an observation, before anybody has judged it.' },
      { key: 'c3', flowKey: 'f0', parentKey: 'c0', order: 1, name: 'Value analysis', description: 'Is it worth doing? Value, cost of delay and the rough shape.' },
      { key: 'c4', flowKey: 'f0', parentKey: 'c0', order: 2, name: 'Concept', description: 'What it would take: a sketch, a decision and an estimate.' },
      { key: 'c5', flowKey: 'f0', parentKey: 'c0', order: 3, name: 'Incoming', description: 'Pulled from upstream, waiting for the next replenishment.' },
      { key: 'c6', flowKey: 'f0', parentKey: null, order: 1, name: 'Ready', stage: 'notStarted', orientation: 'columns' },
      { key: 'c7', flowKey: 'f0', parentKey: 'c6', order: 0, name: 'Ready to Pull', description: 'Analysed and shaped, waiting for the downstream team to pull it.' },
      { key: 'c8', flowKey: 'f0', parentKey: 'c6', order: 1, name: 'Next', description: 'Selected for the next cycle; the team’s next pull.' },
      { key: 'c9', flowKey: 'f0', parentKey: null, order: 2, name: 'In Progress', stage: 'inProgress', orientation: 'columns' },
      { key: 'c10', flowKey: 'f0', parentKey: 'c9', order: 0, name: 'Being Pulled', description: 'The downstream team has taken it on; upstream is finishing its hand-off.' },
      { key: 'c12', flowKey: 'f0', parentKey: 'c9', order: 1, name: 'Analysis', description: 'Understanding it: options, impact and the plan.' },
      { key: 'c13', flowKey: 'f0', parentKey: 'c9', order: 2, name: 'Development', description: 'Building it, with its tests written alongside.' },
      { key: 'c14', flowKey: 'f0', parentKey: 'c9', order: 3, name: 'Test', description: 'Verifying it: automated, exploratory and peer review.' },
      { key: 'c15', flowKey: 'f0', parentKey: 'c9', order: 4, name: 'UAT', description: 'Acceptance by the people who asked for it, in their own words.' },
      { key: 'c16', flowKey: 'f0', parentKey: null, order: 3, name: 'Done', stage: 'done', orientation: 'columns' },
      { key: 'c17', flowKey: 'f0', parentKey: 'c16', order: 0, name: 'Pulled', description: 'Upstream is finished with it.' },
      { key: 'c18', flowKey: 'f0', parentKey: 'c16', order: 1, name: 'Ready to Deploy', description: 'Accepted and waiting for its release window.' },
    ],
  },
  {
    /** The canonical board: a queue, a ready column, and two WIP-limited working columns. */
    id: 'tpl-basic-kanban',
    name: 'Basic Kanban',
    band: 'team',
    defaultCardTypeId: 't-story',
    flows: [{ key: 'f0', kind: 'cards', name: 'Flow', order: 0 }],
    lanes: [
      { key: 'bk0', parentKey: null, order: 0, name: 'Backlog', stage: 'backlog', description: 'Everything not yet picked up.' },
      { key: 'bk1', parentKey: null, order: 1, name: 'Ready', stage: 'notStarted', description: 'Small enough to start, waiting for a free slot.' },
      { key: 'bk2', parentKey: null, order: 2, name: 'In Progress', stage: 'inProgress', orientation: 'columns' },
      { key: 'bk3', parentKey: 'bk2', order: 0, name: 'Doing', wipLimit: 3, description: 'The work in hand. The limit is what keeps it in hand.' },
      { key: 'bk4', parentKey: 'bk2', order: 1, name: 'Review', wipLimit: 2, description: 'Read by somebody else before it is called done.' },
      { key: 'bk5', parentKey: null, order: 3, name: 'Done', stage: 'done' },
    ],
  },
  {
    /** One person's board: a list, today's shortlist, and a limit on what is actually open. */
    id: 'tpl-personal-kanban',
    name: 'Personal Kanban',
    band: 'team',
    defaultCardTypeId: 't-task',
    flows: [{ key: 'f0', kind: 'cards', name: 'Tasks', order: 0 }],
    lanes: [
      { key: 'pk0', parentKey: null, order: 0, name: 'Backlog', stage: 'backlog' },
      { key: 'pk1', parentKey: null, order: 1, name: 'Today', stage: 'notStarted', description: 'The few things you mean to finish today.' },
      { key: 'pk2', parentKey: null, order: 2, name: 'Doing', stage: 'inProgress', wipLimit: 3, description: 'Three is the point: a fourth is a promise you cannot keep.' },
      { key: 'pk3', parentKey: null, order: 3, name: 'Done', stage: 'done' },
    ],
  },
  {
    /** Scrum's commitments on a kanban's pull system: refined work is selected, then pulled. */
    id: 'tpl-scrumban',
    name: 'Scrumban',
    band: 'team',
    defaultCardTypeId: 't-story',
    flows: [{ key: 'f0', kind: 'cards', name: 'Sprint', order: 0 }],
    lanes: [
      { key: 'sb0', parentKey: null, order: 0, name: 'Product Backlog', stage: 'backlog' },
      { key: 'sb1', parentKey: null, order: 1, name: 'Ready', stage: 'notStarted', orientation: 'columns' },
      { key: 'sb2', parentKey: 'sb1', order: 0, name: 'Refined', description: 'Small, understood and agreed; waiting for a slot.' },
      { key: 'sb3', parentKey: 'sb1', order: 1, name: 'Selected for Sprint', description: 'Committed for this sprint, not yet started.' },
      { key: 'sb4', parentKey: null, order: 2, name: 'In Progress', stage: 'inProgress', orientation: 'columns' },
      { key: 'sb5', parentKey: 'sb4', order: 0, name: 'Doing', wipLimit: 3 },
      { key: 'sb6', parentKey: 'sb4', order: 1, name: 'Review', wipLimit: 2 },
      { key: 'sb7', parentKey: 'sb4', order: 2, name: 'Testing' },
      { key: 'sb8', parentKey: null, order: 3, name: 'Done', stage: 'done', orientation: 'columns' },
      { key: 'sb9', parentKey: 'sb8', order: 0, name: 'Accepted', description: 'Meets the sprint goal.' },
      { key: 'sb10', parentKey: 'sb8', order: 1, name: 'Released', description: 'In front of the people it was for.' },
    ],
  },
  {
    /** Shape Up: discovery and shaping are pre-commitment; a shaped pitch is bet on, then built. */
    id: 'tpl-shape-up',
    name: 'Shape Up',
    band: 'team',
    defaultCardTypeId: 't-story',
    flows: [{ key: 'f0', kind: 'cards', name: 'Cycle', order: 0 }],
    lanes: [
      { key: 'su0', parentKey: null, order: 0, name: 'Discovery', stage: 'backlog', orientation: 'columns' },
      { key: 'su1', parentKey: 'su0', order: 0, name: 'Ideas', description: 'Raw demand; nobody has shaped it yet.' },
      { key: 'su2', parentKey: 'su0', order: 1, name: 'Shaping', description: 'Time, appetite and a sketch of the solution.' },
      { key: 'su3', parentKey: null, order: 1, name: 'Betting table', stage: 'notStarted', description: 'Shaped pitches waiting for a cycle to be bet on.' },
      { key: 'su4', parentKey: null, order: 2, name: 'Building', stage: 'inProgress', description: 'A six-week cycle in progress. Scope is fixed; the work is not.' },
      { key: 'su5', parentKey: null, order: 3, name: 'Shipped', stage: 'done' },
    ],
  },
  {
    /** Incidents: triage is the commitment point, and monitoring is a state of its own. */
    id: 'tpl-incident-response',
    name: 'Incident Response',
    band: 'team',
    defaultCardTypeId: 't-bug',
    flows: [{ key: 'f0', kind: 'cards', name: 'Response', order: 0 }],
    lanes: [
      { key: 'ir0', parentKey: null, order: 0, name: 'Reported', stage: 'backlog', description: 'An alert or a report; not yet triaged.' },
      { key: 'ir1', parentKey: null, order: 1, name: 'Triaged', stage: 'notStarted', description: 'Severity set, an owner named, waiting for the on-call.' },
      { key: 'ir2', parentKey: null, order: 2, name: 'In Progress', stage: 'inProgress', orientation: 'columns' },
      { key: 'ir3', parentKey: 'ir2', order: 0, name: 'Investigating', description: 'Finding the cause, not yet changing anything.' },
      { key: 'ir4', parentKey: 'ir2', order: 1, name: 'Mitigating', description: 'The bleeding is being stopped.' },
      { key: 'ir5', parentKey: 'ir2', order: 2, name: 'Monitoring', description: 'Fix is in; watching for recurrence before closing.' },
      { key: 'ir6', parentKey: null, order: 3, name: 'Resolved', stage: 'done' },
    ],
  },
  {
    /** A five-day sprint: understand and sketch before committing, prototype and test after. */
    id: 'tpl-design-sprint',
    name: 'Design Sprint',
    band: 'team',
    defaultCardTypeId: 't-spike',
    flows: [{ key: 'f0', kind: 'cards', name: 'Sprint', order: 0 }],
    lanes: [
      { key: 'ds0', parentKey: null, order: 0, name: 'Discovery', stage: 'backlog', orientation: 'columns' },
      { key: 'ds1', parentKey: 'ds0', order: 0, name: 'Understand', description: 'Monday: the problem, the users and the map.' },
      { key: 'ds2', parentKey: 'ds0', order: 1, name: 'Sketch', description: 'Tuesday: solutions drawn, not discussed.' },
      { key: 'ds3', parentKey: null, order: 1, name: 'Decide', stage: 'notStarted', description: 'Wednesday: one direction chosen and committed.' },
      { key: 'ds4', parentKey: null, order: 2, name: 'In Progress', stage: 'inProgress', orientation: 'columns' },
      { key: 'ds5', parentKey: 'ds4', order: 0, name: 'Prototype', description: 'Thursday: something a person can react to.' },
      { key: 'ds6', parentKey: 'ds4', order: 1, name: 'Test', description: 'Friday: five conversations, watched and written down.' },
      { key: 'ds7', parentKey: null, order: 3, name: 'Sprint complete', stage: 'done' },
    ],
  },
]

export const BUILT_IN_TEMPLATES: BoardTemplate[] = TEMPLATE_DRAFTS.map(({ flows, lanes, ...template }) => {
  // A program has no cards of its own, so its template is the initiatives flow and nothing else;
  // a team template starts from its cards flow(s). Every template gains the initiatives flow the
  // board always has.
  const actual = flows ?? (template.band === 'program' ? [] : [{ ...TEMPLATE_FLOW }])
  return withInitiatives({
    ...template,
    flows: actual,
    lanes: lanes.map((lane) => ({ ...lane, flowKey: lane.flowKey ?? actual[0]?.key ?? 'i' })),
  })
})

export interface DemoWorkspace {
  users: User[]
  issueTypes: IssueType[]
  boards: Board[]
  flows: BoardFlow[]
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
/**
 * The vocabulary a workspace has before anybody puts anything in it.
 *
 * A new instance is empty of *work* — no boards, no cards, no people — but not of *kinds*: the issue
 * types and the board templates are the app's, not the demo's, and a board made on a fresh instance
 * needs a type to make a card with. Empty means "nothing of yours yet", not "nothing at all".
 */
export const workspaceVocabulary = (): { issueTypes: IssueType[]; boardTemplates: BoardTemplate[] } => ({
  issueTypes: structuredClone(issueTypes),
  boardTemplates: structuredClone(BUILT_IN_TEMPLATES),
})

export function demoWorkspace(): DemoWorkspace {
const lanes: Lane[] = []
const flows: BoardFlow[] = []
let seq = 0
function lane(
  boardId: string,
  name: string,
  parentId: string | null,
  order: number,
  flowId: string,
  opts: Partial<Pick<Lane, 'orientation' | 'wipLimit' | 'stage'>> = {},
): Lane {
  const l: Lane = { id: `lane-${++seq}`, boardId, name, parentId, order, flowId, ...opts }
  lanes.push(l)
  return l
}
const root = (boardId: string, flowId: string) => lane(boardId, '', null, 0, flowId, { orientation: 'columns' })

/** The standard four typed columns, one cell each — where any flow starts. */
function columns(boardId: string, flowId: string) {
  const r = root(boardId, flowId)
  const backlog = lane(boardId, 'Backlog', r.id, 0, flowId, { stage: 'backlog' })
  const ns = lane(boardId, 'Not Started', r.id, 1, flowId, { stage: 'notStarted' })
  const ip = lane(boardId, 'In Progress', r.id, 2, flowId, { stage: 'inProgress' })
  const done = lane(boardId, 'Done', r.id, 3, flowId, { stage: 'done' })
  return { r, backlog, ns, ip, done }
}

/**
 * A board's two trees: the team's own cards flow and the initiatives flow the board starts
 * with. They are independent: In Progress splits into Dev / Test for the cards, while the
 * initiatives flow keeps its four standard sections — a team refines its board, the
 * organisation still reads the same shape.
 */
function workflow(boardId: string, splitProgress: boolean): WorkflowLanes {
  const cards: BoardFlow = { id: `flow-${boardId}-cards`, boardId, kind: 'cards', name: 'Cards', order: 0 }
  const initiatives: BoardFlow = { id: `flow-${boardId}-initiatives`, boardId, kind: 'initiatives', name: 'Initiatives', order: 0 }
  flows.push(cards, initiatives)
  const c = columns(boardId, cards.id)
  if (splitProgress) c.ip.orientation = 'columns'
  const dev = splitProgress ? lane(boardId, 'Dev', c.ip.id, 0, cards.id) : c.ip
  const test = splitProgress ? lane(boardId, 'Test', c.ip.id, 1, cards.id) : undefined
  const init = columns(boardId, initiatives.id)
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

// Team Atlas carries a second cards flow: the support queue, with the standard four columns. It is
// the demo's proof that a board is not one tree — two Backlogs, two Doned, and a card that can be
// dragged from one to the other.
const support = ((): SupportLanes => {
  const flow: BoardFlow = { id: 'flow-b-atlas-support', boardId: 'b-atlas', kind: 'cards', name: 'Support', order: 1 }
  flows.push(flow)
  const c = columns('b-atlas', flow.id)
  return { flow, ...c }
})()
a.support = support

// Demo WIP limits: Not Started is at its limit (yellow); Backlog is over it (red).
a.ns.wipLimit = 1
n.backlog.wipLimit = 2

// Demo lane policies (shown via the lane's info icon).
a.ns.description =
  'Pull one card at a time. A card may only enter once it has a clear owner.'
a.test!.description =
  'Definition of done: reviewed, automated checks green, and deployed to staging before it can move to Done.'
  return {
    users: structuredClone(users),
    issueTypes: structuredClone(issueTypes),
    boards: structuredClone(boards),
    flows,
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
