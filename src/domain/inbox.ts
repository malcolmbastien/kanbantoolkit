/**
 * The inbox: what happened to the work a person watches.
 *
 * A row is one event about one item, in words a reader can act on. It is built from the workspace's
 * own record rather than kept beside it — on an instance the outbox is the source, and in the demo
 * the items' histories are — so a row cannot say something the board disagrees with.
 *
 * The sentence is deliberately plain and short: "Maya moved Rebuild the signup form to Done". The
 * board and cell travel beside it as context, not as part of the sentence, because a reader who
 * clicked from the wrong board needs to know which one this was.
 */

import type { Board, Item, ItemLogEntry, Lane, Stage, User } from './types'
import type { WebhookEventType } from './webhooks'

/** The stages, in the words a board prints. */
const STAGE_NAMES: Record<Stage, string> = {
  backlog: 'Backlog',
  notStarted: 'Not started',
  inProgress: 'In progress',
  done: 'Done',
}

/** A health level in a sentence. The badge says "At risk"; a row says what that means. */
const HEALTH_NAMES: Record<string, string> = {
  healthy: 'on track',
  watch: 'worth watching',
  atRisk: 'at risk',
}

export interface InboxRow {
  /** The event's id, which is its identity and the key a list renders by. */
  id: string
  type: WebhookEventType
  at: number
  /**
   * The outbox position of the event, on a row built from one. The panel does not read it; the
   * digest does, so a watch that started after an event does not quote that event back.
   */
  seq?: number
  /** Whether this row is at or before the person's cursor. */
  read: boolean
  actorId?: string
  /** The actor's name, resolved where the row was built. Absent when nobody was named. */
  actor?: string
  itemId: string
  itemTitle: string
  boardId?: string
  boardName?: string
  laneId?: string
  laneName?: string
  fromStage?: Stage
  toStage?: Stage
  /** Why a card is blocked. */
  reason?: string
  /** The field names an edit changed. */
  fields?: string[]
  /** An initiative's health before and after, when the reading moved. */
  health?: { before: string; after: string }
  /** A note's id, so a future surface can open the entry rather than only the card. */
  entryId?: string
  mentions?: string[]
  /**
   * A line the source itself wrote, for a demo row built from a history entry whose kind has no
   * event of its own (an edit's "title: … → …"). An instance leaves it out: the outbox carries
   * the field names instead.
   */
  detail?: string
}

/** Who did it, as a sentence starts. Nobody is "Somebody", never a blank. */
export function inboxActor(row: Pick<InboxRow, 'actor'>): string {
  return row.actor?.trim() || 'Somebody'
}

/**
 * What the row says.
 *
 * One sentence per event, built from what the event carries. A kind this build does not know is
 * still shown — "Something happened to X" — because dropping it would make the inbox quietly
 * incomplete, and inventing a specific verb would be worse.
 */
export function inboxSentence(row: InboxRow): string {
  const who = inboxActor(row)
  switch (row.type) {
    case 'item.created':
      return `${who} created ${row.itemTitle}`
    case 'item.moved': {
      const to = row.laneName ?? (row.toStage ? STAGE_NAMES[row.toStage] : undefined) ?? 'another column'
      const from = row.fromStage && row.fromStage !== row.toStage ? ` from ${STAGE_NAMES[row.fromStage]}` : ''
      return `${who} moved ${row.itemTitle}${from} to ${to}`
    }
    case 'item.blocked':
      return `${who} blocked ${row.itemTitle}${row.reason ? ` — ${row.reason}` : ''}`
    case 'item.unblocked':
      return `${who} unblocked ${row.itemTitle}`
    case 'item.noted':
      return `${who} noted on ${row.itemTitle}`
    case 'item.updated': {
      const fields = row.fields?.length ? ` (${row.fields.join(', ')})` : row.detail ? ` (${row.detail})` : ''
      return `${who} edited ${row.itemTitle}${fields}`
    }
    case 'initiative.health_changed': {
      const after = row.health ? HEALTH_NAMES[row.health.after] ?? row.health.after : 'changed'
      const before = row.health ? HEALTH_NAMES[row.health.before] ?? row.health.before : undefined
      return `${row.itemTitle} is now ${after}${before ? ` (was ${before})` : ''}`
    }
    case 'objective.mapped':
      return `${who} mapped ${row.itemTitle} to an objective`
    case 'objective.unmapped':
      return `${who} unmapped ${row.itemTitle}`
    default:
      return `${who} changed ${row.itemTitle}`
  }
}

/** Where a row happened: the board, then the cell when the item is in one. */
export function inboxWhere(row: Pick<InboxRow, 'boardName' | 'laneName'>): string | undefined {
  if (row.boardName && row.laneName) return `${row.boardName} · ${row.laneName}`
  return row.boardName ?? row.laneName
}

/** Everything the demo's inbox needs to read a workspace, and nothing else. */
export interface DemoInboxInput {
  items: Item[]
  users: User[]
  boards: Board[]
  lanes: Lane[]
  watchedItemIds: string[]
  /**
   * When each watch began, by item id. The demo has no outbox positions, so a moment is its
   * equivalent: an entry older than the watch is history, not news.
   */
  watchStartedAt?: Record<string, number>
  /** Entries at or before this moment are read. The demo's cursor, held in this browser. */
  readAt: number
  /** A bound on how much history a bell should read; newest first after the sort. */
  limit?: number
}

/**
 * The inbox a browser can build with no server.
 *
 * On an instance the outbox is the record and the server answers this question. A static build has
 * no outbox, so it reads the one record it does have — the items' histories — for the items this
 * person watches. The row shapes are the same, which is what lets the panel and its tests be one.
 */
export function demoInboxRows(input: DemoInboxInput): InboxRow[] {
  const watched = new Set(input.watchedItemIds)
  const userById = new Map(input.users.map((user) => [user.id, user]))
  const boardById = new Map(input.boards.map((board) => [board.id, board]))
  const laneById = new Map(input.lanes.map((lane) => [lane.id, lane]))
  const rows: InboxRow[] = []

  for (const item of input.items) {
    if (!watched.has(item.id)) continue
    const beganAt = input.watchStartedAt?.[item.id] ?? 0
    for (const entry of item.log ?? []) {
      if (entry.at < beganAt) continue
      const row = demoRowOf(item, entry, userById, boardById, laneById, input.readAt)
      if (row) rows.push(row)
    }
  }

  rows.sort((left, right) => right.at - left.at || right.id.localeCompare(left.id))
  return typeof input.limit === 'number' ? rows.slice(0, input.limit) : rows
}

function demoRowOf(
  item: Item,
  entry: ItemLogEntry,
  userById: Map<string, User>,
  boardById: Map<string, Board>,
  laneById: Map<string, Lane>,
  readAt: number,
): InboxRow | undefined {
  const type = demoTypeOf(entry.kind)
  if (!type) return undefined
  const board = entry.boardId ? boardById.get(entry.boardId) : undefined
  const lane = entry.toLaneId ? laneById.get(entry.toLaneId) : undefined
  return {
    id: entry.id,
    type,
    at: entry.at,
    read: entry.at <= readAt,
    ...(entry.by ? { actorId: entry.by } : {}),
    ...(entry.by ? { actor: userById.get(entry.by)?.name ?? 'Somebody' } : {}),
    itemId: item.id,
    itemTitle: item.title,
    ...(board ? { boardId: board.id, boardName: board.name } : {}),
    ...(lane ? { laneId: lane.id, laneName: lane.name } : {}),
    ...(entry.fromStage ? { fromStage: entry.fromStage } : {}),
    ...(entry.toStage ? { toStage: entry.toStage } : {}),
    ...(entry.kind === 'blocked' && entry.note ? { reason: entry.note } : {}),
    ...(entry.kind === 'noted' ? { entryId: entry.id } : {}),
    ...(entry.mentions?.length ? { mentions: entry.mentions } : {}),
    ...(entry.kind === 'edited' && entry.note ? { detail: entry.note } : {}),
  }
}

/** The history kinds that belong in an inbox — a checklist tick is not news about the work. */
function demoTypeOf(kind: string): WebhookEventType | undefined {
  switch (kind) {
    case 'created':
      return 'item.created'
    case 'moved':
      return 'item.moved'
    case 'blocked':
      return 'item.blocked'
    case 'unblocked':
      return 'item.unblocked'
    case 'noted':
      return 'item.noted'
    case 'edited':
    case 'archived':
    case 'discarded':
    case 'restored':
      return 'item.updated'
    default:
      return undefined
  }
}
