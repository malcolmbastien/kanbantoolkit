/**
 * The workspace's account: its owner, its bill, and the end of it.
 *
 * The correction of task 126's first shape. A **workspace** is the tenant — it holds many people's
 * accounts, its boards and its cards — and an **account** is a person. The owner is the account that
 * pays for the workspace: a field, not a role, because a workspace may have several administrators
 * and exactly one payer.
 *
 * Two things are asserted here, and they are the whole point of the correction:
 *
 * - the **workspace administrator** may delete the workspace, a **member may not**, and the act
 *   reaches nothing outside that workspace — not another workspace, not the people's accounts;
 * - what is billed is the **workspace**, so its record lives beside the owner it belongs to rather
 *   than on the deployment.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { readWorkspaceAccount } from './workspace/account'
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

  const signIn = async (email: string, role: 'viewer' | 'editor' | 'admin' = 'admin') => {
    const response = await request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (response.status !== 200) throw new Error(`sign-in refused for ${email}: ${response.status}`)
    const cookie = cookieOf(response)
    const person = (await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?1', [email]))!
    await db.run('UPDATE workspace_members SET role = ?2 WHERE user_id = ?1', [person.id, role])
    const call = (path: string, init: RequestInit = {}) =>
      request(path, { ...init, headers: { 'content-type': 'application/json', cookie, ...init.headers } })
    return { cookie, id: person.id, call }
  }

  return { db, request, signIn }
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

describe('the workspace’s account', () => {
  it('holds the owner and four billing fields, and nothing that could be charged', async () => {
    const { db } = await world()
    const columns = (await db.all<{ name: string }>('PRAGMA table_info(workspaces)')).map((column) => column.name)

    for (const field of ['owner_id', 'billing_email', 'company_name', 'billing_reference', 'plan']) {
      expect(columns).toContain(field)
    }
    // The deployment no longer has a billing record of its own.
    const settings = (await db.all<{ name: string }>('PRAGMA table_info(instance_settings)')).map((column) => column.name)
    expect(settings).not.toContain('billing_email')
    expect(settings).not.toContain('plan')

    // And the liability this table refuses to hold.
    for (const forbidden of ['card', 'cvc', 'cvv', 'iban', 'account_number', 'sort_code']) {
      expect(columns.filter((column) => column.includes(forbidden))).toEqual([])
    }
  })

  it('makes a member the owner, and records the fields that changed', async () => {
    const { db, signIn } = await world()
    const admin = await signIn('admin@example.com', 'admin')
    const payer = await signIn('payer@example.com', 'viewer')

    const saved = await admin.call(
      '/api/workspace/account',
      json('PATCH', {
        ownerId: payer.id,
        billing: { email: 'billing@atlas.example', company: 'Atlas Ltd', plan: 'Team', reference: 'cus_1' },
      }),
    )
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({
      ownerId: payer.id,
      ownerName: 'Payer',
      billing: { email: 'billing@atlas.example', company: 'Atlas Ltd', plan: 'Team', reference: 'cus_1' },
    })
    expect(await readWorkspaceAccount(db, 'workspace')).toMatchObject({ ownerId: payer.id, name: 'Team Atlas' })

    const trail = await db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'workspace.account'")
    // Field names, never values: a billing address is somebody's address.
    expect(JSON.parse(trail!.data)).toEqual({
      fields: ['billing_email', 'company_name', 'billing_reference', 'plan', 'owner_id'],
    })
  })

  it('refuses an owner who is not in the workspace', async () => {
    const { db, signIn } = await world()
    await signIn('admin@example.com', 'admin')
    await db.run("INSERT INTO users (id, name, email) VALUES ('u-stranger', 'Stranger', 'stranger@example.com')")

    const admin = await signIn('admin@example.com', 'admin')
    const refused = await admin.call('/api/workspace/account', json('PATCH', { ownerId: 'u-stranger' }))
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as { error: string }).error).toContain('member')
  })

  it('is refused to a member: the owner and the bill are the administrator’s', async () => {
    const { signIn } = await world()
    await signIn('admin@example.com', 'admin')
    const member = await signIn('member@example.com', 'editor')

    expect((await member.call('/api/workspace/account')).status).toBe(403)
    expect((await member.call('/api/workspace/account', json('PATCH', { billing: { company: 'x' } }))).status).toBe(403)
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
    const { db, signIn } = await world()
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
    // …and the people's accounts survive with no workspace to open.
    expect(await db.get("SELECT 1 AS seen FROM users WHERE email = 'admin@example.com'")).toEqual({ seen: 1 })
    expect(await db.get("SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = 'workspace'")).toEqual({ n: 0 })

    // The trail outlives the thing it describes.
    expect(await db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'workspace.delete'")).toEqual({
      data: JSON.stringify({ name: 'Team Atlas' }),
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

  it('leaves the person with no workspace, which is what the read answers', async () => {
    const { signIn } = await world()
    const admin = await signIn('admin@example.com', 'admin')

    expect((await admin.call('/api/workspace')).status).toBe(200)
    expect((await admin.call('/api/workspace', json('DELETE', { confirm: 'Team Atlas' }))).status).toBe(204)
    // No workspace to open: 404, not an empty board.
    expect((await admin.call('/api/workspace')).status).toBe(404)
  })
})
