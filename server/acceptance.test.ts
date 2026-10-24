/**
 * The acceptance pass: the clauses of task 122, proved to add up.
 *
 * Every rule here is about a *second* person — a viewer who may read and not write, an editor who
 * may write and not redesign, an administrator who cannot walk out of the last door. A test with one
 * signed-in user can see none of them, which is why this file signs several in and drives the real
 * routes rather than the functions behind them.
 *
 * The matrix itself is asserted in `src/domain/roles.test.ts`, one test per role × action pair. What
 * this adds is the second half of R1: for every action a **route** enforces, the same table through
 * the route — because a hidden control is not a permission check.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { can, ROLES } from '../src/domain/roles'
import type { Action, Role } from '../src/domain/roles'
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
  meUserId: 'u-admin',
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

type Call = (path: string, init?: RequestInit) => Response | Promise<Response>

async function world() {
  const db = database()
  await writeWorkspace(db, seeded(), 'workspace')
  // A card to write, so `item.write` has something to refuse.
  await db.run(
    "INSERT INTO items (id, title, type_id, created_at, rev, workspace_id) VALUES ('i-1', 'A card', 't-card', 0, 1, 'workspace')",
  )

  // The roster is opened for the domain these tests use: the acceptance pass is about *authority*
  // once somebody is in, and every rule here needs a second person to exist at all. (Admission
  // itself — closed by default, invitations, domains — is asserted in its own tests.)
  await db.run('UPDATE instance_settings SET allowed_domains = ?1', [JSON.stringify(['example.com'])])

  const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
  const request = (path: string, init?: RequestInit) => app.request(path, init, { AUTH_DEV: '1' })

  /** Sign somebody in, and give them the role this test needs in the workspace. */
  const signIn = async (email: string, role: Role | 'instance' = 'viewer') => {
    const response = await request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (response.status !== 200) throw new Error(`sign-in refused for ${email}: ${response.status}`)
    const cookie = cookieOf(response)
    const person = (await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?1', [email]))!
    if (role === 'instance') {
      // Administers the instance and belongs to no workspace: the actor for the last-administrator
      // rules, which need somebody outside the count they are checking.
      await db.run("UPDATE instance_members SET role = 'admin' WHERE user_id = ?1", [person.id])
      await db.run('DELETE FROM workspace_members WHERE user_id = ?1', [person.id])
    } else {
      await db.run('UPDATE workspace_members SET role = ?2 WHERE user_id = ?1', [person.id, role])
    }
    const call: Call = (path, init = {}) =>
      request(path, { ...init, headers: { 'content-type': 'application/json', cookie, ...init.headers } })
    return { cookie, id: person.id, call }
  }

  return { db, request, signIn }
}

const writeCard: RequestInit = {
  method: 'PATCH',
  body: JSON.stringify({ baseRev: 1, item: { id: 'i-1', title: 'Changed', typeId: 't-card', createdAt: 0 } }),
}

/** The routes that enforce an action, and a request that reaches each of them. */
const ROUTES: Array<{ action: Action; path: string; init?: RequestInit }> = [
  { action: 'board.read', path: '/api/workspace' },
  { action: 'item.write', path: '/api/workspace/items/i-1', init: writeCard },
  {
    action: 'workspace.import',
    path: '/api/workspace/import',
    init: { method: 'POST', body: JSON.stringify({ boards: [] }) },
  },
  {
    action: 'workspace.settings',
    path: '/api/admin/workspace',
    init: { method: 'PATCH', body: JSON.stringify({ name: 'Renamed' }) },
  },
  {
    action: 'workspace.members',
    path: '/api/admin/workspace/members/nobody',
    init: { method: 'PATCH', body: JSON.stringify({ role: 'viewer' }) },
  },
]

describe('the matrix, through the routes', () => {
  for (const role of ROLES) {
    for (const route of ROUTES) {
      it(`${role.id} × ${route.action}`, async () => {
        const { signIn } = await world()
        // The first sign-in owns the instance, so the roles under test are made afterwards.
        const owner = await signIn('owner@example.com', 'instance')
        void owner
        const person = await signIn(`${role.id}@example.com`, role.id)
        const response = await person.call(route.path, route.init)

        // A refusal is 403 and nothing else: any other answer means the permission passed, whatever
        // the interface would have shown. A 404 here would mean the scope refused, which is a
        // different rule and a different test.
        expect(response.status === 403).toBe(!can(role.id, route.action))
        if (!can(role.id, route.action)) expect(response.status).toBe(403)
      })
    }
  }
})

describe('the second person', () => {
  it('refuses a viewer a write, and changes nothing', async () => {
    const { db, signIn } = await world()
    await signIn('owner@example.com', 'instance')
    const viewer = await signIn('viewer@example.com', 'viewer')

    const before = await db.get('SELECT * FROM items WHERE id = ?1', ['i-1'])
    const answer = await viewer.call('/api/workspace/items/i-1', writeCard)
    expect(answer.status).toBe(403)

    // Byte-identical: not a field, not a revision, not a timestamp.
    expect(await db.get('SELECT * FROM items WHERE id = ?1', ['i-1'])).toEqual(before)
    // …and the viewer may still read.
    expect((await viewer.call('/api/workspace')).status).toBe(200)
  })

  it('lets an editor write, and refuses the thing only an administrator may do', async () => {
    const { db, signIn } = await world()
    await signIn('owner@example.com', 'instance')
    const editor = await signIn('editor@example.com', 'editor')

    expect((await editor.call('/api/workspace/items/i-1', writeCard)).status).toBe(200)
    expect(await db.get<{ title: string }>('SELECT title FROM items WHERE id = ?1', ['i-1'])).toEqual({ title: 'Changed' })

    // Board design has no route of its own — a board is part of the workspace payload, and the only
    // way to write one is the import, which is `workspace.import`: the administrator's. So that is
    // where "an editor may not redesign the board" is enforced, and that is where it is asserted.
    const redesign = await editor.call('/api/workspace/import', {
      method: 'POST',
      body: JSON.stringify({ boards: [{ id: 'b-1', name: 'A board they made' }] }),
    })
    expect(redesign.status).toBe(403)
    expect(await db.get("SELECT COUNT(*) AS n FROM boards WHERE id = 'b-1'")).toEqual({ n: 0 })
  })
})

describe('the lifecycle', () => {
  it('takes effect on the next request: a role change, then a removal', async () => {
    const { db, signIn } = await world()
    await signIn('owner@example.com', 'instance')
    const person = await signIn('person@example.com', 'editor')

    expect((await person.call('/api/workspace/items/i-1', writeCard)).status).toBe(200)

    // A role change is read on the next request, with no re-login and no new session.
    await db.run('UPDATE workspace_members SET role = ?2 WHERE user_id = ?1', [person.id, 'viewer'])
    expect((await person.call('/api/workspace/items/i-1', writeCard)).status).toBe(403)
    expect((await person.call('/api/workspace')).status).toBe(200)

    // A removal is the door itself: the same cookie is nobody.
    await db.run('DELETE FROM workspace_members WHERE user_id = ?1', [person.id])
    expect((await person.call('/api/workspace')).status).toBe(404)
  })

  it('ends an inactive account’s sessions, and refuses it at the door', async () => {
    const { request, db, signIn } = await world()
    const owner = await signIn('owner@example.com', 'instance')
    const person = await signIn('person@example.com', 'editor')
    expect((await person.call('/api/workspace')).status).toBe(200)

    const off = await owner.call(`/api/admin/users/${person.id}/deactivate`, { method: 'POST' })
    expect(off.status).toBe(204)

    // The cookie it was holding is not a credential any more…
    expect((await person.call('/api/workspace')).status).toBe(401)
    // …and it cannot be issued a new one.
    const again = await request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'person@example.com' }),
    })
    expect(again.status).toBe(403)
    expect(await db.get("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?1 AND revoked_at IS NULL", [person.id])).toEqual({
      n: 0,
    })
  })
})

describe('the safe guards', () => {
  /** The four ways to lose the last administrator, through the routes that carry them. */
  const four = (id: string): Array<{ what: string; path: string; init: RequestInit }> => [
    {
      what: 'demote',
      path: `/api/admin/workspace/members/${id}`,
      init: { method: 'PATCH', body: JSON.stringify({ role: 'viewer' }) },
    },
    { what: 'deactivate', path: `/api/admin/users/${id}/deactivate`, init: { method: 'POST' } },
    { what: 'delete', path: `/api/admin/users/${id}`, init: { method: 'DELETE' } },
    { what: 'remove', path: `/api/admin/workspace/members/${id}`, init: { method: 'DELETE' } },
  ]

  it('refuses all four on the last administrator, and allows all four with a second', async () => {
    const { signIn } = await world()
    // The actor administers the instance and belongs to no workspace; the person acted on is the
    // workspace's only administrator, which is the count that matters here.
    const owner = await signIn('owner@example.com', 'instance')
    const only = await signIn('only@example.com', 'admin')

    for (const attempt of four(only.id)) {
      const answer = await owner.call(attempt.path, attempt.init)
      expect(answer.status, attempt.what).toBe(409)
    }

    // With a peer, every one of the four is possible — a fresh pair each time, because two of the
    // acts remove the person they are applied to.
    let n = 0
    for (const attempt of four('placeholder')) {
      n += 1
      const target = await signIn(`target-${n}@example.com`, 'admin')
      const peer = await signIn(`peer-${n}@example.com`, 'admin')
      void peer
      const answer = await owner.call(attempt.path.replace('placeholder', target.id), attempt.init)
      // 200 or 204: what matters is that it was not refused.
      expect(answer.ok, attempt.what).toBe(true)
    }
  })

  it('refuses a person their own deactivation and deletion', async () => {
    const { signIn } = await world()
    const person = await signIn('person@example.com', 'admin')

    expect((await person.call(`/api/admin/users/${person.id}/deactivate`, { method: 'POST' })).status).toBe(409)
    expect((await person.call(`/api/admin/users/${person.id}`, { method: 'DELETE' })).status).toBe(409)
  })
})
