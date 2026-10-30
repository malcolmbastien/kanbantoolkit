/**
 * The acts, once.
 *
 * A tool table, an HTTP route and the app are three doors to the same operations; this is the room
 * behind them. Everything here takes a caller resolved from a credential and a plain input, and
 * answers either a value or a refusal with the domain's own sentence. No `Context`, no status codes,
 * no headers — the transport decides how a refusal looks on the wire.
 *
 * The rules are not restated here. A move asks `src/domain/move.ts`, a retype asks `canRetype`, a
 * parent asks `canSetParent`, an objective's completeness asks `objectiveRollup`. What this module
 * adds is the part that needs a database: reading the workspace, writing in one transaction, and
 * recording the trail with the token that acted.
 */

import { decompositionParent, objectiveRollup, rollupOf } from '../src/domain/derive'
import { cardsFlows, initiativesFlow, kindOf } from '../src/domain/flows'
import { boardCardTypeId, boardTags, canRetype, canSetParent, defaultDropLane, isInitiativeItem, searchItems } from '../src/domain/board'
import { moveCard, moveInitiative } from '../src/domain/move'
import type { Role } from '../src/domain/roles'
import type { Scope } from '../src/domain/scopes'
import { statement } from './audit'
import type { Database, Statement } from './db'
import { randomToken } from './auth/oauth'
import type { AuthUser } from './auth/session'
import { readItem, readWorkspace } from './workspace/read'
import { appliedItemOf, writeItemAndPlacements, writeWorkspace } from './workspace/write'
import { parseItem, parseWorkspace } from './workspace/validate'
import type { Board, BoardFlow, Item, ItemLogEntry, Lane, Placement } from '../src/domain/types'
import type { Workspace } from './workspace/types'
import { WORKSPACE_SCHEMA } from './workspace/schema'

/** Who is acting: resolved from a bearer token, never from a request body. */
export interface OpCaller {
  db: Database
  user: AuthUser
  /** The token that acted — named in the trail, and the unit a rate limit counts. */
  tokenId: string
  scopes: Scope[]
  workspaceId: string
  role: Role
}

export interface ApiFailure {
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503
  code: string
  message: string
  details?: Record<string, unknown>
}

export type Op<T> = { ok: true; value: T } | { ok: false; error: ApiFailure }

export const ok = <T>(value: T): Op<T> => ({ ok: true, value })
export const no = (status: ApiFailure['status'], code: string, message: string, details?: Record<string, unknown>): Op<never> => ({
  ok: false,
  error: { status, code, message, ...(details ? { details } : {}) },
})

/* ---- The shapes a client sees ------------------------------------------------------------- */

export const compactItem = (item: Item, placement?: Placement) => ({
  id: item.id,
  title: item.title,
  typeId: item.typeId,
  ...(item.createdById ? { createdById: item.createdById } : {}),
  ...(item.initiativeTypeId ? { initiativeTypeId: item.initiativeTypeId } : {}),
  ...(item.priority ? { priority: item.priority } : {}),
  ...(item.assignees?.length ? { assignees: item.assignees } : {}),
  ...(item.tagIds?.length ? { tagIds: item.tagIds } : {}),
  ...(item.targetStartDate ? { targetStartDate: item.targetStartDate } : {}),
  ...(item.targetEndDate ? { targetEndDate: item.targetEndDate } : {}),
  ...(placement ? { boardId: placement.boardId, laneId: placement.laneId, rank: placement.rank ?? 0 } : {}),
  rev: item.rev ?? 0,
  createdAt: item.createdAt,
  ...(item.resolvedAt !== undefined ? { resolvedAt: item.resolvedAt } : {}),
  ...(item.archived ? { archived: true } : {}),
  // A filed-away item says whether its work was done; absence is the completed case.
  ...(item.discarded ? { discarded: true } : {}),
  ...(item.blocked ? { blocked: true } : {}),
})

export const boardView = (board: Board) => ({
  id: board.id,
  name: board.name,
  band: board.band,
  description: board.description ?? '',
  ...(board.archived ? { archived: true } : {}),
  ...(board.linkedBoardIds?.length ? { linkedBoardIds: board.linkedBoardIds } : {}),
  wipEnforcement: board.wipEnforcement ?? 'visualize',
})

export interface LaneNode {
  id: string
  name: string
  workflow: string
  stage?: string
  parentId: string | null
  order: number
  wipLimit?: number
  orientation?: string
  children?: LaneNode[]
}

const laneNode = (lane: Lane, flow: BoardFlow, children: LaneNode[]): LaneNode => ({
  id: lane.id,
  name: lane.name,
  // `workflow` stays the *kind* on the wire: `/api/v1` promised it, and a script branches on
  // "cards" or "initiatives" rather than on which of several cards flows a lane sits in.
  workflow: flow.kind,
  ...(lane.stage ? { stage: lane.stage } : {}),
  parentId: lane.parentId,
  order: lane.order,
  ...(lane.wipLimit !== undefined ? { wipLimit: lane.wipLimit } : {}),
  ...(lane.orientation ? { orientation: lane.orientation } : {}),
  ...(children.length ? { children } : {}),
})

/** One flow's lanes as the tree they are, roots first. */
export function tree(lanes: Lane[], flow: BoardFlow): LaneNode[] {
  const mine = lanes.filter((lane) => lane.flowId === flow.id)
  const build = (parentId: string | null): LaneNode[] =>
    mine
      .filter((lane) => lane.parentId === parentId)
      .sort((a, b) => a.order - b.order)
      .map((lane) => laneNode(lane, flow, build(lane.id)))
  return build(null)
}

/* ---- Cursors and pages (shared, so both doors bound identically) --------------------------- */

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

export function boundedLimit(raw: unknown): number {
  const value = Number(raw ?? DEFAULT_LIMIT)
  return Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(value) ? Math.floor(value) : DEFAULT_LIMIT))
}

/** A cursor is opaque to a client: base64url of the last id it saw. Both runtimes have `btoa`. */
export const encodeCursor = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const decodeCursor = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  try {
    return atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return undefined
  }
}

export function pageOf<T extends { id: string }>(rows: T[], limit: number) {
  const slice = rows.slice(0, limit)
  return {
    data: slice,
    nextCursor: rows.length > limit ? encodeCursor(slice[slice.length - 1].id) : null,
  }
}

const afterId = <T extends { id: string }>(rows: T[], cursor: string | undefined) =>
  cursor ? rows.filter((row) => row.id > cursor) : rows

/* ---- The trail ---------------------------------------------------------------------------- */

/**
 * One write, one trail entry: the token's **owner** as the actor, the operation, the item, and the
 * token. A script cannot write as somebody else, and cannot write without a record.
 */
export const auditWrite = (caller: OpCaller, operation: string, target: string, extra: Record<string, unknown> = {}): Statement =>
  statement({
    actorId: caller.user.id,
    action: 'api.write',
    targetType: 'item',
    targetId: target,
    data: { operation, token: caller.tokenId, scopes: caller.scopes, ...extra },
  })

const newId = (prefix = 'i') => `${prefix}_${randomToken(9)}`

const editedEntry = (context: { id: () => string; at: number; by: string }, what: string): ItemLogEntry => ({
  id: context.id(),
  at: context.at,
  kind: 'edited',
  note: what,
  by: context.by,
})

/* ---- Reads -------------------------------------------------------------------------------- */

export async function listBoards(caller: OpCaller, input: { limit?: unknown; cursor?: string } = {}): Promise<Op<{ data: ReturnType<typeof boardView>[]; nextCursor: string | null }>> {
  const state = await readWorkspace(caller.db, caller.workspaceId)
  const rows = afterId([...state.boards].sort((a, b) => a.id.localeCompare(b.id)), decodeCursor(input.cursor)).map(boardView)
  return ok(pageOf(rows, boundedLimit(input.limit)))
}

export interface ItemFilters {
  boardId?: string
  laneId?: string
  typeId?: string
  q?: string
  updatedSince?: string
  includeArchived?: boolean
  limit?: unknown
  cursor?: string
}

export async function listItems(caller: OpCaller, filters: ItemFilters): Promise<Op<{ data: ReturnType<typeof compactItem>[]; nextCursor: string | null }>> {
  const state = await readWorkspace(caller.db, caller.workspaceId)
  const placements = new Map(state.placements.map((p) => [p.itemId, p]))
  let rows = state.items.filter((item) => filters.includeArchived || !item.archived)

  if (filters.boardId) rows = rows.filter((item) => placements.get(item.id)?.boardId === filters.boardId)
  if (filters.laneId) {
    // A lane's subtree: "in Done" means the column, not one cell of a split.
    const laneIds = new Set<string>([filters.laneId])
    let grew = true
    while (grew) {
      grew = false
      for (const lane of state.lanes) {
        if (lane.parentId && laneIds.has(lane.parentId) && !laneIds.has(lane.id)) {
          laneIds.add(lane.id)
          grew = true
        }
      }
    }
    rows = rows.filter((item) => {
      const lane = placements.get(item.id)?.laneId
      return lane ? laneIds.has(lane) : false
    })
  }
  if (filters.typeId) rows = rows.filter((item) => item.typeId === filters.typeId)
  if (filters.q?.trim()) {
    const found = new Set(searchItems(rows, filters.q).map((item) => item.id))
    rows = rows.filter((item) => found.has(item.id))
  }
  if (filters.updatedSince) {
    const at = new Date(filters.updatedSince)
    if (Number.isNaN(at.getTime())) return no(422, 'invalid', '`updatedSince` must be an ISO timestamp')
    const changed = await caller.db.all<{ item_id: string }>('SELECT DISTINCT item_id FROM changes WHERE at > ?1', [at.toISOString()])
    const ids = new Set(changed.map((row) => row.item_id))
    rows = rows.filter((item) => ids.has(item.id))
  }

  rows = [...rows].sort((a, b) => a.id.localeCompare(b.id))
  const answered = afterId(rows, decodeCursor(filters.cursor)).map((item) => compactItem(item, placements.get(item.id)))
  return ok(pageOf(answered, boundedLimit(filters.limit)))
}

export async function getBoard(caller: OpCaller, boardId: string) {
  const state = await readWorkspace(caller.db, caller.workspaceId)
  const board = state.boards.find((b) => b.id === boardId)
  if (!board) return no(404, 'not_found', 'no such board')

  const placements = state.placements.filter((p) => p.boardId === board.id)
  const byItem = new Map(placements.map((p) => [p.itemId, p]))
  // `cards` keeps meaning the board's first cards flow: `v1` may add, never remove or retype. A
  // board with more than one cards flow returns the rest in `flows`, which is the additive door.
  const cards = cardsFlows(state.flows, board.id)
  const initiatives = initiativesFlow(state.flows, board.id)
  return ok({
    board: boardView(board),
    workflows: {
      cards: cards[0] ? tree(state.lanes, cards[0]) : [],
      initiatives: initiatives ? tree(state.lanes, initiatives) : [],
    },
    flows: [...cards, ...(initiatives ? [initiatives] : [])].map((flow) => ({
      id: flow.id,
      name: flow.name,
      kind: flow.kind,
      order: flow.order,
      lanes: tree(state.lanes, flow),
    })),
    placements: placements.map((p) => ({ itemId: p.itemId, laneId: p.laneId, rank: p.rank ?? 0 })),
    items: state.items.filter((item) => byItem.has(item.id) && !item.archived).map((item) => compactItem(item, byItem.get(item.id))),
  })
}

export async function getItem(caller: OpCaller, itemId: string) {
  const state = await readWorkspace(caller.db, caller.workspaceId)
  const item = state.items.find((i) => i.id === itemId)
  if (!item) return no(404, 'not_found', 'no such item')
  return ok({
    ...compactItem(item),
    description: item.description ?? '',
    parentId: decompositionParent(item.id, state.edges) ?? null,
    placements: state.placements
      .filter((p) => p.itemId === item.id)
      .map((p) => ({ boardId: p.boardId, laneId: p.laneId, rank: p.rank ?? 0 })),
    rollup: rollupOf(item.id, state),
    log: item.log ?? [],
  })
}

export async function listObjectives(caller: OpCaller) {
  const state = await readWorkspace(caller.db, caller.workspaceId)
  return ok({
    data: state.objectives.map((objective) => ({
      id: objective.id,
      title: objective.title,
      period: objective.period,
      ...(objective.score !== undefined ? { score: objective.score } : {}),
      // The completeness the app shows: the rollup of the work that serves it, and `null` when
      // nothing does — 0% would be a worse way of saying "nothing serves this".
      completeness: objectiveRollup(objective.id, state) ?? null,
      keyResults: state.keyResults.filter((kr) => kr.objectiveId === objective.id).map((kr) => ({ id: kr.id, title: kr.title })),
    })),
  })
}

export async function listPeople(caller: OpCaller) {
  const state = await readWorkspace(caller.db, caller.workspaceId)
  return ok({ data: state.users.map((user) => ({ id: user.id, name: user.name, ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}) })) })
}

export async function search(caller: OpCaller, q: string, limit?: unknown) {
  if (!q.trim()) return ok({ data: [] })
  const state = await readWorkspace(caller.db, caller.workspaceId)
  const placements = new Map(state.placements.map((p) => [p.itemId, p]))
  const rows = searchItems(state.items.filter((item) => !item.archived), q).map((item) => compactItem(item, placements.get(item.id)))
  return ok(pageOf(rows, boundedLimit(limit)))
}

/** What an agent reads before it plans: the shape of the workspace, not every card in it. */
export async function workspaceSummary(caller: OpCaller) {
  const state = await readWorkspace(caller.db, caller.workspaceId)
  const placements = new Map(state.placements.map((p) => [p.itemId, p]))
  const inLane = (laneId: string) => state.items.filter((item) => placements.get(item.id)?.laneId === laneId && !item.archived).length
  return ok({
    boards: state.boards.map((board) => ({
      id: board.id,
      name: board.name,
      band: board.band,
      archived: Boolean(board.archived),
      items: state.placements.filter((p) => p.boardId === board.id).length,
    })),
    counts: {
      items: state.items.filter((item) => !item.archived).length,
      archived: state.items.filter((item) => item.archived).length,
      initiatives: state.items.filter((item) => isInitiativeItem(item, state.issueTypes) && !item.archived).length,
      people: state.users.length,
      objectives: state.objectives.length,
    },
    // The columns of the first team board, because "what is in Done" is the first question an agent
    // asks and a lane id is what it needs to ask it. Every cards flow is named here: a board may
    // carry several, and an agent that took the first as the whole board would plan blind.
    ...(() => {
      const board = state.boards.find((b) => b.band === 'team' && !b.archived)
      if (!board) return { lanes: undefined, flows: [] }
      const columns = (flow: (typeof state.flows)[number]) =>
        tree(state.lanes, flow).map((lane) => ({
          id: lane.id,
          name: lane.name,
          stage: lane.stage,
          items: inLane(lane.id),
        }))
      const cards = cardsFlows(state.flows, board.id)
      const first = cards[0]
      return {
        // The same columns the app's board renders, one entry per cards flow.
        flows: cards.map((flow) => ({ id: flow.id, name: flow.name, columns: columns(flow) })),
        // The legacy list: the first cards flow's columns, each saying which flow it is.
        lanes: first ? columns(first).map((lane) => ({ ...lane, flow: first.name })) : [],
      }
    })(),
  })
}

export async function exportFile(caller: OpCaller) {
  const state = await readWorkspace(caller.db, caller.workspaceId)
  return ok({ schema: WORKSPACE_SCHEMA, ...state })
}

export async function importFile(caller: OpCaller, body: unknown) {
  const state = await readWorkspace(caller.db, caller.workspaceId)
  if (state.boards.length) {
    return no(409, 'not_empty', 'this workspace already has boards; import is for a fresh instance', { boards: state.boards.length })
  }
  const workspace = parseWorkspace(body as Workspace | null)
  if (!workspace) return no(422, 'invalid', 'that is not a workspace this server can read')
  await writeWorkspace(
    caller.db,
    workspace,
    caller.workspaceId,
    statement({
      actorId: caller.user.id,
      action: 'workspace.import',
      targetType: 'workspace',
      data: { boards: workspace.boards.length, items: workspace.items.length, token: caller.tokenId },
    }),
  )
  return ok({ imported: { boards: workspace.boards.length, items: workspace.items.length } })
}

/* ---- Writes ------------------------------------------------------------------------------- */

export interface NewItemInput {
  id?: unknown
  boardId?: unknown
  laneId?: unknown
  typeId?: unknown
  title?: unknown
  description?: unknown
  parentId?: unknown
  size?: unknown
  priority?: unknown
  assignees?: unknown
  tagIds?: unknown
  targetStartDate?: unknown
  targetEndDate?: unknown
}

export async function createItem(caller: OpCaller, body: NewItemInput, key?: string) {
  // A replayed create answers with what it created: the key names the change, not the attempt.
  if (key) {
    const applied = await appliedItemOf(caller.db, key)
    if (applied) {
      const existing = await readItem(caller.db, applied.itemId, caller.workspaceId)
      if (existing) return ok({ item: compactItem(existing), replayed: true })
    }
  }

  const state = await readWorkspace(caller.db, caller.workspaceId)
  const board = state.boards.find((b) => b.id === String(body.boardId ?? ''))
  if (!board) return no(422, 'invalid', '`boardId` must be a board on this instance', { field: 'boardId' })

  const id = typeof body.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(body.id) ? body.id : newId()
  if (state.items.some((i) => i.id === id)) return no(409, 'conflict', 'an item with that id already exists')

  const initiativeType = state.issueTypes.find((t) => t.name === 'Initiative')?.id
  const typeId = typeof body.typeId === 'string' ? body.typeId : boardCardTypeId(board, state.issueTypes)
  if (!typeId || !state.issueTypes.some((t) => t.id === typeId)) {
    return no(422, 'invalid', '`typeId` must be an issue type on this instance', { field: 'typeId' })
  }
  const initiative = typeId === initiativeType

  const laneParam = typeof body.laneId === 'string' ? body.laneId : undefined
  const lane = laneParam
    ? state.lanes.find((l) => l.id === laneParam && l.boardId === board.id)
    : defaultDropLane(board, state.flows, state.lanes, board.id)
  if (!lane) {
    return no(422, 'invalid', laneParam ? 'that lane is not on this board' : 'this board has no cell to put a card in', { field: 'laneId' })
  }
  if (kindOf(state.flows, lane.flowId) !== (initiative ? 'initiatives' : 'cards')) {
    return no(
      422,
      'wrong_workflow',
      initiative
        ? 'an initiative is placed in the initiatives workflow, not in a card lane'
        : 'a card is placed in the cards workflow, not in an initiatives cell',
    )
  }

  const parentId = typeof body.parentId === 'string' ? body.parentId : undefined
  if (parentId) {
    // The same rule the drop preview reads: the parent is an initiative, and an item is never its
    // own ancestor.
    const known = { items: [...state.items, { id, title: '', typeId, createdAt: 0 }], edges: state.edges, links: state.links, placements: state.placements, lanes: state.lanes }
    if (!canSetParent(id, parentId, known, state.issueTypes)) {
      return no(422, 'parent_invalid', 'a parent must be an initiative, and nothing can be its own ancestor', { field: 'parentId' })
    }
  }

  // The board stopped counting points. A client that still sends `size` hears so, rather than
  // having a number it believes in quietly dropped on the floor.
  if ('size' in body) return no(422, 'invalid', '`size` is gone: this board counts issues, not points', { field: 'size' })
  if ('createdById' in body) {
    return no(422, 'invalid', '`createdById` is the caller, recorded by the server — it is not a field to send', { field: 'createdById' })
  }

  const now = Date.now()
  const draft: Item = {
    id,
    title: typeof body.title === 'string' ? body.title : '',
    typeId,
    createdAt: now,
    // Who made it is the caller, not a field in the body: the record of an act, written once.
    createdById: caller.user.id,
    ...(typeof body.description === 'string' ? { description: body.description } : {}),
    ...(typeof body.priority === 'string' ? { priority: body.priority as Item['priority'] } : {}),
    ...(Array.isArray(body.assignees) ? { assignees: body.assignees.filter((a): a is string => typeof a === 'string') } : {}),
    ...(Array.isArray(body.tagIds) ? { tagIds: body.tagIds.filter((t): t is string => typeof t === 'string') } : {}),
    ...(typeof body.targetStartDate === 'string' ? { targetStartDate: body.targetStartDate } : {}),
    ...(typeof body.targetEndDate === 'string' ? { targetEndDate: body.targetEndDate } : {}),
    rev: 1,
    log: [{ id: newId(), at: now, kind: 'created', by: caller.user.id }],
  }
  // The shape check is the server's own parser, not a second one written here.
  const item = parseItem(draft)
  if (!item) return no(422, 'invalid', 'that is not an item this server can store')
  for (const assignee of item.assignees ?? []) {
    if (!state.users.some((u) => u.id === assignee)) {
      return no(422, 'invalid', '`assignees` must be people on this instance', { field: 'assignees', id: assignee })
    }
  }
  const tags = new Set(boardTags(board).map((t) => t.id))
  for (const tag of item.tagIds ?? []) {
    if (!tags.has(tag)) return no(422, 'invalid', '`tagIds` must be tags on this board', { field: 'tagIds', id: tag })
  }

  const placement: Placement = {
    id: newId('p'),
    boardId: board.id,
    itemId: item.id,
    laneId: lane.id,
    laneEnteredAt: now,
    rank: state.placements.filter((p) => p.laneId === lane.id).length,
  }

  await writeItemAndPlacements(
    caller.db,
    item,
    [placement],
    caller.workspaceId,
    key,
    auditWrite(caller, 'item.create', item.id, { boardId: board.id, laneId: lane.id }),
  )
  if (parentId) {
    await caller.db.run('INSERT INTO edges (id, kind, from_id, to_id, workspace_id) VALUES (?1, ?2, ?3, ?4, ?5)', [
      newId('e'),
      'decomposition',
      parentId,
      item.id,
      caller.workspaceId,
    ])
  }

  return ok({ item: compactItem(item, placement), ...(parentId ? { parentId } : {}) })
}

export interface ItemPatch {
  baseRev?: unknown
  title?: unknown
  description?: unknown
  typeId?: unknown
  size?: unknown
  priority?: unknown
  assignees?: unknown
  tagIds?: unknown
  targetStartDate?: unknown
  targetEndDate?: unknown
  parentId?: unknown
}

export async function updateItem(caller: OpCaller, itemId: string, body: ItemPatch, key?: string) {
  if (typeof body.baseRev !== 'number' || !Number.isInteger(body.baseRev) || body.baseRev < 0) {
    return no(422, 'invalid', '`baseRev` is required: read the item, then send the revision you read', { field: 'baseRev' })
  }
  // As on a create: `size` is not a field any more, and a client that sends one is told.
  if ('size' in body) return no(422, 'invalid', '`size` is gone: this board counts issues, not points', { field: 'size' })
  // And the creator records an act that has already happened; a later edit cannot restate it.
  if ('createdById' in body) {
    return no(422, 'invalid', '`createdById` records who made the item, and is not a field to change', { field: 'createdById' })
  }

  if (key) {
    const applied = await appliedItemOf(caller.db, key)
    if (applied && applied.itemId === itemId) {
      const existing = await readItem(caller.db, itemId, caller.workspaceId)
      if (existing) return ok({ item: compactItem(existing), replayed: true })
    }
  }

  const current = await readItem(caller.db, itemId, caller.workspaceId)
  if (!current) return no(404, 'not_found', 'no such item')
  if ((current.rev ?? 0) !== body.baseRev) {
    return no(409, 'stale', 'this item has moved past the revision the change was based on', { item: compactItem(current) })
  }

  const state = await readWorkspace(caller.db, caller.workspaceId)
  const changes: string[] = []
  const next: Item = { ...current }
  const now = Date.now()

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) return no(422, 'invalid', '`title` may not be empty', { field: 'title' })
    if (body.title !== current.title) changes.push('title')
    next.title = body.title
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') {
      return no(422, 'invalid', '`description` must be a string or null', { field: 'description' })
    }
    next.description = typeof body.description === 'string' ? body.description : undefined
    changes.push('description')
  }
  if (body.typeId !== undefined) {
    if (typeof body.typeId !== 'string' || !state.issueTypes.some((t) => t.id === body.typeId)) {
      return no(422, 'invalid', '`typeId` must be an issue type on this instance', { field: 'typeId' })
    }
    // The rule the panel's select asks: an initiative is never retyped, a sub-task is not a card,
    // and nothing becomes an initiative.
    if (!canRetype(current, body.typeId, state.issueTypes)) {
      return no(422, 'invalid', 'the Initiative and Sub-task types are the system’s: an item is not retyped into or out of them', { field: 'typeId' })
    }
    next.typeId = body.typeId
    changes.push('type')
  }
  if (body.priority !== undefined) {
    const allowed = ['urgent', 'high', 'medium', 'low']
    if (body.priority !== null && (typeof body.priority !== 'string' || !allowed.includes(body.priority))) {
      return no(422, 'invalid', '`priority` must be urgent, high, medium, low, or null', { field: 'priority' })
    }
    next.priority = (body.priority ?? undefined) as Item['priority']
    changes.push('priority')
  }
  if (body.assignees !== undefined) {
    if (!Array.isArray(body.assignees)) return no(422, 'invalid', '`assignees` must be a list of people ids', { field: 'assignees' })
    for (const assignee of body.assignees) {
      if (typeof assignee !== 'string' || !state.users.some((u) => u.id === assignee)) {
        return no(422, 'invalid', '`assignees` must be people on this instance', { field: 'assignees', id: String(assignee) })
      }
    }
    next.assignees = body.assignees.length ? (body.assignees as string[]) : undefined
    changes.push('assignees')
  }
  if (body.tagIds !== undefined) {
    if (!Array.isArray(body.tagIds)) return no(422, 'invalid', '`tagIds` must be a list of tags', { field: 'tagIds' })
    const board = state.boards.find((b) => b.id === state.placements.find((p) => p.itemId === itemId)?.boardId)
    const tags = new Set(boardTags(board).map((t) => t.id))
    for (const tag of body.tagIds) {
      if (typeof tag !== 'string' || !tags.has(tag)) {
        return no(422, 'invalid', '`tagIds` must be tags on this item’s board', { field: 'tagIds', id: String(tag) })
      }
    }
    next.tagIds = body.tagIds.length ? (body.tagIds as string[]) : undefined
    changes.push('tags')
  }
  const date = (name: 'targetStartDate' | 'targetEndDate', label: string, value: unknown): Op<string | undefined> => {
    if (value !== null && !(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))) {
      return no(422, 'invalid', `\`${name}\` must be YYYY-MM-DD or null`, { field: name })
    }
    changes.push(label)
    return ok(typeof value === 'string' ? value : undefined)
  }
  if (body.targetStartDate !== undefined) {
    const parsed = date('targetStartDate', 'target start', body.targetStartDate)
    if (!parsed.ok) return parsed
    next.targetStartDate = parsed.value
  }
  if (body.targetEndDate !== undefined) {
    const parsed = date('targetEndDate', 'target end', body.targetEndDate)
    if (!parsed.ok) return parsed
    next.targetEndDate = parsed.value
  }
  if (body.parentId !== undefined) {
    const parentId = body.parentId === null ? undefined : String(body.parentId)
    // The domain decides, exactly as it does for a drop.
    if (parentId && !canSetParent(itemId, parentId, state, state.issueTypes)) {
      return no(422, 'parent_invalid', 'a parent must be an initiative, and nothing can be its own ancestor', { field: 'parentId' })
    }
    changes.push('parent')
  }

  const stored: Item = {
    ...next,
    ...(changes.length ? { log: [...(next.log ?? []), editedEntry({ id: newId, at: now, by: caller.user.id }, changes.join(', '))] } : {}),
    rev: body.baseRev + 1,
  }

  await writeItemAndPlacements(caller.db, stored, [], caller.workspaceId, key, auditWrite(caller, 'item.update', itemId, { fields: changes }))
  if (body.parentId !== undefined) {
    const parentId = body.parentId === null ? undefined : String(body.parentId)
    await caller.db.run("DELETE FROM edges WHERE kind = 'decomposition' AND to_id = ?1 AND workspace_id = ?2", [itemId, caller.workspaceId])
    if (parentId) {
      await caller.db.run('INSERT INTO edges (id, kind, from_id, to_id, workspace_id) VALUES (?1, ?2, ?3, ?4, ?5)', [
        newId('e'),
        'decomposition',
        parentId,
        itemId,
        caller.workspaceId,
      ])
    }
  }

  return ok({ item: compactItem(stored) })
}

export interface MoveInputBody {
  laneId?: unknown
  index?: unknown
  reason?: unknown
  baseRev?: unknown
}

export async function moveItem(caller: OpCaller, boardId: string, itemId: string, body: MoveInputBody) {
  if (typeof body.laneId !== 'string') return no(422, 'invalid', '`laneId` is required', { field: 'laneId' })

  const state = await readWorkspace(caller.db, caller.workspaceId)
  const item = state.items.find((i) => i.id === itemId)
  if (!item) return no(404, 'not_found', 'no such item')
  if (!state.boards.some((b) => b.id === boardId)) return no(404, 'not_found', 'no such board')

  // A move is arrangement, so it does not demand a revision — but a script that read first may send
  // one, and a stale one is answered rather than applied over a newer card.
  if (typeof body.baseRev === 'number' && (item.rev ?? 0) !== body.baseRev) {
    return no(409, 'stale', 'this item has moved past the revision the move was based on', { item: compactItem(item) })
  }

  const intent = {
    itemId,
    boardId,
    laneId: body.laneId,
    ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
    ...(typeof body.index === 'number' ? { index: body.index } : {}),
  }
  const context = { at: Date.now(), by: caller.user.id, id: () => newId() }
  const outcome = isInitiativeItem(item, state.issueTypes) ? moveInitiative(state, intent, context) : moveCard(state, intent, context)

  if (outcome.kind === 'refused') {
    const status = outcome.refusal.code === 'not_found' ? 404 : 422
    return no(
      status,
      outcome.refusal.code,
      outcome.refusal.message,
      'details' in outcome.refusal ? (outcome.refusal.details as Record<string, unknown>) : undefined,
    )
  }
  if (outcome.kind === 'held') {
    // `justify`: the move needs a reason. The refusal names the place and the limit, so a caller can
    // ask somebody or supply one.
    return no(422, 'reason_required', outcome.message, {
      laneId: outcome.laneId,
      laneName: outcome.laneName,
      limit: outcome.limit,
      ...(outcome.index === undefined ? {} : { index: outcome.index }),
    })
  }

  const changed = outcome.placements.filter((placement) => !state.placements.includes(placement))
  const moved = outcome.items.find((i) => i.id === itemId)!
  await writeItemAndPlacements(
    caller.db,
    moved,
    changed,
    caller.workspaceId,
    undefined,
    auditWrite(caller, 'item.move', itemId, {
      boardId,
      laneId: intent.laneId,
      ...(outcome.justified ? { reason: intent.reason } : {}),
    }),
  )

  return ok({
    item: compactItem(moved, outcome.placement),
    placement: { boardId, laneId: outcome.placement.laneId, rank: outcome.placement.rank ?? 0 },
    ...(outcome.justified ? { justified: true, reason: intent.reason } : {}),
    ...(outcome.positionOnly ? { positionOnly: true } : {}),
  })
}

/**
 * The hierarchy edit, as a door of its own (task 170's `set_parent`).
 *
 * Judged by `canSetParent` — the rule the drop preview reads — and refused before the old parent is
 * dropped, so asking for something impossible cannot quietly detach the item instead.
 */
export async function setParentItem(caller: OpCaller, itemId: string, parentId: string | null, baseRev?: unknown) {
  const current = await readItem(caller.db, itemId, caller.workspaceId)
  if (!current) return no(404, 'not_found', 'no such item')
  if (typeof baseRev === 'number' && (current.rev ?? 0) !== baseRev) {
    return no(409, 'stale', 'this item has moved past the revision the change was based on', { item: compactItem(current) })
  }

  const state = await readWorkspace(caller.db, caller.workspaceId)
  if (parentId && !canSetParent(itemId, parentId, state, state.issueTypes)) {
    return no(422, 'parent_invalid', 'a parent must be an initiative, and nothing can be its own ancestor', { field: 'parentId' })
  }

  const now = Date.now()
  const parent = parentId ? state.items.find((i) => i.id === parentId) : undefined
  const stored: Item = {
    ...current,
    log: [
      ...(current.log ?? []),
      editedEntry(
        { id: newId, at: now, by: caller.user.id },
        parent ? `rolled up to ${parent.title}` : 'taken out of its parent',
      ),
    ],
    rev: (current.rev ?? 0) + 1,
  }

  await writeItemAndPlacements(caller.db, stored, [], caller.workspaceId, undefined, auditWrite(caller, 'item.parent', itemId, { parentId: parentId ?? null }))
  await caller.db.run("DELETE FROM edges WHERE kind = 'decomposition' AND to_id = ?1 AND workspace_id = ?2", [itemId, caller.workspaceId])
  if (parentId) {
    await caller.db.run('INSERT INTO edges (id, kind, from_id, to_id, workspace_id) VALUES (?1, ?2, ?3, ?4, ?5)', [
      newId('e'),
      'decomposition',
      parentId,
      itemId,
      caller.workspaceId,
    ])
  }

  return ok({ item: compactItem(stored), parentId: parentId ?? null })
}
