/**
 * A card's history, read where it is read (task 192).
 *
 * The workspace document carries cards, not what happened to them. These tests hold the three
 * reads that replace it: one card's log, a page at a time; one board's moves, for the flow reading;
 * and the notes search and mentions need. Each is scoped by the workspace and bounded, and the
 * order is `(at, id)` so two entries in one millisecond still have one true order.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { issueSession } from './auth/session'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { readItemLog, readMovements, readNotes } from './workspace/history'
import { writeWorkspace } from './workspace/write'
import type { Workspace } from './workspace/types'
import type { Board, BoardFlow, Item, ItemLogEntry, Lane, Placement } from '../src/domain/types'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

function database(): Database {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

async function signedIn(db: Database, id = 'u-ada'): Promise<{ cookie: string }> {
  await db.run('INSERT OR IGNORE INTO users (id, name, email) VALUES (?1, ?2, ?3)', [id, 'Ada', `${id}@example.com`])
  await db.run('INSERT OR IGNORE INTO instance_members (user_id, role) VALUES (?1, ?2)', [id, 'admin'])
  await db.run('INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, ?3)', [
    'workspace',
    id,
    'admin',
  ])
  const session = await issueSession(db, id)
  return { cookie: `fl_session=${session.token}` }
}

function instance(db: Database) {
  const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
  return (path: string, init?: RequestInit) => app.request(path, init, {})
}

const board = (id: string): Board => ({ id, name: id, band: 'team', description: '' })
const flow = (id: string, boardId: string): BoardFlow => ({ id, boardId, kind: 'cards', name: 'Cards', order: 0 })
const lane = (id: string, boardId: string, flowId: string, stage: Lane['stage']): Lane => ({
  id,
  boardId,
  parentId: null,
  order: 0,
  name: id,
  flowId,
  stage,
})
const placement = (id: string, boardId: string, itemId: string, laneId: string): Placement => ({
  id,
  boardId,
  itemId,
  laneId,
})

const moved = (id: string, at: number, boardId: string, toStage: ItemLogEntry['toStage']): ItemLogEntry => ({
  id,
  at,
  kind: 'moved',
  by: 'u-ada',
  fromLaneId: 'l-backlog',
  toLaneId: 'l-doing',
  fromStage: 'backlog',
  ...(toStage ? { toStage } : {}),
  boardId,
})

const noted = (id: string, at: number, note: string, mentions?: string[]): ItemLogEntry => ({
  id,
  at,
  kind: 'noted',
  by: 'u-ada',
  note,
  ...(mentions ? { mentions } : {}),
})

const card = (id: string, log: ItemLogEntry[], over: Partial<Item> = {}): Item => ({
  id,
  title: id,
  typeId: 't-card',
  createdAt: 1_700_000_000_000,
  log,
  ...over,
})

/** One board with a card whose history spans moves and notes, and a second board to leak across. */
function seeded(): Workspace {
  return {
    users: [
      { id: 'u-ada', name: 'Ada' },
      { id: 'u-grace', name: 'Grace' },
    ],
    issueTypes: [{ id: 't-card', name: 'Card', color: '#3b82f6' }],
    boards: [board('b-1'), board('b-2')],
    flows: [flow('f-1', 'b-1'), flow('f-2', 'b-2')],
    lanes: [
      lane('l-backlog', 'b-1', 'f-1', 'backlog'),
      lane('l-doing', 'b-1', 'f-1', 'inProgress'),
      lane('l-done', 'b-1', 'f-1', 'done'),
      lane('l-2', 'b-2', 'f-2', 'backlog'),
    ],
    items: [
      card('i-1', [
        { id: 'e-1', at: 1_700_000_000_000, kind: 'created', by: 'u-ada' },
        moved('e-2', 1_700_000_001_000, 'b-1', 'inProgress'),
        noted('e-3', 1_700_000_002_000, 'The retries need a budget @Grace', ['u-grace']),
        moved('e-4', 1_700_000_003_000, 'b-1', 'done'),
        noted('e-5', 1_700_000_004_000, 'Shipped behind the flag'),
      ]),
      card('i-2', [moved('e-6', 1_700_000_002_500, 'b-2', 'backlog')]),
      card('i-3', [
        { id: 'e-7', at: 1_700_000_000_500, kind: 'created', by: 'u-ada' },
        noted('e-8', 1_700_000_003_500, 'A note with no mentions'),
      ]),
    ],
    placements: [
      placement('p-1', 'b-1', 'i-1', 'l-done'),
      placement('p-2', 'b-2', 'i-2', 'l-2'),
      placement('p-3', 'b-1', 'i-3', 'l-backlog'),
    ],
    edges: [],
    links: [],
    objectives: [],
    periods: [],
    keyResults: [],
    boardTemplates: [],
    boardId: '',
    autoArchiveDays: 0,
    savedFilters: [],
    collapsedLanes: {},
  }
}

describe('one card’s history, a page at a time', () => {
  it('answers the newest page first, with the count and a cursor for the rest', async () => {
    const db = database()
    await writeWorkspace(db, seeded(), 'workspace')
    const page = await readItemLog(db, 'i-1', 'workspace', { limit: 2 })

    expect(page?.entries.map((entry) => entry.id)).toEqual(['e-5', 'e-4'])
    expect(page?.total).toBe(5)
    expect(page?.nextCursor).toBeTruthy()

    const next = await readItemLog(db, 'i-1', 'workspace', { limit: 2, cursor: page!.nextCursor! })
    expect(next?.entries.map((entry) => entry.id)).toEqual(['e-3', 'e-2'])
    expect(next?.total).toBe(5)

    const last = await readItemLog(db, 'i-1', 'workspace', { limit: 2, cursor: next!.nextCursor! })
    expect(last?.entries.map((entry) => entry.id)).toEqual(['e-1'])
    expect(last?.nextCursor).toBeNull()
    expect(last?.total).toBe(5)
  })

  it('keeps a page inside the bound, whatever the caller asks for', async () => {
    const db = database()
    await writeWorkspace(db, seeded(), 'workspace')
    const wide = await readItemLog(db, 'i-1', 'workspace', { limit: 10_000 })
    expect(wide?.entries).toHaveLength(5)

    const narrow = await readItemLog(db, 'i-1', 'workspace', { limit: 0 })
    // A nonsensical bound is the default, not an empty answer.
    expect(narrow?.entries).toHaveLength(5)
  })

  it('refuses an item from another workspace rather than answering an empty log', async () => {
    const db = database()
    await db.run("INSERT INTO workspaces (id, name) VALUES ('other', 'Other')")
    await writeWorkspace(db, seeded(), 'workspace')
    await db.run(
      "INSERT INTO items (id, title, type_id, created_at, rev, workspace_id) VALUES ('i-theirs', 'Theirs', 't-card', 1, 1, 'other')",
    )
    await db.run("INSERT INTO item_log (item_id, id, at, kind, workspace_id) VALUES ('i-theirs', 'e-x', 1, 'created', 'other')")

    expect(await readItemLog(db, 'i-theirs', 'workspace')).toBeUndefined()
    expect((await readItemLog(db, 'i-1', 'workspace'))?.entries).toHaveLength(5)
  })

  it('serves the page over the route, and 404 for an unknown card', async () => {
    const db = database()
    await writeWorkspace(db, seeded(), 'workspace')
    const { cookie } = await signedIn(db)
    const request = instance(db)

    const response = await request('/api/workspace/items/i-1/log?limit=2', { headers: { cookie } })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { entries: Array<{ id: string }>; nextCursor: string; total: number }
    expect(body.entries.map((entry) => entry.id)).toEqual(['e-5', 'e-4'])
    expect(body.total).toBe(5)
    expect(body.nextCursor).toBeTruthy()

    expect((await request('/api/workspace/items/nope/log', { headers: { cookie } })).status).toBe(404)
    expect((await request('/api/workspace/items/i-1/log')).status).toBe(401)
  })
})

describe('the moves one board charts', () => {
  it('answers only moves of this board’s cards, oldest first', async () => {
    const db = database()
    await writeWorkspace(db, seeded(), 'workspace')

    const answer = await readMovements(db, 'b-1', 'workspace')
    expect(answer.truncated).toBe(false)
    expect(answer.moves).toEqual([
      { id: 'e-2', itemId: 'i-1', at: 1_700_000_001_000, toStage: 'inProgress', fromStage: 'backlog' },
      { id: 'e-4', itemId: 'i-1', at: 1_700_000_003_000, toStage: 'done', fromStage: 'backlog' },
    ])
  })

  it('honours the window, and says when the cap left older moves behind', async () => {
    const db = database()
    await writeWorkspace(db, seeded(), 'workspace')

    const recent = await readMovements(db, 'b-1', 'workspace', { since: 1_700_000_002_000 })
    expect(recent.moves.map((move) => move.toStage)).toEqual(['done'])

    const capped = await readMovements(db, 'b-1', 'workspace', { limit: 1 })
    expect(capped.truncated).toBe(true)
    expect(capped.moves.map((move) => move.toStage)).toEqual(['done'])
  })

  it('answers a route and refuses an unknown board', async () => {
    const db = database()
    await writeWorkspace(db, seeded(), 'workspace')
    const { cookie } = await signedIn(db)
    const request = instance(db)

    const response = await request('/api/workspace/movements?boardId=b-2', { headers: { cookie } })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { moves: Array<{ itemId: string }> }
    expect(body.moves.map((move) => move.itemId)).toEqual(['i-2'])

    expect((await request('/api/workspace/movements?boardId=nope', { headers: { cookie } })).status).toBe(404)
  })
})

describe('the notes search and mentions read', () => {
  it('matches a note’s words case-insensitively and names the card', async () => {
    const db = database()
    await writeWorkspace(db, seeded(), 'workspace')

    const hits = await readNotes(db, 'workspace', { q: 'RETRIES' })
    expect(hits).toHaveLength(1)
    expect(hits[0].itemId).toBe('i-1')
    expect(hits[0].entry.id).toBe('e-3')
    // Newest first across cards.
    expect((await readNotes(db, 'workspace', { q: 'note' })).map((hit) => hit.entry.id)).toEqual(['e-8'])
  })

  it('answers the notes that name one person, and nobody else’s', async () => {
    const db = database()
    await writeWorkspace(db, seeded(), 'workspace')

    expect((await readNotes(db, 'workspace', { mentionOf: 'u-grace' })).map((hit) => hit.entry.id)).toEqual(['e-3'])
    expect(await readNotes(db, 'workspace', { mentionOf: 'u-ada' })).toEqual([])
  })

  it('serves both questions over the route, scoped to the caller for mentions', async () => {
    const db = database()
    await writeWorkspace(db, seeded(), 'workspace')
    const { cookie } = await signedIn(db, 'u-grace')
    const request = instance(db)

    const search = (await (
      await request('/api/workspace/notes?q=budget', { headers: { cookie } })
    ).json()) as { notes: Array<{ itemId: string; entry: { id: string } }> }
    expect(search.notes.map((note) => note.entry.id)).toEqual(['e-3'])

    const mine = (await (
      await request('/api/workspace/notes?mention=me', { headers: { cookie } })
    ).json()) as { notes: Array<{ entry: { id: string } }> }
    expect(mine.notes.map((note) => note.entry.id)).toEqual(['e-3'])
  })

  it('never returns another workspace’s notes', async () => {
    const db = database()
    await db.run("INSERT INTO workspaces (id, name) VALUES ('other', 'Other')")
    await writeWorkspace(db, seeded(), 'workspace')
    await db.run(
      "INSERT INTO items (id, title, type_id, created_at, rev, workspace_id) VALUES ('i-theirs', 'Theirs', 't-card', 1, 1, 'other')",
    )
    await db.run(
      "INSERT INTO item_log (item_id, id, at, kind, note, workspace_id) VALUES ('i-theirs', 'e-x', 1, 'noted', 'their secret', 'other')",
    )

    expect(await readNotes(db, 'workspace', { q: 'secret' })).toEqual([])
  })
})

describe('appending history without a revision', () => {
  const entry = (id: string, at: number, over: Record<string, unknown> = {}) => ({
    id,
    at,
    kind: 'moved',
    toStage: 'done',
    ...over,
  })

  const append = (db: Database, cookie: string, id: string, entries: unknown[]) =>
    instance(db)(`/api/workspace/items/${id}/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ entries }),
    })

  it('writes the entry once, and leaves the card’s revision where it was', async () => {
    const db = database()
    await writeWorkspace(db, seeded(), 'workspace')
    const { cookie } = await signedIn(db)
    const before = (await db.get<{ rev: number }>('SELECT rev FROM items WHERE id = ?1', ['i-1']))!.rev

    // A drag is arrangement: the entry is a fact, the revision is not its business.
    expect((await append(db, cookie, 'i-1', [entry('e-new', 1_700_000_005_000)])).status).toBe(200)
    // A retry of the same entry appends nothing twice.
    expect((await append(db, cookie, 'i-1', [entry('e-new', 1_700_000_005_000)])).status).toBe(200)

    const page = await readItemLog(db, 'i-1', 'workspace')
    expect(page?.entries.filter((e) => e.id === 'e-new')).toHaveLength(1)
    expect(page?.entries[0].id).toBe('e-new')
    expect((await db.get<{ rev: number }>('SELECT rev FROM items WHERE id = ?1', ['i-1']))!.rev).toBe(before)
  })

  it('refuses a malformed entry rather than storing half of one', async () => {
    const db = database()
    await writeWorkspace(db, seeded(), 'workspace')
    const { cookie } = await signedIn(db)

    expect((await append(db, cookie, 'i-1', [])).status).toBe(400)
    expect((await append(db, cookie, 'i-1', [{ id: 'e-x' }])).status).toBe(400)
    expect((await append(db, cookie, 'i-1', [entry('e-ok', 1), { id: 'e-bad' }])).status).toBe(400)
    // A refused body wrote none of the entries it carried.
    expect((await readItemLog(db, 'i-1', 'workspace'))?.entries.some((e) => e.id === 'e-ok')).toBe(false)
  })

  it('is an item write, and only for a card in this workspace', async () => {
    const db = database()
    await db.run("INSERT INTO workspaces (id, name) VALUES ('other', 'Other')")
    await writeWorkspace(db, seeded(), 'workspace')
    const { cookie } = await signedIn(db)
    await db.run('UPDATE workspace_members SET role = ?1 WHERE user_id = ?2', ['viewer', 'u-ada'])
    expect((await append(db, cookie, 'i-1', [entry('e-viewer', 1)])).status).toBe(403)

    await db.run('UPDATE workspace_members SET role = ?1 WHERE user_id = ?2', ['admin', 'u-ada'])
    await db.run(
      "INSERT INTO items (id, title, type_id, created_at, rev, workspace_id) VALUES ('i-theirs', 'Theirs', 't-card', 1, 1, 'other')",
    )
    expect((await append(db, cookie, 'i-theirs', [entry('e-theirs', 1)])).status).toBe(404)
    expect((await append(db, cookie, 'nope', [entry('e-nope', 1)])).status).toBe(404)
  })
})
