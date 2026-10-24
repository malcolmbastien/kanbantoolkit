/**
 * Removing a member ends their account, and the work keeps saying who they were.
 *
 * The three acts are not degrees of one another (task 144): **deactivate** closes a door on an
 * account that stays, **remove** deletes the account and leaves the work, and **invite** is how
 * anybody comes back — as a new account, with a new id, because the old history cannot be re-attached
 * to somebody whose identity nobody can check.
 *
 * What this file defends is the blast radius: removal reaches the person and nothing else. Every
 * item, log entry, comment, placement, edge and audit event is compared before and after.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { nameOfUser, FORMER_MEMBER } from '../src/domain/users'
import type { User } from '../src/domain/types'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

function database(): Database {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

const cookieOf = (response: Response) =>
  `fl_session=${(response.headers.get('set-cookie') ?? '').match(/fl_session=([^;]+)/)?.[1] ?? ''}`

async function world() {
  const db = database()
  const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
  const request = (path: string, init?: RequestInit) => app.request(path, init, { AUTH_DEV: '1' })
  await db.run('UPDATE instance_settings SET allowed_domains = ?1', [JSON.stringify(['example.com'])])

  const signIn = async (email: string) => {
    const response = await request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (response.status !== 200) throw new Error(`sign-in refused for ${email}: ${response.status}`)
    const cookie = cookieOf(response)
    const person = (await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?1', [email]))!
    const call = (path: string, init: RequestInit = {}) =>
      request(path, { ...init, headers: { 'content-type': 'application/json', cookie, ...init.headers } })
    return { cookie, id: person.id, call }
  }

  /** Put somebody in the workspace, the way an invitation would. */
  const join = async (id: string, role: 'viewer' | 'editor' | 'admin' = 'editor') => {
    await db.run(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('workspace', ?1, ?2)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`,
      [id, role],
    )
    await db.run("INSERT OR IGNORE INTO people (id, name, workspace_id) SELECT id, name, 'workspace' FROM users WHERE id = ?1", [id])
  }

  return { db, request, signIn, join }
}


/** The tables a removal must not touch, compared whole. */
const WORK = ['items', 'item_checklist', 'item_log', 'placements', 'edges', 'links', 'boards', 'lanes', 'objectives']

describe('deactivating', () => {
  it('closes the door and keeps the account', async () => {
    const { db, signIn, join } = await world()
    const admin = await signIn('admin@example.com')
    const person = await signIn('person@example.com')
    await join(person.id)

    expect((await admin.call(`/api/admin/workspace/members/${person.id}/deactivate`, { method: 'POST' })).status).toBe(204)

    // The account is there, the name is there, the door is shut.
    expect(await db.get('SELECT status FROM users WHERE id = ?1', [person.id])).toEqual({ status: 'inactive' })
    expect((await person.call('/api/workspace')).status).toBe(401)
    // …and it can be opened again, because nothing was deleted.
    expect((await admin.call(`/api/admin/workspace/members/${person.id}/activate`, { method: 'POST' })).status).toBe(204)
    expect(await db.get('SELECT status FROM users WHERE id = ?1', [person.id])).toEqual({ status: 'active' })
  })
})

describe('removing', () => {
  it('deletes the account, and touches none of the work', async () => {
    const { db, signIn, join } = await world()
    const admin = await signIn('admin@example.com')
    const person = await signIn('person@example.com')
    await join(person.id)

    // Work that names them: a log entry with their id as the author, a card assigned to them.
    await db.run(
      `INSERT INTO items (id, title, type_id, created_at, rev, workspace_id, assignees)
       VALUES ('i-1', 'A card', 't-card', 0, 1, 'workspace', ?1)`,
      [JSON.stringify([person.id])],
    )
    await db.run(
      `INSERT INTO item_log (item_id, id, at, kind, by_user, note, workspace_id)
       VALUES ('i-1', 'l-1', '2026-10-24T10:00:00.000Z', 'comment', ?1, 'We should ship this on Friday.', 'workspace')`,
      [person.id],
    )

    const before = Object.fromEntries(await Promise.all(WORK.map(async (table) => [table, await db.all(`SELECT * FROM ${table}`)])))

    expect((await admin.call(`/api/admin/workspace/members/${person.id}`, { method: 'DELETE' })).status).toBe(204)

    // The person, and everything that was a way in or a session, is gone.
    for (const table of ['identities', 'sessions', 'instance_members', 'workspace_members', 'group_members']) {
      expect(await db.get(`SELECT 1 AS seen FROM ${table} WHERE user_id = ?1`, [person.id]), table).toBeUndefined()
    }
    // The roster row is keyed by the person's own id.
    expect(await db.get('SELECT 1 AS seen FROM people WHERE id = ?1', [person.id])).toBeUndefined()
    expect(await db.get('SELECT 1 AS seen FROM users WHERE id = ?1', [person.id])).toBeUndefined()
    expect(await db.get('SELECT 1 AS seen FROM people WHERE id = ?1', [person.id])).toBeUndefined()

    // …and the work is byte-identical, including the words and the id that names them.
    const after = Object.fromEntries(await Promise.all(WORK.map(async (table) => [table, await db.all(`SELECT * FROM ${table}`)])))
    expect(after).toEqual(before)
    expect(await db.get("SELECT note, by_user FROM item_log WHERE id = 'l-1'")).toEqual({
      note: 'We should ship this on Friday.',
      by_user: person.id,
    })
    expect(JSON.parse((await db.get<{ assignees: string }>("SELECT assignees FROM items WHERE id = 'i-1'"))!.assignees)).toEqual([
      person.id,
    ])

    // The trail kept the act, and the name of the person it was about — the row it points at is gone.
    const trail = await db.get<{ actor_id: string; data: string }>(
      "SELECT actor_id, data FROM audit_events WHERE action = 'workspace.member.remove'",
    )
    expect(trail?.actor_id).toBe(admin.id)
    expect(JSON.parse(trail!.data)).toEqual({ name: 'Person', account: true })
  })

  it('lets the same address come back as a new account, with none of the old history', async () => {
    const { db, signIn, join } = await world()
    const admin = await signIn('admin@example.com')
    const first = await signIn('returning@example.com')
    await join(first.id)
    await db.run(
      `INSERT INTO items (id, title, type_id, created_at, rev, workspace_id) VALUES ('i-1', 'A card', 't-card', 0, 1, 'workspace')`,
    )
    await db.run(
      `INSERT INTO item_log (item_id, id, at, kind, by_user, note, workspace_id)
       VALUES ('i-1', 'l-1', '2026-10-24T10:00:00.000Z', 'comment', ?1, 'From the first account.', 'workspace')`,
      [first.id],
    )

    expect((await admin.call(`/api/admin/workspace/members/${first.id}`, { method: 'DELETE' })).status).toBe(204)

    // Invited again — here, the door that admits a return is the same one that admitted them first.
    const again = await signIn('returning@example.com')
    expect(again.id).not.toBe(first.id)
    await join(again.id)

    // The words remain, attributed to the account that wrote them, which no longer exists.
    expect(await db.get("SELECT by_user FROM item_log WHERE id = 'l-1'")).toEqual({ by_user: first.id })
    expect(await db.get('SELECT name FROM users WHERE id = ?1', [first.id])).toBeUndefined()
  })

  it('refuses the deployment’s last administrator', async () => {
    const { db, signIn, join } = await world()
    const admin = await signIn('admin@example.com')
    const second = await signIn('second@example.com')
    await join(second.id, 'admin')

    // The first account administers the deployment and so does nobody else yet; removing them would
    // leave it without one.
    const refused = await admin.call(`/api/admin/workspace/members/${admin.id}`, { method: 'DELETE' })
    expect(refused.status).toBe(409)
    expect(await db.get('SELECT 1 AS seen FROM users WHERE id = ?1', [admin.id])).toEqual({ seen: 1 })
  })

  it('keeps one email per workspace', async () => {
    const { db } = await world()
    await db.run("INSERT INTO users (id, name, email) VALUES ('u-1', 'Ada', 'shared@example.com')")

    // Two accounts in one workspace may not share an address; the table refuses it outright, and the
    // invitation and sign-up routes inherit that refusal because they insert here.
    await expect(
      db.run("INSERT INTO users (id, name, email) VALUES ('u-2', 'Ada again', 'shared@example.com')"),
    ).rejects.toThrow(/UNIQUE/)
  })
})

describe('the rendering rule', () => {
  it('calls an id with no account “Former member”', () => {
    const users: User[] = [{ id: 'u-1', name: 'Maya Blake' }]
    expect(nameOfUser(users, 'u-1')).toBe('Maya Blake')
    expect(nameOfUser(users, 'u-gone')).toBe(FORMER_MEMBER)
    expect(nameOfUser(users, undefined)).toBeUndefined()
  })
})
