/**
 * SCIM 2.0 — the provisioning side of an identity provider (task 168).
 *
 * OIDC says who a person is when they sign in; SCIM says who the team *is*, so arrivals and
 * departures happen where they already happen. The endpoint is deliberately small: the documents an
 * IdP reads before it will connect, `/Users`, and `/Groups`, with the RFC's status codes and the
 * RFC's error shape.
 *
 * Two boundaries run through it:
 *
 * - **A SCIM token is not a person.** It cannot read a board, it cannot administer the instance, and
 *   its writes are audited as the directory with the token named — never as somebody who did not do
 *   it. It carries one decision: the workspace role a provisioned person gets.
 * - **The directory provisions people and membership; the team decides authority.** SCIM can put
 *   somebody in a group and cannot thereby make them an administrator; a group carries a role only
 *   when an administrator granted one in the app.
 *
 * `active: false` is deactivation — the reversible act this product already has: the account stays
 * and the work keeps their name. Only `DELETE` removes the account, and it removes it the app's way:
 * the work stays, and every reference reads "Former member".
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Role } from '../../src/domain/roles'
import { requireInstanceAdmin } from '../access'
import { statement } from '../audit'
import { randomToken } from '../auth/oauth'
import { WORKSPACE_ID } from '../auth/session'
import { publicUrl } from '../config'
import type { Database, Statement } from '../db'
import { schemaVersion } from '../migrate'
import { limitPerMinute, spend } from '../rate-limit'
import type { Runtime } from '../runtime'
import { REQUIRED_SCHEMA } from '../workspace/schema'
import {
  SCIM_ROLES,
  mintScimToken,
  publicScimToken,
  revokeScimToken,
  scimCallerForSecret,
  scimTokensOf,
  type ScimTokenRow,
} from './tokens'

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User'
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group'
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error'
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse'
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'

type Ctx = Context<{ Bindings: object }>

interface UserRow {
  id: string
  name: string
  email: string
  status: string
  external_id: string | null
  created_at: string
  updated_at: string | null
}

interface GroupRow {
  id: string
  name: string
  description: string | null
  active: number
  created_at: string
}

interface MemberRow {
  user_id: string
  name: string
}

/** The RFC's error body. An IdP will not read ours, and a sync that cannot parse a failure retries. */
function scimError(c: Ctx, status: 400 | 401 | 403 | 404 | 409 | 429 | 503, detail: string): Response {
  return c.json({ schemas: [ERROR_SCHEMA], detail, status: String(status) }, status) as unknown as Response
}

const nowIso = () => new Date().toISOString()

function baseOf(c: Ctx): string {
  return `${publicUrl(c.env, c.req.raw)}/scim/v2`
}

/* ---- The door ------------------------------------------------------------------------------ */

/**
 * The token, and only the token.
 *
 * A revoked credential is `401`, not `403`: it is not a person short of authority. The limit is per
 * token so one IdP's retry storm cannot spend another's.
 */
async function requireScim(c: Ctx, runtime: Runtime): Promise<{ db: Database; token: ScimTokenRow } | Response> {
  const db = runtime.database(c.env)
  if (!db) return scimError(c, 503, 'this instance has no database')

  const header = c.req.header('authorization') ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  if (!match) return scimError(c, 401, 'a SCIM token is required: send `Authorization: Bearer <token>`')

  const token = await scimCallerForSecret(db, match[1])
  if (!token) return scimError(c, 401, 'that credential is not valid: it was revoked, or never existed')

  if (c.req.method !== 'GET' && (await schemaVersion(db)) < REQUIRED_SCHEMA) {
    return scimError(c, 503, 'this instance has not finished migrating')
  }

  const limit = limitPerMinute(c.env)
  const spent = spend(`scim:${token.id}`, limit)
  const headers = {
    'RateLimit-Limit': String(limit),
    'RateLimit-Remaining': String(spent.remaining),
    'RateLimit-Reset': String(spent.reset),
  }
  if (!spent.allowed) {
    const response = scimError(c, 429, `this token may make ${limit} requests a minute; try again in ${spent.reset}s`)
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
    response.headers.set('Retry-After', String(spent.reset))
    return response
  }

  return { db, token }
}

/* ---- Shapes -------------------------------------------------------------------------------- */

function userResource(row: UserRow, base: string) {
  return {
    schemas: [USER_SCHEMA],
    id: row.id,
    ...(row.external_id ? { externalId: row.external_id } : {}),
    userName: row.email,
    name: { formatted: row.name },
    displayName: row.name,
    active: row.status === 'active',
    emails: [{ value: row.email, primary: true, type: 'work' }],
    meta: {
      resourceType: 'User',
      created: row.created_at,
      lastModified: row.updated_at ?? row.created_at,
      location: `${base}/Users/${row.id}`,
    },
  }
}

async function memberRows(db: Database, groupId: string): Promise<MemberRow[]> {
  return db.all<MemberRow>(
    `SELECT m.user_id, u.name FROM group_members m JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ?1 ORDER BY u.name, u.id`,
    [groupId],
  )
}

async function groupResource(db: Database, row: GroupRow, base: string) {
  const members = await memberRows(db, row.id)
  return {
    schemas: [GROUP_SCHEMA],
    id: row.id,
    displayName: row.name,
    ...(row.description ? { description: row.description } : {}),
    members: members.map((member) => ({ value: member.user_id, display: member.name, type: 'User' })),
    meta: { resourceType: 'Group', created: row.created_at, lastModified: row.created_at, location: `${base}/Groups/${row.id}` },
  }
}

const listResponse = (resources: unknown[], total: number, startIndex: number) => ({
  schemas: [LIST_SCHEMA],
  totalResults: total,
  itemsPerPage: resources.length,
  startIndex,
  Resources: resources,
})

/** `userName eq "…"`, `externalId eq "…"`, `active eq true`. Anything else is refused rather than
 * silently ignored: an IdP that believes it filtered and got everybody does the wrong thing next. */
function parseFilter(filter: string | undefined): { attribute: string; value: string } | undefined | 'invalid' {
  if (!filter) return undefined
  const match = /^\s*(userName|externalId|active|displayName)\s+eq\s+"([^"]*)"\s*$/i.exec(filter)
  if (!match) return 'invalid'
  return { attribute: match[1], value: match[2] }
}

function paging(c: Ctx): { startIndex: number; count: number } {
  const start = Number(c.req.query('startIndex') ?? 1)
  const count = Number(c.req.query('count') ?? 100)
  return {
    startIndex: Number.isFinite(start) && start >= 1 ? Math.floor(start) : 1,
    count: Number.isFinite(count) && count >= 0 ? Math.min(500, Math.floor(count)) : 100,
  }
}

/* ---- Users --------------------------------------------------------------------------------- */

async function findUser(db: Database, id: string): Promise<UserRow | undefined> {
  return db.get<UserRow>('SELECT id, name, email, status, external_id, created_at, updated_at FROM users WHERE id = ?1', [id])
}

async function findUserByEmail(db: Database, email: string): Promise<UserRow | undefined> {
  return db.get<UserRow>(
    'SELECT id, name, email, status, external_id, created_at, updated_at FROM users WHERE lower(email) = lower(?1)',
    [email],
  )
}

interface UserBody {
  userName?: unknown
  externalId?: unknown
  name?: { formatted?: unknown; givenName?: unknown; familyName?: unknown } | unknown
  displayName?: unknown
  active?: unknown
}

/** The address, the display name, the IdP's id and the active flag — the four things this server
 * honours, and nothing else. A field it does not honour is ignored rather than half-applied. */
function readUser(body: UserBody | null): { userName: string; name: string; externalId?: string; active?: boolean } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'a JSON body is required' }
  const userName = typeof body.userName === 'string' ? body.userName.trim() : ''
  if (!userName || !userName.includes('@')) return { error: '`userName` must be the address the person signs in with' }

  const name = body.name && typeof body.name === 'object' ? (body.name as Record<string, unknown>) : {}
  const formatted = typeof name.formatted === 'string' ? name.formatted.trim() : ''
  const given = typeof name.givenName === 'string' ? name.givenName.trim() : ''
  const family = typeof name.familyName === 'string' ? name.familyName.trim() : ''
  const display = typeof body.displayName === 'string' ? body.displayName.trim() : ''
  const resolved = formatted || display || [given, family].filter(Boolean).join(' ') || userName.split('@')[0]

  const externalId = typeof body.externalId === 'string' && body.externalId.trim() ? body.externalId.trim() : undefined
  const active = typeof body.active === 'boolean' ? body.active : undefined
  return { userName, name: resolved, ...(externalId ? { externalId } : {}), ...(active === undefined ? {} : { active }) }
}

export function scimRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  /* ---- The documents an IdP reads first (R2) --------------------------------------------- */

  routes.get('/ServiceProviderConfig', (c) =>
    c.json({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: `${publicUrl(c.env, c.req.raw)}/app`,
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'SCIM token',
          description: 'Mint a SCIM token in Admin → Directory provisioning, and send it as `Authorization: Bearer …`.',
          specUri: 'https://www.rfc-editor.org/info/rfc6750',
          primary: true,
        },
      ],
      meta: { resourceType: 'ServiceProviderConfig', location: `${baseOf(c)}/ServiceProviderConfig` },
    }),
  )

  routes.get('/ResourceTypes', (c) => {
    const base = baseOf(c)
    return c.json(
      listResponse(
        [
          {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
            id: 'User',
            name: 'User',
            endpoint: '/Users',
            description: 'A person: an account, its address, and the workspace role the SCIM token grants.',
            schema: USER_SCHEMA,
            meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/User` },
          },
          {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
            id: 'Group',
            name: 'Group',
            endpoint: '/Groups',
            description: 'A group of people. It carries authority only when an administrator granted it a role in the app.',
            schema: GROUP_SCHEMA,
            meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/Group` },
          },
        ],
        2,
        1,
      ),
    )
  })

  routes.get('/ResourceTypes/:id', (c) => {
    const id = c.req.param('id')
    if (id !== 'User' && id !== 'Group') return scimError(c, 404, 'no such resource type')
    const base = baseOf(c)
    return c.json({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      id,
      name: id,
      endpoint: `/${id}s`,
      schema: id === 'User' ? USER_SCHEMA : GROUP_SCHEMA,
      meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/${id}` },
    })
  })

  routes.get('/Schemas', (c) =>
    c.json(
      listResponse(
        [
          { id: USER_SCHEMA, name: 'User', description: 'A person on this instance.' },
          { id: GROUP_SCHEMA, name: 'Group', description: 'A group of people.' },
          { id: ERROR_SCHEMA, name: 'Error', description: 'A refusal.' },
          { id: LIST_SCHEMA, name: 'ListResponse', description: 'A page of resources.' },
          { id: PATCH_SCHEMA, name: 'PatchOp', description: 'A patch request.' },
        ].map((schema) => ({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'], ...schema })),
        5,
        1,
      ),
    ),
  )

  routes.get('/Schemas/:id', (c) => {
    const known = [
      { id: USER_SCHEMA, name: 'User' },
      { id: GROUP_SCHEMA, name: 'Group' },
      { id: ERROR_SCHEMA, name: 'Error' },
      { id: LIST_SCHEMA, name: 'ListResponse' },
      { id: PATCH_SCHEMA, name: 'PatchOp' },
    ].find((schema) => schema.id === decodeURIComponent(c.req.param('id') ?? ''))
    if (!known) return scimError(c, 404, 'no such schema')
    return c.json({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'], ...known })
  })

  /* ---- Users (R3, R4) ------------------------------------------------------------------- */

  routes.get('/Users', async (c) => {
    const door = await requireScim(c, runtime)
    if (door instanceof Response) return door
    const filter = parseFilter(c.req.query('filter'))
    if (filter === 'invalid') return scimError(c, 400, 'this server filters on userName, externalId, active and displayName, with `eq`')

    let rows = await door.db.all<UserRow>(
      'SELECT id, name, email, status, external_id, created_at, updated_at FROM users ORDER BY lower(email)',
    )
    if (filter) {
      const wanted = filter.value.toLowerCase()
      if (filter.attribute === 'userName') rows = rows.filter((row) => row.email.toLowerCase() === wanted)
      else if (filter.attribute === 'externalId') rows = rows.filter((row) => (row.external_id ?? '').toLowerCase() === wanted)
      else if (filter.attribute === 'displayName') rows = rows.filter((row) => row.name.toLowerCase() === wanted)
      else rows = rows.filter((row) => (row.status === 'active') === (filter.value.toLowerCase() === 'true'))
    }

    const { startIndex, count } = paging(c)
    const slice = rows.slice(startIndex - 1, startIndex - 1 + count)
    const base = baseOf(c)
    return c.json(listResponse(slice.map((row) => userResource(row, base)), rows.length, startIndex))
  })

  routes.post('/Users', async (c) => {
    const door = await requireScim(c, runtime)
    if (door instanceof Response) return door

    const body = (await c.req.json().catch(() => null)) as UserBody | null
    const read = readUser(body)
    if ('error' in read) return scimError(c, 400, read.error)

    // A person who already exists by address is **returned, not duplicated**: the IdP is told which
    // id it already has, and the sync continues without a second Ada.
    const existing = await findUserByEmail(door.db, read.userName)
    if (existing) return scimError(c, 409, `userName already exists; GET /Users?filter=userName eq "${read.userName}" for id ${existing.id}`)

    if (read.externalId) {
      const byExternal = await door.db.get<{ id: string }>('SELECT id FROM users WHERE external_id = ?1', [read.externalId])
      if (byExternal) return scimError(c, 409, `externalId already exists; it is the id of ${byExternal.id}`)
    }

    const id = `u_${randomToken(9)}`
    const at = nowIso()
    const active = read.active !== false
    const statements: Statement[] = [
      {
        sql: 'INSERT INTO users (id, name, email, status, external_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
        params: [id, read.name, read.userName.toLowerCase(), active ? 'active' : 'inactive', read.externalId ?? null, at, at],
      },
      // The door: a provisioned person may sign in to this instance…
      { sql: "INSERT INTO instance_members (user_id, role) VALUES (?1, 'member')", params: [id] },
      // …and the seat the token carries. Never an instance administrator: that is not a directory's.
      {
        sql: 'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, ?3)',
        params: [WORKSPACE_ID, id, door.token.default_role],
      },
      statement({
        action: 'scim.user.create',
        targetType: 'user',
        targetId: id,
        data: { token: door.token.id, role: door.token.default_role, active },
      }),
    ]
    await door.db.batch(statements)

    const row = (await findUser(door.db, id))!
    return c.json(userResource(row, baseOf(c)), 201, { Location: `${baseOf(c)}/Users/${id}` })
  })

  routes.get('/Users/:id', async (c) => {
    const door = await requireScim(c, runtime)
    if (door instanceof Response) return door
    const row = await findUser(door.db, c.req.param('id') ?? '')
    if (!row) return scimError(c, 404, 'no such user')
    return c.json(userResource(row, baseOf(c)))
  })

  routes.put('/Users/:id', async (c) => {
    const door = await requireScim(c, runtime)
    if (door instanceof Response) return door
    const id = c.req.param('id') ?? ''
    const current = await findUser(door.db, id)
    if (!current) return scimError(c, 404, 'no such user')

    const body = (await c.req.json().catch(() => null)) as UserBody | null
    const read = readUser(body)
    if ('error' in read) return scimError(c, 400, read.error)

    const clash = await findUserByEmail(door.db, read.userName)
    if (clash && clash.id !== id) return scimError(c, 409, `userName already exists; it is the id of ${clash.id}`)
    if (read.externalId) {
      const byExternal = await door.db.get<{ id: string }>('SELECT id FROM users WHERE external_id = ?1', [read.externalId])
      if (byExternal && byExternal.id !== id) return scimError(c, 409, `externalId already exists; it is the id of ${byExternal.id}`)
    }

    const active = read.active ?? current.status === 'active'
    await door.db.batch([
      {
        sql: 'UPDATE users SET name = ?1, email = ?2, external_id = ?3, status = ?4, updated_at = ?5 WHERE id = ?6',
        params: [read.name, read.userName.toLowerCase(), read.externalId ?? null, active ? 'active' : 'inactive', nowIso(), id],
      },
      ...(active ? [] : [{ sql: 'UPDATE sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL', params: [nowIso(), id] }]),
      statement({ action: 'scim.user.update', targetType: 'user', targetId: id, data: { token: door.token.id, replace: true, active } }),
    ])

    return c.json(userResource((await findUser(door.db, id))!, baseOf(c)))
  })

  /**
   * `PATCH` in the RFC's shape: `{ Operations: [{ op, path, value }] }`.
   *
   * The acts are the ones this product has: rename, re-address, set the IdP's id, and **deactivate**
   * — which is the reversible act (task 144), not a deletion. A `remove` of a whole user is refused
   * with a sentence pointing at DELETE, because a sync that meant "delete" and sent the wrong verb
   * must not empty a team.
   */
  routes.patch('/Users/:id', async (c) => {
    const door = await requireScim(c, runtime)
    if (door instanceof Response) return door
    const id = c.req.param('id') ?? ''
    const current = await findUser(door.db, id)
    if (!current) return scimError(c, 404, 'no such user')

    const body = (await c.req.json().catch(() => null)) as { schemas?: unknown; Operations?: unknown; operations?: unknown } | null
    const operations = (body?.Operations ?? body?.operations) as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(operations)) return scimError(c, 400, 'a PATCH body is `{ Operations: [{ op, path, value }] }`')

    let name = current.name
    let email = current.email
    let externalId = current.external_id ?? undefined
    let active = current.status === 'active'

    for (const operation of operations) {
      const op = String(operation.op ?? '').toLowerCase()
      const path = operation.path === undefined ? '' : String(operation.path)
      const value = operation.value
      const key = path.toLowerCase()

      if (op === 'remove' && (key === '' || key === 'active')) {
        return scimError(c, 400, 'a user is deactivated with `replace` on `active`, or removed with DELETE')
      }
      if (key === 'active') {
        if (typeof value !== 'boolean') return scimError(c, 400, '`active` is true or false')
        active = value
      } else if (key === 'name.formatted' || key === 'displayname') {
        if (typeof value !== 'string' || !value.trim()) return scimError(c, 400, '`name.formatted` must be a name')
        name = value.trim()
      } else if (key === 'name' && value && typeof value === 'object') {
        // Some IdPs send the whole object rather than a sub-attribute.
        const formatted = (value as Record<string, unknown>).formatted
        const given = (value as Record<string, unknown>).givenName
        const family = (value as Record<string, unknown>).familyName
        const resolved =
          typeof formatted === 'string' && formatted.trim()
            ? formatted.trim()
            : [given, family].filter((part): part is string => typeof part === 'string' && Boolean(part.trim())).join(' ').trim()
        if (resolved) name = resolved
      } else if (key === 'username') {
        if (typeof value !== 'string' || !value.includes('@')) return scimError(c, 400, '`userName` must be an address')
        const clash = await findUserByEmail(door.db, value)
        if (clash && clash.id !== id) return scimError(c, 409, `userName already exists; it is the id of ${clash.id}`)
        email = value.trim()
      } else if (key === 'externalid') {
        if (typeof value !== 'string') return scimError(c, 400, '`externalId` must be a string')
        externalId = value || undefined
      } else if (op === 'add' && key === '') {
        // `{ op: 'add', value: { active: false } }` — the whole object, no path.
        if (value && typeof value === 'object') {
          const whole = value as Record<string, unknown>
          if (typeof whole.active === 'boolean') active = whole.active
        }
      } else {
        return scimError(c, 400, `this server cannot patch \`${path || '(no path)'}\``)
      }
    }

    await door.db.batch([
      {
        sql: 'UPDATE users SET name = ?1, email = ?2, external_id = ?3, status = ?4, updated_at = ?5 WHERE id = ?6',
        params: [name, email.toLowerCase(), externalId ?? null, active ? 'active' : 'inactive', nowIso(), id],
      },
      ...(active ? [] : [{ sql: 'UPDATE sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL', params: [nowIso(), id] }]),
      statement({
        action: 'scim.user.update',
        targetType: 'user',
        targetId: id,
        // The act that matters to an administrator reading the trail later.
        data: { token: door.token.id, active, ...(active ? {} : { deactivated: true }) },
      }),
    ])

    return c.json(userResource((await findUser(door.db, id))!, baseOf(c)))
  })

  /**
   * Removal — the irreversible one. It is the app's own delete (the account goes, `group_members` and
   * sessions with it) and the workspace's `people` rows stay, so every card that named them reads
   * "Former member" rather than losing its history.
   */
  routes.delete('/Users/:id', async (c) => {
    const door = await requireScim(c, runtime)
    if (door instanceof Response) return door
    const id = c.req.param('id') ?? ''
    const row = await findUser(door.db, id)
    // A second DELETE is 404 — the RFC's answer, and not an error worth failing a sync over.
    if (!row) return scimError(c, 404, 'no such user')

    await door.db.batch([
      { sql: 'DELETE FROM users WHERE id = ?1', params: [id] },
      statement({ action: 'scim.user.delete', targetType: 'user', targetId: id, data: { token: door.token.id, email: row.email } }),
    ])
    return c.body(null, 204)
  })

  /* ---- Groups (R5) ---------------------------------------------------------------------- */

  const groupOf = (db: Database, id: string) =>
    db.get<GroupRow>('SELECT id, name, description, active, created_at FROM groups WHERE id = ?1', [id])

  routes.get('/Groups', async (c) => {
    const door = await requireScim(c, runtime)
    if (door instanceof Response) return door
    const filter = parseFilter(c.req.query('filter'))
    if (filter === 'invalid') return scimError(c, 400, 'this server filters groups on displayName, with `eq`')

    let rows = await door.db.all<GroupRow>('SELECT id, name, description, active, created_at FROM groups ORDER BY lower(name)')
    if (filter && filter.attribute === 'displayName') {
      rows = rows.filter((row) => row.name.toLowerCase() === filter.value.toLowerCase())
    } else if (filter) {
      return scimError(c, 400, 'groups filter on displayName')
    }

    const { startIndex, count } = paging(c)
    const slice = rows.slice(startIndex - 1, startIndex - 1 + count)
    const base = baseOf(c)
    const resources = []
    for (const row of slice) resources.push(await groupResource(door.db, row, base))
    return c.json(listResponse(resources, rows.length, startIndex))
  })

  routes.post('/Groups', async (c) => {
    const door = await requireScim(c, runtime)
    if (door instanceof Response) return door
    const body = (await c.req.json().catch(() => null)) as { displayName?: unknown; description?: unknown; members?: unknown } | null
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''
    if (!displayName) return scimError(c, 400, '`displayName` is required')

    const clash = await door.db.get<{ id: string }>('SELECT id FROM groups WHERE lower(name) = lower(?1)', [displayName])
    if (clash) return scimError(c, 409, `a group named “${displayName}” already exists; it is the id of ${clash.id}`)

    const id = `g_${randomToken(9)}`
    const members = Array.isArray(body?.members) ? body.members : []
    const statements: Statement[] = [
      {
        sql: 'INSERT INTO groups (id, name, description, active, created_by) VALUES (?1, ?2, ?3, 1, NULL)',
        params: [id, displayName, typeof body?.description === 'string' ? body.description : null],
      },
    ]
    for (const member of members) {
      const userId = memberId(member)
      if (!userId) continue
      if (!(await door.db.get('SELECT 1 AS seen FROM users WHERE id = ?1', [userId]))) {
        return scimError(c, 400, `member ${userId} is not a person on this instance`)
      }
      statements.push({
        sql: 'INSERT OR IGNORE INTO group_members (group_id, user_id, added_by) VALUES (?1, ?2, NULL)',
        params: [id, userId],
      })
    }
    statements.push(statement({ action: 'scim.group.create', targetType: 'group', targetId: id, data: { token: door.token.id, name: displayName } }))
    await door.db.batch(statements)

    return c.json(await groupResource(door.db, (await groupOf(door.db, id))!, baseOf(c)), 201, { Location: `${baseOf(c)}/Groups/${id}` })
  })

  routes.get('/Groups/:id', async (c) => {
    const door = await requireScim(c, runtime)
    if (door instanceof Response) return door
    const row = await groupOf(door.db, c.req.param('id') ?? '')
    if (!row) return scimError(c, 404, 'no such group')
    return c.json(await groupResource(door.db, row, baseOf(c)))
  })

  /** `PUT` replaces the group's name and its membership — the two things SCIM may decide. */
  routes.put('/Groups/:id', async (c) => {
    const door = await requireScim(c, runtime)
    if (door instanceof Response) return door
    const id = c.req.param('id') ?? ''
    const row = await groupOf(door.db, id)
    if (!row) return scimError(c, 404, 'no such group')

    const body = (await c.req.json().catch(() => null)) as { displayName?: unknown; description?: unknown; members?: unknown } | null
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''
    if (!displayName) return scimError(c, 400, '`displayName` is required')

    const members = Array.isArray(body?.members) ? body.members.map(memberId).filter((value): value is string => Boolean(value)) : []
    const known = await door.db.all<{ id: string }>('SELECT id FROM users')
    const missing = members.find((member) => !known.some((user) => user.id === member))
    if (missing) return scimError(c, 400, `member ${missing} is not a person on this instance`)

    await door.db.batch([
      { sql: 'UPDATE groups SET name = ?1, description = ?2 WHERE id = ?3', params: [displayName, typeof body?.description === 'string' ? body.description : null, id] },
      { sql: 'DELETE FROM group_members WHERE group_id = ?1', params: [id] },
      ...members.map((member) => ({
        sql: 'INSERT OR IGNORE INTO group_members (group_id, user_id, added_by) VALUES (?1, ?2, NULL)',
        params: [id, member],
      })),
      statement({ action: 'scim.group.update', targetType: 'group', targetId: id, data: { token: door.token.id, members: members.length } }),
    ])

    return c.json(await groupResource(door.db, (await groupOf(door.db, id))!, baseOf(c)))
  })

  /**
   * Membership by patch: `add`/`remove`/`replace` on `members`.
   *
   * A group carries authority only when an administrator granted it a role in the app, so adding
   * somebody here cannot make them anything they were not. That is the line R5 draws, and it is why
   * this route has no role field to set.
   */
  routes.patch('/Groups/:id', async (c) => {
    const door = await requireScim(c, runtime)
    if (door instanceof Response) return door
    const id = c.req.param('id') ?? ''
    const row = await groupOf(door.db, id)
    if (!row) return scimError(c, 404, 'no such group')

    const body = (await c.req.json().catch(() => null)) as { Operations?: unknown; operations?: unknown } | null
    const operations = (body?.Operations ?? body?.operations) as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(operations)) return scimError(c, 400, 'a PATCH body is `{ Operations: [{ op, path, value }] }`')

    const statements: Statement[] = []
    let renamed: string | undefined
    for (const operation of operations) {
      const op = String(operation.op ?? '').toLowerCase()
      const path = operation.path === undefined ? '' : String(operation.path)
      const key = path.toLowerCase()

      if (key === 'displayname') {
        if (typeof operation.value !== 'string' || !operation.value.trim()) return scimError(c, 400, '`displayName` must be a name')
        renamed = operation.value.trim()
        statements.push({ sql: 'UPDATE groups SET name = ?1 WHERE id = ?2', params: [renamed, id] })
        continue
      }
      if (key !== 'members' && key !== '') return scimError(c, 400, `this server cannot patch \`${path}\``)

      const values = op === 'remove' ? (Array.isArray(operation.value) ? operation.value : [operation.value]) : (Array.isArray(operation.value) ? operation.value : [operation.value])
      const ids = values.map(memberId).filter((value): value is string => Boolean(value))
      if (op === 'replace' && key === 'members') statements.push({ sql: 'DELETE FROM group_members WHERE group_id = ?1', params: [id] })
      for (const member of ids) {
        if (op === 'remove') {
          statements.push({ sql: 'DELETE FROM group_members WHERE group_id = ?1 AND user_id = ?2', params: [id, member] })
        } else {
          if (!(await door.db.get('SELECT 1 AS seen FROM users WHERE id = ?1', [member]))) {
            return scimError(c, 400, `member ${member} is not a person on this instance`)
          }
          statements.push({ sql: 'INSERT OR IGNORE INTO group_members (group_id, user_id, added_by) VALUES (?1, ?2, NULL)', params: [id, member] })
        }
      }
    }

    statements.push(statement({ action: 'scim.group.update', targetType: 'group', targetId: id, data: { token: door.token.id } }))
    await door.db.batch(statements)
    return c.json(await groupResource(door.db, (await groupOf(door.db, id))!, baseOf(c)))
  })

  routes.delete('/Groups/:id', async (c) => {
    const door = await requireScim(c, runtime)
    if (door instanceof Response) return door
    const id = c.req.param('id') ?? ''
    const row = await groupOf(door.db, id)
    if (!row) return scimError(c, 404, 'no such group')
    await door.db.batch([
      { sql: 'DELETE FROM groups WHERE id = ?1', params: [id] },
      statement({ action: 'scim.group.delete', targetType: 'group', targetId: id, data: { token: door.token.id, name: row.name } }),
    ])
    return c.body(null, 204)
  })

  return routes
}

/** A member is `{ value: "<user id>" }` in the RFC, and a bare string is tolerated because IdPs send both. */
function memberId(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined
  if (value && typeof value === 'object') {
    const id = (value as Record<string, unknown>).value
    return typeof id === 'string' && id ? id : undefined
  }
  return undefined
}

/* ---- Minting the token (R1) ---------------------------------------------------------------- */

/**
 * Admin's own routes: list, mint, revoke.
 *
 * Only an **instance administrator** may mint one, because the token is a door into the deployment.
 * The role it carries is a workspace role; an instance role is not on offer, which is why there is no
 * field for it.
 */
export function scimAdminRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  routes.get('/tokens', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller
    return c.json({ tokens: (await scimTokensOf(caller.db)).map(publicScimToken) })
  })

  routes.post('/tokens', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller

    const body = (await c.req.json().catch(() => null)) as { name?: unknown; defaultRole?: unknown } | null
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) return c.json({ error: 'give the token a name, so two directories can be told apart' }, 422)
    const role = (typeof body?.defaultRole === 'string' ? body.defaultRole : 'editor') as Role
    if (!SCIM_ROLES.includes(role)) {
      return c.json({ error: 'the default role is viewer, editor or admin — a workspace role, never an instance one' }, 422)
    }

    const { secret, token } = await mintScimToken(caller.db, { name, defaultRole: role, mintedBy: caller.user.id })
    await caller.db.run(
      ...auditStatement({
        actorId: caller.user.id,
        action: 'scim.token.create',
        targetType: 'user',
        targetId: caller.user.id,
        data: { token: token.id, name, defaultRole: role },
      }),
    )
    return c.json({ token: publicScimToken(token), secret }, 201)
  })

  routes.delete('/tokens/:id', async (c) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller
    const id = c.req.param('id') ?? ''
    const revoked = await revokeScimToken(caller.db, id)
    if (revoked === 0) return c.json({ error: 'no such token' }, 404)
    await caller.db.run(
      ...auditStatement({
        actorId: caller.user.id,
        action: 'scim.token.revoke',
        targetType: 'user',
        targetId: caller.user.id,
        data: { token: id },
      }),
    )
    return c.json({ revoked })
  })

  return routes
}

function auditStatement(event: Parameters<typeof statement>[0]): [string, unknown[]] {
  const { sql, params } = statement(event)
  return [sql, params ?? []]
}
