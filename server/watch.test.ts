/**
 * Watching a card, and reading the outbox as an inbox.
 *
 * The rules asserted here are the ones a person would notice: a watch belongs to the account and
 * survives a device, the creator and a newly assigned person watch without asking, the inbox is a
 * cursor over the outbox rather than a second history, and nobody can read somebody else's.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { issueSession } from './auth/session'
import type { Database } from './db'
import { emitEvent } from './events'
import { fromSqlite } from './sqlite'
import { readItem } from './workspace/read'
import type { Workspace } from './workspace/types'
import { writeWorkspace } from './workspace/write'
import type { Item } from '../src/domain/types'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

function database(): Database {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  title: id,
  typeId: 't-card',
  createdAt: 1,
  rev: 0,
  ...over,
})

function workspace(): Workspace {
  return {
    users: [
      { id: 'u-ada', name: 'Ada' },
      { id: 'u-grace', name: 'Grace' },
    ],
    issueTypes: [
      { id: 't-card', name: 'Card', color: '#3b82f6' },
      { id: 't-init', name: 'Initiative', color: '#7c3aed' },
    ],
    boards: [{ id: 'b-1', name: 'Team Atlas', band: 'team', description: '' }],
    flows: [
      { id: 'f-cards', boardId: 'b-1', kind: 'cards', name: 'Cards', order: 0 },
      { id: 'f-init', boardId: 'b-1', kind: 'initiatives', name: 'Initiatives', order: 0 },
    ],
    lanes: [
      { id: 'l-backlog', boardId: 'b-1', parentId: null, order: 0, name: 'Backlog', flowId: 'f-cards', stage: 'backlog' },
      { id: 'l-done', boardId: 'b-1', parentId: null, order: 1, name: 'Done', flowId: 'f-cards', stage: 'done' },
      { id: 'l-sec', boardId: 'b-1', parentId: null, order: 0, name: 'Backlog', flowId: 'f-init', stage: 'backlog' },
      { id: 'l-cell', boardId: 'b-1', parentId: 'l-sec', order: 0, name: 'Uncommitted', flowId: 'f-init' },
    ],
    items: [item('i-1', { title: 'Rebuild the signup form' }), item('i-2', { title: 'Email verification' })],
    placements: [
      { id: 'p-1', boardId: 'b-1', itemId: 'i-1', laneId: 'l-backlog', laneEnteredAt: 1, rank: 0 },
      { id: 'p-2', boardId: 'b-1', itemId: 'i-2', laneId: 'l-backlog', laneEnteredAt: 1, rank: 1 },
    ],
    edges: [],
    links: [],
    objectives: [],
    periods: [],
    keyResults: [],
    boardTemplates: [],
    savedFilters: [],
    collapsedLanes: {},
    boardId: 'b-1',
  }
}

async function world() {
  const db = database()
  await writeWorkspace(db, workspace(), 'workspace')
  for (const [id, role] of [
    ['u-ada', 'admin'],
    ['u-grace', 'editor'],
  ] as const) {
    await db.run('INSERT OR IGNORE INTO users (id, name, email) VALUES (?1, ?2, ?3)', [id, id, `${id}@example.com`])
    await db.run('INSERT OR IGNORE INTO instance_members (user_id, role) VALUES (?1, ?2)', [id, 'member'])
    await db.run('INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, ?3)', [
      'workspace',
      id,
      role,
    ])
  }
  const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
  const request = (path: string, init?: RequestInit) => app.request(path, init, {})
  const session = async (id: string) => `fl_session=${(await issueSession(db, id)).token}`
  const as = (cookie: string) => (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('cookie', cookie)
    return request(path, { ...init, headers })
  }
  return { db, request, session, as, ada: await session('u-ada'), grace: await session('u-grace') }
}

const json = async <T>(response: Response): Promise<T> => (await response.json()) as T

const patch = (call: ReturnType<Awaited<ReturnType<typeof world>>['as']>, id: string, body: unknown) =>
  call(`/api/workspace/items/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('the watch', () => {
  it('belongs to the account, is idempotent, and is a read door so a Viewer can keep one', async () => {
    const { db, as, ada, grace } = await world()
    const mine = as(ada)

    expect(await json<{ itemIds: string[] }>(await mine('/api/workspace/watches'))).toEqual({ itemIds: [] })
    expect(await json(await mine('/api/workspace/items/i-1/watch', { method: 'POST' }))).toEqual({
      itemId: 'i-1',
      watching: true,
    })
    // Asking twice is still one watch.
    await mine('/api/workspace/items/i-1/watch', { method: 'POST' })
    expect(await json<{ itemIds: string[] }>(await mine('/api/workspace/watches'))).toEqual({ itemIds: ['i-1'] })
    expect(await json(await mine('/api/workspace/items/i-1/watch'))).toEqual({ itemId: 'i-1', watching: true })

    // A Viewer may watch: it is not a permission over the work.
    await db.run("UPDATE workspace_members SET role = 'viewer' WHERE user_id = 'u-grace'")
    const viewer = as(grace)
    expect((await viewer('/api/workspace/items/i-1/watch', { method: 'POST' })).status).toBe(200)
    expect(await json<{ itemIds: string[] }>(await viewer('/api/workspace/watches'))).toEqual({ itemIds: ['i-1'] })

    // Unwatching is idempotent, and another person's watch is untouched.
    await mine('/api/workspace/items/i-1/watch', { method: 'DELETE' })
    await mine('/api/workspace/items/i-1/watch', { method: 'DELETE' })
    expect(await json<{ itemIds: string[] }>(await mine('/api/workspace/watches'))).toEqual({ itemIds: [] })
    expect(await json<{ itemIds: string[] }>(await viewer('/api/workspace/watches'))).toEqual({ itemIds: ['i-1'] })

    // An item that is not here is not a watch, and an id from another workspace is the same 404.
    expect((await mine('/api/workspace/items/nope/watch', { method: 'POST' })).status).toBe(404)
  })

  it('subscribes the creator, a newly assigned person, and the author of a note', async () => {
    const { db, as, ada } = await world()
    const mine = as(ada)
    const watching = async (userId: string, itemId: string) =>
      Boolean(
        await db.get('SELECT 1 AS seen FROM item_watch WHERE workspace_id = ?1 AND user_id = ?2 AND item_id = ?3', [
          'workspace',
          userId,
          itemId,
        ]),
      )

    // A create: whoever made it watches it.
    const created = await patch(mine, 'i-new', {
      baseRev: 0,
      item: { id: 'i-new', title: 'A new card', typeId: 't-card', createdAt: Date.now() },
    })
    expect(created.status).toBe(200)
    expect(await watching('u-ada', 'i-new')).toBe(true)
    expect(await watching('u-grace', 'i-new')).toBe(false)

    // An assignee is added: that person watches, and no one else is subscribed by it.
    const current = (await readItem(db, 'i-1', 'workspace'))!
    const assigned = await patch(mine, 'i-1', {
      baseRev: current.rev ?? 0,
      item: { ...current, assignees: ['u-grace'] },
    })
    expect(assigned.status).toBe(200)
    expect(await watching('u-grace', 'i-1')).toBe(true)
    expect(await watching('u-ada', 'i-1')).toBe(false)

    // A note: its author watches the card they wrote on.
    const before = (await readItem(db, 'i-2', 'workspace'))!
    const noted = await patch(mine, 'i-2', {
      baseRev: before.rev ?? 0,
      item: {
        ...before,
        log: [
          ...(before.log ?? []),
          { id: 'n-1', at: Date.now(), kind: 'noted', note: 'Deployed to staging.', by: 'u-ada' },
        ],
      },
    })
    expect(noted.status).toBe(200)
    expect(await watching('u-ada', 'i-2')).toBe(true)
  })
})

describe('the inbox', () => {
  it('starts at the watch: a card’s history is not the news a watcher asked for', async () => {
    const { db, as, ada } = await world()
    const mine = as(ada)

    // History before the watch.
    await emitEvent(db, 'workspace', 'item.noted', { itemId: 'i-1', entryId: 'n-old' }, 'u-grace')
    await emitEvent(db, 'workspace', 'item.moved', { itemId: 'i-1', laneId: 'l-done', toStage: 'done' }, 'u-grace')

    await mine('/api/workspace/items/i-1/watch', { method: 'POST' })
    expect(await json<{ rows: unknown[]; unread: number }>(await mine('/api/workspace/inbox'))).toEqual({
      rows: [],
      unread: 0,
      cursor: 0,
    })

    // The next change is the first thing the watch sees, and only that one.
    await emitEvent(db, 'workspace', 'item.noted', { itemId: 'i-1', entryId: 'n-new' }, 'u-grace')
    const page = await json<{ rows: Array<{ entryId?: string }>; unread: number }>(
      await mine('/api/workspace/inbox'),
    )
    expect(page.rows).toHaveLength(1)
    expect(page.rows[0].entryId).toBe('n-new')
    expect(page.unread).toBe(1)
  })

  it('is a cursor over the outbox: paged, counted, and read by marking', async () => {
    const { db, as, ada } = await world()
    const mine = as(ada)
    await mine('/api/workspace/items/i-1/watch', { method: 'POST' })
    await mine('/api/workspace/items/i-2/watch', { method: 'POST' })

    // Three events about watched work, and one about work nobody here watches.
    await emitEvent(db, 'workspace', 'item.moved', {
      itemId: 'i-1',
      title: 'Rebuild the signup form',
      boardId: 'b-1',
      laneId: 'l-done',
      fromStage: 'backlog',
      toStage: 'done',
    }, 'u-ada')
    await emitEvent(db, 'workspace', 'item.noted', { itemId: 'i-1', entryId: 'n-1' }, 'u-grace')
    await emitEvent(db, 'workspace', 'item.updated', { itemId: 'i-2', fields: ['due date'] }, 'u-ada')
    await emitEvent(db, 'workspace', 'item.created', { itemId: 'i-unwatched' }, 'u-grace')

    const page = await json<{
      rows: Array<{ id: string; type: string; itemId: string; itemTitle: string; boardName?: string; laneName?: string; read: boolean; actor?: string }>
      unread: number
      cursor: number
    }>(await mine('/api/workspace/inbox?limit=2'))

    // Newest first, the watched work only, with the board and the cell resolved.
    expect(page.rows.map((row) => row.type)).toEqual(['item.updated', 'item.noted'])
    expect(page.rows[1]).toMatchObject({ itemId: 'i-1', itemTitle: 'Rebuild the signup form', actor: 'Grace' })
    expect(page.unread).toBe(3)
    expect(page.cursor).toBe(0)

    const all = await json<typeof page>(await mine('/api/workspace/inbox'))
    expect(all.rows.map((row) => row.type)).toEqual(['item.updated', 'item.noted', 'item.moved'])
    // The moved row says where it landed, from the event and the placement.
    expect(all.rows.find((row) => row.type === 'item.moved')).toMatchObject({
      itemId: 'i-1',
      boardName: 'Team Atlas',
      laneName: 'Done',
    })

    const read = await json<{ cursor: number; unread: number }>(
      await mine('/api/workspace/inbox/read', { method: 'POST' }),
    )
    expect(read.unread).toBe(0)
    expect(read.cursor).toBeGreaterThan(0)

    const afterRead = await json<typeof page>(await mine('/api/workspace/inbox'))
    expect(afterRead.rows.every((row) => row.read)).toBe(true)
    expect(afterRead.unread).toBe(0)

    // A change after the cursor is unread again — and only that one.
    await emitEvent(db, 'workspace', 'item.blocked', { itemId: 'i-2', reason: 'Waiting on legal' }, 'u-grace')
    const later = await json<typeof page>(await mine('/api/workspace/inbox'))
    expect(later.unread).toBe(1)
    expect(later.rows[0]).toMatchObject({ type: 'item.blocked', read: false, reason: 'Waiting on legal' })
  })

  it('reads an initiative health change as a level, not the event’s object', async () => {
    const { db, as, ada } = await world()
    const mine = as(ada)
    await mine('/api/workspace/items/i-1/watch', { method: 'POST' })
    await emitEvent(
      db,
      'workspace',
      'initiative.health_changed',
      { initiativeId: 'i-1', before: { level: 'healthy', flags: [] }, after: { level: 'atRisk', flags: ['blocked'] } },
      'u-ada',
    )

    const page = await json<{ rows: Array<{ type: string; health?: { before: string; after: string } }> }>(
      await mine('/api/workspace/inbox'),
    )
    expect(page.rows[0]).toMatchObject({
      type: 'initiative.health_changed',
      health: { before: 'healthy', after: 'atRisk' },
    })
  })

  it('is nobody else’s, and drops a row whose item has gone', async () => {
    const { db, as, ada, grace } = await world()
    const mine = as(ada)
    const theirs = as(grace)
    await mine('/api/workspace/items/i-1/watch', { method: 'POST' })
    await emitEvent(db, 'workspace', 'item.noted', { itemId: 'i-1', entryId: 'n-1' }, 'u-ada')

    expect(await json<{ rows: unknown[]; unread: number }>(await theirs('/api/workspace/inbox'))).toEqual({
      rows: [],
      unread: 0,
      cursor: 0,
    })

    // Deleting the card removes the watch with it (the schema's cascade), so the row goes too.
    await db.run("DELETE FROM items WHERE id = 'i-1'")
    expect(await json<{ rows: unknown[]; unread: number }>(await mine('/api/workspace/inbox'))).toEqual({
      rows: [],
      unread: 0,
      cursor: 0,
    })
    expect(await json<{ itemIds: string[] }>(await mine('/api/workspace/watches'))).toEqual({ itemIds: [] })
  })
})
