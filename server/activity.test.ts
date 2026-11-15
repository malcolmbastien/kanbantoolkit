/**
 * A board's activity stream: board-scoped, paginated, and anonymous on deletion.
 *
 * The event is written at the change seam; these tests hold the server's half — the actor is the
 * session, the deletion clears earlier references, and the page is newest-first.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { issueSession } from './auth/session'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { readBoardActivity, writeBoardActivity } from './workspace/activity'
import { writeDesign } from './workspace/structure'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

function database(): Database {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

async function board(db: Database): Promise<void> {
  await db.run(
    "INSERT OR IGNORE INTO boards (id, name, band, description, position, workspace_id) VALUES ('b-1', 'Atlas', 'team', '', 0, 'workspace')",
  )
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

const instance = (db: Database) => {
  const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
  return (path: string, init?: RequestInit) => app.request(path, init, {})
}

describe('board activity', () => {
  it('stores the actor from the session and reads newest first', async () => {
    const db = database()
    await board(db)
    const first = await writeBoardActivity(db, 'workspace', 'b-1', {
      event: { id: 'e-1', boardId: 'b-1', kind: 'card.created', itemId: 'i-1' },
    }, 'u-ada')
    const second = await writeBoardActivity(db, 'workspace', 'b-1', {
      event: { id: 'e-2', boardId: 'b-1', kind: 'board.updated', summary: 'renamed the board' },
    }, 'u-grace')
    expect(first).toMatchObject({ id: 'e-1', actorId: 'u-ada', itemId: 'i-1' })
    expect(second).toMatchObject({ id: 'e-2', actorId: 'u-grace', summary: 'renamed the board' })

    const page = await readBoardActivity(db, 'b-1', 'workspace')
    expect(page.total).toBe(2)
    expect(page.events.map((event) => event.id)).toEqual(['e-2', 'e-1'])
  })

  it('clears earlier card references when a card is deleted, and stores no card in the delete', async () => {
    const db = database()
    await board(db)
    await writeBoardActivity(db, 'workspace', 'b-1', {
      event: { id: 'e-1', boardId: 'b-1', kind: 'card.updated', itemId: 'i-1' },
    }, 'u-ada')
    const deletion = await writeBoardActivity(db, 'workspace', 'b-1', {
      event: { id: 'e-2', boardId: 'b-1', kind: 'card.deleted' },
      redactItemId: 'i-1',
    }, 'u-ada')
    expect(deletion).toMatchObject({ kind: 'card.deleted' })
    expect(deletion?.itemId).toBeUndefined()

    const page = await readBoardActivity(db, 'b-1', 'workspace')
    expect(page.events.find((event) => event.id === 'e-1')?.itemId).toBeUndefined()
    expect(page.events.find((event) => event.id === 'e-2')).not.toHaveProperty('itemId')
  })

  it('pages newest first, with a cursor made of the last row it returned', async () => {
    const db = database()
    await board(db)
    for (const id of ['e-1', 'e-2', 'e-3']) {
      await writeBoardActivity(db, 'workspace', 'b-1', {
        event: { id, boardId: 'b-1', kind: 'card.updated', itemId: 'i-1' },
      }, 'u-ada')
    }
    const first = await readBoardActivity(db, 'b-1', 'workspace', { limit: '2' })
    expect(first.events.map((event) => event.id)).toEqual(['e-3', 'e-2'])
    expect(first.total).toBe(3)
    expect(first.nextCursor).toBeTruthy()
    const second = await readBoardActivity(db, 'b-1', 'workspace', { cursor: first.nextCursor!, limit: '2' })
    expect(second.events.map((event) => event.id)).toEqual(['e-1'])
    expect(second.nextCursor).toBeNull()
  })

  it('records the token a script acted with, while the actor stays the person', async () => {
    const db = database()
    await board(db)
    const event = await writeBoardActivity(
      db,
      'workspace',
      'b-1',
      { event: { id: 'e-1', boardId: 'b-1', kind: 'card.created', itemId: 'i-1' } },
      'u-ada',
      'CI bot',
    )
    expect(event).toMatchObject({ actorId: 'u-ada', via: 'CI bot' })
    const page = await readBoardActivity(db, 'b-1', 'workspace')
    expect(page.events[0].via).toBe('CI bot')
  })

  it('takes a board’s stream with it when the board is removed', async () => {
    const db = database()
    await board(db)
    await writeBoardActivity(db, 'workspace', 'b-1', {
      event: { id: 'e-1', boardId: 'b-1', kind: 'board.updated', summary: 'renamed the board' },
    }, 'u-ada')
    // A design write replaces the boards it carries; one it does not carry has been removed.
    await writeDesign(db, 'workspace', { boards: [], flows: [], lanes: [], placements: [] }, 0)
    const page = await readBoardActivity(db, 'b-1', 'workspace')
    expect(page.total).toBe(0)
    expect(page.events).toEqual([])
  })

  it('requires membership to read and the right door to write', async () => {
    const db = database()
    await board(db)
    const call = instance(db)
    expect((await call('/api/workspace/boards/b-1/activity')).status).toBe(401)

    const { cookie } = await signedIn(db)
    const read = await call('/api/workspace/boards/b-1/activity', { headers: { cookie } })
    expect(read.status).toBe(200)
    const post = await call('/api/workspace/boards/b-1/activity', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ event: { id: 'e-1', boardId: 'b-1', kind: 'card.created', itemId: 'i-1' } }),
    })
    expect(post.status).toBe(200)
    expect((await post.json()) as { event: { actorId: string } }).toMatchObject({
      event: { actorId: 'u-ada' },
    })
  })
})
