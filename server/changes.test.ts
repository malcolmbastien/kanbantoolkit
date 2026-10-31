/**
 * The change feed belongs to one workspace, and a cursor that fell behind retention says so.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { issueSession } from './auth/session'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { pruneChanges } from './workspace/changes'

const MIGRATIONS = new URL('../migrations/', import.meta.url)
const files = () => readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()

function database(except?: string): Database {
  const db = new DatabaseSync(':memory:')
  for (const file of files().filter((name) => name !== except)) db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  return fromSqlite(db)
}

async function signedIn(db: Database): Promise<{ cookie: string }> {
  await db.run("INSERT OR IGNORE INTO users (id, name, email) VALUES ('u-ada', 'Ada', 'ada@example.com')")
  await db.run("INSERT OR IGNORE INTO instance_members (user_id, role) VALUES ('u-ada', 'admin')")
  await db.run("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES ('workspace', 'u-ada', 'admin')")
  const session = await issueSession(db, 'u-ada')
  return { cookie: `fl_session=${session.token}` }
}

function instance(db: Database) {
  const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
  return (path: string, init?: RequestInit) => app.request(path, init, {})
}

const item = (id: string, workspaceId: string) =>
  `INSERT INTO items (id, title, type_id, created_at, rev, workspace_id) VALUES ('${id}', '${id}', 't-card', 1, 1, '${workspaceId}')`

describe('the change feed', () => {
  it('never returns another workspace’s change', async () => {
    const db = database()
    await db.run("INSERT INTO workspaces (id, name) VALUES ('other', 'Other')")
    await db.run(item('i-a', 'workspace'))
    await db.run(item('i-b', 'other'))
    await db.run("INSERT INTO changes (item_id, rev, workspace_id) VALUES ('i-a', 1, 'workspace')")
    await db.run("INSERT INTO changes (item_id, rev, workspace_id) VALUES ('i-b', 1, 'other')")
    const { cookie } = await signedIn(db)

    const response = await instance(db)('/api/workspace/changes?since=0', { headers: { cookie } })
    const body = (await response.json()) as { changes: Array<{ item: { id: string } | null }> }
    expect(body.changes.map((change) => change.item?.id)).toEqual(['i-a'])
  })

  it('says a cursor has expired rather than skipping the changes it lost', async () => {
    const db = database()
    await db.run(item('i-a', 'workspace'))
    await db.run("INSERT INTO changes (item_id, rev, workspace_id, at) VALUES ('i-a', 1, 'workspace', '2020-01-01T00:00:00.000Z')")
    const kept = await db.run("INSERT INTO changes (item_id, rev, workspace_id) VALUES ('i-a', 2, 'workspace')")
    const { cookie } = await signedIn(db)

    expect(await pruneChanges(db, { days: 30 })).toBe(1)
    const expired = await instance(db)('/api/workspace/changes?since=1', { headers: { cookie } })
    expect((await expired.json()) as Record<string, unknown>).toMatchObject({ expired: true, cursor: 0, changes: [] })

    // The cursor at the oldest retained row has lost nothing.
    const keptId = Number((await db.get<{ id: number }>('SELECT MAX(id) AS id FROM changes'))?.id)
    expect(kept.changes).toBe(1)
    const fresh = await instance(db)(`/api/workspace/changes?since=${keptId}`, { headers: { cookie } })
    expect((await fresh.json()) as Record<string, unknown>).toEqual({ changes: [], cursor: keptId, locks: [] })
  })

  it('filters the feed through the workspace index', async () => {
    const db = database()
    const plan = await db.all<{ detail: string }>(
      'EXPLAIN QUERY PLAN SELECT id, item_id, rev FROM changes WHERE workspace_id = ?1 AND id > ?2 ORDER BY id LIMIT 50',
      ['workspace', 0],
    )
    expect(plan.map((row) => row.detail).join(' ')).toContain('changes_workspace')
  })

  it('backfills an existing change from the item that caused it', async () => {
    const old = database('0038_changes_workspace.sql')
    await old.run(item('i-a', 'workspace'))
    await old.run("INSERT INTO changes (item_id, rev) VALUES ('i-a', 1)")
    ;(old as unknown as { exec(sql: string): void }).exec(readFileSync(new URL('0038_changes_workspace.sql', MIGRATIONS), 'utf8'))
    expect(await old.get('SELECT id, workspace_id FROM changes')).toEqual({ id: 1, workspace_id: 'workspace' })
  })
})
