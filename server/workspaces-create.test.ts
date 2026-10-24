/**
 * Making a workspace: the creator owns it.
 *
 * A workspace is the tenant (task 126, revised) and an account is a person, so the email that asks
 * for a workspace is the email that owns it — not a field somebody else can be written into. What is
 * asserted here is the whole of that: the owner, the membership, the settings row, the audit entry,
 * and the one-workspace-per-account rule that keeps an account from drifting between tenants.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Database } from './db'
import { fromSqlite } from './sqlite'

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

  return { db, request, signIn }
}

/** The instance's own workspace is the first person's on arrival; a creator wants a second one. */
async function withoutAWorkspace(call: (path: string, init?: RequestInit) => Response | Promise<Response>, db: Database, id: string) {
  await db.run('DELETE FROM workspace_members WHERE user_id = ?1', [id])
  return call
}

describe('creating a workspace', () => {
  it('makes the creator its owner, its administrator, and records the act', async () => {
    const { db, signIn } = await world()
    const person = await signIn('owner@example.com')
    await withoutAWorkspace(person.call, db, person.id)

    const answer = await person.call('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: 'Northwind' }) })
    expect(answer.status).toBe(201)
    const created = (await answer.json()) as { id: string; name: string; ownerId: string }
    expect(created).toMatchObject({ name: 'Northwind', ownerId: person.id })

    // The owner is the account that asked for it…
    expect(await db.get('SELECT owner_id, name FROM workspaces WHERE id = ?1', [created.id])).toEqual({
      owner_id: person.id,
      name: 'Northwind',
    })
    // …which is also its administrator: owning and administering are two facts, both recorded.
    expect(await db.get('SELECT role FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2', [created.id, person.id])).toEqual({
      role: 'admin',
    })
    // …and the workspace has its settings row from the first moment.
    expect(await db.get('SELECT name FROM workspace WHERE id = ?1', [created.id])).toEqual({ name: 'Northwind' })
    expect(await db.get("SELECT data FROM audit_events WHERE action = 'workspace.create'")).toEqual({
      data: JSON.stringify({ name: 'Northwind' }),
    })

    // The board it opens on is this one, because the account's only membership is now this.
    const session = (await (await person.call('/api/auth/session')).json()) as { workspaces: Array<{ id: string; role: string }> }
    expect(session.workspaces).toEqual([{ id: created.id, role: 'admin' }])
    expect((await person.call('/api/workspace')).status).toBe(200)
  })

  it('refuses a second workspace to an account that already has one', async () => {
    const { db, signIn } = await world()
    const person = await signIn('owner@example.com')

    // The first account already belongs to the instance's workspace.
    const refused = await person.call('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: 'Another' }) })
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { error: string }).error).toContain('already has a workspace')
    expect(await db.get('SELECT COUNT(*) AS n FROM workspaces')).toEqual({ n: 1 })
  })

  it('needs a name, and needs somebody signed in', async () => {
    const { request, db, signIn } = await world()
    const person = await signIn('owner@example.com')
    await withoutAWorkspace(person.call, db, person.id)

    expect((await person.call('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: '  ' }) })).status).toBe(400)
    expect((await request('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: 'Nobody' }) })).status).toBe(401)
  })

  it('says whether this account already has one, so the surface can ask before it acts', async () => {
    const { db, signIn } = await world()
    const person = await signIn('owner@example.com')

    const mine = (await (await person.call('/api/workspaces/mine')).json()) as { workspace: { id: string } | null }
    expect(mine.workspace?.id).toBe('workspace')

    await withoutAWorkspace(person.call, db, person.id)
    const none = (await (await person.call('/api/workspaces/mine')).json()) as { workspace: unknown }
    expect(none.workspace).toBeNull()
  })
})
