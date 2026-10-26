/**
 * `/api/v1`, through the routes (task 169).
 *
 * The tests a script's author would want: a token is the only door; the scope is the ceiling and the
 * role is the wall behind it; a move goes through the domain and refuses in the domain's words; a
 * stale revision is answered with the truth; an idempotency key lands once; and the document names
 * every route that is mounted.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { writeWorkspace } from './workspace/write'
import type { Workspace } from './workspace/types'
import type { Board, Item, Lane, Placement } from '../src/domain/types'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

function database(): Database {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

const lane = (id: string, stage: Lane['stage'], extra: Partial<Lane> = {}): Lane => ({
  id,
  boardId: 'b-1',
  parentId: null,
  order: 0,
  name: id,
  workflow: 'cards',
  ...(stage ? { stage } : {}),
  ...extra,
})

const item = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  title: `Card ${id}`,
  typeId: 't-card',
  createdAt: 1_700_000_000_000,
  rev: 1,
  ...extra,
})

const place = (itemId: string, laneId: string, rank = 0): Placement => ({
  id: `p-${itemId}`,
  boardId: 'b-1',
  itemId,
  laneId,
  laneEnteredAt: 1_700_000_000_000,
  rank,
})

/** A workspace with a board, its four stages, a WIP-limited Done, and three cards. */
function seeded(): Workspace {
  const board: Board = { id: 'b-1', name: 'Atlas', band: 'team', description: 'A board.' }
  const lanes = [
    lane('l-backlog', 'backlog', { order: 0 }),
    lane('l-doing', 'inProgress', { order: 1 }),
    lane('l-done', 'done', { order: 2, wipLimit: 1 }),
    // The initiatives workflow: one section with one cell, which is what makes an initiative
    // placeable at all.
    lane('l-sec-backlog', 'backlog', { order: 0, workflow: 'initiatives', name: 'Backlog (initiatives)' }),
    lane('l-cell-backlog', 'backlog', { order: 0, workflow: 'initiatives', parentId: 'l-sec-backlog', name: 'Uncommitted' }),
  ]
  const items = [item('i-1'), item('i-2'), item('i-3')]
  return {
    meUserId: 'u-admin',
    boardId: 'b-1',
    users: [],
    issueTypes: [
      { id: 't-card', name: 'Card', color: '#0ea5e9' },
      { id: 't-init', name: 'Initiative', color: '#8b5cf6' },
    ],
    boards: [board],
    lanes,
    items,
    placements: [place('i-1', 'l-backlog', 0), place('i-2', 'l-backlog', 1), place('i-3', 'l-doing', 0)],
    edges: [],
    links: [],
    objectives: [],
    keyResults: [],
    boardTemplates: [],
    savedFilters: [],
    collapsedLanes: {},
  }
}

const cookieOf = (response: Response) =>
  `fl_session=${(response.headers.get('set-cookie') ?? '').match(/fl_session=([^;]+)/)?.[1] ?? ''}`

type Init = RequestInit & { bearer?: string }

async function world(env: Record<string, string> = {}, options: { empty?: boolean } = {}) {
  const db = database()
  await writeWorkspace(db, options.empty ? { ...seeded(), boards: [], lanes: [], items: [], placements: [] } : seeded(), 'workspace')
  await db.run('UPDATE instance_settings SET allowed_domains = ?1', [JSON.stringify(['example.com'])])

  const app = createApp({ database: () => db, clientIp: () => '203.0.113.9' })
  const request = (path: string, init: Init = {}) => {
    const { bearer, ...rest } = init
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(rest.headers as Record<string, string>) }
    if (bearer) headers.authorization = `Bearer ${bearer}`
    return app.request(path, { ...rest, headers }, { AUTH_DEV: '1', ...env })
  }

  const signIn = async (email: string, role: 'viewer' | 'editor' | 'admin' | 'instance' = 'editor') => {
    const response = await request('/api/auth/dev', { method: 'POST', body: JSON.stringify({ email }) })
    if (response.status !== 200) throw new Error(`sign-in refused: ${response.status}`)
    const person = (await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?1', [email]))!
    if (role === 'instance') {
      await db.run("UPDATE instance_members SET role = 'admin' WHERE user_id = ?1", [person.id])
      await db.run('DELETE FROM workspace_members WHERE user_id = ?1', [person.id])
    } else {
      await db.run(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('workspace', ?1, ?2)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`,
        [person.id, role],
      )
    }
    const cookie = cookieOf(response)
    const call = (path: string, init: Init = {}) => request(path, { ...init, headers: { cookie, ...(init.headers as Record<string, string>) } })
    return { id: person.id, cookie, call }
  }

  /** Mint a token through the real route, and answer a caller that uses only it. */
  const token = async (
    person: { call: (path: string, init?: Init) => Response | Promise<Response> },
    scopes: string[],
    name = 'script',
  ) => {
    const response = await person.call('/api/tokens', { method: 'POST', body: JSON.stringify({ name, scopes }) })
    if (response.status !== 201) throw new Error(`mint refused: ${response.status} ${await response.text()}`)
    const { secret, token: row } = (await response.json()) as { secret: string; token: { id: string } }
    const call = (path: string, init: Init = {}) => request(`/api/v1${path}`, { ...init, bearer: secret })
    return { secret, id: row.id, call }
  }

  return { db, request, signIn, token }
}

const body = (value: unknown) => JSON.stringify(value)

describe('the door', () => {
  it('refuses a session cookie, and says what to use instead', async () => {
    const { signIn } = await world()
    const person = await signIn('editor@example.com', 'editor')

    // The app's own credential, pointed at the supported surface: it is not a token and has no
    // scopes, so it is refused rather than quietly trusted.
    const answer = await person.call('/api/v1/boards')
    expect(answer.status).toBe(401)
    const error = (await answer.json()) as { error: { code: string; message: string } }
    expect(error.error.code).toBe('token_required')
    expect(error.error.message).toContain('Authorization: Bearer')
  })

  it('refuses a credential past its scope, and names the scope it needed', async () => {
    const { signIn, token } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const reader = await token(person, ['boards:read', 'items:read', 'items:write'], 'reader')
    // A read-only credential: `items:write` would be needed to move, so this one has neither the
    // scope nor the right to ask.
    const readOnly = await token(person, ['boards:read'], 'read only')

    expect((await reader.call('/boards')).status).toBe(200)

    const moved = await readOnly.call('/boards/b-1/items/i-1/move', {
      method: 'POST',
      body: body({ laneId: 'l-doing' }),
    })
    expect(moved.status).toBe(403)
    const error = (await moved.json()) as { error: { code: string; details: { scope: string } } }
    expect(error.error.code).toBe('scope_required')
    expect(error.error.details.scope).toBe('items:write')
  })

  it('is bound by the owner’s role as well as its scopes', async () => {
    const { signIn, token, db } = await world()
    const person = await signIn('person@example.com', 'editor')
    const writer = await token(person, ['items:write', 'boards:read'], 'writer')

    expect((await writer.call('/boards/b-1/items/i-1/move', { method: 'POST', body: body({ laneId: 'l-doing' }) })).status).toBe(200)

    // Demoted. Nothing is revoked: the role is read per request, so the next write is refused and
    // the sentence is the role's, not the scope's.
    await db.run("UPDATE workspace_members SET role = 'viewer' WHERE user_id = ?1", [person.id])
    const after = await writer.call('/boards/b-1/items/i-1/move', { method: 'POST', body: body({ laneId: 'l-backlog' }) })
    expect(after.status).toBe(403)
    expect(((await after.json()) as { error: { code: string } }).error.code).toBe('role_forbidden')
  })
})

describe('reading', () => {
  it('lists boards and one board with its trees and what is in it', async () => {
    const { signIn, token } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const reader = await token(person, ['boards:read'], 'reader')

    const boards = (await (await reader.call('/boards')).json()) as { data: Array<{ id: string; name: string }> }
    expect(boards.data.map((b) => b.name)).toEqual(['Atlas'])

    const board = (await (await reader.call('/boards/b-1')).json()) as {
      board: { id: string }
      workflows: { cards: Array<{ id: string; children?: unknown[] }>; initiatives: unknown[] }
      placements: Array<{ itemId: string; laneId: string }>
      items: Array<{ id: string; laneId: string }>
    }
    expect(board.board.id).toBe('b-1')
    expect(board.workflows.cards.map((lane) => lane.id)).toEqual(['l-backlog', 'l-doing', 'l-done'])
    // The two trees are independent: the initiatives one holds the section, with its one cell.
    expect(board.workflows.initiatives).toHaveLength(1)
    expect((board.workflows.initiatives[0] as { id: string; children?: Array<{ id: string }> }).children?.map((lane) => lane.id)).toEqual(['l-cell-backlog'])
    expect(board.items.find((i) => i.id === 'i-1')?.laneId).toBe('l-backlog')
  })

  it('pages, and filters by `updatedSince`', async () => {
    const { signIn, token, db } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const reader = await token(person, ['items:read', 'boards:read'], 'reader')

    const first = (await (await reader.call('/items?limit=2')).json()) as { data: Array<{ id: string }>; nextCursor: string | null }
    expect(first.data.map((i) => i.id)).toEqual(['i-1', 'i-2'])
    expect(first.nextCursor).toBeTruthy()

    const second = (await (await reader.call(`/items?limit=2&cursor=${first.nextCursor}`)).json()) as { data: Array<{ id: string }> }
    expect(second.data.map((i) => i.id)).toEqual(['i-3'])

    // A client reads, notes the time, then asks what changed after it. The seed wrote its own
    // `changes` rows, so the baseline is "now", not "a minute ago".
    const baseline = new Date().toISOString()
    await new Promise((resolve) => setTimeout(resolve, 5))
    await db.run("INSERT INTO changes (item_id, rev) VALUES ('i-2', 2)")

    const changed = (await (await reader.call(`/items?updatedSince=${encodeURIComponent(baseline)}`)).json()) as {
      data: Array<{ id: string }>
    }
    expect(changed.data.map((i) => i.id)).toEqual(['i-2'])
    const future = new Date(Date.now() + 60_000).toISOString()
    const none = (await (await reader.call(`/items?updatedSince=${encodeURIComponent(future)}`)).json()) as { data: unknown[] }
    expect(none.data).toEqual([])

    // A query language is not offered; the app's own search is.
    const searched = (await (await reader.call('/search?q=card%20i-3')).json()) as { data: Array<{ id: string }> }
    expect(searched.data.map((i) => i.id)).toEqual(['i-3'])
  })
})

describe('writing', () => {
  it('creates a card, places it, and answers with the revision to base the next write on', async () => {
    const { signIn, token, db } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const writer = await token(person, ['items:write', 'boards:read'], 'writer')

    const created = await writer.call('/items', {
      method: 'POST',
      body: body({ boardId: 'b-1', title: 'From a script', typeId: 't-card', priority: 'high' }),
    })
    expect(created.status).toBe(201)
    const { item: made } = (await created.json()) as { item: { id: string; laneId: string; rev: number } }
    expect(made.laneId).toBe('l-backlog')
    expect(made.rev).toBe(1)

    // It is really there — the row, the placement, and the history.
    expect(await db.get('SELECT title FROM items WHERE id = ?1', [made.id])).toEqual({ title: 'From a script' })
    expect(await db.get('SELECT lane_id FROM placements WHERE item_id = ?1', [made.id])).toEqual({ lane_id: 'l-backlog' })
    expect(await db.get<{ kind: string }>('SELECT kind FROM item_log WHERE item_id = ?1', [made.id])).toEqual({ kind: 'created' })
  })

  it('answers a repeated idempotency key from what it already wrote', async () => {
    const { signIn, token, db } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const writer = await token(person, ['items:write'], 'writer')

    const once = await writer.call('/items', {
      method: 'POST',
      headers: { 'idempotency-key': 'create-1' },
      body: body({ boardId: 'b-1', title: 'Once', typeId: 't-card' }),
    })
    expect(once.status).toBe(201)
    const first = (await once.json()) as { item: { id: string } }

    const twice = await writer.call('/items', {
      method: 'POST',
      headers: { 'idempotency-key': 'create-1' },
      body: body({ boardId: 'b-1', title: 'Once', typeId: 't-card' }),
    })
    expect(twice.status).toBe(200)
    expect(((await twice.json()) as { item: { id: string } }).item.id).toBe(first.item.id)
    expect(await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE title = 'Once'")).toEqual({ n: 1 })
  })

  it('refuses a stale revision with the item, so a script can retry from the truth', async () => {
    const { signIn, token } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const writer = await token(person, ['items:write'], 'writer')

    const first = await writer.call('/items/i-1', { method: 'PATCH', body: body({ baseRev: 1, title: 'First' }) })
    expect(first.status).toBe(200)
    expect(((await first.json()) as { item: { rev: number } }).item.rev).toBe(2)

    const stale = await writer.call('/items/i-1', { method: 'PATCH', body: body({ baseRev: 1, title: 'Second' }) })
    expect(stale.status).toBe(409)
    const error = (await stale.json()) as { error: { code: string; details: { item: { title: string; rev: number } } } }
    expect(error.error.code).toBe('stale')
    expect(error.error.details.item).toMatchObject({ title: 'First', rev: 2 })
  })

  it('places an initiative in its own workflow, and knows nothing of an estimate', async () => {
    const { signIn, token } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const writer = await token(person, ['items:write', 'boards:read'], 'writer')

    const created = await writer.call('/items', {
      method: 'POST',
      body: body({ boardId: 'b-1', title: 'An outcome', typeId: 't-init', laneId: 'l-backlog' }),
    })
    // An initiative in a card lane is the wrong workflow.
    expect(created.status).toBe(422)
    expect(((await created.json()) as { error: { code: string } }).error.code).toBe('wrong_workflow')

    // In its own workflow it is welcome…
    const placed = await writer.call('/items', {
      method: 'POST',
      body: body({ boardId: 'b-1', title: 'An outcome', typeId: 't-init', laneId: 'l-cell-backlog' }),
    })
    expect(placed.status).toBe(201)

    // The board stopped counting points, so `size` is not a field a client can send — and the
    // server says so rather than dropping a number the client believes it set.
    const sized = await writer.call('/items', {
      method: 'POST',
      body: body({ boardId: 'b-1', title: 'Another outcome', typeId: 't-init', laneId: 'l-cell-backlog', size: 8 }),
    })
    expect(sized.status).toBe(422)
    expect(((await sized.json()) as { error: { code: string; message: string } }).error.message).toContain('counts issues, not points')
  })
})

describe('a move is the domain’s move', () => {
  it('refuses under `block` with the limit, and lands under `justify` with a reason', async () => {
    const { signIn, token, db } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const writer = await token(person, ['items:write'], 'writer')
    // Done holds one card and its limit is one, which is what makes the move a breach.
    await db.run("UPDATE placements SET lane_id = 'l-done' WHERE item_id = 'i-3'")
    await db.run("UPDATE boards SET wip_enforcement = 'block' WHERE id = 'b-1'")

    const blocked = await writer.call('/boards/b-1/items/i-1/move', { method: 'POST', body: body({ laneId: 'l-done' }) })
    // One card is already in Done, whose limit is one.
    expect(blocked.status).toBe(422)
    const refusal = (await blocked.json()) as { error: { code: string; message: string; details: { limit: number } } }
    expect(refusal.error.code).toBe('wip_blocked')
    expect(refusal.error.message).toContain('at its limit of 1')
    expect(refusal.error.details.limit).toBe(1)

    // `justify` holds the same move until a reason arrives — and then it is on the card.
    await db.run("UPDATE boards SET wip_enforcement = 'justify' WHERE id = 'b-1'")
    const held = await writer.call('/boards/b-1/items/i-1/move', { method: 'POST', body: body({ laneId: 'l-done' }) })
    expect(held.status).toBe(422)
    expect(((await held.json()) as { error: { code: string } }).error.code).toBe('reason_required')

    const landed = await writer.call('/boards/b-1/items/i-1/move', {
      method: 'POST',
      body: body({ laneId: 'l-done', reason: 'Signed off' }),
    })
    expect(landed.status).toBe(200)
    expect(((await landed.json()) as { justified: boolean }).justified).toBe(true)
    expect(await db.get('SELECT lane_id FROM placements WHERE item_id = ?1', ['i-1'])).toEqual({ lane_id: 'l-done' })

    const card = await db.get<{ last_move_reason: string }>('SELECT last_move_reason FROM items WHERE id = ?1', ['i-1'])
    expect(card).toEqual({ last_move_reason: 'Signed off' })
    const kinds = await db.all<{ kind: string }>('SELECT kind FROM item_log WHERE item_id = ?1', ['i-1'])
    // Both were recorded: the overrun explains the limit, and the journey says where it went. They
    // share a millisecond, so the stored order is the row id's — the *set* is what a script reads.
    expect(kinds.map((row) => row.kind).sort()).toEqual(['limit', 'moved'])
  })

  it('places a card at the index it was given', async () => {
    const { signIn, token, db } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const writer = await token(person, ['items:write'], 'writer')

    const moved = await writer.call('/boards/b-1/items/i-3/move', { method: 'POST', body: body({ laneId: 'l-backlog', index: 0 }) })
    expect(moved.status).toBe(200)
    const order = await db.all<{ item_id: string }>(
      "SELECT item_id FROM placements WHERE lane_id = 'l-backlog' ORDER BY rank, item_id",
    )
    expect(order.map((row) => row.item_id)).toEqual(['i-3', 'i-1', 'i-2'])
  })

  it('is the same operation the app calls, not a second placement write', () => {
    // R1's structural half: the operations module imports the domain rule, and the store imports the
    // same one. A second implementation would have to be written somewhere, and there is nowhere for
    // it to hide — a placement write in the operations or route file would be one. (The writer in
    // `workspace/write.ts` is the only place arrangement is stored.)
    const operations = readFileSync(new URL('./operations.ts', import.meta.url), 'utf8')
    const routes = readFileSync(new URL('./v1/routes.ts', import.meta.url), 'utf8')
    const store = readFileSync(new URL('../src/store.ts', import.meta.url), 'utf8')
    expect(operations).toContain("from '../src/domain/move'")
    expect(store).toContain("from '@/domain/move'")
    for (const source of [routes, operations]) {
      expect(source).not.toMatch(/UPDATE\s+placements/i)
      expect(source).not.toMatch(/INSERT\s+INTO\s+placements/i)
    }
  })
})

describe('the answers a client depends on', () => {
  it('puts the rate-limit headers on success and refusal, and answers 429 when spent', async () => {
    const { signIn, token } = await world({ API_RATE_LIMIT: '3' })
    const person = await signIn('editor@example.com', 'editor')
    const reader = await token(person, ['boards:read'], 'reader')

    const ok = await reader.call('/boards')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('ratelimit-limit')).toBe('3')
    expect(ok.headers.get('ratelimit-remaining')).toBe('2')

    await reader.call('/boards')
    await reader.call('/boards')
    const over = await reader.call('/boards')
    expect(over.status).toBe(429)
    expect(over.headers.get('ratelimit-remaining')).toBe('0')
    expect(over.headers.get('ratelimit-reset')).toBeTruthy()
    const error = (await over.json()) as { error: { code: string; details: { retryAfter: number } } }
    expect(error.error.code).toBe('rate_limited')
    expect(error.error.details.retryAfter).toBeGreaterThan(0)
  })

  it('serves a document that names every mounted route, and no route it does not mount', async () => {
    const { request } = await world()
    const document = (await (await request('/api/v1/openapi.json')).json()) as {
      openapi: string
      paths: Record<string, Record<string, unknown>>
    }
    expect(document.openapi).toBe('3.1.0')

    const documented = new Set<string>()
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const method of Object.keys(methods)) documented.add(`${method.toUpperCase()} ${path}`)
    }

    // What is actually mounted, from Hono's own routing table.
    const app = createApp({ database: () => database(), clientIp: () => '203.0.113.9' })
    const mounted = new Set(
      app.routes
        // `ALL /*` is the header middleware, not a route a client calls.
        .filter((route) => route.method !== 'ALL' && route.path.startsWith('/api/v1/'))
        .map((route) => `${route.method} ${route.path.slice('/api/v1'.length)}`),
    )

    expect([...mounted].sort()).toEqual([...documented].sort())
  })

  it('writes the trail as the token’s owner, and names the token', async () => {
    const { signIn, token, db } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const writer = await token(person, ['items:write'], 'writer')

    await writer.call('/items/i-1', { method: 'PATCH', body: body({ baseRev: 1, title: 'Audited' }) })
    const entry = await db.get<{ actor_id: string; action: string; data: string }>(
      "SELECT actor_id, action, data FROM audit_events WHERE action = 'api.write' ORDER BY at DESC LIMIT 1",
    )
    expect(entry?.actor_id).toBe(person.id)
    expect(entry?.data).toContain(writer.id)
    expect(entry?.data).toContain('item.update')
  })
})

describe('the worked script', () => {
  it('does what the documented Node script does, end to end', async () => {
    // The calls in `docs/rest-api.md`'s second script, in the order it makes them: find the board by
    // name, file a card per line with a key of its own, then move what was filed. A test that only
    // read the page would not have caught the day the page stopped working.
    const { signIn, token } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const writer = await token(person, ['boards:read', 'items:read', 'items:write'], 'script')

    const boards = (await (await writer.call('/boards')).json()) as { data: Array<{ id: string; name: string }> }
    const board = boards.data.find((b) => b.name === 'Atlas')
    expect(board).toBeTruthy()

    const filed: string[] = []
    for (const line of ['Ship the export', 'Write the changelog']) {
      const answer = await writer.call('/items', {
        method: 'POST',
        headers: { 'idempotency-key': `file-${line}` },
        body: body({ boardId: board!.id, title: line, typeId: 't-card' }),
      })
      const payload = (await answer.json()) as { item?: { id: string; title: string }; error?: { code: string; message: string } }
      expect(answer.status, payload.error?.message).toBe(201)
      filed.push(payload.item!.id)
    }

    const items = (await (await writer.call(`/items?boardId=${board!.id}`)).json()) as { data: Array<{ id: string; title: string }> }
    expect(items.data.map((i) => i.title)).toEqual(expect.arrayContaining(['Ship the export', 'Write the changelog']))

    for (const id of filed) {
      const moved = await writer.call(`/boards/${board!.id}/items/${id}/move`, { method: 'POST', body: body({ laneId: 'l-doing' }) })
      const payload = (await moved.json()) as { placement?: { laneId: string }; error?: { code: string } }
      expect(moved.status, payload.error?.code).toBe(200)
      expect(payload.placement?.laneId).toBe('l-doing')
    }
  })
})

describe('the workspace file', () => {
  it('exports, and imports into a clean instance unchanged', async () => {
    const source = await world()
    const person = await source.signIn('editor@example.com', 'editor')
    const reader = await source.token(person, ['boards:read'], 'backup')
    const file = (await (await reader.call('/workspace')).json()) as { schema: number; boards: Board[]; items: Item[]; lanes: Lane[] }

    expect(file.schema).toBe(1)
    expect(file.boards.map((b) => b.name)).toEqual(['Atlas'])
    expect(file.items).toHaveLength(3)

    // A fresh instance, where a restore is allowed.
    const target = await world({}, { empty: true })
    const admin = await target.signIn('admin@example.com', 'admin')
    // Restore and read: `workspace:admin` is the import, and reading the result back is a board read.
    const writer = await target.token(admin, ['workspace:admin', 'boards:read'], 'restore')

    const imported = await writer.call('/workspace', { method: 'POST', body: JSON.stringify(file) })
    expect(imported.status).toBe(200)
    const after = (await (await writer.call('/workspace')).json()) as { boards: Board[]; items: Item[]; placements: Placement[] }
    expect(after.boards.map((b) => b.name)).toEqual(file.boards.map((b) => b.name))
    expect(after.items.map((i) => i.id).sort()).toEqual(file.items.map((i) => i.id).sort())
    expect(after.placements).toHaveLength(3)

    // And an instance with boards refuses rather than merging two half-workspaces.
    const again = await writer.call('/workspace', { method: 'POST', body: JSON.stringify(file) })
    expect(again.status).toBe(409)
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe('not_empty')
  })
})
