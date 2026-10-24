/**
 * The account: its name, its billing record, and the two ways to destroy it.
 *
 * The Account Admin is the instance administrator under the name the role earns (task 126). What is
 * asserted here is what that role can do and — more importantly — the two deletions: one scoped to a
 * workspace and leaving the account standing, one taking everything and answering only once nothing
 * is left.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { accountTables, readAccount, remainingRows } from './account'

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

  // The domain these tests sign in through: admission itself is asserted elsewhere.
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

  return { db, request, signIn }
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

describe('the account record', () => {
  it('is the name and four billing fields, and nothing that could be charged', async () => {
    const { db } = await world()
    const columns = (await db.all<{ name: string }>('PRAGMA table_info(instance_settings)')).map((column) => column.name)

    for (const field of ['name', 'billing_email', 'company_name', 'billing_reference', 'plan']) {
      expect(columns).toContain(field)
    }
    // The liability this table refuses to hold.
    for (const forbidden of ['card', 'cvc', 'cvv', 'iban', 'account_number', 'sort_code']) {
      expect(columns.filter((column) => column.includes(forbidden))).toEqual([])
    }
  })

  it('is edited by an Account Admin, and the change is recorded', async () => {
    const { db, signIn } = await world()
    const admin = await signIn('admin@example.com')

    const saved = await admin.call(
      '/api/admin/account',
      json('PATCH', { name: 'Northwind', billing: { email: 'billing@northwind.example', company: 'Northwind Ltd', plan: 'Team', reference: 'cus_123' } }),
    )
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({
      name: 'Northwind',
      billing: { email: 'billing@northwind.example', company: 'Northwind Ltd', plan: 'Team', reference: 'cus_123' },
    })

    expect(await readAccount(db)).toMatchObject({ name: 'Northwind' })
    const trail = await db.all<{ action: string; data: string }>(
      "SELECT action, data FROM audit_events WHERE action LIKE 'account.%' ORDER BY id",
    )
    expect(trail.map((row) => row.action)).toEqual(['account.rename', 'account.billing'])
    // Field names, never the values: the billing record is somebody's address.
    expect(JSON.parse(trail[1].data)).toEqual({ fields: ['billing_email', 'company_name', 'billing_reference', 'plan'] })
  })

  it('refuses an address that is not one, and an empty name', async () => {
    const { signIn } = await world()
    const admin = await signIn('admin@example.com')

    expect((await admin.call('/api/admin/account', json('PATCH', { billing: { email: 'nope' } }))).status).toBe(400)
    expect((await admin.call('/api/admin/account', json('PATCH', { name: '   ' }))).status).toBe(400)
  })

  it('is refused to a member, for every power it carries', async () => {
    const { signIn } = await world()
    await signIn('admin@example.com')
    const member = await signIn('member@example.com')

    expect((await member.call('/api/admin/account', json('PATCH', { name: 'Theirs now' }))).status).toBe(403)
    expect((await member.call('/api/admin/account', json('PATCH', { billing: { company: 'x' } }))).status).toBe(403)
    expect((await member.call(`/api/admin/account/admins/${member.id}`, json('PATCH', { role: 'admin' }))).status).toBe(403)
    expect((await member.call('/api/admin/account/workspaces/workspace', { method: 'DELETE' })).status).toBe(403)
    expect((await member.call('/api/admin/account', json('DELETE', { confirm: 'Flowline' }))).status).toBe(403)
  })
})

describe('delegation', () => {
  it('appoints a second Account Admin, and refuses to unappoint the last one', async () => {
    const { db, signIn } = await world()
    const first = await signIn('first@example.com')
    const second = await signIn('second@example.com')

    expect((await first.call(`/api/admin/account/admins/${second.id}`, json('PATCH', { role: 'admin' }))).status).toBe(200)
    expect(await db.get('SELECT role FROM instance_members WHERE user_id = ?1', [second.id])).toEqual({ role: 'admin' })

    // Two administrators: either may step down.
    expect((await first.call(`/api/admin/account/admins/${second.id}`, json('PATCH', { role: 'member' }))).status).toBe(200)

    // One left: the last one is refused, with a sentence that says what to do instead.
    const refused = await first.call(`/api/admin/account/admins/${first.id}`, json('PATCH', { role: 'member' }))
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { error: string }).error).toContain('last Account Admin')
  })
})

describe('deleting a workspace', () => {
  /** A second workspace with a card in it, so "deleted" has something to be deleted from. */
  const secondWorkspace = async (db: Database) => {
    await db.run("INSERT INTO workspaces (id, name) VALUES ('other', 'Another')")
    await db.run(
      "INSERT INTO items (id, title, type_id, created_at, rev, workspace_id) VALUES ('i-other', 'Theirs', 't-card', 0, 1, 'other')",
    )
    await db.run("INSERT INTO changes (item_id, rev) VALUES ('i-other', 1)")
  }

  it('takes that workspace’s work, leaves the account, and records the act', async () => {
    const { db, signIn } = await world()
    const admin = await signIn('admin@example.com')
    await secondWorkspace(db)

    const answer = await admin.call('/api/admin/account/workspaces/other', { method: 'DELETE' })
    expect(answer.status).toBe(204)

    expect(await db.get("SELECT 1 AS seen FROM items WHERE id = 'i-other'")).toBeUndefined()
    expect(await db.get("SELECT 1 AS seen FROM workspaces WHERE id = 'other'")).toBeUndefined()
    expect(await db.get("SELECT 1 AS seen FROM changes WHERE item_id = 'i-other'")).toBeUndefined()

    // The account and its own workspace are untouched…
    expect(await db.get("SELECT 1 AS seen FROM workspaces WHERE id = 'workspace'")).toEqual({ seen: 1 })
    expect(await db.get('SELECT name FROM instance_settings')).toEqual({ name: 'Flowline' })
    // …and the trail survives the thing it describes.
    expect(
      await db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'workspace.delete'"),
    ).toEqual({ data: JSON.stringify({ name: 'Another' }) })
  })

  it('refuses the account’s only workspace, and points at the alternative', async () => {
    const { signIn } = await world()
    const admin = await signIn('admin@example.com')

    const refused = await admin.call('/api/admin/account/workspaces/workspace', { method: 'DELETE' })
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { error: string }).error).toContain('Close the account')
  })

  it('is a 404 for a workspace that does not exist', async () => {
    const { signIn } = await world()
    const admin = await signIn('admin@example.com')
    expect((await admin.call('/api/admin/account/workspaces/nope', { method: 'DELETE' })).status).toBe(404)
  })
})

describe('closing the account', () => {
  it('asks for the name, and takes everything when it is given', async () => {
    const { db, signIn } = await world()
    const admin = await signIn('admin@example.com')
    await db.run(
      "INSERT INTO items (id, title, type_id, created_at, rev, workspace_id) VALUES ('i-1', 'A card', 't-card', 0, 1, 'workspace')",
    )

    // A confirmation the client would show is not a confirmation the server accepts.
    expect((await admin.call('/api/admin/account', json('DELETE', { confirm: 'not the name' }))).status).toBe(400)
    expect(await db.get("SELECT 1 AS seen FROM items WHERE id = 'i-1'")).toEqual({ seen: 1 })

    const answer = await admin.call('/api/admin/account', json('DELETE', { confirm: 'Flowline' }))
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ closed: true })

    // Every table this database holds, not a list somebody remembered to update.
    expect(await remainingRows(db)).toEqual([])
    expect((await accountTables(db)).length).toBeGreaterThan(20)
    // The schema's own record stays: it describes the shape, not anybody's data.
    expect(await db.get("SELECT 1 AS seen FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")).toEqual({
      seen: 1,
    })
  })
})
