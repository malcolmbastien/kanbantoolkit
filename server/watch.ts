/**
 * Watching a piece of work, and the inbox that reads the outbox.
 *
 * A watch is one row: a person, an item and when they started caring. It is held by the instance,
 * not by a browser, so the same watch is there on the next device and outlives a closed tab. There
 * is no board, filter or dependency subscription here on purpose — a watch is about a **piece of
 * work**, not a view of the board.
 *
 * The inbox is a **cursor over `outbound_events`**, not a second history. The workspace already
 * writes that record for webhooks, so an inbox row and a receiver's event cannot disagree; the
 * server reads the events whose item this person watches and marks them read by position. That is
 * why the outbox gained `seq` and `item_id` (migration 44): a UUID is a contract with a receiver,
 * and a reader needs an order.
 *
 * Nothing here is a permission. The route asks only for `board.read`, which is what a Viewer has,
 * and every event is filtered to a watched item the person could already read. The inbox is always
 * the caller's own: no route takes a person id from a request.
 */

import { Hono } from 'hono'
import type { Runtime } from './runtime'
import { requireWorkspace } from './access'
import type { Database } from './db'
import type { Item, Stage } from '../src/domain/types'
import type { InboxRow } from '../src/domain/inbox'
import type { WebhookEventType } from '../src/domain/webhooks'
import { readItemsByIds } from './workspace/read'

type Row = Record<string, unknown>
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const maybeText = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const number = (value: unknown): number => (typeof value === 'number' ? value : 0)

/**
 * The default page a bell reads, and the ceiling a caller may ask for.
 *
 * A bell is a glance, not the archive: fifty newest rows is more than a person reads in one look,
 * and a page bound keeps a long history from becoming one large response.
 */
const PAGE = 50
const MAX_PAGE = 200

function pageSize(asked: unknown): number {
  const value = typeof asked === 'string' ? Number(asked) : typeof asked === 'number' ? asked : PAGE
  return Number.isInteger(value) && value > 0 ? Math.min(value, MAX_PAGE) : PAGE
}

/* ---- Who watches ----------------------------------------------------------------------------- */

/**
 * Subscribe the people a write implies, without asking them.
 *
 * The creator, each person newly assigned, and the author of a note. A **mention** is not here: a
 * name in a sentence is an address for one message, not a request for a feed, and the delivery task
 * is where a mention is sent. An explicit Watch/Unwatch is a person's choice and is never undone by
 * this function — it only ever adds.
 *
 * Called from `emitItemChange`, after the write has landed. A failed watch insert must not fail the
 * write, so callers keep the same "a receiver's problem is not the card's" rule the events use.
 *
 * The watch starts at the outbox as it is **before** the event this write is about to emit, so the
 * change that caused the watch (the create, the assignment, the note) is the first thing the person
 * sees — and the card's earlier history is not.
 */
/** The last position written in a workspace. A watch made now begins after it. */
async function currentSeq(db: Database, workspaceId: string): Promise<number> {
  const row = await db.get<Row>('SELECT MAX(seq) AS seq FROM outbound_events WHERE workspace_id = ?1', [workspaceId])
  return row ? number(row.seq) : 0
}

export async function syncAutoWatches(
  db: Database,
  workspaceId: string,
  before: Item | undefined,
  after: Item | undefined,
  actorId?: string,
): Promise<void> {
  if (!after) return
  const watchers = new Set<string>()

  // The creator: only on a create, and only when the server knows who acted.
  if (!before && actorId) watchers.add(actorId)

  // Each person who was just added to the card. An assignee who was already there is not a new
  // subscription on every save.
  const wasAssigned = new Set(before?.assignees ?? [])
  for (const assignee of after.assignees ?? []) if (!wasAssigned.has(assignee)) watchers.add(assignee)

  // Whoever wrote a note in this write. A note is a person speaking on the card, which is the
  // moment they start caring what happens to it.
  const known = new Set((before?.log ?? []).map((entry) => entry.id))
  for (const entry of after.log ?? []) {
    if (!known.has(entry.id) && entry.kind === 'noted' && entry.by) watchers.add(entry.by)
  }

  if (!watchers.size) return
  const at = Date.now()
  try {
    const since = await currentSeq(db, workspaceId)
    await db.batch(
      [...watchers].map((userId) => ({
        sql: `INSERT OR IGNORE INTO item_watch (workspace_id, user_id, item_id, created_at, since_seq)
              VALUES (?1, ?2, ?3, ?4, ?5)`,
        params: [workspaceId, userId, after.id, at, since],
      })),
    )
  } catch (error) {
    // A subscription is a consequence of the write, never a condition of it. A person whose row
    // vanished between the write and this insert loses their watch; the card is still saved, and
    // the change is still in the outbox for the people who are here.
    console.error('watching a changed item failed', error)
  }
}

/** The items one person watches here, in the order they started. Missing items are dropped. */
export async function readWatches(db: Database, workspaceId: string, userId: string): Promise<string[]> {
  const rows = await db.all<Row>(
    `SELECT w.item_id AS item_id FROM item_watch w
       JOIN items i ON i.id = w.item_id AND i.workspace_id = w.workspace_id
      WHERE w.workspace_id = ?1 AND w.user_id = ?2
      ORDER BY w.created_at, w.item_id`,
    [workspaceId, userId],
  )
  return rows.map((row) => text(row.item_id))
}

/** Whether one person watches one item. */
export async function isWatching(
  db: Database,
  workspaceId: string,
  userId: string,
  itemId: string,
): Promise<boolean> {
  return Boolean(
    await db.get('SELECT 1 AS seen FROM item_watch WHERE workspace_id = ?1 AND user_id = ?2 AND item_id = ?3', [
      workspaceId,
      userId,
      itemId,
    ]),
  )
}

/**
 * Watch one item. Idempotent: asking twice is still one watch, and the second ask does not move the
 * starting position — a watcher who has already seen the last hour should not lose it by pressing
 * the bell again.
 */
export async function watchItem(db: Database, workspaceId: string, userId: string, itemId: string): Promise<void> {
  const since = await currentSeq(db, workspaceId)
  await db.run(
    `INSERT OR IGNORE INTO item_watch (workspace_id, user_id, item_id, created_at, since_seq)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
    [workspaceId, userId, itemId, Date.now(), since],
  )
}

/** Stop watching one item. Idempotent: unwatching something you never watched is not an error. */
export async function unwatchItem(db: Database, workspaceId: string, userId: string, itemId: string): Promise<void> {
  await db.run('DELETE FROM item_watch WHERE workspace_id = ?1 AND user_id = ?2 AND item_id = ?3', [
    workspaceId,
    userId,
    itemId,
  ])
}

/* ---- The inbox ------------------------------------------------------------------------------- */

/** The position this person has read up to. Zero means they have not opened it yet. */
export async function readCursor(db: Database, workspaceId: string, userId: string): Promise<number> {
  const row = await db.get<Row>(
    'SELECT last_seen_event_seq AS seq FROM inbox_cursor WHERE workspace_id = ?1 AND user_id = ?2',
    [workspaceId, userId],
  )
  return row ? number(row.seq) : 0
}

export interface InboxPage {
  rows: InboxRow[]
  unread: number
  cursor: number
}

/**
 * One page of a person's inbox, newest first, with the unread count beside it.
 *
 * The unread count is a count, not a badge computed from the page: a person who has been away may
 * have more rows than this page holds, and "3" when there are thirty would be the interface lying.
 * A row whose item has since been deleted is dropped, because a dead link is not a notification.
 */
export async function readInbox(
  db: Database,
  workspaceId: string,
  userId: string,
  options: { limit?: unknown } = {},
): Promise<InboxPage> {
  const cursor = await readCursor(db, workspaceId, userId)
  const limit = pageSize(options.limit)

  const events = await db.all<Row>(
    `SELECT e.id AS id, e.seq AS seq, e.type AS type, e.payload AS payload,
            e.occurred_at AS occurred_at, e.actor_id AS actor_id, e.item_id AS item_id
       FROM outbound_events e
       JOIN item_watch w
         ON w.workspace_id = e.workspace_id AND w.item_id = e.item_id AND w.user_id = ?2
        AND e.seq > w.since_seq
       JOIN items i ON i.id = e.item_id AND i.workspace_id = e.workspace_id
      WHERE e.workspace_id = ?1
      ORDER BY e.seq DESC
      LIMIT ?3`,
    [workspaceId, userId, limit],
  )

  const unreadRow = await db.get<Row>(
    `SELECT COUNT(*) AS n FROM outbound_events e
       JOIN item_watch w
         ON w.workspace_id = e.workspace_id AND w.item_id = e.item_id AND w.user_id = ?2
        AND e.seq > w.since_seq
       JOIN items i ON i.id = e.item_id AND i.workspace_id = e.workspace_id
      WHERE e.workspace_id = ?1 AND e.seq > ?3`,
    [workspaceId, userId, cursor],
  )
  const unread = unreadRow ? number(unreadRow.n) : 0

  if (!events.length) return { rows: [], unread, cursor }

  const itemIds = [...new Set(events.map((event) => text(event.item_id)))]
  const marks = itemIds.map((_, index) => `?${index + 2}`).join(', ')
  const [items, placements, boards, lanes, people] = await Promise.all([
    readItemsByIds(db, itemIds, workspaceId, { history: false }),
    db.all<Row>(`SELECT * FROM placements WHERE workspace_id = ?1 AND item_id IN (${marks})`, [workspaceId, ...itemIds]),
    db.all<Row>('SELECT id, name FROM boards WHERE workspace_id = ?1', [workspaceId]),
    db.all<Row>('SELECT id, name FROM lanes WHERE workspace_id = ?1', [workspaceId]),
    db.all<Row>('SELECT id, name FROM people WHERE workspace_id = ?1', [workspaceId]),
  ])

  const lookup: InboxLookup = {
    itemById: new Map(items.map((item) => [item.id, item])),
    placementByItem: new Map(),
    boardName: new Map(boards.map((row) => [text(row.id), text(row.name)])),
    laneName: new Map(lanes.map((row) => [text(row.id), text(row.name)])),
    personName: new Map(people.map((row) => [text(row.id), text(row.name)])),
  }
  for (const row of placements) {
    const itemId = text(row.item_id)
    if (!lookup.itemById.has(itemId)) continue
    const boardId = maybeText(row.board_id)
    const laneId = maybeText(row.lane_id)
    lookup.placementByItem.set(itemId, { ...(boardId ? { boardId } : {}), ...(laneId ? { laneId } : {}) })
  }

  return { rows: inboxRowsOf(events, lookup, cursor), unread, cursor }
}

/**
 * The maps a row needs to be built: the item, where it sits, and the names of the board, the cell
 * and the person who acted. `readInbox` fills them with one targeted read; the digest already holds
 * the workspace, so it fills them from that. One row builder is what keeps the two readings of the
 * same event from saying different things.
 */
export interface InboxLookup {
  itemById: Map<string, Item>
  placementByItem: Map<string, { boardId?: string; laneId?: string }>
  boardName: Map<string, string>
  laneName: Map<string, string>
  personName: Map<string, string>
}

/** Build the rows for a set of events, newest first. Events whose item has gone are dropped. */
export function inboxRowsOf(events: Row[], lookup: InboxLookup, cursor: number): InboxRow[] {
  const rows: InboxRow[] = []
  for (const event of events) {
    const itemId = text(event.item_id)
    const item = lookup.itemById.get(itemId)
    if (!item) continue
    const row = inboxRowOf(event, item, lookup, cursor)
    if (row) rows.push(row)
  }
  return rows
}

function inboxRowOf(event: Row, item: Item, lookup: InboxLookup, cursor: number): InboxRow | undefined {
  const placement = lookup.placementByItem.get(item.id)
  const { boardName, laneName, personName } = lookup
  let data: Record<string, unknown> = {}
  try {
    const envelope = JSON.parse(text(event.payload)) as { data?: Record<string, unknown> }
    data = envelope.data ?? {}
  } catch {
    // A row that cannot be parsed is still a change that happened; it shows with what the columns
    // carry rather than disappearing.
  }

  const seq = number(event.seq)
  const actorId = maybeText(event.actor_id)
  const laneId = maybeText(data.laneId) ?? placement?.laneId
  const boardId = maybeText(data.boardId) ?? placement?.boardId
  const fromStage = maybeText(data.fromStage) as Stage | undefined
  const toStage = maybeText(data.toStage) as Stage | undefined

  const row: InboxRow = {
    id: text(event.id),
    type: text(event.type) as WebhookEventType,
    at: number(event.occurred_at),
    read: seq <= cursor,
    seq,
    itemId: item.id,
    itemTitle: item.title,
    ...(actorId ? { actorId } : {}),
    ...(actorId && personName.get(actorId) ? { actor: personName.get(actorId) } : {}),
    ...(boardId ? { boardId } : {}),
    ...(boardId && boardName.get(boardId) ? { boardName: boardName.get(boardId) } : {}),
    ...(laneId ? { laneId } : {}),
    ...(laneId && laneName.get(laneId) ? { laneName: laneName.get(laneId) } : {}),
    ...(fromStage ? { fromStage } : {}),
    ...(toStage ? { toStage } : {}),
    ...(maybeText(data.reason) ? { reason: maybeText(data.reason) } : {}),
    ...(Array.isArray(data.fields) ? { fields: data.fields.filter((field): field is string => typeof field === 'string') } : {}),
    ...(maybeText(data.entryId) ? { entryId: maybeText(data.entryId) } : {}),
    ...(Array.isArray(data.mentions)
      ? { mentions: data.mentions.filter((mention): mention is string => typeof mention === 'string') }
      : {}),
  }
  if (maybeText(event.type) === 'initiative.health_changed') {
    // The event carries `{ level, flags }` on each side, not a bare word. A row reads the level;
    // the flags are the board's detail, and a sentence is not the place to list them.
    const level = (value: unknown): string | undefined =>
      typeof value === 'string'
        ? value
        : value && typeof value === 'object' && typeof (value as Record<string, unknown>).level === 'string'
          ? ((value as Record<string, unknown>).level as string)
          : undefined
    const before = level(data.before)
    const after = level(data.after)
    if (before && after) row.health = { before, after }
  }
  return row
}

/**
 * Mark everything currently in this person's inbox read.
 *
 * The cursor is the workspace's highest position, not the highest watched one: positions are shared,
 * and skipping the events in between would be a cursor that means "read up to here" while leaving a
 * gap. An event that arrives after this call has a higher position and is unread, which is what the
 * bell should say.
 */
export async function markInboxRead(db: Database, workspaceId: string, userId: string): Promise<number> {
  const row = await db.get<Row>('SELECT MAX(seq) AS seq FROM outbound_events WHERE workspace_id = ?1', [workspaceId])
  const cursor = row ? number(row.seq) : 0
  await db.run(
    `INSERT INTO inbox_cursor (workspace_id, user_id, last_seen_event_seq) VALUES (?1, ?2, ?3)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET last_seen_event_seq = excluded.last_seen_event_seq`,
    [workspaceId, userId, cursor],
  )
  return cursor
}

/* ---- The routes ------------------------------------------------------------------------------ */

export function watchRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  /**
   * The items this person watches. One read for the whole board, so a bell and every watch control
   * agree without asking once per card.
   */
  routes.get('/watches', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'board.read')
    if (allowed instanceof Response) return allowed
    return c.json({ itemIds: await readWatches(allowed.db, allowed.workspaceId, allowed.user.id) })
  })

  /** Whether this person watches one item. The card's controls read this where they need one. */
  routes.get('/items/:id/watch', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'board.read')
    if (allowed instanceof Response) return allowed
    const itemId = c.req.param('id')
    if (!(await exists(allowed.db, itemId, allowed.workspaceId))) return c.json({ error: 'no such item' }, 404)
    return c.json({ itemId, watching: await isWatching(allowed.db, allowed.workspaceId, allowed.user.id, itemId) })
  })

  /**
   * Watch one item. A watch is not a permission, so the door is the read a Viewer already has;
   * asking twice is still one watch.
   */
  routes.post('/items/:id/watch', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'board.read')
    if (allowed instanceof Response) return allowed
    const itemId = c.req.param('id')
    if (!(await exists(allowed.db, itemId, allowed.workspaceId))) return c.json({ error: 'no such item' }, 404)
    await watchItem(allowed.db, allowed.workspaceId, allowed.user.id, itemId)
    return c.json({ itemId, watching: true })
  })

  /** Stop watching one item. Unwatching something never watched is not an error. */
  routes.delete('/items/:id/watch', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'board.read')
    if (allowed instanceof Response) return allowed
    const itemId = c.req.param('id')
    if (!(await exists(allowed.db, itemId, allowed.workspaceId))) return c.json({ error: 'no such item' }, 404)
    await unwatchItem(allowed.db, allowed.workspaceId, allowed.user.id, itemId)
    return c.json({ itemId, watching: false })
  })

  /** This person's inbox: newest first, with the unread count beside it. */
  routes.get('/inbox', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'board.read')
    if (allowed instanceof Response) return allowed
    const page = await readInbox(allowed.db, allowed.workspaceId, allowed.user.id, { limit: c.req.query('limit') })
    return c.json(page)
  })

  /** Mark everything currently in the inbox read. */
  routes.post('/inbox/read', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'board.read')
    if (allowed instanceof Response) return allowed
    const cursor = await markInboxRead(allowed.db, allowed.workspaceId, allowed.user.id)
    return c.json({ cursor, unread: 0 })
  })

  return routes
}

async function exists(db: Database, itemId: string, workspaceId: string): Promise<boolean> {
  return Boolean(await db.get('SELECT 1 AS seen FROM items WHERE id = ?1 AND workspace_id = ?2', [itemId, workspaceId]))
}
