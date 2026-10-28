/**
 * `/api/v1` — the surface a script may rely on (task 169), and the door `/mcp` shares (task 170).
 *
 * The app's own `/api/*` changes with the client in the same commit and promises nobody anything.
 * This one is a contract: within `v1` a field may be added and never removed or retyped, and
 * `docs/rest-api.md` says so in writing. What is here is the transport's half — authentication, the
 * rate limit, pagination parameters, status codes — and nothing that decides. The acts are in
 * `server/operations.ts`, and the rules behind them are the domain's.
 *
 * A token, never a session. Two ceilings on every request: the token's scopes and the owner's role.
 * One error body with a stable `code`. The document is generated from this table, so a mounted route
 * cannot be missing from `openapi.json` and vice versa.
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import { can, type Action, type Role } from '../../src/domain/roles'
import { grants, type Scope } from '../../src/domain/scopes'
import { resolveWorkspace } from '../access'
import { callerForSecret } from '../tokens'
import { limitPerMinute, spend } from '../rate-limit'
import { schemaVersion } from '../migrate'
import type { Runtime } from '../runtime'
import { REQUIRED_SCHEMA } from '../workspace/schema'
import {
  createItem,
  exportFile,
  getBoard,
  getItem,
  importFile,
  listBoards,
  listItems,
  listObjectives,
  listPeople,
  moveItem,
  search,
  updateItem,
  type ApiFailure,
  type Op,
  type OpCaller,
} from '../operations'
import type { AuthUser } from '../auth/session'
import type { Database } from '../db'

/* ---- The body of every answer that is not a success ---------------------------------------- */

export interface ApiError {
  error: { code: string; message: string; details?: Record<string, unknown> }
}

type Ctx = Context<{ Bindings: object; Variables: V1Vars }>

const failure = (c: Ctx, status: ApiFailure['status'], code: string, message: string, details?: Record<string, unknown>) =>
  c.json({ error: { code, message, ...(details ? { details } : {}) } } satisfies ApiError, status) as unknown as Response

/** An operation's answer, as HTTP. The status is the operation's; a success is 200 unless the route
 * created something. */
function respond(c: Ctx, result: Op<unknown>, status: 200 | 201 = 200): Response {
  return result.ok ? c.json(result.value, status) : failure(c, result.error.status, result.error.code, result.error.message, result.error.details)
}

/* ---- The caller ---------------------------------------------------------------------------- */

export interface V1Vars {
  /** Set once the credential is known, so the middleware can put the rate-limit headers on every
   * answer — including the ones that are refusals. */
  rate?: { limit: number; remaining: number; reset: number }
}

export type V1Caller = OpCaller

/* ---- Rate limits (R5) ---------------------------------------------------------------------- */

// The window and the configured limit live in `server/rate-limit.ts`, because `/mcp` and `/scim/v2`
// share them; what is here is only the header shape a v1 answer needs.

/**
 * The credential, and only the credential.
 *
 * `/api/v1` and `/mcp` share this: both are for tokens, both resolve the same caller, and the tool
 * or the route decides what that caller may do. The refusal is deliberately the same sentence on
 * both doors — a session cookie is the app's, and neither surface will take it.
 */
export async function requireToken(
  c: Ctx,
  runtime: Runtime,
): Promise<{ db: Database; user: AuthUser; tokenId: string; scopes: Scope[]; workspaceId: string; role: Role } | Response> {
  const db = runtime.database(c.env)
  if (!db) return failure(c, 503, 'not_configured', 'this instance has no database')

  const header = c.req.header('authorization') ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  if (!match) {
    return failure(
      c,
      401,
      'token_required',
      'this API is for token credentials: acquire one with `kanbantoolkit login`, then send `Authorization: Bearer <token>`',
    )
  }

  const found = await callerForSecret(db, match[1])
  if (!found) return failure(c, 401, 'invalid_token', 'that credential is not valid: it was revoked, expired, or never existed')

  const instance = await db.get<{ role: string }>('SELECT role FROM instance_members WHERE user_id = ?1', [found.user.id])
  if (!instance) {
    return failure(c, 401, 'invalid_token', 'that credential belongs to an account that is no longer a member of this instance')
  }

  if (c.req.method !== 'GET' && (await schemaVersion(db)) < REQUIRED_SCHEMA) {
    return failure(c, 503, 'not_configured', 'this instance has not finished migrating')
  }

  const instanceRole = instance.role === 'admin' ? 'admin' : 'member'
  const resolved = await resolveWorkspace(db, found.user.id, instanceRole === 'admin', undefined)
  if (!resolved) return failure(c, 404, 'no_workspace', 'this account is not in a workspace on this instance')

  return { db, user: found.user, tokenId: found.tokenId, scopes: found.scopes, workspaceId: resolved.id, role: resolved.role }
}

/**
 * The door: the credential, its scope, and the owner's role — in that order, because each answer
 * means something different to the script that sent it.
 */
export async function requireV1(c: Ctx, runtime: Runtime, scope: Scope, action?: Action): Promise<V1Caller | Response> {
  const caller = await requireToken(c, runtime)
  if (caller instanceof Response) return caller

  if (!grants(caller.scopes, scope)) {
    return failure(c, 403, 'scope_required', `this credential cannot ${action ?? scope}`, { scope })
  }
  if (action && !can(caller.role, action)) {
    return failure(c, 403, 'role_forbidden', `a ${caller.role} may not ${action}`, { role: caller.role, action })
  }

  const limit = limitPerMinute(c.env)
  const spent = spend(caller.tokenId, limit)
  c.set('rate', { limit, remaining: spent.remaining, reset: spent.reset })
  if (!spent.allowed) {
    return failure(c, 429, 'rate_limited', `this token may make ${limit} requests a minute; try again in ${spent.reset}s`, {
      retryAfter: spent.reset,
    })
  }

  return caller
}

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
  responses: Record<string, { description: string }>
  handler: (c: Ctx, caller: V1Caller) => Promise<Response> | Response
}

export function v1Routes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object; Variables: V1Vars }>()

  // The limits are on every answer, refusals included: a script being told "no" still wants to know
  // when it may ask again. The values are decided in `requireV1`, after the token is known.
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
      handler: async (c, caller) => respond(c, await listBoards(caller, { limit: c.req.query('limit'), cursor: c.req.query('cursor') })),
    },
    {
      method: 'GET',
      path: '/boards/:boardId',
      summary: 'One board: its two lane trees, what is placed in it, and the items there.',
      scope: 'boards:read',
      responses: { '200': { description: 'The board' }, '404': { description: 'No such board' } },
      handler: async (c, caller) => respond(c, await getBoard(caller, c.req.param('boardId') ?? '')),
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
      handler: async (c, caller) =>
        respond(
          c,
          await listItems(caller, {
            boardId: c.req.query('boardId'),
            laneId: c.req.query('laneId'),
            typeId: c.req.query('typeId'),
            q: c.req.query('q'),
            updatedSince: c.req.query('updatedSince'),
            includeArchived: c.req.query('includeArchived') === 'true',
            limit: c.req.query('limit'),
            cursor: c.req.query('cursor'),
          }),
        ),
    },
    {
      method: 'GET',
      path: '/items/:itemId',
      summary: 'One item, with its parent, its placements and its rollup.',
      scope: 'items:read',
      responses: { '200': { description: 'The item' }, '404': { description: 'No such item' } },
      handler: async (c, caller) => respond(c, await getItem(caller, c.req.param('itemId') ?? '')),
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
        const result = await createItem(caller, body, c.req.header('idempotency-key'))
        // A replayed create is a 200 with the item it already made; a new one is a 201.
        if (result.ok && (result.value as { replayed?: boolean }).replayed) {
          const { replayed: _replayed, ...value } = result.value as { replayed?: boolean } & Record<string, unknown>
          return c.json(value, 200)
        }
        return respond(c, result, 201)
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
        const result = await updateItem(caller, c.req.param('itemId') ?? '', body, c.req.header('idempotency-key'))
        if (result.ok && (result.value as { replayed?: boolean }).replayed) {
          const { replayed: _replayed, ...value } = result.value as { replayed?: boolean } & Record<string, unknown>
          return c.json(value, 200)
        }
        return respond(c, result)
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
        if (!body) return failure(c, 422, 'invalid', '`laneId` is required', { field: 'laneId' })
        return respond(c, await moveItem(caller, c.req.param('boardId') ?? '', c.req.param('itemId') ?? '', body))
      },
    },
    {
      method: 'GET',
      path: '/objectives',
      summary: 'Objectives with the completeness their work gives them, and their key results.',
      scope: 'boards:read',
      responses: { '200': { description: '{ data }' } },
      handler: async (c, caller) => respond(c, await listObjectives(caller)),
    },
    {
      method: 'GET',
      path: '/people',
      summary: 'Names and ids, so an assignment names a person.',
      scope: 'people:read',
      responses: { '200': { description: '{ data }' } },
      handler: async (c, caller) => respond(c, await listPeople(caller)),
    },
    {
      method: 'GET',
      path: '/search',
      summary: 'The app’s own search over titles. Not a query language.',
      scope: 'items:read',
      query: [{ name: 'q', description: 'What to look for. Empty answers nothing.' }],
      responses: { '200': { description: '{ data }' } },
      handler: async (c, caller) => respond(c, await search(caller, c.req.query('q') ?? '', c.req.query('limit'))),
    },
    {
      method: 'GET',
      path: '/workspace',
      summary: 'The workspace file — what `POST /workspace` restores, and what a backup holds.',
      scope: 'boards:read',
      responses: { '200': { description: 'The workspace slice, plus `schema`' } },
      handler: async (c, caller) => respond(c, await exportFile(caller)),
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
      handler: async (c, caller) => respond(c, await importFile(caller, await c.req.json().catch(() => null))),
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
    createdById: { type: 'string', description: 'Who made the item. Recorded by the server; never writable.' },
    initiativeTypeId: { type: 'string' },
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
      parameters.push({
        name: query.name,
        in: 'query',
        required: false,
        description: query.description,
        schema: { type: 'string', ...(query.example ? { example: query.example } : {}) },
      })
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
      title: 'Kanban Toolkit API',
      version: '1.0.0',
      description:
        'The supported surface. Within v1 a client may rely on every field here existing; fields may be added and never removed or retyped. See `docs/rest-api.md` for the promise and the conventions.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', description: 'A token from `kanbantoolkit login`, or one minted in the app.' },
      },
      schemas,
    },
    paths,
  }
}
