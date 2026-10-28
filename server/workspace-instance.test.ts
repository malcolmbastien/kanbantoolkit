/**
 * One instance, one workspace (task 163).
 *
 * A workspace used to be something an account made for itself, with an owner and a name typed into
 * a form. Now it comes with the deployment: the installation names it (`WORKSPACE_NAME`), the first
 * person to sign in administers it, and there is no second one — not through the API, not through
 * a stale client, not at all. What is asserted here is exactly that, plus the one thing that would
 * quietly undo it: a later first sign-in must not overwrite a name somebody chose.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { ONE_WORKSPACE } from './workspace-instance'

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

async function world(env: Record<string, string> = {}) {
  const db = database()
  const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
  const request = (path: string, init?: RequestInit) => app.request(path, init, { AUTH_DEV: '1', ...env })
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

describe('one instance, one workspace', () => {
  it('makes the install’s name the workspace’s own, on both rows that hold it', async () => {
    const { db, signIn } = await world({ WORKSPACE_NAME: 'Team Atlas' })
    await signIn('ada@example.com')

    const row = await db.get<{ name: string }>("SELECT name FROM workspaces WHERE id = 'workspace'")
    expect(row?.name).toBe('Team Atlas')
    const settings = await db.get<{ name: string }>("SELECT name FROM workspace WHERE id = 'workspace'")
    expect(settings?.name).toBe('Team Atlas')
  })

  it('falls back to the default name when the installation chose none', async () => {
    const { db, signIn } = await world()
    await signIn('ada@example.com')
    const row = await db.get<{ name: string }>("SELECT name FROM workspaces WHERE id = 'workspace'")
    expect(row?.name).toBe('Kanban Toolkit')
  })

  it('makes the first person the workspace’s administrator, and refuses a second workspace', async () => {
    const { db, signIn } = await world()
    const ada = await signIn('ada@example.com')

    const role = await db.get<{ role: string }>(
      "SELECT role FROM workspace_members WHERE workspace_id = 'workspace' AND user_id = ?1",
      [ada.id],
    )
    expect(role?.role).toBe('admin')

    const refused = await ada.call('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: 'Northwind' }) })
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { error: string }).error).toBe(ONE_WORKSPACE)

    const count = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM workspaces')
    expect(count?.n).toBe(1)
  })

  it('answers a stranger with the door, not with the sentence', async () => {
    const { request } = await world()
    const refused = await request('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: 'Northwind' }) })
    expect(refused.status).toBe(401)
  })

  it('re-opens a deleted workspace when an administrator arrives, under the install’s name', async () => {
    const { db, signIn } = await world({ WORKSPACE_NAME: 'Team Atlas' })
    const ada = await signIn('ada@example.com')

    // What a deletion leaves behind: no workspace, no memberships — and the deployment's
    // administrator still administering it, which is what makes it recoverable.
    await db.run('DELETE FROM workspace_members')
    await db.run('DELETE FROM workspace')
    await db.run('DELETE FROM workspaces')
    expect(await db.get('SELECT 1 AS seen FROM workspaces')).toBeUndefined()

    await signIn('ada@example.com')
    const workspace = await db.get<{ name: string }>("SELECT name FROM workspaces WHERE id = 'workspace'")
    expect(workspace?.name).toBe('Team Atlas')
    const seat = await db.get<{ role: string }>(
      "SELECT role FROM workspace_members WHERE workspace_id = 'workspace' AND user_id = ?1",
      [ada.id],
    )
    expect(seat?.role).toBe('admin')
  })

  it('does not re-open a workspace for a plain member', async () => {
    const { db, signIn } = await world()
    await signIn('ada@example.com')
    const grace = await signIn('grace@example.com')

    await db.run('DELETE FROM workspace_members')
    await db.run('DELETE FROM workspace')
    await db.run('DELETE FROM workspaces')

    await signIn('grace@example.com')
    expect(await db.get('SELECT 1 AS seen FROM workspaces')).toBeUndefined()
    const seat = await db.get('SELECT 1 AS seen FROM workspace_members WHERE user_id = ?1', [grace.id])
    expect(seat).toBeUndefined()
  })

  it('keeps a name a person chose, even when the instance’s first person arrives again', async () => {
    const { db, signIn } = await world({ WORKSPACE_NAME: 'Team Atlas' })
    const ada = await signIn('ada@example.com')

    // Somebody renamed the team after the install. Losing every member later is not a reason to
    // rename it back to the value the deployment shipped with.
    await db.run("UPDATE workspaces SET name = 'Northwind' WHERE id = 'workspace'")
    await db.run("UPDATE workspace SET name = 'Northwind' WHERE id = 'workspace'")
    await db.run('DELETE FROM workspace_members')
    await db.run('DELETE FROM instance_members')
    await db.run("DELETE FROM identities WHERE user_id = ?1", [ada.id])
    await db.run('DELETE FROM users')

    await signIn('grace@example.com')
    const row = await db.get<{ name: string }>("SELECT name FROM workspaces WHERE id = 'workspace'")
    expect(row?.name).toBe('Northwind')
  })
})
