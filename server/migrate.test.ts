/**
 * The server's migrations, rehearsed against a database that already has rows.
 *
 * The property that matters is not "the files run" — they always do — but that running them over
 * data written by the previous shape keeps that data. A migration that reseeded would pass a test
 * that only counted tables.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate, schemaVersion } from './migrate'
import type { Migration } from './migrate'
import { fromSqlite } from './sqlite'

const DIR = new URL('../migrations/', import.meta.url)

const files = readdirSync(DIR)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort()
  .map((file) => readFileSync(new URL(file, DIR), 'utf8'))

const all: Migration[] = files.map((sql, index) => ({ version: index + 1, name: `${index + 1}`, sql }))

describe('the server schema', () => {
  it('applies every file, in order, and says where it is', async () => {
    const db = fromSqlite(new DatabaseSync(':memory:'))

    const result = await migrate(db, all)
    expect(result.applied).toEqual(all.map((migration) => migration.version))
    expect(result.version).toBe(all.length)
    expect(await schemaVersion(db)).toBe(all.length)
  })

  it('does not run what has already run', async () => {
    const db = fromSqlite(new DatabaseSync(':memory:'))
    await migrate(db, all)

    const again = await migrate(db, all)
    expect(again.applied).toEqual([])
    expect(again.version).toBe(all.length)
  })

  it('carries what exists through a later migration', async () => {
    const raw = new DatabaseSync(':memory:')
    // The shape *before* the workspace became a row: no `workspaces` table, no `workspace_id`, and
    // every migration since still to run. That is the database a real self-hoster has when they
    // upgrade. Named by version rather than counted from the end, so adding a migration does not
    // quietly move the line this test draws.
    const since = 18
    const older = all.filter((migration) => migration.version < since)
    for (const migration of older) raw.exec(migration.sql)
    raw.exec(`
      INSERT INTO boards (id, name, band, description, position) VALUES ('b-1', 'Atlas', 'team', 'Kept.', 0);
      INSERT INTO items (id, title, type_id, created_at, rev) VALUES ('i-1', 'A card', 't-card', 1700000000000, 3);
    `)

    const db = fromSqlite(raw)
    const result = await migrate(db, all)

    // Behind, and it knows it: only the ones it is missing run.
    expect(result.applied).toEqual(all.filter((migration) => migration.version >= since).map((migration) => migration.version))
    expect(result.version).toBe(all.length)
    // Nothing was reseeded: the board and the card are still the ones that were there…
    expect(await db.get('SELECT name FROM boards WHERE id = ?1', ['b-1'])).toEqual({ name: 'Atlas' })
    expect(await db.get("SELECT title, rev, workspace_id FROM items WHERE id = 'i-1'")).toEqual({
      title: 'A card',
      rev: 3,
      workspace_id: 'workspace',
    })
    // …and the migration that made the workspace a row gave them theirs.
    expect(await db.get("SELECT name FROM workspaces WHERE id = 'workspace'")).toEqual({ name: 'Flowline' })
  })

  it('takes the bill away and keeps the workspace it belonged to', async () => {
    const raw = new DatabaseSync(':memory:')
    // A database from before task 166: the workspace carries an owner and a billing record.
    const since = 21
    for (const migration of all.filter((candidate) => candidate.version < since)) raw.exec(migration.sql)
    raw.exec(`
      INSERT INTO users (id, name, email) VALUES ('u-1', 'Ada', 'ada@example.com');
      UPDATE workspaces SET name = 'Atlas', owner_id = 'u-1', billing_email = 'billing@atlas.example',
        company_name = 'Atlas Ltd', billing_reference = 'cus_1', plan = 'Team'
       WHERE id = 'workspace';
      INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('workspace', 'u-1', 'admin');
      INSERT INTO boards (id, name, band, description, position, workspace_id)
        VALUES ('b-1', 'Atlas', 'team', 'Kept.', 0, 'workspace');
    `)

    const db = fromSqlite(raw)
    const result = await migrate(db, all)
    expect(result.applied).toEqual([since])
    expect(result.version).toBe(all.length)

    // The workspace, its name, its administrator and its work are all still there…
    expect(await db.get("SELECT name FROM workspaces WHERE id = 'workspace'")).toEqual({ name: 'Atlas' })
    expect(await db.get("SELECT role FROM workspace_members WHERE user_id = 'u-1'")).toEqual({ role: 'admin' })
    expect(await db.get("SELECT name FROM boards WHERE id = 'b-1'")).toEqual({ name: 'Atlas' })
    // …and the commercial columns are not.
    const columns = (await db.all<{ name: string }>('PRAGMA table_info(workspaces)')).map((column) => column.name)
    for (const gone of ['owner_id', 'billing_email', 'company_name', 'billing_reference', 'plan']) {
      expect(columns, gone).not.toContain(gone)
    }
  })

  it('leaves the version where it was when a file fails, so the next attempt starts it again', async () => {
    const db = fromSqlite(new DatabaseSync(':memory:'))
    await migrate(db, all)

    const broken: Migration[] = [{ version: all.length + 1, name: 'broken', sql: 'CREATE TABLE ok (id TEXT); CREATE TABLE bad (id TEXT REFERENCES nothing (id));' }]
    await expect(migrate(db, broken)).rejects.toThrow(/broken failed/)
    expect(await schemaVersion(db)).toBe(all.length)
    // The half-applied statement went with the rollback.
    expect(await db.get("SELECT name FROM sqlite_master WHERE name = 'ok'")).toBeUndefined()
  })
})
