/**
 * The migration of what exists, rehearsed against the shape it came from.
 *
 * The database is built by the *old* migrations and given the rows a real instance would have had —
 * an owner and a member in `members`, an invitation with no token, a board and a card. Then the new
 * files run, and the test asks the only question that matters: did anybody lose an ability, and did
 * anything they wrote disappear?
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from './migrate'
import type { Migration } from './migrate'
import { fromSqlite } from './sqlite'

const DIR = new URL('../migrations/', import.meta.url)

const all: Migration[] = readdirSync(DIR)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort()
  .map((file) => ({ version: Number(file.slice(0, 4)), name: file, sql: readFileSync(new URL(file, DIR), 'utf8') }))

/** The shape before the two axes: everything up to and including the leases. */
const OLD = 7

function oldDatabase() {
  const raw = new DatabaseSync(':memory:')
  for (const migration of all.filter((entry) => entry.version <= OLD)) raw.exec(migration.sql)

  raw.exec(`
    INSERT INTO users (id, name, email) VALUES ('u-owner', 'Ada', 'ada@example.com');
    INSERT INTO users (id, name, email) VALUES ('u-member', 'Grace', 'grace@example.com');
    INSERT INTO members (user_id, role) VALUES ('u-owner', 'owner');
    INSERT INTO members (user_id, role) VALUES ('u-member', 'member');

    -- An invitation from before there were tokens: it can never become a link.
    INSERT INTO invites (email, role) VALUES ('newcomer@example.com', 'member');

    INSERT INTO boards (id, name, band, description, position) VALUES ('b-1', 'Atlas', 'team', 'Kept.', 0);
    INSERT INTO lanes (id, board_id, parent_id, position, name, workflow, stage)
      VALUES ('l-1', 'b-1', NULL, 0, 'Backlog', 'cards', 'backlog');
    INSERT INTO items (id, title, type_id, created_at, rev) VALUES ('i-1', 'A card', 't-card', 1700000000000, 3);
    INSERT INTO placements (id, board_id, item_id, lane_id) VALUES ('p-1', 'b-1', 'i-1', 'l-1');
  `)

  return fromSqlite(raw)
}

describe('the migration from one role column to two axes', () => {
  it('leaves every existing person with the ability they had', async () => {
    const db = oldDatabase()
    const result = await migrate(db, all)

    expect(result.applied).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22])
    expect(result.version).toBe(22)

    // The owner administers the instance and the workspace; the member remains a member here and
    // keeps the editing they could already do.
    expect(await db.all('SELECT user_id, role FROM instance_members ORDER BY user_id')).toEqual([
      { user_id: 'u-member', role: 'member' },
      { user_id: 'u-owner', role: 'admin' },
    ])
    expect(await db.all('SELECT user_id, role FROM workspace_members ORDER BY user_id')).toEqual([
      { user_id: 'u-member', role: 'editor' },
      { user_id: 'u-owner', role: 'admin' },
    ])
  })

  it('drops an invitation that could never have become a link', async () => {
    const db = oldDatabase()
    await migrate(db, all)

    // The choice is the migration's, and it is asserted rather than trusted to the comment above it.
    expect(await db.all('SELECT * FROM invites')).toEqual([])
  })

  it('changes no work at all, and gives every row the one workspace', async () => {
    const db = oldDatabase()
    const before = await db.all<Record<string, unknown>>('SELECT * FROM items')
    const boardsBefore = await db.all<Record<string, unknown>>('SELECT * FROM boards')
    const placementsBefore = await db.all<Record<string, unknown>>('SELECT * FROM placements')

    await migrate(db, all)

    // The scope is the one thing added; nothing that was there moved, and no id changed.
    const unscoped = (rows: Array<Record<string, unknown>>) =>
      rows.map(({ workspace_id: _scope, ...rest }) => rest)

    expect(unscoped(await db.all('SELECT * FROM items'))).toEqual(before)
    expect(unscoped(await db.all('SELECT * FROM boards'))).toEqual(boardsBefore)
    expect(unscoped(await db.all('SELECT * FROM placements'))).toEqual(placementsBefore)
    expect(before[0]).toMatchObject({ title: 'A card', rev: 3 })

    for (const table of ['items', 'boards', 'placements', 'lanes', 'people', 'issue_types', 'item_log']) {
      const rows = await db.all<{ workspace_id: string | null }>(`SELECT workspace_id FROM ${table}`)
      expect(rows.every((row) => row.workspace_id === 'workspace'), table).toBe(true)
    }
    expect(await db.all('SELECT id, name FROM workspaces')).toEqual([{ id: 'workspace', name: 'Flowline' }])
  })

  it('retires the table that answered two questions with one column', async () => {
    const db = oldDatabase()
    await migrate(db, all)

    expect(await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'members'")).toBeUndefined()
  })
})
