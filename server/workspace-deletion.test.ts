/**
 * The end of a workspace: who may do it, what it takes with it, and what the schema refuses to keep.
 *
 * Two things are asserted here. The **workspace administrator** may delete the workspace and a
 * **member may not**, and the act reaches nothing outside that workspace — not another workspace,
 * not the deployment's operator. And the schema holds no bill at all (task 166): no owner, no
 * billing address, no plan, and nothing that could be charged.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { writeWorkspace } from './workspace/write'
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

const seeded = (): Workspace => ({
  meUserId: 'u-owner',
  boardId: '',
  users: [],
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
  await writeWorkspace(db, seeded(), 'workspace')
  await db.run("UPDATE workspace SET name = 'Team Atlas' WHERE id = 'workspace'")

  const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
  const request = (path: string, init?: RequestInit) => app.request(path, init, { AUTH_DEV: '1' })
  await db.run('UPDATE instance_settings SET allowed_domains = ?1', [JSON.stringify(['example.com'])])

  /**
   * An operator: administers the deployment, belongs to no workspace. Deleting a workspace deletes
   * its accounts, so somebody has to be outside it or the deployment would lose its last
   * administrator — the guard that makes the deletion refuse.
   */
  const operator = async () => {
    const response = await request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'operator@example.com' }),
    })
    const id = (await db.get<{ id: string }>("SELECT id FROM users WHERE email = 'operator@example.com'"))!.id
    await db.run("UPDATE instance_members SET role = 'admin' WHERE user_id = ?1", [id])
    await db.run('DELETE FROM workspace_members WHERE user_id = ?1', [id])
    return { cookie: cookieOf(response), id }
  }

  const signIn = async (email: string, role: 'viewer' | 'editor' | 'admin' = 'admin') => {
    const response = await request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (response.status !== 200) throw new Error(`sign-in refused for ${email}: ${response.status}`)
    const cookie = cookieOf(response)
    const person = (await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?1', [email]))!
    await db.run(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('workspace', ?1, ?2)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`,
      [person.id, role],
    )
    const call = (path: string, init: RequestInit = {}) =>
      request(path, { ...init, headers: { 'content-type': 'application/json', cookie, ...init.headers } })
    return { cookie, id: person.id, call }
  }

  return { db, request, signIn, operator }
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

describe('the schema', () => {
  it('holds no owner, no bill and no plan — nothing to charge and nowhere to send it', async () => {
    const { db } = await world()
    const columns = (await db.all<{ name: string }>('PRAGMA table_info(workspaces)')).map((column) => column.name)

    // Task 166: the commercial shape left with the plans.
    for (const gone of ['owner_id', 'billing_email', 'company_name', 'billing_reference', 'plan']) {
      expect(columns, gone).not.toContain(gone)
    }
    // And the deployment never had one.
    const settings = (await db.all<{ name: string }>('PRAGMA table_info(instance_settings)')).map((column) => column.name)
    expect(settings).not.toContain('billing_email')
    expect(settings).not.toContain('plan')

    // What the workspace is still made of: its identity, and when it arrived.
    expect(columns).toEqual(expect.arrayContaining(['id', 'name', 'created_at']))

    // The liability this table has never held, and still does not.
    for (const forbidden of ['card', 'cvc', 'cvv', 'iban', 'account_number', 'sort_code']) {
      expect(columns.filter((column) => column.includes(forbidden))).toEqual([])
    }
  })
})

describe('deleting the workspace', () => {
  /** A second workspace, so "deleted" has something to be deleted *from*. */
  const another = async (db: Database) => {
    await db.run("INSERT INTO workspaces (id, name) VALUES ('other', 'Another')")
    await db.run(
      "INSERT INTO items (id, title, type_id, created_at, rev, workspace_id) VALUES ('i-other', 'Theirs', 't-card', 0, 1, 'other')",
    )
  }

  it('is the administrator’s, and takes only that workspace', async () => {
    const { db, signIn, operator } = await world()
    const operatorPerson = await operator()
    const admin = await signIn('admin@example.com', 'admin')
    await another(db)
    await db.run(
      "INSERT INTO items (id, title, type_id, created_at, rev, workspace_id) VALUES ('i-mine', 'Mine', 't-card', 0, 1, 'workspace')",
    )

    const answer = await admin.call('/api/workspace', json('DELETE', { confirm: 'Team Atlas' }))
    expect(answer.status).toBe(204)

    // This workspace is gone…
    expect(await db.get("SELECT 1 AS seen FROM items WHERE id = 'i-mine'")).toBeUndefined()
    expect(await db.get("SELECT 1 AS seen FROM workspaces WHERE id = 'workspace'")).toBeUndefined()
    // …the other one is not…
    expect(await db.get("SELECT 1 AS seen FROM workspaces WHERE id = 'other'")).toEqual({ seen: 1 })
    expect(await db.get("SELECT 1 AS seen FROM items WHERE id = 'i-other'")).toEqual({ seen: 1 })
    // …and the accounts that belonged to it went with it, while the operator outside it did not.
    expect(await db.get("SELECT 1 AS seen FROM users WHERE email = 'admin@example.com'")).toBeUndefined()
    expect(await db.get('SELECT 1 AS seen FROM users WHERE id = ?1', [operatorPerson.id])).toEqual({ seen: 1 })
    expect(await db.get("SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = 'workspace'")).toEqual({ n: 0 })

    // The trail outlives the thing it describes.
    expect(await db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'workspace.delete'")).toEqual({
      data: JSON.stringify({ name: 'Team Atlas', by: 'Admin' }),
    })
  })

  it('is refused to a member, and changes nothing', async () => {
    const { db, signIn } = await world()
    await signIn('admin@example.com', 'admin')
    const member = await signIn('member@example.com', 'editor')

    expect((await member.call('/api/workspace', json('DELETE', { confirm: 'Team Atlas' }))).status).toBe(403)
    expect(await db.get("SELECT 1 AS seen FROM workspaces WHERE id = 'workspace'")).toEqual({ seen: 1 })
  })

  it('asks for the name — a confirmation only the client enforces is a suggestion', async () => {
    const { db, signIn } = await world()
    const admin = await signIn('admin@example.com', 'admin')

    const refused = await admin.call('/api/workspace', json('DELETE', { confirm: 'not the name' }))
    expect(refused.status).toBe(400)
    expect(await db.get("SELECT 1 AS seen FROM workspaces WHERE id = 'workspace'")).toEqual({ seen: 1 })
  })

  it('leaves nobody behind: the accounts go with it', async () => {
    const { db, signIn, operator } = await world()
    await operator()
    const admin = await signIn('admin@example.com', 'admin')
    const colleague = await signIn('colleague@example.com', 'editor')

    expect((await admin.call('/api/workspace')).status).toBe(200)
    expect((await admin.call('/api/workspace', json('DELETE', { confirm: 'Team Atlas' }))).status).toBe(204)

    // The account that asked, and the account of everybody else in the workspace, are gone — with
    // their identities and their sessions.
    for (const id of [admin.id, colleague.id]) {
      expect(await db.get('SELECT 1 AS seen FROM users WHERE id = ?1', [id])).toBeUndefined()
      expect(await db.get('SELECT 1 AS seen FROM sessions WHERE user_id = ?1', [id])).toBeUndefined()
      expect(await db.get('SELECT 1 AS seen FROM identities WHERE user_id = ?1', [id])).toBeUndefined()
    }
    // The session that asked cannot be used again, so the answer they saw is the last thing it did.
    expect((await admin.call('/api/workspace')).status).toBe(401)
    // The operator outside it is untouched.
    expect(await db.get("SELECT 1 AS seen FROM users WHERE email = 'operator@example.com'")).toEqual({ seen: 1 })
    // And the trail keeps the act, and the name of whoever did it — their id is nulled with them.
    const trail = await db.get<{ actor_id: string | null; data: string }>(
      "SELECT actor_id, data FROM audit_events WHERE action = 'workspace.delete'",
    )
    expect(trail?.actor_id).toBeNull()
    expect(JSON.parse(trail!.data)).toEqual({ name: 'Team Atlas', by: 'Admin' })
  })

  it('refuses when the workspace holds the deployment’s last administrator', async () => {
    const { db, signIn } = await world()
    // Nobody outside: this account administers the deployment and belongs to the workspace, so
    // deleting it would leave a deployment nobody can administer.
    const admin = await signIn('admin@example.com', 'admin')

    const refused = await admin.call('/api/workspace', json('DELETE', { confirm: 'Team Atlas' }))
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { error: string }).error).toContain('last administrator')
    expect(await db.get("SELECT 1 AS seen FROM users WHERE email = 'admin@example.com'")).toEqual({ seen: 1 })
  })
})
