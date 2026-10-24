/**
 * The workspace is a row, and every entity names it.
 *
 * Task 122.1. What is asserted here is the container rather than the behaviour of a board: that a
 * row of work cannot exist without a workspace, that a row of *another* workspace is not in the
 * read, and that the migration put everything this instance already had into the one workspace it
 * already had.
 *
 * The seal itself — every route resolving the scope from the session, and refusing a workspace you
 * are not in — is 122.2's job, and its tests live with it.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { readWorkspace } from './workspace/read'
import { writeItem, writeWorkspace } from './workspace/write'
import type { Workspace } from './workspace/types'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

function database(): Database {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

/** The tables R1 names, minus the settings row (keyed by the workspace) and the children (by parent). */
const SCOPED = [
  'people',
  'issue_types',
  'boards',
  'lanes',
  'items',
  'item_log',
  'placements',
  'edges',
  'links',
  'objectives',
  'key_results',
  'board_templates',
]

const workspace = (): Workspace => ({
  meUserId: 'u-ada',
  boardId: '',
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

describe('every entity names its workspace', () => {
  it('has the column on every table that holds work', async () => {
    const db = database()
    for (const table of SCOPED) {
      const columns = await db.all<{ name: string }>(`PRAGMA table_info(${table})`)
      expect(columns.map((column) => column.name), table).toContain('workspace_id')
    }
    // The settings row carries it as its identity rather than as a second column.
    expect(await db.all<{ name: string }>('PRAGMA table_info(workspace)')).not.toContainEqual(
      expect.objectContaining({ name: 'workspace_id' }),
    )
    expect(await db.get<{ id: string }>('SELECT id FROM workspace')).toBeUndefined()
    expect(await db.all('SELECT id, name FROM workspaces')).toEqual([{ id: 'workspace', name: 'Flowline' }])
  })

  it('refuses a row written without one', async () => {
    const db = database()
    // The column is nullable — SQLite will not add a `REFERENCES` column with a default — so the
    // refusal is a trigger, which is what makes the rule true rather than intended.
    await expect(db.run("INSERT INTO boards (id, name) VALUES ('b-orphan', 'Nowhere')")).rejects.toThrow(
      /belongs to a workspace/,
    )
    await expect(
      db.run("INSERT INTO boards (id, name, band, position, workspace_id) VALUES ('b-nowhere', 'Nowhere', 'team', 0, 'nope')"),
    ).rejects.toThrow(/FOREIGN KEY/)
  })

  it('keeps another workspace’s work out of a read', async () => {
    const db = database()
    await writeWorkspace(db, workspace(), 'workspace')
    // A board that belongs somewhere else: the read is a scope, not a filter over everything.
    await db.run("INSERT INTO workspaces (id, name) VALUES ('other', 'Another')")
    await db.run(
      "INSERT INTO boards (id, name, band, position, workspace_id) VALUES ('b-other', 'Theirs', 'team', 0, 'other')",
    )

    const mine = await readWorkspace(db, 'workspace')
    expect(mine.boards.map((board) => board.id)).toEqual([])

    const theirs = await readWorkspace(db, 'other')
    expect(theirs.boards.map((board) => board.id)).toEqual(['b-other'])
  })

  it('writes the scope onto every row it inserts, and replaces only its own', async () => {
    const db = database()
    const other = { ...workspace(), boards: [] }
    await db.run("INSERT INTO workspaces (id, name) VALUES ('other', 'Another')")
    await db.run(
      "INSERT INTO boards (id, name, band, position, workspace_id) VALUES ('b-other', 'Theirs', 'team', 0, 'other')",
    )

    await writeWorkspace(db, other, 'workspace')

    // The other workspace's board survived the import, because the import replaces one workspace.
    expect(await db.get("SELECT 1 AS seen FROM boards WHERE id = 'b-other'")).toEqual({ seen: 1 })

    const item = { id: 'i-1', title: 'A card', typeId: 't-card', createdAt: 0, rev: 1 }
    await writeItem(db, item, 'workspace')
    expect(await db.get("SELECT workspace_id FROM items WHERE id = 'i-1'")).toEqual({ workspace_id: 'workspace' })
  })
})
