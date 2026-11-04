/**
 * The outbound event layer: the one record of "something happened" that a receiver can subscribe to.
 *
 * Events are written after the change that caused them has landed. A webhook that is down is a
 * retry, not a lost fact: `emitEvent` writes the envelope and one delivery per interested endpoint
 * in one batch, and `webhooks.ts` owns the attempts. A failure here must never fail the write the
 * person made — a board that refused a card because a receiver was offline would be a board that
 * put somebody else's integration in front of the work.
 *
 * Health is derived, so it has no event of its own to hook: this module compares the health of the
 * initiatives above a changed item before and after the write and emits only when the reading
 * actually moved. Receivers can also compute health from `item.*`; this event is a convenience.
 */

import { isInitiativeItem } from '../src/domain/board'
import { decompositionParent, type Graph } from '../src/domain/derive'
import { initiativeHealth, type InitiativeHealth } from '../src/domain/health'
import type { Item, IssueType } from '../src/domain/types'
import type { WebhookEventType } from '../src/domain/webhooks'
import type { Database, Statement } from './db'
import { readWorkspace } from './workspace/read'
import { syncAutoWatches } from './watch'

const newId = () => crypto.randomUUID()

export interface EventEnvelope {
  id: string
  type: WebhookEventType
  occurredAt: number
  workspaceId: string
  actorId?: string
  data: Record<string, unknown>
}

/** Whether an endpoint's stored filter wants this type. An empty list means everything. */
function wants(eventTypes: string | null, type: WebhookEventType): boolean {
  if (!eventTypes) return true
  try {
    const list = JSON.parse(eventTypes) as unknown
    return Array.isArray(list) && (list.length === 0 || list.includes(type))
  } catch {
    // A row that cannot be parsed is not a subscription to anything in particular. The admin
    // screen can repair it; the dispatcher does not guess.
    return false
  }
}

/**
 * Record one event and fan it out to the endpoints that asked for it.
 *
 * The event is written even when nobody is listening: it is the history a receiver can catch up
 * from if it was added later, and an empty outbox would make "was this emitted?" unanswerable.
 */
export async function emitEvent(
  db: Database,
  workspaceId: string,
  type: WebhookEventType,
  data: Record<string, unknown>,
  actorId?: string,
): Promise<void> {
  const occurredAt = Date.now()
  const id = newId()
  const envelope: EventEnvelope = {
    id,
    type,
    occurredAt,
    workspaceId,
    ...(actorId ? { actorId } : {}),
    data,
  }
  const payload = JSON.stringify(envelope)

  const endpoints = await db.all<{ id: string; event_types: string | null }>(
    'SELECT id, event_types FROM webhook_endpoints WHERE workspace_id = ?1 AND active = 1',
    [workspaceId],
  )
  const interested = endpoints.filter((endpoint) => wants(endpoint.event_types, type))

  // Two things a reader needs that a receiver does not: an order (`seq`) and the item the event is
  // about. The public id stays the UUID the webhook contract names; `seq` is the inbox's position,
  // taken from the outbox itself so two events cannot claim the same place.
  const itemId =
    typeof data.itemId === 'string'
      ? data.itemId
      : typeof data.initiativeId === 'string'
        ? data.initiativeId
        : null

  const statements: Statement[] = [
    {
      sql: `INSERT INTO outbound_events (id, workspace_id, type, payload, occurred_at, actor_id, item_id, seq)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, (SELECT COALESCE(MAX(seq), 0) + 1 FROM outbound_events))`,
      params: [id, workspaceId, type, payload, occurredAt, actorId ?? null, itemId],
    },
  ]
  for (const endpoint of interested) {
    statements.push({
      sql: `INSERT INTO webhook_deliveries
              (id, endpoint_id, event_id, status, attempts, next_attempt_at, created_at, updated_at)
            VALUES (?1, ?2, ?3, 'pending', 0, ?4, ?4, ?4)`,
      params: [newId(), endpoint.id, id, occurredAt],
    })
  }
  await db.batch(statements)
}

const movedEntry = (item: Item | undefined) =>
  [...(item?.log ?? [])].filter((entry) => entry.kind === 'moved').sort((a, b) => a.at - b.at).at(-1)

/**
 * The fields an edit changed, in the words a row prints.
 *
 * `blocked` is not here: a block has its own event, and saying it twice would be two rows for one
 * act. `rev`, `log` and the derived arrival/archive clocks are not fields a person edited either.
 * External link is one line because a label and an address are one link.
 */
const EDITABLE_FIELDS: Array<{ key: keyof Item; label: string }> = [
  { key: 'title', label: 'title' },
  { key: 'description', label: 'description' },
  { key: 'typeId', label: 'type' },
  { key: 'initiativeTypeId', label: 'kind' },
  { key: 'priority', label: 'priority' },
  { key: 'assignees', label: 'assignees' },
  { key: 'tagIds', label: 'tags' },
  { key: 'targetStartDate', label: 'target start' },
  { key: 'targetEndDate', label: 'target end' },
  { key: 'dueDate', label: 'due date' },
  { key: 'externalLabel', label: 'external link' },
  { key: 'externalUrl', label: 'external link' },
  { key: 'checklist', label: 'checklist' },
  { key: 'archived', label: 'archived' },
  { key: 'discarded', label: 'discarded' },
]

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const one = left as Record<string, unknown>
  const two = right as Record<string, unknown>
  const keys = Object.keys(one)
  if (keys.length !== Object.keys(two).length) return false
  return keys.every((key) => key in two && sameValue(one[key], two[key]))
}

/** The labels of the fields that moved, once each, in the order above. */
function changedFields(before: Item, after: Item): string[] {
  const labels: string[] = []
  for (const { key, label } of EDITABLE_FIELDS) {
    if (sameValue(before[key], after[key])) continue
    if (!labels.includes(label)) labels.push(label)
  }
  return labels
}

function graphOf(state: Awaited<ReturnType<typeof readWorkspace>>): Graph {
  return { items: state.items, edges: state.edges, links: state.links, placements: state.placements, lanes: state.lanes }
}

/** The after graph when the caller already holds it, with the vocabulary health needs. */
export interface AfterGraph {
  graph: Graph
  issueTypes: IssueType[]
}

/**
 * The graph after one item's own fields changed.
 *
 * A card write does not move a placement, a lane, an edge or a link — those have their own writes.
 * So the after graph is the before graph with one item replaced or added, in the same order
 * `readWorkspace` uses. This is what lets a save skip reading the workspace a second time.
 */
export function graphWithItem(graph: Graph, item: Item): Graph {
  const exists = graph.items.some((entry) => entry.id === item.id)
  const items = exists
    ? graph.items.map((entry) => (entry.id === item.id ? item : entry))
    : [...graph.items, item].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  return { ...graph, items }
}

function healthWords(health: InitiativeHealth): { level: string; flags: string[] } {
  return { level: health.level, flags: health.flags.map((flag) => flag.flag) }
}

/**
 * Emit the item events a write caused, and any health change above it.
 *
 * `beforeGraph` is the state the change was based on. Without it the item events still fire; the
 * derived health comparison is skipped, because a comparison against the wrong "before" would be
 * an invented change.
 *
 * `afterState` is the same graph after the write, when the caller already holds it. A card save
 * reads the graph once before writing and derives the after graph in memory (`graphWithItem`), so
 * it does not pay for a second whole-workspace read. A caller that does not supply it still gets
 * the after state read here — the item events always need the board the item landed on.
 */
export async function emitItemChange(
  db: Database,
  workspaceId: string,
  before: Item | undefined,
  after: Item | undefined,
  beforeGraph: Graph | undefined,
  actorId?: string,
  afterState?: AfterGraph,
): Promise<void> {
  try {
    // The people a write implies watch it from now on: the creator, a person just assigned, the
    // author of a note. It runs inside this try because a watch is a consequence of the write, and
    // the card must not fail because the consequence did.
    await syncAutoWatches(db, workspaceId, before, after, actorId)

    // The whole graph is read only when health is going to be compared. A note or a move appended
    // through `/log` needs neither the derived reading nor the workspace behind it, so it asks the
    // one placement instead of reading every card on the instance.
    let afterGraph: Graph | undefined
    let issueTypes: IssueType[] = []
    if (afterState) {
      afterGraph = afterState.graph
      issueTypes = afterState.issueTypes
    } else if (beforeGraph) {
      const read = await readWorkspace(db, workspaceId)
      afterGraph = graphOf(read)
      issueTypes = read.issueTypes
    }
    const placementBoard = after
      ? await db.get<{ board_id: string }>(
          'SELECT board_id FROM placements WHERE item_id = ?1 AND workspace_id = ?2 LIMIT 1',
          [after.id, workspaceId],
        )
      : undefined
    const boardId = after
      ? (afterGraph?.placements.find((placement) => placement.itemId === after.id)?.boardId ??
        placementBoard?.board_id ??
        movedEntry(after)?.boardId)
      : undefined

    if (!before && after) {
      await emitEvent(
        db,
        workspaceId,
        'item.created',
        { itemId: after.id, title: after.title, typeId: after.typeId, ...(boardId ? { boardId } : {}) },
        actorId,
      )
    }

    if (before && after) {
      if (!before.blocked && after.blocked) {
        await emitEvent(
          db,
          workspaceId,
          'item.blocked',
          {
            itemId: after.id,
            title: after.title,
            ...(after.blockedReason ? { reason: after.blockedReason } : {}),
            ...(boardId ? { boardId } : {}),
          },
          actorId,
        )
      } else if (before.blocked && !after.blocked) {
        await emitEvent(db, workspaceId, 'item.unblocked', { itemId: after.id, title: after.title, ...(boardId ? { boardId } : {}) }, actorId)
      }

      // What this write appended, rather than the last move in the whole history: a card can be
      // moved, noted and edited between two reads, and every entry is a sentence of its own.
      const known = new Set((before.log ?? []).map((entry) => entry.id))
      for (const entry of after.log ?? []) {
        if (known.has(entry.id)) continue
        const by = entry.by ?? actorId
        if (entry.kind === 'moved') {
          await emitEvent(
            db,
            workspaceId,
            'item.moved',
            {
              itemId: after.id,
              title: after.title,
              ...(entry.boardId ?? boardId ? { boardId: entry.boardId ?? boardId } : {}),
              ...(entry.fromStage ? { fromStage: entry.fromStage } : {}),
              ...(entry.toStage ? { toStage: entry.toStage } : {}),
              ...(entry.toLaneId ? { laneId: entry.toLaneId } : {}),
            },
            by,
          )
        } else if (entry.kind === 'noted') {
          await emitEvent(
            db,
            workspaceId,
            'item.noted',
            {
              itemId: after.id,
              entryId: entry.id,
              ...(entry.mentions?.length ? { mentions: entry.mentions } : {}),
            },
            by,
          )
        }
      }

      // An edit is what is left once the acts with their own events are taken out: the field names
      // travel, never the card's body.
      const fields = changedFields(before, after)
      if (fields.length) {
        await emitEvent(
          db,
          workspaceId,
          'item.updated',
          { itemId: after.id, fields, ...(boardId ? { boardId } : {}) },
          actorId,
        )
      }
    }

    if (!beforeGraph || !after || !afterGraph) return

    // The item itself, if it is an initiative, and every initiative above it. Both the before and
    // after graphs are walked: a parent set by this write is an initiative in only one of them.
    const ids = new Set<string>()
    for (const item of [before, after]) {
      if (!item) continue
      if (isInitiativeItem(item, issueTypes)) ids.add(item.id)
      for (const graph of [beforeGraph, afterGraph]) {
        let parent = decompositionParent(item.id, graph.edges)
        const seen = new Set<string>()
        while (parent && !seen.has(parent)) {
          seen.add(parent)
          const candidate = graph.items.find((entry) => entry.id === parent)
          if (candidate && isInitiativeItem(candidate, issueTypes)) ids.add(candidate.id)
          parent = decompositionParent(parent, graph.edges)
        }
      }
    }

    const now = Date.now()
    for (const initiativeId of ids) {
      const beforeHealth = healthWords(initiativeHealth(initiativeId, beforeGraph, now))
      const afterHealth = healthWords(initiativeHealth(initiativeId, afterGraph, now))
      if (JSON.stringify(beforeHealth) === JSON.stringify(afterHealth)) continue
      await emitEvent(
        db,
        workspaceId,
        'initiative.health_changed',
        { initiativeId, before: beforeHealth, after: afterHealth },
        actorId,
      )
    }
  } catch (error) {
    // A receiver's problem is not the card's. The write has landed; the next change will try again.
    console.error('outbound event failed', error)
  }
}

/** Emit an objective mapping change, from the one operation that owns attribution. */
export async function emitObjectiveMapping(
  db: Database,
  workspaceId: string,
  objectiveId: string,
  itemId: string,
  mapped: boolean,
  actorId?: string,
): Promise<void> {
  try {
    await emitEvent(db, workspaceId, mapped ? 'objective.mapped' : 'objective.unmapped', { objectiveId, itemId }, actorId)
  } catch (error) {
    console.error('objective event failed', error)
  }
}
