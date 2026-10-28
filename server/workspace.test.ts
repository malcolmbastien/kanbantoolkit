/**
 * The workspace schema and the read.
 *
 * The strong test is a round trip: a workspace goes in through the writer and comes back through
 * the endpoint, and the two are the same object. That is what "shaped exactly as `persistedSlice`"
 * means in practice — not that the columns look plausible, but that nothing is lost or renamed on
 * the way through.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { issueSession } from './auth/session'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { readWorkspace } from './workspace/read'
import { acquire, LEASE_MS, lockOf, release } from './workspace/locks'
import type { Board, Item, Lane } from '../src/domain/types'
import type { Workspace } from './workspace/types'
import { writeWorkspace } from './workspace/write'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

function database(): Database {
  const db = new DatabaseSync(':memory:')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

async function signedIn(db: Database, id = 'u-ada', member = true): Promise<{ cookie: string }> {
  await db.run('INSERT OR IGNORE INTO users (id, name, email) VALUES (?1, ?2, ?3)', [id, 'Ada', `${id}@example.com`])
  if (member) {
    // The two axes: the door, and the authority inside.
    await db.run('INSERT OR IGNORE INTO instance_members (user_id, role) VALUES (?1, ?2)', [id, 'admin'])
    await db.run('INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, ?3)', [
      'workspace',
      id,
      'admin',
    ])
  }
  const session = await issueSession(db, id)
  return { cookie: `fl_session=${session.token}` }
}

function instance(db: Database) {
  const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
  return (path: string, init?: RequestInit) => app.request(path, init, {})
}

/** A workspace that uses every table, most optional fields, and a tree three lanes deep. */
const workspace: Workspace = {
  users: [
    { id: 'u-ada', name: 'Ada' },
    { id: 'u-grace', name: 'Grace', avatarUrl: 'data:image/png;base64,AAAA' },
  ],
  issueTypes: [{ id: 't-card', name: 'Card', color: '#3b82f6' }],
  boards: [
    {
      id: 'b-atlas',
      name: 'Team Atlas',
      band: 'team',
      description: 'What we are doing, and why.',
      initiativeTypes: [{ id: 'k-bet', name: 'Bet', color: '#7c3aed' }],
      tags: [{ id: 'g-ux', name: 'UX', color: '#0ea5e9' }],
      linkedBoardIds: [],
      archived: false,
      defaultCardTypeId: 't-card',
      defaultDropLaneId: 'l-now',
      wipEnforcement: 'justify',
    },
    {
      id: 'b-port',
      name: 'Portfolio',
      band: 'portfolio',
      description: '',
      archived: true,
      archivedAt: 1_700_000_000_000,
    },
  ],
  lanes: [
    { id: 'l-start', boardId: 'b-atlas', parentId: null, order: 0, name: 'Not Started', workflow: 'cards', stage: 'notStarted' },
    {
      id: 'l-ready',
      boardId: 'b-atlas',
      parentId: 'l-start',
      order: 0,
      name: 'Ready',
      workflow: 'cards',
      orientation: 'columns',
      wipLimit: 2,
      description: 'Only work that is actually ready.',
    },
    { id: 'l-ready-named', boardId: 'b-atlas', parentId: 'l-ready', order: 0, name: 'Named', workflow: 'cards' },
    { id: 'l-now', boardId: 'b-atlas', parentId: null, order: 0, name: 'Now', workflow: 'initiatives', stage: 'inProgress' },
    { id: 'l-done', boardId: 'b-port', parentId: null, order: 0, name: 'Done', workflow: 'initiatives', stage: 'done' },
  ],
  items: [
    {
      id: 'i-signin',
      title: 'Sign in with a provider',
      description: 'One OIDC issuer, and no passwords.',
      typeId: 't-card',
      createdById: 'u-ada',
      initiativeTypeId: 'k-bet',
      tagIds: ['g-ux'],
      assignees: ['u-ada'],
      priority: 'high',
      targetStartDate: '2026-10-01',
      targetEndDate: '2026-10-31',
      createdAt: 1_700_000_000_000,
      rev: 4,
      lastMoveReason: 'pulled forward',
      blocked: true,
      blockedReason: 'waiting on legal',
      archived: false,
      archivedAt: 1_700_000_001_000,
      checklist: [
        { id: 'c-1', text: 'draft', done: true },
        { id: 'c-2', text: 'review', done: false },
      ],
      log: [
        { id: 'e-1', at: 1_700_000_000_000, kind: 'created', by: 'u-ada' },
        {
          id: 'e-2',
          at: 1_700_000_001_000,
          kind: 'moved',
          by: 'u-ada',
          note: 'Ready → Now',
          fromLaneId: 'l-ready-named',
          toLaneId: 'l-now',
          fromStage: 'notStarted',
          toStage: 'inProgress',
          boardId: 'b-atlas',
        },
      ],
    },
    { id: 'i-outcome', title: 'A portfolio outcome', typeId: 't-init', createdAt: 1_700_000_002_000 },
  ],
  placements: [
    { id: 'pl-1', boardId: 'b-atlas', itemId: 'i-signin', laneId: 'l-ready-named', laneEnteredAt: 1_700_000_001_000, rank: 2 },
    { id: 'pl-2', boardId: 'b-atlas', itemId: 'i-outcome', laneId: 'l-now' },
  ],
  edges: [
    { id: 'ed-1', kind: 'decomposition', from: 'i-outcome', to: 'i-signin' },
    { id: 'ed-2', kind: 'attribution', from: 'o-1', to: 'i-outcome' },
  ],
  links: [{ id: 'lk-1', from: 'i-outcome', to: 'i-signin', reason: 'needs it first' }],
  objectives: [
    { id: 'o-1', title: 'Ship the server', period: '2026-Q4', status: 'active' },
    { id: 'o-2', title: 'Grow', period: '2026-Q3', status: 'scored', score: 0.7 },
  ],
  keyResults: [{ id: 'kr-1', objectiveId: 'o-1', title: 'Two devices, one board' }],
  boardTemplates: [
    {
      id: 'bt-1',
      name: 'Standard team',
      band: 'team',
      defaultCardTypeId: 't-card',
      wipEnforcement: 'visualize',
      lanes: [
        { key: 'a', parentKey: null, order: 0, name: 'Backlog' },
        { key: 'b', parentKey: 'a', order: 0, name: 'Ready', orientation: 'rows', stage: 'notStarted', wipLimit: 3, description: 'Groomed.' },
      ],
    },
  ],
  autoArchiveDays: 30,
  savedFilters: [
    {
      id: 'f-1',
      name: 'Blocked and mine',
      boardId: 'b-atlas',
      filters: {
        text: 'acme',
        typeIds: ['t-card'],
        blocked: true,
        overdue: false,
        dueSoon: false,
        unassigned: false,
        assigneeIds: ['u-ada'],
        priorities: ['high'],
        tagIds: ['g-ux'],
        minAgeDays: 5,
        initiativeId: 'i-outcome',
      },
    },
  ],
  collapsedLanes: { 'l-now': true },
  boardId: 'b-atlas',
}

describe('the workspace', () => {
  it('comes back exactly as it went in', async () => {
    const db = database()
    await writeWorkspace(db, workspace, 'workspace')

    // Lanes are compared as a set: a lane carries its own `order`, and the order of the array it
    // happens to sit in is not part of the contract. Everything else keeps the order it was written
    // in, because for boards and for lists that order *is* the data.
    const read = await readWorkspace(db)
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)
    expect({ ...read, lanes: [...read.lanes].sort(byId) }).toEqual({
      ...workspace,
      lanes: [...workspace.lanes].sort(byId),
    })
  })

  it('is empty rather than broken when nothing has been written', async () => {
    const db = database()
    expect(await readWorkspace(db)).toEqual({
      boardId: '',
      savedFilters: [],
      collapsedLanes: {},
      users: [],
      issueTypes: [],
      items: [],
      edges: [],
      links: [],
      objectives: [],
      keyResults: [],
      boardTemplates: [],
      boards: [],
      lanes: [],
      placements: [],
    })
  })

  it('is handed back whole, in one request, to the person signed in', async () => {
    const db = database()
    await writeWorkspace(db, workspace, 'workspace')
    const request = instance(db)
    const { cookie } = await signedIn(db)

    const response = await request('/api/workspace', { headers: { cookie } })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Workspace & { meUserId: string }

    // The session answers "whose workspace", so the browser keeps no pointer of its own.
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)
    expect({ ...body, lanes: [...body.lanes].sort(byId) }).toEqual({
      ...workspace,
      schema: 1,
      meUserId: 'u-ada',
      // The write that put this workspace here was an import, so its design is the first one: a
      // client that adopts it knows which design its next write is based on.
      structureRev: 1,
      lanes: [...workspace.lanes].sort(byId),
    })
  })

  it('answers nobody who is not signed in', async () => {
    const db = database()
    const request = instance(db)
    expect((await request('/api/workspace')).status).toBe(401)
  })

  it('answers nobody who is signed in without a membership', async () => {
    const db = database()
    const request = instance(db)
    const { cookie } = await signedIn(db, 'u-stranger', false)
    expect((await request('/api/workspace', { headers: { cookie } })).status).toBe(403)
  })

  it('lets an instance administrator read a workspace they are not on', async () => {
    const db = database()
    const request = instance(db)
    await db.run("INSERT INTO users (id, name, email) VALUES ('u-admin', 'Ada', 'ada@example.com')")
    await db.run("INSERT INTO instance_members (user_id, role) VALUES ('u-admin', 'admin')")
    // Deliberately no workspace_members row: repairing a team you do not belong to is the point.
    const { cookie } = { cookie: `fl_session=${(await issueSession(db, 'u-admin')).token}` }

    const response = await request('/api/workspace', { headers: { cookie } })
    expect(response.status).toBe(200)
  })
})

describe('writing the board design', () => {
  const board = (over: Partial<Board> = {}): Board => ({
    id: 'b-new',
    name: 'A new board',
    band: 'team',
    description: '',
    ...over,
  })
  const lane = (over: Partial<Lane> = {}): Lane => ({
    id: 'l-backlog',
    boardId: 'b-new',
    parentId: null,
    order: 0,
    name: 'Backlog',
    workflow: 'cards',
    stage: 'backlog',
    ...over,
  })

  async function designer(role: 'admin' | 'editor' | 'viewer' = 'admin') {
    const db = database()
    await writeWorkspace(db, { ...workspace, boards: [], lanes: [], placements: [] }, 'workspace')
    const { cookie } = await signedIn(db)
    if (role !== 'admin') await db.run('UPDATE workspace_members SET role = ?1 WHERE user_id = ?2', [role, 'u-ada'])
    const request = instance(db)
    // The design the workspace was written with is its first: the next write says so.
    const rev = ((await (await request('/api/workspace', { headers: { cookie } })).json()) as { structureRev: number }).structureRev
    const put = (body: unknown, signed = true) =>
      request('/api/workspace/structure', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...(signed ? { cookie } : {}) },
        body: JSON.stringify(body),
      })
    return { db, request, put, cookie, rev }
  }

  it('writes a board, its lanes and a placement as one design, and answers the new revision', async () => {
    const { db, put, request, cookie, rev } = await designer()
    await db.run(
      "INSERT INTO items (id, workspace_id, title, type_id, created_at) VALUES ('i-card', 'workspace', 'A card', 't-card', 0)",
    )

    const response = await put({
      rev,
      design: { boards: [board()], lanes: [lane(), lane({ id: 'l-done', order: 1, name: 'Done', stage: 'done' })], placements: [{ id: 'p-1', boardId: 'b-new', itemId: 'i-card', laneId: 'l-backlog', rank: 0 }] },
    })
    expect(response.status).toBe(200)
    expect(((await response.json()) as { rev: number }).rev).toBe(rev + 1)

    // It is really there, and it reads back as a workspace.
    const body = (await (await request('/api/workspace', { headers: { cookie } })).json()) as Workspace & { structureRev: number }
    expect(body.boards.map((b) => b.id)).toEqual(['b-new'])
    expect(body.lanes.map((l) => l.name)).toEqual(['Backlog', 'Done'])
    expect(body.placements.map((p) => p.itemId)).toEqual(['i-card'])
    expect(body.structureRev).toBe(rev + 1)
  })

  it('refuses a design based on a revision that has moved, and says which one is there', async () => {
    const { put, rev } = await designer()
    await put({ rev, design: { boards: [board()], lanes: [lane()], placements: [] } })

    const stale = await put({ rev, design: { boards: [board({ name: 'Renamed' })], lanes: [lane()], placements: [] } })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ rev: rev + 1 })
  })

  it('skips a placement whose card the server has not met yet, and keeps the rest', async () => {
    const { put, rev } = await designer()
    const response = await put({
      rev,
      design: {
        boards: [board()],
        lanes: [lane()],
        placements: [{ id: 'p-late', boardId: 'b-new', itemId: 'i-not-here', laneId: 'l-backlog', rank: 0 }],
      },
    })
    expect(response.status).toBe(200)
    expect(((await response.json()) as { skipped: number }).skipped).toBe(1)
  })

  it('is a designer’s write: a viewer is refused, and nobody signed in is nobody', async () => {
    const { put, rev } = await designer('viewer')
    expect((await put({ rev, design: { boards: [board()], lanes: [lane()], placements: [] } })).status).toBe(403)

    const anonymous = await designer()
    expect((await anonymous.put({ rev: anonymous.rev, design: {} }, false)).status).toBe(401)
  })

  it('refuses a body that is not a design, or one without the revision it began from', async () => {
    const { put, rev } = await designer()
    expect((await put({ design: { boards: [], lanes: [], placements: [] } })).status).toBe(400)
    expect((await put({ rev, design: 'boards' })).status).toBe(400)
  })
})

describe('writing one item', () => {
  const card = (over: Partial<Item> = {}): Item => ({
    id: 'i-card',
    title: 'A card',
    typeId: 't-card',
    createdAt: 1_700_000_000_000,
    ...over,
  })

  async function writer() {
    const db = database()
    const { cookie } = await signedIn(db)
    const request = instance(db)
    const patch = (id: string, body: unknown, signed = true) =>
      request(`/api/workspace/items/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...(signed ? { cookie } : {}) },
        body: JSON.stringify(body),
      })
    return { db, request, patch, cookie }
  }

  it('creates an item based on nothing, and keeps the server\'s revision', async () => {
    const { request, patch, cookie } = await writer()

    // A field the server does not know is not a field it stores.
    const response = await patch('i-card', { baseRev: 0, item: { ...card(), extra: 'not a field' } })
    expect(response.status).toBe(200)
    const answer = (await response.json()) as { item: Item }
    expect(answer.item.rev).toBe(1)
    expect((answer.item as unknown as Record<string, unknown>).extra).toBeUndefined()

    const body = (await (await request('/api/workspace', { headers: { cookie } })).json()) as Workspace
    expect(body.items.map((entry) => entry.id)).toEqual(['i-card'])
  })

  it('creates an item the server has never seen, whatever revision the browser based it on', async () => {
    const { patch } = await writer()
    // A workspace that has lived only in a browser arrives with revisions of its own; nothing here
    // has moved past anything, so the first write is a creation.
    const response = await patch('i-card', { baseRev: 7, item: card({ rev: 7 }) })
    expect(response.status).toBe(200)
    expect(((await response.json()) as { item: Item }).item.rev).toBe(8)
  })

  it('updates an item with the revision it was based on', async () => {
    const { patch } = await writer()
    await patch('i-card', { baseRev: 0, item: card() })

    const response = await patch('i-card', { baseRev: 1, item: card({ title: 'Renamed', rev: 1 }) })
    expect(response.status).toBe(200)
    const answer = (await response.json()) as { item: Item }
    expect(answer.item.title).toBe('Renamed')
    expect(answer.item.rev).toBe(2)
  })

  it('refuses a write the workspace has moved past, and answers with what is there now', async () => {
    const { patch, request, cookie } = await writer()
    await patch('i-card', { baseRev: 0, item: card() })
    await patch('i-card', { baseRev: 1, item: card({ title: 'Theirs', rev: 1 }) })

    // A tab that still believes the card is at revision 1 tries to write over revision 2.
    const stale = await patch('i-card', { baseRev: 1, item: card({ title: 'Mine', rev: 1 }) })
    expect(stale.status).toBe(409)
    const answer = (await stale.json()) as { item: Item }
    expect(answer.item.title).toBe('Theirs')
    expect(answer.item.rev).toBe(2)

    // Refused is not applied: the stored card is still theirs.
    const body = (await (await request('/api/workspace', { headers: { cookie } })).json()) as Workspace
    expect(body.items.find((entry) => entry.id === 'i-card')?.title).toBe('Theirs')
  })

  it('will not write without knowing what it was based on', async () => {
    const { patch } = await writer()
    expect((await patch('i-card', { item: card() })).status).toBe(400)
    expect((await patch('i-card', { baseRev: -1, item: card() })).status).toBe(400)
  })

  it('will not write a card to a path that names another card', async () => {
    const { patch } = await writer()
    expect((await patch('i-other', { baseRev: 0, item: card() })).status).toBe(400)
  })

  it('applies a retried change once, and answers the retry', async () => {
    const { patch, request, cookie } = await writer()
    await patch('i-card', { baseRev: 0, item: card() })

    const change = { baseRev: 1, item: card({ title: 'Once', rev: 1 }), key: 'change-1' }
    expect((await patch('i-card', change)).status).toBe(200)
    // The same key again is the same change: 200, not 409, and not applied a second time.
    expect((await patch('i-card', change)).status).toBe(200)

    const body = (await (await request('/api/workspace', { headers: { cookie } })).json()) as Workspace
    const stored = body.items.find((entry) => entry.id === 'i-card')!
    expect(stored.rev).toBe(2)
    expect(stored.title).toBe('Once')
  })

  it('will not write without a session', async () => {
    const { patch } = await writer()
    expect((await patch('i-card', { baseRev: 0, item: card() }, false)).status).toBe(401)
  })
})

describe('the change feed', () => {
  const card = (over: Partial<Item> = {}): Item => ({
    id: 'i-card',
    title: 'A card',
    typeId: 't-card',
    createdAt: 1_700_000_000_000,
    ...over,
  })

  async function feed() {
    const db = database()
    const { cookie } = await signedIn(db)
    const request = instance(db)
    return {
      request,
      cookie,
      write: (id: string, baseRev: number, item: Item) =>
        request(`/api/workspace/items/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ baseRev, item: { ...item, id } }),
        }),
    }
  }

  it('answers what changed after a cursor, with the cards themselves', async () => {
    const { request, cookie, write } = await feed()
    await write('i-card', 0, card({ title: 'First' }))
    await write('i-card', 1, card({ title: 'Second', rev: 1 }))
    await write('i-other', 0, card({ title: 'Another' }))

    const answer = await request('/api/workspace/changes?since=0', { headers: { cookie } })
    const body = (await answer.json()) as { changes: Array<{ id: number; item: Item }>; cursor: number }
    // The card written twice is one change, at the revision it is now; the second card is its own.
    expect(body.changes.map((change) => change.item.title)).toEqual(['Second', 'Another'])
    expect(body.cursor).toBe(3)

    const later = await request(`/api/workspace/changes?since=${body.cursor}`, { headers: { cookie } })
    expect(((await later.json()) as { changes: unknown[] }).changes).toEqual([])
  })

  it('pages rather than answering everything at once', async () => {
    const { request, cookie, write } = await feed()
    for (let index = 0; index < 60; index++) {
      await write(`i-${index}`, 0, card({ title: `Card ${index}` }))
    }

    const first = await request('/api/workspace/changes?since=0', { headers: { cookie } })
    const body = (await first.json()) as { changes: unknown[]; cursor: number }
    expect(body.changes).toHaveLength(50)
    expect(body.cursor).toBe(50)
  })

  it('is behind the session', async () => {
    const { request } = await feed()
    expect((await request('/api/workspace/changes')).status).toBe(401)
  })
})

describe('importing a workspace', () => {
  const slice = {
    boards: [{ id: 'b-new', name: 'Team Atlas', band: 'team', description: 'Brought from the browser.' }],
    lanes: [
      { id: 'l-new', boardId: 'b-new', parentId: null, order: 0, name: 'Backlog', workflow: 'cards', stage: 'backlog' },
    ],
    items: [{ id: 'i-new', title: 'A card from the browser', typeId: 't-card', createdAt: 1_700_000_000_000, rev: 4 }],
    users: [{ id: 'u-new', name: 'Ada' }],
    issueTypes: [{ id: 't-card', name: 'Card', color: '#3b82f6' }],
    edges: [],
    links: [],
    objectives: [],
    keyResults: [],
    boardTemplates: [],
    placements: [{ id: 'p-new', boardId: 'b-new', itemId: 'i-new', laneId: 'l-new' }],
    savedFilters: [],
    collapsedLanes: {},
    boardId: 'b-new',
  }

  async function importer() {
    const db = database()
    const { cookie } = await signedIn(db)
    const request = instance(db)
    return {
      db,
      cookie,
      import: (body: unknown, signed = true) =>
        request('/api/workspace/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(signed ? { cookie } : {}) },
          body: JSON.stringify(body),
        }),
      read: () => request('/api/workspace', { headers: { cookie } }),
    }
  }

  it('takes the whole workspace, and hands it back', async () => {
    const { import: send, read } = await importer()
    expect((await send(slice)).status).toBe(200)

    const body = (await (await read()).json()) as Workspace
    expect(body.boards.map((board) => board.id)).toEqual(['b-new'])
    expect(body.items.map((item) => item.title)).toEqual(['A card from the browser'])
    // The revision comes across too: R2 says every entity and every log, including rev.
    expect(body.items[0].rev).toBe(4)
    // The file's people, and the account that read it: a member of a workspace is one of its people,
    // which is what an assignee and an author point at.
    expect(body.users.map((person) => person.id)).toContain('u-ada')
    expect(body.users.length).toBeGreaterThanOrEqual(1)
    expect(body.placements).toHaveLength(1)
  })

  it('will not replace a workspace that already has a board', async () => {
    const { import: send } = await importer()
    await send(slice)

    const again = await send({ ...slice, boards: [{ ...slice.boards[0], id: 'b-other', name: 'Other' }] })
    expect(again.status).toBe(409)
  })

  it('refuses what is not a workspace', async () => {
    const { import: send } = await importer()
    expect((await send({ boards: [] })).status).toBe(400)
    expect((await send({ boards: 'not a list' })).status).toBe(400)
    expect((await send(null)).status).toBe(400)
  })

  it('is behind the session', async () => {
    const { import: send } = await importer()
    expect((await send(slice, false)).status).toBe(401)
  })
})

describe('the lease on a card', () => {
  const card = (over: Partial<Item> = {}): Item => ({
    id: 'i-card',
    title: 'A card',
    typeId: 't-card',
    createdAt: 1_700_000_000_000,
    ...over,
  })

  async function holder() {
    const db = database()
    const { cookie } = await signedIn(db)
    const request = instance(db)
    const as = (tab: string, path: string, init: RequestInit = {}) =>
      request(path, { ...init, headers: { ...(init.headers ?? {}), cookie, 'x-kanbantoolkit-tab': tab } })
    return { db, request, as }
  }

  it('is won by one session and refused to the other, with the holder named', async () => {
    const { as } = await holder()
    await as('tab-a', '/api/workspace/items/i-card', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev: 0, item: card() }),
    })

    expect((await as('tab-a', '/api/workspace/items/i-card/lock', { method: 'POST' })).status).toBe(200)

    const second = await as('tab-b', '/api/workspace/items/i-card/lock', { method: 'POST' })
    expect(second.status).toBe(423)
    const body = (await second.json()) as { holder: { holderName: string; sessionId: string } }
    expect(body.holder.holderName).toBe('Ada')
    expect(body.holder.sessionId).toBe('tab-a')
  })

  it('refuses a content change from anyone but the holder, and never a move', async () => {
    const { as } = await holder()
    await as('tab-a', '/api/workspace/items/i-card', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev: 0, item: card() }),
    })
    await as('tab-a', '/api/workspace/items/i-card/lock', { method: 'POST' })

    const theirs = await as('tab-b', '/api/workspace/items/i-card', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev: 1, item: card({ title: 'Mine', rev: 1 }) }),
    })
    expect(theirs.status).toBe(423)
    expect(((await theirs.json()) as { holder: { sessionId: string } }).holder.sessionId).toBe('tab-a')

    // The holder is not refused.
    const mine = await as('tab-a', '/api/workspace/items/i-card', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev: 1, item: card({ title: 'Ours', rev: 1 }) }),
    })
    expect(mine.status).toBe(200)
  })

  it('lets go, and refuses a heartbeat that has nothing to renew', async () => {
    const { as } = await holder()
    await as('tab-a', '/api/workspace/items/i-card', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev: 0, item: card() }),
    })
    await as('tab-a', '/api/workspace/items/i-card/lock', { method: 'POST' })

    expect((await as('tab-a', '/api/workspace/items/i-card/heartbeat', { method: 'POST' })).status).toBe(200)
    expect((await as('tab-a', '/api/workspace/items/i-card/lock', { method: 'DELETE' })).status).toBe(204)

    const lapsed = await as('tab-a', '/api/workspace/items/i-card/heartbeat', { method: 'POST' })
    expect(lapsed.status).toBe(409)
    expect((await as('tab-b', '/api/workspace/items/i-card/lock', { method: 'POST' })).status).toBe(200)
  })

  it('can be taken over once it has lapsed, and never before', async () => {
    const { db } = await holder()
    const holderA = { userId: 'u-a', sessionId: 'tab-a', name: 'Ada' }
    const holderB = { userId: 'u-b', sessionId: 'tab-b', name: 'Grace' }
    const start = new Date('2026-10-22T10:00:00.000Z')

    expect((await acquire(db, 'i-card', holderA, start)).sessionId).toBe('tab-a')

    // Half a lease later: still hers.
    const early = new Date(start.getTime() + LEASE_MS / 2)
    expect((await acquire(db, 'i-card', holderB, early)).sessionId).toBe('tab-a')

    // Past the lease: whoever touches it next takes it, with no steal button.
    const late = new Date(start.getTime() + LEASE_MS + 1)
    expect((await acquire(db, 'i-card', holderB, late)).sessionId).toBe('tab-b')

    await release(db, 'i-card', 'tab-b')
    expect(await lockOf(db, 'i-card')).toBeUndefined()
  })

  it('is visible to everyone on the same poll as the changes', async () => {
    const { as } = await holder()
    await as('tab-a', '/api/workspace/items/i-card', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev: 0, item: card() }),
    })
    await as('tab-a', '/api/workspace/items/i-card/lock', { method: 'POST' })

    const answer = await as('tab-b', '/api/workspace/changes?since=0')
    const body = (await answer.json()) as { locks: Array<{ itemId: string; holderName: string }> }
    expect(body.locks.map((lock) => lock.itemId)).toContain('i-card')
    expect(body.locks[0].holderName).toBe('Ada')
  })
})

describe('what a role may do, at the door', () => {
  const card = (over: Partial<Item> = {}): Item => ({
    id: 'i-card',
    title: 'A card',
    typeId: 't-card',
    createdAt: 1_700_000_000_000,
    ...over,
  })

  /** A signed-in caller with a given role on each axis. */
  async function caller(db: Database, id: string, role: 'viewer' | 'editor' | 'admin', instance: 'admin' | 'member' = 'member') {
    await db.run('INSERT OR IGNORE INTO users (id, name, email) VALUES (?1, ?2, ?3)', [id, id, `${id}@example.com`])
    await db.run('INSERT OR IGNORE INTO instance_members (user_id, role) VALUES (?1, ?2)', [id, instance])
    await db.run("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES ('workspace', ?1, ?2)", [id, role])
    const session = await issueSession(db, id)
    return { id, cookie: `fl_session=${session.token}` }
  }

  const write = (request: ReturnType<typeof instance>, cookie: string, title: string, baseRev: number) =>
    request('/api/workspace/items/i-card', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ baseRev, item: card({ title }) }),
    })

  it('refuses a viewer a write, and changes nothing', async () => {
    const db = database()
    const request = instance(db)
    const admin = await caller(db, 'u-admin', 'admin')
    const viewer = await caller(db, 'u-view', 'viewer')
    await write(request, admin.cookie, 'A card', 0)

    expect((await write(request, viewer.cookie, 'Mine', 1)).status).toBe(403)

    const body = (await (await request('/api/workspace', { headers: { cookie: admin.cookie } })).json()) as Workspace
    expect(body.items[0].title).toBe('A card')
  })

  it('lets an editor change the work and refuses them the workspace', async () => {
    const db = database()
    const request = instance(db)
    const editor = await caller(db, 'u-edit', 'editor')
    await write(request, editor.cookie, 'A card', 0)

    expect((await write(request, editor.cookie, 'Renamed', 1)).status).toBe(200)
    // Importing a whole workspace is the administrator's, not the editor's.
    const imported = await request('/api/workspace/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: editor.cookie },
      body: JSON.stringify({ boards: [{ id: 'b-x', name: 'X', band: 'team', description: '' }] }),
    })
    expect(imported.status).toBe(403)
  })

  it('takes a demotion on the very next request, with no sign-out', async () => {
    const db = database()
    const request = instance(db)
    const admin = await caller(db, 'u-demote', 'admin')
    await write(request, admin.cookie, 'A card', 0)
    expect((await write(request, admin.cookie, 'Still mine', 1)).status).toBe(200)

    await db.run("UPDATE workspace_members SET role = 'viewer' WHERE user_id = 'u-demote'")

    // The cookie is the same one; the role is read again, on this request.
    expect((await write(request, admin.cookie, 'Not any more', 2)).status).toBe(403)
  })

  it('gives a removed member nothing to see, rather than a refusal that confirms it', async () => {
    const db = database()
    const request = instance(db)
    const member = await caller(db, 'u-removed', 'editor')
    expect((await request('/api/workspace', { headers: { cookie: member.cookie } })).status).toBe(200)

    await db.run("DELETE FROM workspace_members WHERE user_id = 'u-removed'")

    // Not 403: a workspace you are not in is one that is not there for you.
    expect((await request('/api/workspace', { headers: { cookie: member.cookie } })).status).toBe(404)
  })

  it('lets an instance administrator write to a workspace they are not a member of', async () => {
    const db = database()
    const request = instance(db)
    await db.run("INSERT INTO users (id, name, email) VALUES ('u-root', 'Root', 'root@example.com')")
    await db.run("INSERT INTO instance_members (user_id, role) VALUES ('u-root', 'admin')")
    const session = await issueSession(db, 'u-root')

    expect((await write(request, `fl_session=${session.token}`, 'Repaired', 0)).status).toBe(200)
  })
})
