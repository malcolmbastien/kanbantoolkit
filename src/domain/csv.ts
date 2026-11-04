import { isInitiativeItem, tagsOf } from './board'
import { HEALTH_META, type InitiativeHealth } from './health'
import { decompositionParent } from './derive'
import type { Graph } from './derive'
import { cardsFlows } from './flows'
import { childrenOf, effectiveStage, lanePath, placementsInOrder, rootLane, STAGE_LABELS } from './lanes'
import type { Board, BoardFlow, IssueType, Item, Stage, User } from './types'

/**
 * CSV — the cheapest expression of data ownership there is: no server, no account, no queue, just
 * a file the person opens in whatever they already use.
 *
 * The serialiser follows RFC 4180. A field is quoted when it contains a comma, a quote or a line
 * break, and its own quotes are doubled. Titles with commas, quotes and newlines are the normal
 * case in a board, not the edge case, so this is the part worth getting exactly right.
 */

/**
 * One field, quoted only when it has to be. `undefined` and `null` are empty, never the word.
 *
 * A field is exported exactly as it is: nothing is prefixed to a value that starts with `=`, `+`
 * or `-`, because an export is a copy of the person's own data and quietly editing it would make
 * the file a lie about what they hold.
 */
export function csvField(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Rows to CSV text: comma-separated, CRLF-terminated, header first — as the format asks. */
export function toCsv(rows: unknown[][]): string {
  if (rows.length === 0) return ''
  return `${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`
}

/**
 * The board's cards in the order the board reads them: flow by flow, column by column, cell by
 * cell. Every cards flow is read — the board is what is exported, not one of its tabs — and the
 * flows keep the order the board gives them.
 */
function cardsInBoardOrder(boardId: string, graph: Graph, flows: BoardFlow[]): { item: Item; laneId: string }[] {
  const out: { item: Item; laneId: string }[] = []
  for (const flow of cardsFlows(flows, boardId)) {
    const root = rootLane(graph.lanes, flow.id)
    if (!root) continue
    const walk = (laneId: string) => {
      for (const p of placementsInOrder(graph.placements, laneId)) {
        const item = graph.items.find((i) => i.id === p.itemId)
        if (item && !item.archived) out.push({ item, laneId })
      }
      for (const child of childrenOf(graph.lanes, laneId)) walk(child.id)
    }
    walk(root.id)
  }
  return out
}

export const BOARD_CSV_HEADER = [
  'Title',
  'Type',
  'Column',
  // The tree the column belongs to. Always a column, even on a board with one cards flow: a file
  // is read by something that did not watch the board being designed, and a column that appears
  // only sometimes is a column every consumer has to guess about.
  'Flow',
  'Stage',
  'Assignees',
  'Blocked',
  'Blocked reason',
  'Target start',
  'Target end',
  // The promise, beside the plan: a reader of the file has the same two dates the drawer shows.
  'Due',
  // Where the work lives elsewhere: the label the card shows and the address it opens.
  'External label',
  'External URL',
  'Parent',
  'Tags',
]

/**
 * The board's cards as CSV text — one row per card the board carries, in board order.
 *
 * Archived cards are left out: they are off the board, and the Archive view is where they live.
 * Assignees are joined with semicolons so a comma in someone's name cannot break the column, and
 * the column is the lane's full path, because a cell's own name ("Test") rarely says enough.
 */
export function boardCsv(
  boardId: string,
  graph: Graph,
  types: IssueType[],
  users: User[],
  flows: BoardFlow[],
  boards: Board[] = [],
): string {
  const nameOf = (id: string) => types.find((t) => t.id === id)?.name ?? 'Item'
  const nameOfUser = (id: string) => users.find((u) => u.id === id)?.name ?? id
  const flowOfLane = new Map(graph.lanes.map((l) => [l.id, flows.find((f) => f.id === l.flowId)?.name ?? ''] as const))
  const rows = cardsInBoardOrder(boardId, graph, flows)
    .filter(({ item }) => !isInitiativeItem(item, types))
    .map(({ item, laneId }) => {
      const stage = effectiveStage(graph.lanes, laneId)
      const parentId = decompositionParent(item.id, graph.edges)
      return [
        item.title,
        nameOf(item.typeId),
        lanePath(graph.lanes, laneId).join(' / '),
        flowOfLane.get(laneId) ?? '',
        stage ? STAGE_LABELS[stage] : '',
        (item.assignees ?? []).map(nameOfUser).join('; '),
        item.blocked ? 'yes' : 'no',
        item.blocked ? item.blockedReason ?? '' : '',
        item.targetStartDate ?? '',
        item.targetEndDate ?? '',
        item.dueDate ?? '',
        item.externalLabel ?? '',
        item.externalUrl ?? '',
        parentId ? graph.items.find((i) => i.id === parentId)?.title ?? '' : '',
        // Semicolons, like assignees: a comma in a tag name must not break the column.
        tagsOf(boards, item).map((t) => t.name).join('; '),
      ]
    })
  return toCsv([BOARD_CSV_HEADER, ...rows])
}

/** A management dashboard row, exactly as the dashboard computes it. */
export interface DashboardCsvRow {
  item: Item
  roll: { bucket: Stage; percent: number; done: number; total: number; inProgress: number }
  blocked: number
  overdue: boolean
  health: InitiativeHealth
  /** The board's own label for the initiative, or "None" — which is the absence of one. */
  kind: string
  /** The item's tags, joined the way assignees are. */
  tags: string
}

export const DASHBOARD_CSV_HEADER = [
  'Initiative',
  'Type',
  'Kind',
  'Progress %',
  'Done',
  'Total',
  'In progress',
  'Target start',
  'Target end',
  'Due',
  'Status',
  'Overdue',
  'Blocked below',
  'Health',
  'Flags',
  'Tags',
]

/** The dashboard's rows as CSV text — the same rows, the same numbers, as a file. */
export function dashboardCsv(rows: DashboardCsvRow[], types: IssueType[]): string {
  const nameOf = (id: string) => types.find((t) => t.id === id)?.name ?? 'Item'
  return toCsv([
    DASHBOARD_CSV_HEADER,
    ...rows.map(({ item, roll, blocked, overdue, health, kind, tags }) => [
      item.title,
      nameOf(item.typeId),
      kind,
      roll.percent,
      roll.done,
      roll.total,
      roll.inProgress,
      item.targetStartDate ?? '',
      item.targetEndDate ?? '',
      item.dueDate ?? '',
      STAGE_LABELS[roll.bucket],
      overdue ? 'yes' : 'no',
      blocked,
      HEALTH_META[health.level].label,
      health.flags.map((f) => f.label).join('; '),
      tags,
    ]),
  ])
}

/**
 * One delivered card in the Flow report's window: the same facts the scatter's tooltip reads.
 * Dates are the local days the screen shows, so a file opened elsewhere names the same day.
 */
export interface FlowCsvRow {
  title: string
  type: string
  createdAt: number
  committedAt: number
  resolvedAt: number
  leadDays: number
  cycleDays: number
}

export const FLOW_CSV_HEADER = ['Card', 'Type', 'Created', 'Committed', 'Done', 'Lead (days)', 'Cycle (days)']

/** The local calendar day, as `YYYY-MM-DD` — the day a reader saw, not a UTC shift of it. */
const localDay = (ms: number): string => {
  const day = new Date(ms)
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

/** A duration with at most one decimal, so a file and the screen round the same way. */
const oneDecimal = (value: number): number => Math.round(value * 10) / 10

/**
 * The Flow report's delivered cards as CSV text — every card in the window, not the most recent
 * screenful. This is the data behind the cycle-time reading, and the file keeps it available now
 * that the on-screen table is gone.
 */
export function flowCsv(rows: FlowCsvRow[]): string {
  return toCsv([
    FLOW_CSV_HEADER,
    ...rows.map((row) => [
      row.title,
      row.type,
      localDay(row.createdAt),
      localDay(row.committedAt),
      localDay(row.resolvedAt),
      oneDecimal(row.leadDays),
      oneDecimal(row.cycleDays),
    ]),
  ])
}

/** A filename that survives a filesystem: lower-case, dashes, no punctuation a shell minds. */
export function csvFilename(name: string, kind: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'kanbantoolkit'}-${kind}.csv`
}
