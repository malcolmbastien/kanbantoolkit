/**
 * `/api/v1` — the surface a script may rely on (task 169).
 *
 * The app's own `/api/*` changes with the client in the same commit and promises nobody anything.
 * This one is a contract: within `v1` a field may be added and never removed or retyped, and
 * `docs/rest-api.md` says so in writing. Everything below exists to keep that promise honest:
 *
 * - **One implementation.** A move asks `src/domain/move.ts`, which is the same function the
 *   board's drag asks. A refusal here is the domain's sentence, not a second opinion.
 * - **A token, never a session.** A cookie is refused with a sentence saying so: a script has no
 *   browser, and a session cannot carry scopes.
 * - **Two ceilings.** The token's scopes and the owner's role, both read per request.
 * - **One error body.** `{ error: { code, message, details } }`, where `code` is stable.
 * - **The document is generated from this table**, so a route that is mounted cannot be missing
 *   from `openapi.json` and vice versa.
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import { can, type Action, type Role } from '../../src/domain/roles'
import { grants, type Scope } from '../../src/domain/scopes'
import { decompositionParent, objectiveRollup, rollupOf } from '../../src/domain/derive'
import { boardCardTypeId, boardTags, canRetype, canSetParent, defaultDropLane, isInitiativeItem, searchItems } from '../../src/domain/board'
import { moveCard, moveInitiative } from '../../src/domain/move'
import { resolveWorkspace } from '../access'
import { statement } from '../audit'
import { callerForSecret } from '../tokens'
import type { Database, Statement } from '../db'
import { randomToken } from '../auth/oauth'
import type { AuthUser } from '../auth/session'
import type { Runtime } from '../runtime'
import { readItem, readWorkspace } from '../workspace/read'
import { appliedItemOf, writeItemAndPlacements, writeWorkspace } from '../workspace/write'
import { parseItem, parseWorkspace } from '../workspace/validate'
import { schemaVersion } from '../migrate'
import { REQUIRED_SCHEMA, WORKSPACE_SCHEMA } from '../workspace/schema'
import type { Board, Item, ItemLogEntry, Lane, Placement } from '../../src/domain/types'
import type { Workspace } from '../workspace/types'

/* ---- The body of every answer that is not a success ---------------------------------------- */

export interface ApiError {
  error: { code: string; message: string; details?: Record<string, unknown> }
}

const failure = (c: Context<{ Bindings: object; Variables: V1Vars }>, status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503, code: string, message: string, details?: Record<string, unknown>) =>
  c.json({ error: { code, message, ...(details ? { details } : {}) } } satisfies ApiError, status) as unknown as Response

/* ---- The caller ---------------------------------------------------------------------------- */

interface V1Vars {
  /** Set once the credential is known, so the middleware can put the rate-limit headers on every
   * answer — including the ones that are refusals. */
  rate?: { limit: number; remaining: number; reset: number }
}

export interface V1Caller {
  db: Database
  user: AuthUser
  tokenId: string
  scopes: Scope[]
  workspaceId: string
  role: Role
}

/* ---- Rate limits (R5) ---------------------------------------------------------------------- */

/**
 * Per token, in memory.
 *
 * In memory because the limit is a guard against a runaway loop rather than an accounting system:
 * losing a window on restart costs a client one minute of extra allowance, and a table written on
 * every request would cost every client a write. A Cloudflare deployment keeps this per isolate,
 * which the docs say rather than hide — the limit there is a courtesy, and the real guard is the
 * scope on the token.
 */
const WINDOW_MS = 60_000

interface Window {
  startedAt: number
  count: number
}

const windows = new Map<string, Window>()

function spend(tokenId: string, limit: number): { allowed: boolean; remaining: number; reset: number } {
  const now = Date.now()
  const current = windows.get(tokenId)
  const window = !current || now - current.startedAt >= WINDOW_MS ? { startedAt: now, count: 0 } : current
  window.count += 1
  windows.set(tokenId, window)
  // A map that grows forever is a leak; expired windows are the only ones worth dropping.
  if (windows.size > 5_000) {
    for (const [key, value] of windows) if (now - value.startedAt >= WINDOW_MS) windows.delete(key)
  }
  return {
    allowed: window.count <= limit,
    remaining: Math.max(0, limit - window.count),
    reset: Math.max(0, Math.ceil((window.startedAt + WINDOW_MS - now) / 1000)),
  }
}

/** The limit is configuration (`docs/configure.md`); the default is generous for a script. */
function limitPerMinute(env: unknown): number {
  const raw = (env as Record<string, unknown> | undefined)?.API_RATE_LIMIT
  const value = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 120
}

/**
 * The door: a bearer token, its scopes, and the owner's role — in that order, because each answer
 * means something different to the script that sent the credential.
 */
async function requireV1(
  c: Context<{ Bindings: object; Variables: V1Vars }>,
  runtime: Runtime,
  scope: Scope,
  action?: Action,
): Promise<V1Caller | Response> {
  const db = runtime.database(c.env)
  if (!db) return failure(c, 503, 'not_configured', 'this instance has no database')

  const header = c.req.header('authorization') ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  if (!match) {
    // A session cookie is the app's credential and is never accepted here: it has no scopes, and a
    // script can neither hold one nor renew it.
    return failure(
      c,
      401,
      'token_required',
      'this API is for token credentials: acquire one with `flowline login`, then send `Authorization: Bearer <token>`',
    )
  }

  const found = await callerForSecret(db, match[1])
  if (!found) return failure(c, 401, 'invalid_token', 'that credential is not valid: it was revoked, expired, or never existed')

  const instance = await db.get<{ role: string }>('SELECT role FROM instance_members WHERE user_id = ?1', [found.user.id])
  if (!instance) return failure(c, 401, 'invalid_token', 'that credential belongs to an account that is no longer a member of this instance')

  if (c.req.method !== 'GET' && (await schemaVersion(db)) < REQUIRED_SCHEMA) {
    return failure(c, 503, 'not_configured', 'this instance has not finished migrating')
  }

  if (!grants(found.scopes, scope)) {
    return failure(c, 403, 'scope_required', `this credential cannot ${action ?? scope}`, { scope })
  }

  const instanceRole = instance.role === 'admin' ? 'admin' : 'member'
  const resolved = await resolveWorkspace(db, found.user.id, instanceRole === 'admin', undefined)
  if (!resolved) return failure(c, 404, 'no_workspace', 'this account is not in a workspace on this instance')
  if (action && !can(resolved.role, action)) {
    return failure(c, 403, 'role_forbidden', `a ${resolved.role} may not ${action}`, { role: resolved.role, action })
  }

  const limit = limitPerMinute(c.env)
  const spent = spend(found.tokenId, limit)
  c.set('rate', { limit, remaining: spent.remaining, reset: spent.reset })
  if (!spent.allowed) {
    return failure(c, 429, 'rate_limited', `this token may make ${limit} requests a minute; try again in ${spent.reset}s`, {
      retryAfter: spent.reset,
    })
  }

  return {
    db,
    user: found.user,
    tokenId: found.tokenId,
    scopes: found.scopes,
    workspaceId: resolved.id,
    role: resolved.role,
  }
}

/* ---- Shapes ------------------------------------------------------------------------------- */

const compactItem = (item: Item, placement?: Placement) => ({
  id: item.id,
  title: item.title,
  typeId: item.typeId,
  ...(item.initiativeTypeId ? { initiativeTypeId: item.initiativeTypeId } : {}),
  ...(item.size !== undefined ? { size: item.size } : {}),
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
  ...(item.blocked ? { blocked: true } : {}),
})

const boardView = (board: Board) => ({
  id: board.id,
  name: board.name,
  band: board.band,
  description: board.description ?? '',
  ...(board.archived ? { archived: true } : {}),
  ...(board.linkedBoardIds?.length ? { linkedBoardIds: board.linkedBoardIds } : {}),
  wipEnforcement: board.wipEnforcement ?? 'visualize',
})

interface LaneNode {
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

const laneNode = (lane: Lane, children: LaneNode[]): LaneNode => ({
  id: lane.id,
  name: lane.name,
  workflow: lane.workflow,
  ...(lane.stage ? { stage: lane.stage } : {}),
  parentId: lane.parentId,
  order: lane.order,
  ...(lane.wipLimit !== undefined ? { wipLimit: lane.wipLimit } : {}),
  ...(lane.orientation ? { orientation: lane.orientation } : {}),
  ...(children.length ? { children } : {}),
})

/** One workflow's lanes as the tree they are, roots first. */
function tree(lanes: Lane[], workflow: 'cards' | 'initiatives', boardId: string): LaneNode[] {
  const mine = lanes.filter((lane) => lane.boardId === boardId && lane.workflow === workflow)
  const build = (parentId: string | null): LaneNode[] =>
    mine
      .filter((lane) => lane.parentId === parentId)
      .sort((a, b) => a.order - b.order)
      .map((lane) => laneNode(lane, build(lane.id)))
  return build(null)
}

/* ---- Pagination (R4) ---------------------------------------------------------------------- */

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** A cursor is opaque to a client: base64url of the last id it saw. Both runtimes have `btoa`. */
const encodeCursor = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const decodeCursor = (value: string): string | undefined => {
  try {
    return atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return undefined
  }
}

function paging(c: Context): { limit: number; after: string | undefined } {
  const raw = Number(c.req.query('limit') ?? DEFAULT_LIMIT)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_LIMIT))
  return { limit, after: c.req.query('cursor') ? decodeCursor(c.req.query('cursor')!) : undefined }
}

const page = <T extends { id: string }>(rows: T[], limit: number) => {
  const slice = rows.slice(0, limit)
  const more = rows.length > limit
  return {
    data: slice,
    nextCursor: more ? encodeCursor(slice[slice.length - 1].id) : null,
  }
}

const after = <T extends { id: string }>(rows: T[], cursor: string | undefined) =>
  cursor ? rows.filter((row) => row.id > cursor) : rows

/* ---- One write, one audit row, one answer -------------------------------------------------- */

const auditWrite = (caller: V1Caller, operation: string, target: string, extra: Record<string, unknown> = {}): Statement =>
  statement({
    actorId: caller.user.id,
    action: 'api.write',
    targetType: 'item',
    targetId: target,
    data: { operation, token: caller.tokenId, scopes: caller.scopes, ...extra },
  })

const editedEntry = (context: { id: () => string; at: number; by: string }, what: string): ItemLogEntry => ({
  id: context.id(),
  at: context.at,
  kind: 'edited',
  note: what,
  by: context.by,
})

const newId = () => `i_${randomToken(9)}`

/* ---- The routes --------------------------------------------------------------------------- */

export interface RouteSpec {
  method: 'GET' | 'POST' | 'PATCH'
  path: string
  summary: string
  /** The scope a credential needs. `null` is public documentation. */
  scope: Scope | null
  /** The matrix action the change needs, when there is one. */
  action?: Action
  query?: Array<{ name: string; description: string; example?: string }>
  body?: Record<string, unknown>
  responses: Record<string, { description: string; schema?: Record<string, unknown> }>
  handler: (c: Context<{ Bindings: object; Variables: V1Vars }>, caller: V1Caller) => Promise<Response> | Response
}

export function v1Routes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object; Variables: V1Vars }>()

  // The limits are on every answer, refusals included: a script that is being told "no" still wants
  // to know when it may ask again. The values are decided in `requireV1`, after the token is known.
  routes.use('*', async (c, next) => {
    await next()
    const rate = c.get('rate')
    if (!rate) return
    c.header('RateLimit-Limit', String(rate.limit))
    c.header('RateLimit-Remaining', String(rate.remaining))
    c.header('RateLimit-Reset', String(rate.reset))
  })

  const TABLE: RouteSpec[] = [
    {
      method: 'GET',
      path: '/openapi.json',
      summary: 'This document. Public: a client generator has no credential yet.',
      scope: null,
      responses: { '200': { description: 'OpenAPI 3.1' } },
      handler: (c) => c.json(openapi(TABLE)),
    },
    {
      method: 'GET',
      path: '/boards',
      summary: 'Every board, with its band and shape.',
      scope: 'boards:read',
      query: [
        { name: 'limit', description: 'How many to return (default 50, max 200).', example: '50' },
        { name: 'cursor', description: 'From a previous answer’s `nextCursor`.' },
      ],
      responses: { '200': { description: '{ data, nextCursor }' } },
      handler: async (c, caller) => {
        const state = await readWorkspace(caller.db, caller.workspaceId)
        const { limit, after: cursor } = paging(c)
        const rows = after([...state.boards].sort((a, b) => a.id.localeCompare(b.id)), cursor).map(boardView)
        return c.json(page(rows, limit))
      },
    },
    {
      method: 'GET',
      path: '/boards/:boardId',
      summary: 'One board: its two lane trees, what is placed in it, and the items there.',
      scope: 'boards:read',
      responses: { '200': { description: 'The board' }, '404': { description: 'No such board' } },
      handler: async (c, caller) => {
        const state = await readWorkspace(caller.db, caller.workspaceId)
        const board = state.boards.find((b) => b.id === c.req.param('boardId'))
        if (!board) return failure(c, 404, 'not_found', 'no such board')

        const placements = state.placements.filter((p) => p.boardId === board.id)
        const byItem = new Map(placements.map((p) => [p.itemId, p]))
        const items = state.items
          .filter((item) => byItem.has(item.id) && !item.archived)
          .map((item) => compactItem(item, byItem.get(item.id)))

        return c.json({
          board: boardView(board),
          workflows: {
            cards: tree(state.lanes, 'cards', board.id),
            initiatives: tree(state.lanes, 'initiatives', board.id),
          },
          placements: placements.map((p) => ({ itemId: p.itemId, laneId: p.laneId, rank: p.rank ?? 0 })),
          items,
        })
      },
    },
    {
      method: 'GET',
      path: '/items',
      summary: 'Items — cards and initiatives alike — filtered and paged.',
      scope: 'items:read',
      query: [
        { name: 'boardId', description: 'Only items placed on this board.' },
        { name: 'laneId', description: 'Only items in this cell (or its subtree).' },
        { name: 'typeId', description: 'Only items of this type.' },
        { name: 'q', description: 'The app’s own search: a substring of the title.' },
        { name: 'updatedSince', description: 'ISO timestamp: only items changed after it.' },
        { name: 'includeArchived', description: '`true` to include filed-away items.' },
        { name: 'limit', description: 'Default 50, max 200.' },
        { name: 'cursor', description: 'From a previous answer’s `nextCursor`.' },
      ],
      responses: { '200': { description: '{ data, nextCursor }' } },
      handler: async (c, caller) => {
        const state = await readWorkspace(caller.db, caller.workspaceId)
        const { limit, after: cursor } = paging(c)
        const boardId = c.req.query('boardId')
        const laneId = c.req.query('laneId')
        const typeId = c.req.query('typeId')
        const q = c.req.query('q') ?? ''
        const since = c.req.query('updatedSince')
        const archived = c.req.query('includeArchived') === 'true'

        const placements = new Map(state.placements.map((p) => [p.itemId, p]))
        let rows = state.items.filter((item) => archived || !item.archived)
        if (boardId) rows = rows.filter((item) => placements.get(item.id)?.boardId === boardId)
        if (laneId) {
          const laneIds = new Set<string>([laneId])
          // A lane's subtree, because "in Done" means the column, not one cell of a split.
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
        if (typeId) rows = rows.filter((item) => item.typeId === typeId)
        if (q.trim()) {
          const found = new Set(searchItems(rows, q).map((item) => item.id))
          rows = rows.filter((item) => found.has(item.id))
        }
        if (since) {
          // The change feed is the clock: an item read after a timestamp is one whose content moved
          // after it. A malformed timestamp is a refusal rather than a silent full read.
          const at = new Date(since)
          if (Number.isNaN(at.getTime())) return failure(c, 422, 'invalid', '`updatedSince` must be an ISO timestamp')
          const changed = await caller.db.all<{ item_id: string }>(
            'SELECT DISTINCT item_id FROM changes WHERE at > ?1',
            [at.toISOString()],
          )
          const ids = new Set(changed.map((row) => row.item_id))
          rows = rows.filter((item) => ids.has(item.id))
        }

        rows = [...rows].sort((a, b) => a.id.localeCompare(b.id))
        const answered = after(rows, cursor).map((item) => compactItem(item, placements.get(item.id)))
        return c.json(page(answered, limit))
      },
    },
    {
      method: 'GET',
      path: '/items/:itemId',
      summary: 'One item, with its parent, its placements and its rollup.',
      scope: 'items:read',
      responses: { '200': { description: 'The item' }, '404': { description: 'No such item' } },
      handler: async (c, caller) => {
        const state = await readWorkspace(caller.db, caller.workspaceId)
        const item = state.items.find((i) => i.id === c.req.param('itemId'))
        if (!item) return failure(c, 404, 'not_found', 'no such item')
        const graph = state
        return c.json({
          ...compactItem(item),
          description: item.description ?? '',
          parentId: decompositionParent(item.id, state.edges) ?? null,
          placements: state.placements
            .filter((p) => p.itemId === item.id)
            .map((p) => ({ boardId: p.boardId, laneId: p.laneId, rank: p.rank ?? 0 })),
          rollup: rollupOf(item.id, graph),
          log: item.log ?? [],
        })
      },
    },
    {
      method: 'POST',
      path: '/items',
      summary: 'Create a card or an initiative, and place it.',
      scope: 'items:write',
      action: 'item.write',
      body: { $ref: '#/components/schemas/NewItem' },
      responses: {
        '201': { description: 'The item' },
        '409': { description: 'The idempotency key was used for something else' },
        '422': { description: 'Refused by the domain' },
      },
      handler: async (c, caller) => {
        const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
        if (!body) return failure(c, 400, 'invalid_body', 'a JSON body is required')
        const key = c.req.header('idempotency-key')

        // A replayed create answers with what it created: the key names the change, not the attempt.
        if (key) {
          const applied = await appliedItemOf(caller.db, key)
          if (applied) {
            const existing = await readItem(caller.db, applied.itemId, caller.workspaceId)
            if (existing) return c.json({ item: compactItem(existing) }, 200)
          }
        }

        const state = await readWorkspace(caller.db, caller.workspaceId)
        const board = state.boards.find((b) => b.id === String(body.boardId ?? ''))
        if (!board) return failure(c, 422, 'invalid', '`boardId` must be a board on this instance', { field: 'boardId' })

        const id = typeof body.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(body.id) ? body.id : newId()
        if (state.items.some((i) => i.id === id)) return failure(c, 409, 'conflict', 'an item with that id already exists')

        const initiativeType = state.issueTypes.find((t) => t.name === 'Initiative')?.id
        const typeId = typeof body.typeId === 'string' ? body.typeId : boardCardTypeId(board, state.issueTypes)
        if (!typeId || !state.issueTypes.some((t) => t.id === typeId)) {
          return failure(c, 422, 'invalid', '`typeId` must be an issue type on this instance', { field: 'typeId' })
        }
        const initiative = typeId === initiativeType

        const laneParam = typeof body.laneId === 'string' ? body.laneId : undefined
        const lane = laneParam
          ? state.lanes.find((l) => l.id === laneParam && l.boardId === board.id)
          : defaultDropLane(board, state.lanes, board.id)
        if (!lane) return failure(c, 422, 'invalid', laneParam ? 'that lane is not on this board' : 'this board has no cell to put a card in', { field: 'laneId' })
        if (lane.workflow !== (initiative ? 'initiatives' : 'cards')) {
          return failure(c, 422, 'wrong_workflow', initiative
            ? 'an initiative is placed in the initiatives workflow, not in a card lane'
            : 'a card is placed in the cards workflow, not in an initiatives cell')
        }

        const parentId = typeof body.parentId === 'string' ? body.parentId : undefined
        if (parentId) {
          // The same rule the drop preview reads: the parent is an initiative, and an item is never
          // its own ancestor.
          const known = { items: [...state.items, { id, title: '', typeId, createdAt: 0 }], edges: state.edges, links: state.links, placements: state.placements, lanes: state.lanes }
          if (!canSetParent(id, parentId, known, state.issueTypes)) {
            return failure(c, 422, 'parent_invalid', 'a parent must be an initiative, and nothing can be its own ancestor', { field: 'parentId' })
          }
        }

        const now = Date.now()
        const draft: Item = {
          id,
          title: typeof body.title === 'string' ? body.title : '',
          typeId,
          createdAt: now,
          ...(typeof body.description === 'string' ? { description: body.description } : {}),
          ...(typeof body.size === 'number' ? { size: body.size } : {}),
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
        if (!item) return failure(c, 422, 'invalid', 'that is not an item this server can store')
        if (initiative && item.size !== undefined) {
          return failure(c, 422, 'invalid', 'an initiative has no estimate of its own — its size is the sum of the work below it', { field: 'size' })
        }
        for (const assignee of item.assignees ?? []) {
          if (!state.users.some((u) => u.id === assignee)) {
            return failure(c, 422, 'invalid', '`assignees` must be people on this instance', { field: 'assignees', id: assignee })
          }
        }
        const tags = new Set(boardTags(board).map((t) => t.id))
        for (const tag of item.tagIds ?? []) {
          if (!tags.has(tag)) return failure(c, 422, 'invalid', '`tagIds` must be tags on this board', { field: 'tagIds', id: tag })
        }

        const placement: Placement = {
          id: `p_${randomToken(9)}`,
          boardId: board.id,
          itemId: item.id,
          laneId: lane.id,
          laneEnteredAt: now,
          rank: state.placements.filter((p) => p.laneId === lane.id).length,
        }

        await writeItemAndPlacements(caller.db, item, [placement], caller.workspaceId, key, auditWrite(caller, 'item.create', item.id, { boardId: board.id, laneId: lane.id }))
        if (parentId) {
          await caller.db.run('INSERT INTO edges (id, kind, from_id, to_id, workspace_id) VALUES (?1, ?2, ?3, ?4, ?5)', [
            `e_${randomToken(9)}`,
            'decomposition',
            parentId,
            item.id,
            caller.workspaceId,
          ])
        }

        return c.json({ item: compactItem(item, placement), ...(parentId ? { parentId } : {}) }, 201)
      },
    },
    {
      method: 'PATCH',
      path: '/items/:itemId',
      summary: 'Change an item’s fields. Requires the revision it was based on.',
      scope: 'items:write',
      action: 'item.write',
      body: { $ref: '#/components/schemas/ItemPatch' },
      responses: {
        '200': { description: 'The item' },
        '404': { description: 'No such item' },
        '409': { description: 'The item moved past the revision the change was based on' },
        '422': { description: 'Refused by the domain' },
      },
      handler: async (c, caller) => {
        const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
        if (!body) return failure(c, 400, 'invalid_body', 'a JSON body is required')
        if (typeof body.baseRev !== 'number' || !Number.isInteger(body.baseRev) || body.baseRev < 0) {
          return failure(c, 422, 'invalid', '`baseRev` is required: read the item, then send the revision you read', { field: 'baseRev' })
        }
        const key = c.req.header('idempotency-key')
        const id = c.req.param('itemId') ?? ''

        if (key) {
          const applied = await appliedItemOf(caller.db, key)
          if (applied && applied.itemId === id) {
            const existing = await readItem(caller.db, id, caller.workspaceId)
            if (existing) return c.json({ item: compactItem(existing) }, 200)
          }
        }

        const current = await readItem(caller.db, id, caller.workspaceId)
        if (!current) return failure(c, 404, 'not_found', 'no such item')
        if ((current.rev ?? 0) !== body.baseRev) {
          // The disagreement is answered with the truth, so a script can re-read and retry rather
          // than guess what it missed.
          return failure(c, 409, 'stale', 'this item has moved past the revision the change was based on', {
            item: compactItem(current),
          })
        }

        const state = await readWorkspace(caller.db, caller.workspaceId)
        const changes: string[] = []
        const next: Item = { ...current }
        const now = Date.now()

        if (body.title !== undefined) {
          if (typeof body.title !== 'string' || !body.title.trim()) return failure(c, 422, 'invalid', '`title` may not be empty', { field: 'title' })
          if (body.title !== current.title) changes.push('title')
          next.title = body.title
        }
        if (body.description !== undefined) {
          if (body.description !== null && typeof body.description !== 'string') return failure(c, 422, 'invalid', '`description` must be a string or null', { field: 'description' })
          next.description = typeof body.description === 'string' ? body.description : undefined
          changes.push('description')
        }
        if (body.typeId !== undefined) {
          if (typeof body.typeId !== 'string' || !state.issueTypes.some((t) => t.id === body.typeId)) {
            return failure(c, 422, 'invalid', '`typeId` must be an issue type on this instance', { field: 'typeId' })
          }
          // The same rule the panel's select asks: an initiative is never retyped, a sub-task is
          // not a card, and nothing becomes an initiative.
          if (!canRetype(current, body.typeId, state.issueTypes)) {
            return failure(c, 422, 'invalid', 'the Initiative and Sub-task types are the system’s: an item is not retyped into or out of them', { field: 'typeId' })
          }
          next.typeId = body.typeId
          changes.push('type')
        }
        if (body.size !== undefined) {
          if (isInitiativeItem(current, state.issueTypes)) {
            return failure(c, 422, 'invalid', 'an initiative has no estimate of its own — its size is the sum of the work below it', { field: 'size' })
          }
          if (body.size !== null && (typeof body.size !== 'number' || body.size < 0)) {
            return failure(c, 422, 'invalid', '`size` must be a number of 0 or more, or null', { field: 'size' })
          }
          next.size = typeof body.size === 'number' ? body.size : undefined
          changes.push('size')
        }
        if (body.priority !== undefined) {
          const allowed = ['urgent', 'high', 'medium', 'low']
          if (body.priority !== null && (typeof body.priority !== 'string' || !allowed.includes(body.priority))) {
            return failure(c, 422, 'invalid', '`priority` must be urgent, high, medium, low, or null', { field: 'priority' })
          }
          next.priority = (body.priority ?? undefined) as Item['priority']
          changes.push('priority')
        }
        if (body.assignees !== undefined) {
          if (!Array.isArray(body.assignees)) return failure(c, 422, 'invalid', '`assignees` must be a list of people ids', { field: 'assignees' })
          for (const assignee of body.assignees) {
            if (typeof assignee !== 'string' || !state.users.some((u) => u.id === assignee)) {
              return failure(c, 422, 'invalid', '`assignees` must be people on this instance', { field: 'assignees', id: String(assignee) })
            }
          }
          next.assignees = body.assignees.length ? (body.assignees as string[]) : undefined
          changes.push('assignees')
        }
        if (body.tagIds !== undefined) {
          if (!Array.isArray(body.tagIds)) return failure(c, 422, 'invalid', '`tagIds` must be a list of tags', { field: 'tagIds' })
          const board = state.boards.find((b) => b.id === state.placements.find((p) => p.itemId === id)?.boardId)
          const tags = new Set(boardTags(board).map((t) => t.id))
          for (const tag of body.tagIds) {
            if (typeof tag !== 'string' || !tags.has(tag)) {
              return failure(c, 422, 'invalid', '`tagIds` must be tags on this item’s board', { field: 'tagIds', id: String(tag) })
            }
          }
          next.tagIds = body.tagIds.length ? (body.tagIds as string[]) : undefined
          changes.push('tags')
        }
        const date = (name: 'targetStartDate' | 'targetEndDate', label: string): string | undefined | null => {
          const value = body[name]
          if (value === undefined) return null
          if (value !== null && !(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))) return 'invalid' as never
          changes.push(label)
          return typeof value === 'string' ? value : undefined
        }
        if (body.targetStartDate !== undefined) {
          const value = date('targetStartDate', 'target start')
          if (value === ('invalid' as never)) return failure(c, 422, 'invalid', '`targetStartDate` must be YYYY-MM-DD or null', { field: 'targetStartDate' })
          next.targetStartDate = value ?? undefined
        }
        if (body.targetEndDate !== undefined) {
          const value = date('targetEndDate', 'target end')
          if (value === ('invalid' as never)) return failure(c, 422, 'invalid', '`targetEndDate` must be YYYY-MM-DD or null', { field: 'targetEndDate' })
          next.targetEndDate = value ?? undefined
        }
        if (body.parentId !== undefined) {
          const parentId = body.parentId === null ? undefined : String(body.parentId)
          // The domain decides, exactly as it does for a drop: the parent is an initiative, and an
          // item is never its own ancestor.
          if (parentId && !canSetParent(id, parentId, state, state.issueTypes)) {
            return failure(c, 422, 'parent_invalid', 'a parent must be an initiative, and nothing can be its own ancestor', { field: 'parentId' })
          }
          changes.push('parent')
        }

        const stored: Item = {
          ...next,
          ...(changes.length ? { log: [...(next.log ?? []), editedEntry({ id: newId, at: now, by: caller.user.id }, changes.join(', '))] } : {}),
          rev: body.baseRev + 1,
        }

        await writeItemAndPlacements(caller.db, stored, [], caller.workspaceId, key, auditWrite(caller, 'item.update', id, { fields: changes }))
        if (body.parentId !== undefined) {
          const parentId = body.parentId === null ? undefined : String(body.parentId)
          await caller.db.run("DELETE FROM edges WHERE kind = 'decomposition' AND to_id = ?1 AND workspace_id = ?2", [id, caller.workspaceId])
          if (parentId) {
            await caller.db.run('INSERT INTO edges (id, kind, from_id, to_id, workspace_id) VALUES (?1, ?2, ?3, ?4, ?5)', [
              `e_${randomToken(9)}`,
              'decomposition',
              parentId,
              id,
              caller.workspaceId,
            ])
          }
        }

        return c.json({ item: compactItem(stored) })
      },
    },
    {
      method: 'POST',
      path: '/boards/:boardId/items/:itemId/move',
      summary: 'Move an item into a cell, with a position. The domain decides; this asks it.',
      scope: 'items:write',
      action: 'item.move',
      body: { $ref: '#/components/schemas/Move' },
      responses: {
        '200': { description: 'The item’s new place' },
        '404': { description: 'No such item or cell' },
        '409': { description: 'The item moved past the revision the move was based on' },
        '422': { description: 'The domain refused it: `wip_blocked`, `reason_required`, `section_fixed`' },
      },
      handler: async (c, caller) => {
        const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
        if (!body || typeof body.laneId !== 'string') return failure(c, 422, 'invalid', '`laneId` is required', { field: 'laneId' })

        const id = c.req.param('itemId') ?? ''
        const boardId = c.req.param('boardId') ?? ''
        const state = await readWorkspace(caller.db, caller.workspaceId)
        const item = state.items.find((i) => i.id === id)
        if (!item) return failure(c, 404, 'not_found', 'no such item')
        if (!state.boards.some((b) => b.id === boardId)) return failure(c, 404, 'not_found', 'no such board')

        // A move is arrangement, so it does not demand a revision — but a script that read first may
        // send one, and a stale one is answered rather than applied over a newer card.
        if (typeof body.baseRev === 'number' && (item.rev ?? 0) !== body.baseRev) {
          return failure(c, 409, 'stale', 'this item has moved past the revision the move was based on', { item: compactItem(item) })
        }

        const intent = {
          itemId: id,
          boardId,
          laneId: body.laneId,
          ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
          ...(typeof body.index === 'number' ? { index: body.index } : {}),
        }
        const context = { at: Date.now(), by: caller.user.id, id: () => newId() }
        const outcome = isInitiativeItem(item, state.issueTypes)
          ? moveInitiative(state, intent, context)
          : moveCard(state, intent, context)

        if (outcome.kind === 'refused') {
          const status = outcome.refusal.code === 'not_found' ? 404 : 422
          return failure(c, status, outcome.refusal.code, outcome.refusal.message, 'details' in outcome.refusal ? outcome.refusal.details : undefined)
        }
        if (outcome.kind === 'held') {
          // `justify`: the move needs a reason. The refusal names the place and the limit, so a
          // script can ask somebody or supply one.
          return failure(c, 422, 'reason_required', outcome.message, {
            laneId: outcome.laneId,
            laneName: outcome.laneName,
            limit: outcome.limit,
            ...(outcome.index === undefined ? {} : { index: outcome.index }),
          })
        }

        const changed = outcome.placements.filter((placement) => !state.placements.includes(placement))
        const moved = outcome.items.find((i) => i.id === id)!
        await writeItemAndPlacements(caller.db, moved, changed, caller.workspaceId, undefined, auditWrite(caller, 'item.move', id, {
          boardId,
          laneId: intent.laneId,
          ...(outcome.justified ? { reason: intent.reason } : {}),
        }))

        return c.json({
          item: compactItem(moved, outcome.placement),
          placement: { boardId, laneId: outcome.placement.laneId, rank: outcome.placement.rank ?? 0 },
          ...(outcome.justified ? { justified: true, reason: intent.reason } : {}),
          ...(outcome.positionOnly ? { positionOnly: true } : {}),
        })
      },
    },
    {
      method: 'GET',
      path: '/objectives',
      summary: 'Objectives with the completeness their work gives them, and their key results.',
      scope: 'objectives:write',
      responses: { '200': { description: '{ data }' } },
      handler: async (c, caller) => {
        const state = await readWorkspace(caller.db, caller.workspaceId)
        return c.json({
          data: state.objectives.map((objective) => ({
            id: objective.id,
            title: objective.title,
            period: objective.period,
            ...(objective.score !== undefined ? { score: objective.score } : {}),
            // The same completeness the app shows: the rollup of the work that serves it, and
            // `null` when nothing does — a 0% would be a worse way of saying "nothing serves this".
            completeness: objectiveRollup(objective.id, state) ?? null,
            keyResults: state.keyResults
              .filter((kr) => kr.objectiveId === objective.id)
              .map((kr) => ({ id: kr.id, title: kr.title })),
          })),
        })
      },
    },
    {
      method: 'GET',
      path: '/people',
      summary: 'Names and ids, so an assignment names a person.',
      scope: 'people:read',
      responses: { '200': { description: '{ data }' } },
      handler: async (c, caller) => {
        const state = await readWorkspace(caller.db, caller.workspaceId)
        return c.json({ data: state.users.map((user) => ({ id: user.id, name: user.name, ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}) })) })
      },
    },
    {
      method: 'GET',
      path: '/search',
      summary: 'The app’s own search over titles. Not a query language.',
      scope: 'items:read',
      query: [{ name: 'q', description: 'What to look for. Empty answers nothing.' }],
      responses: { '200': { description: '{ data }' } },
      handler: async (c, caller) => {
        const q = c.req.query('q') ?? ''
        if (!q.trim()) return c.json({ data: [] })
        const state = await readWorkspace(caller.db, caller.workspaceId)
        const placements = new Map(state.placements.map((p) => [p.itemId, p]))
        return c.json({
          data: searchItems(state.items.filter((item) => !item.archived), q).map((item) => compactItem(item, placements.get(item.id))),
        })
      },
    },
    {
      method: 'GET',
      path: '/workspace',
      summary: 'The workspace file — what `POST /workspace` restores, and what a backup holds.',
      scope: 'boards:read',
      responses: { '200': { description: 'The workspace slice, plus `schema`' } },
      handler: async (c, caller) => {
        const state = await readWorkspace(caller.db, caller.workspaceId)
        return c.json({ schema: WORKSPACE_SCHEMA, ...state })
      },
    },
    {
      method: 'POST',
      path: '/workspace',
      summary: 'Replace an empty workspace with a file. Refused when it already has boards.',
      scope: 'workspace:admin',
      action: 'workspace.import',
      body: { $ref: '#/components/schemas/Workspace' },
      responses: {
        '200': { description: 'What was imported' },
        '409': { description: 'This workspace already has boards' },
        '422': { description: 'Not a workspace this server can read' },
      },
      handler: async (c, caller) => {
        const state = await readWorkspace(caller.db, caller.workspaceId)
        if (state.boards.length) {
          return failure(c, 409, 'not_empty', 'this workspace already has boards; import is for a fresh instance', {
            boards: state.boards.length,
          })
        }
        const workspace = parseWorkspace((await c.req.json().catch(() => null)) as Workspace | null)
        if (!workspace) return failure(c, 422, 'invalid', 'that is not a workspace this server can read')
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
        return c.json({ imported: { boards: workspace.boards.length, items: workspace.items.length } })
      },
    },
  ]

  for (const spec of TABLE) {
    // The document's own route is public — a generator has no credential yet — so it is mounted
    // outside the door rather than given a caller it would ignore.
    if (spec.scope === null) continue
    routes.on(spec.method, spec.path, async (c) => {
      const caller = await requireV1(c, runtime, spec.scope!, spec.action)
      if (caller instanceof Response) return caller
      try {
        return await spec.handler(c, caller)
      } catch (error) {
        // A route that throws is a bug, not a refusal: it says so without pretending to know why.
        console.error('v1 route failed', spec.method, spec.path, error)
        return failure(c, 503, 'internal', 'this request could not be completed')
      }
    })
  }

  routes.get('/openapi.json', (c) => c.json(openapi(TABLE)))

  return routes
}

/* ---- The document (R6) --------------------------------------------------------------------- */

const itemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'typeId', 'rev', 'createdAt'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    typeId: { type: 'string' },
    initiativeTypeId: { type: 'string' },
    size: { type: 'number' },
    priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
    assignees: { type: 'array', items: { type: 'string' } },
    tagIds: { type: 'array', items: { type: 'string' } },
    targetStartDate: { type: 'string', format: 'date' },
    targetEndDate: { type: 'string', format: 'date' },
    boardId: { type: 'string' },
    laneId: { type: 'string' },
    rank: { type: 'number' },
    rev: { type: 'integer' },
    createdAt: { type: 'integer' },
    resolvedAt: { type: ['integer', 'null'] },
    archived: { type: 'boolean' },
    blocked: { type: 'boolean' },
  },
} as const

const schemas = {
  Error: {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', description: 'Stable: a script branches on this, never on `message`.' },
          message: { type: 'string', description: 'For a person.' },
          details: { type: 'object', additionalProperties: true, description: 'What a script needs to act.' },
        },
      },
    },
  },
  Item: itemSchema,
  Page: {
    type: 'object',
    properties: {
      data: { type: 'array', items: itemSchema },
      nextCursor: { type: ['string', 'null'] },
    },
  },
  NewItem: {
    type: 'object',
    required: ['boardId', 'title'],
    properties: {
      id: { type: 'string', description: 'Optional: your own id, so a retry can be recognised.' },
      boardId: { type: 'string' },
      laneId: { type: 'string', description: 'Defaults to the board’s drop cell.' },
      typeId: { type: 'string', description: 'Defaults to the board’s card type. The Initiative type makes an initiative.' },
      title: { type: 'string' },
      description: { type: 'string' },
      parentId: { type: 'string', description: 'An initiative to roll this up to.' },
      size: { type: 'number', description: 'Refused on an initiative: its size is the work below it.' },
      priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
      assignees: { type: 'array', items: { type: 'string' } },
      tagIds: { type: 'array', items: { type: 'string' } },
      targetStartDate: { type: 'string', format: 'date' },
      targetEndDate: { type: 'string', format: 'date' },
    },
  },
  ItemPatch: {
    type: 'object',
    required: ['baseRev'],
    properties: {
      baseRev: { type: 'integer', description: 'The revision you read. A stale one is a 409 with the item.' },
      title: { type: 'string' },
      description: { type: ['string', 'null'] },
      typeId: { type: 'string' },
      size: { type: ['number', 'null'] },
      priority: { type: ['string', 'null'], enum: ['urgent', 'high', 'medium', 'low', null] },
      assignees: { type: 'array', items: { type: 'string' } },
      tagIds: { type: 'array', items: { type: 'string' } },
      targetStartDate: { type: ['string', 'null'], format: 'date' },
      targetEndDate: { type: ['string', 'null'], format: 'date' },
      parentId: { type: ['string', 'null'] },
    },
  },
  Move: {
    type: 'object',
    required: ['laneId'],
    properties: {
      laneId: { type: 'string', description: 'The cell it is going into.' },
      index: { type: 'integer', description: 'Where in the lane, 0 is the top. Default: the end.' },
      reason: { type: 'string', description: 'Required by a `justify` lane at its limit.' },
      baseRev: { type: 'integer', description: 'Optional: refuse if the item moved since you read it.' },
    },
  },
  Workspace: {
    type: 'object',
    description: 'The shape `GET /workspace` answers with, which is what `POST /workspace` reads.',
    required: ['boards'],
    properties: {
      schema: { type: 'integer' },
      boards: { type: 'array', items: { type: 'object' } },
      lanes: { type: 'array', items: { type: 'object' } },
      items: { type: 'array', items: { type: 'object' } },
      placements: { type: 'array', items: { type: 'object' } },
    },
  },
}

/** OpenAPI 3.1, from the table that mounts the routes. */
export function openapi(table: RouteSpec[]) {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const spec of table) {
    const parameters: Array<Record<string, unknown>> = []
    for (const match of spec.path.matchAll(/:([A-Za-z]+)/g)) {
      parameters.push({ name: match[1], in: 'path', required: true, schema: { type: 'string' } })
    }
    for (const query of spec.query ?? []) {
      parameters.push({ name: query.name, in: 'query', required: false, description: query.description, schema: { type: 'string', ...(query.example ? { example: query.example } : {}) } })
    }
    paths[spec.path] = {
      ...(paths[spec.path] ?? {}),
      [spec.method.toLowerCase()]: {
        summary: spec.summary,
        ...(spec.scope ? { description: `Requires the \`${spec.scope}\` scope.`, security: [{ bearer: [] }] } : { security: [] }),
        ...(parameters.length ? { parameters } : {}),
        ...(spec.body ? { requestBody: { required: true, content: { 'application/json': { schema: spec.body } } } } : {}),
        responses: Object.fromEntries(
          Object.entries(spec.responses).map(([status, response]) => [
            status,
            {
              description: response.description,
              content: {
                'application/json': {
                  schema: status.startsWith('2') ? { type: 'object', additionalProperties: true } : { $ref: '#/components/schemas/Error' },
                },
              },
            },
          ]),
        ),
      },
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Flowline API',
      version: '1.0.0',
      description:
        'The supported surface. Within v1 a client may rely on every field here existing; fields may be added and never removed or retyped. See `docs/rest-api.md` for the promise and the conventions.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', description: 'A token from `flowline login`, or one minted in the app.' },
      },
      schemas,
    },
    paths,
  }
}
