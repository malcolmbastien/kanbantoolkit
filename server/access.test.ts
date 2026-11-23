/**
 * The authorization core, asked directly.
 *
 * Route tests prove a guard is wired; these prove the rule underneath it: a direct role, a group
 * grant, an administrator repairing a workspace they are not on, and the same 404 for "missing" and
 * "not yours".
 */
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { resolveWorkspace } from './access'
import type { Database } from './db'
import { fromSqlite } from './sqlite'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

function database(): Database {
  const db = new DatabaseSync(':memory:')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

async function world(): Promise<Database> {
  const db = database()
  for (const id of ['w-a', 'w-b']) await db.run('INSERT INTO workspaces (id, name) VALUES (?1, ?2)', [id, id])
  for (const id of ['u-direct', 'u-group', 'u-admin', 'u-outside']) {
    await db.run('INSERT INTO users (id, name, email) VALUES (?1, ?1, ?2)', [id, `${id}@example.com`])
    await db.run('INSERT INTO instance_members (user_id, role) VALUES (?1, ?2)', [id, id === 'u-admin' ? 'admin' : 'member'])
  }
  await db.run("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('w-a', 'u-direct', 'editor')")
  await db.run("INSERT INTO groups (id, name) VALUES ('g-designers', 'Designers')")
  await db.run("INSERT INTO group_members (group_id, user_id) VALUES ('g-designers', 'u-group')")
  await db.run("INSERT INTO group_workspace_roles (group_id, workspace_id, role) VALUES ('g-designers', 'w-b', 'viewer')")
  return db
}

describe('resolveWorkspace', () => {
  it('reads a direct role, and refuses a workspace the person is not in', async () => {
    const db = await world()
    expect(await resolveWorkspace(db, 'u-direct', false, undefined)).toEqual({ id: 'w-a', role: 'editor', source: 'direct' })
    expect(await resolveWorkspace(db, 'u-direct', false, 'w-b')).toBeUndefined()
  })

  it('lets a group grant be the way in, with its name as the source', async () => {
    const db = await world()
    expect(await resolveWorkspace(db, 'u-group', false, 'w-b')).toEqual({
      id: 'w-b',
      role: 'viewer',
      source: 'group:Designers',
      groupName: 'Designers',
    })
  })

  it('lets an instance administrator repair a workspace they are not on, if it exists', async () => {
    const db = await world()
    expect(await resolveWorkspace(db, 'u-admin', true, 'w-b')).toEqual({ id: 'w-b', role: 'admin', source: 'instance' })
    expect(await resolveWorkspace(db, 'u-admin', true, 'missing')).toBeUndefined()
  })

  it('gives the same empty answer for a missing workspace and one somebody cannot see', async () => {
    const db = await world()
    expect(await resolveWorkspace(db, 'u-outside', false, 'missing')).toBeUndefined()
    expect(await resolveWorkspace(db, 'u-outside', false, 'w-a')).toBeUndefined()
  })
})
