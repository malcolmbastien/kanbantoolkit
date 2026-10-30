/**
 * Sealed to the workspace, proved twice.
 *
 * The first proof is structural: a search of the server's own source for a statement that touches a
 * table of work without naming a workspace. It cannot see a query built out of a variable — `add()`
 * in `write.ts` is the one that is — and it is not a type system, but it is the thing that catches
 * the query somebody adds next month in a hurry.
 *
 * The second proof is at the door: a person who is not a member is refused rather than shown an
 * empty board, an administrator may enter a workspace they are not on, a removal takes effect on
 * the next request, and a card id from another workspace is a refusal rather than a creation.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { writeWorkspace } from './workspace/write'
import type { Workspace } from './workspace/types'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

/** The tables that carry a workspace of their own — the ones a query must scope. */
const TABLES = [
  'boards',
  'board_flows',
  'lanes',
  'items',
  'placements',
  'edges',
  'links',
  'objectives',
  'key_results',
  'people',
  'issue_types',
  'item_log',
  'board_templates',
]

/** Every `.ts` the server ships, tests excluded: the tests are allowed to read whatever they like. */
function sources(): Array<[string, string]> {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = `${dir}/${name}`
      if (statSync(path).isDirectory()) return walk(path)
      return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
    })
  return walk('server').map((path) => [path, readFileSync(path, 'utf8')])
}

describe('the seal, in the source', () => {
  it('has no statement that touches work without naming the workspace', () => {
    const offenders: string[] = []
    for (const [file, text] of sources()) {
      const lines = text.split('\n')
      lines.forEach((line, index) => {
        const match = line.match(new RegExp(`\\b(?:FROM|INTO|UPDATE|DELETE FROM)\\s+(?:${TABLES.join('|')})\\b`))
        if (!match) return
        // The statement and the comment above it: a marker belongs beside the query it explains.
        const context = `${lines[index - 1] ?? ''} ${line}`
        // The scope is either in the statement, or named in a comment beside it: a child reached
        // through its parent (`item_log` by `item_id`), or a count of the whole instance for a
        // backup. Both are decisions, and both say so where they are made.
        if (context.includes('workspace_id')) return
        if (/scoped by its |whole instance, by design/.test(context)) return
        offenders.push(`${file}:${index + 1} — ${line.trim().slice(0, 90)}`)
      })
    }
    expect(offenders).toEqual([])
  })
})

function database(): Database {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

const empty = (): Workspace => ({
  meUserId: 'u-ada',
  boardId: '',
  flows: [],
  users: [{ id: 'u-ada', name: 'Ada' }],
  issueTypes: [{ id: 't-card', name: 'Card', color: '#0ea5e9' }],
  boards: [],
  lanes: [],
  items: [],
  placements: [],
  edges: [],
  links: [],
  objectives: [],
  keyResults: [],
  boardTemplates: [],
  savedFilters: [],
  collapsedLanes: {},
})

const cookieOf = (response: Response) =>
  `fl_session=${(response.headers.get('set-cookie') ?? '').match(/fl_session=([^;]+)/)?.[1] ?? ''}`

async function world() {
  const db = database()
  // Two workspaces, so "sealed" is a claim with something to be sealed from.
  await db.run("INSERT INTO workspaces (id, name) VALUES ('other', 'Another')")
  await writeWorkspace(db, empty(), 'workspace')

  const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
  const request = (path: string, init?: RequestInit) => app.request(path, init, { AUTH_DEV: '1' })

  const dev = async (email: string) => {
    const response = await request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    return { response, cookie: cookieOf(response) }
  }

  const as = (cookie: string) => (path: string, init: RequestInit = {}) =>
    request(path, { ...init, headers: { 'content-type': 'application/json', cookie, ...init.headers } })

  return { db, request, dev, as }
}

describe('the seal, at the door', () => {
  it('refuses somebody who is not a member, rather than showing them nothing', async () => {
    const { db, dev, as } = await world()
    const ada = await dev('ada@example.com')
    // A person who may sign in to the instance and belongs to no workspace: the door and the
    // authority are two axes, and this is the first without the second.
    await db.run("INSERT INTO users (id, name, email) VALUES ('u-outsider', 'Outsider', 'outsider@example.com')")
    await db.run("INSERT INTO instance_members (user_id, role) VALUES ('u-outsider', 'member')")
    await db.run(
      "INSERT INTO sessions (id, public_id, user_id, expires_at) VALUES ('s-outsider', 's-outsider', 'u-outsider', '2999-01-01T00:00:00.000Z')",
    )
    const token = 'outsider-token'
    const { sha256 } = await import('./auth/oauth')
    await db.run('UPDATE sessions SET id = ?1 WHERE id = ?2', [await sha256(token), 's-outsider'])

    const answer = await as(`fl_session=${token}`)('/api/workspace')
    // 404 rather than 403: naming the difference would confirm a workspace they cannot see.
    expect(answer.status).toBe(404)
    expect(((await answer.json()) as { error: string }).error).toBe('no such workspace')

    // And the member is not affected.
    expect((await as(ada.cookie)('/api/workspace')).status).toBe(200)
  })

  it('lets an instance administrator enter a workspace they are not on', async () => {
    const { db, dev, as } = await world()
    const ada = await dev('ada@example.com')
    // The administrator, with no membership row at all: repairing a team you are not on is the
    // reason the two axes are separate.
    await db.run("DELETE FROM workspace_members WHERE user_id = (SELECT id FROM users WHERE email = 'ada@example.com')")

    const read = await as(ada.cookie)('/api/workspace')
    expect(read.status).toBe(200)
    expect(((await read.json()) as { boards: unknown[] }).boards).toEqual([])

    // …and may administer it: the members list is a `workspace.members` action.
    expect((await as(ada.cookie)('/api/admin/workspace')).status).toBe(200)
  })

  it('takes effect on the next request when a member is removed', async () => {
    const { db, dev, as } = await world()
    // Ada first, so she owns the instance and Grace is an ordinary member — the first account is
    // the administrator, and an administrator is refused by nothing here.
    await dev('ada@example.com')
    // The roster is closed, so a second person needs a door: a domain the instance admits.
    await db.run('UPDATE instance_settings SET allowed_domains = ?1', [JSON.stringify(['example.com'])])
    const grace = await dev('grace@example.com')
    // Admission is an account, not a seat (task 162): the seat is put here so the removal below has
    // something to remove.
    await db.run(
      "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('workspace', (SELECT id FROM users WHERE email = 'grace@example.com'), 'editor')",
    )
    expect((await as(grace.cookie)('/api/workspace')).status).toBe(200)

    await db.run("DELETE FROM workspace_members WHERE user_id = (SELECT id FROM users WHERE email = 'grace@example.com')")

    // No re-login, no new session: the membership is read on every request.
    expect((await as(grace.cookie)('/api/workspace')).status).toBe(404)
  })

  it('refuses a card id from another workspace instead of adopting it', async () => {
    const { db, dev, as } = await world()
    const ada = await dev('ada@example.com')

    // A card that lives in the other workspace.
    await db.run(
      "INSERT INTO items (id, title, type_id, created_at, rev, workspace_id) VALUES ('i-theirs', 'Theirs', 't-card', 0, 1, 'other')",
    )

    const answer = await as(ada.cookie)('/api/workspace/items/i-theirs', {
      method: 'PATCH',
      body: JSON.stringify({ baseRev: 1, item: { id: 'i-theirs', title: 'Mine now', typeId: 't-card', createdAt: 0 } }),
    })
    expect(answer.status).toBe(404)

    // The row is untouched, and no copy was made in this workspace.
    expect(await db.get("SELECT title, workspace_id FROM items WHERE id = 'i-theirs'")).toEqual({
      title: 'Theirs',
      workspace_id: 'other',
    })
    expect(await db.get("SELECT COUNT(*) AS n FROM items WHERE workspace_id = 'workspace'")).toEqual({ n: 0 })

    // The pen is refused for the same reason: a lease on somebody else's card is a write waiting
    // to happen.
    const pen = await as(ada.cookie)('/api/workspace/items/i-theirs/lock', {
      method: 'POST',
      headers: { 'x-kanbantoolkit-tab': 'test' },
    })
    expect(pen.status).toBe(404)
  })

  it('serves the feed of this workspace only', async () => {
    const { db, dev, as } = await world()
    const ada = await dev('ada@example.com')

    await db.run("INSERT INTO items (id, title, type_id, created_at, rev, workspace_id) VALUES ('i-theirs', 'Theirs', 't-card', 0, 1, 'other')")
    await db.run("INSERT INTO changes (item_id, rev) VALUES ('i-theirs', 1)")
    await db.run("INSERT INTO items (id, title, type_id, created_at, rev, workspace_id) VALUES ('i-mine', 'Mine', 't-card', 0, 1, 'workspace')")
    await db.run("INSERT INTO changes (item_id, rev) VALUES ('i-mine', 1)")

    const feed = (await (await as(ada.cookie)('/api/workspace/changes?since=0')).json()) as {
      changes: Array<{ item: { id: string } | null }>
    }
    expect(feed.changes.map((change) => change.item?.id)).toEqual(['i-mine'])
  })
})
