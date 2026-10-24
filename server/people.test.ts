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

    expect(result.applied).toEqual([8, 9, 10, 11, 12, 13, 14])
    expect(result.version).toBe(14)

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

  it('changes no work at all', async () => {
    const db = oldDatabase()
    const before = await db.all('SELECT * FROM items')
    const boardsBefore = await db.all('SELECT * FROM boards')
    const placementsBefore = await db.all('SELECT * FROM placements')

    await migrate(db, all)

    expect(await db.all('SELECT * FROM items')).toEqual(before)
    expect(await db.all('SELECT * FROM boards')).toEqual(boardsBefore)
    expect(await db.all('SELECT * FROM placements')).toEqual(placementsBefore)
    expect(before[0]).toMatchObject({ title: 'A card', rev: 3 })
  })

  it('retires the table that answered two questions with one column', async () => {
    const db = oldDatabase()
    await migrate(db, all)

    expect(await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'members'")).toBeUndefined()
  })
})
