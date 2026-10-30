/**
 * SCIM 2.0, through the routes (task 168).
 *
 * The tests an identity provider would exercise: the documents it reads before connecting, the CRUD
 * on `/Users` and `/Groups` with the RFC's status codes, `active` as deactivation and `DELETE` as the
 * irreversible act, and the two boundaries that matter — a token cannot make an instance
 * administrator, and a group cannot confer authority by membership alone.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { writeWorkspace } from './workspace/write'
import type { Workspace } from './workspace/types'
import type { Board } from '../src/domain/types'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

function database(): Database {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

const seeded = (): Workspace => {
  const board: Board = { id: 'b-1', name: 'Atlas', band: 'team', description: 'A board.' }
  return {
    meUserId: 'u-admin',
    boardId: 'b-1',
    users: [],
    issueTypes: [{ id: 't-card', name: 'Card', color: '#0ea5e9' }],
    boards: [board],
    flows: [{ id: 'f-cards', boardId: board.id, kind: 'cards', name: 'Cards', order: 0 }],
    lanes: [
      { id: 'l-1', boardId: 'b-1', parentId: null, order: 0, name: 'Backlog', flowId: 'f-cards', stage: 'backlog' },
    ],
    items: [],
    placements: [],
    edges: [],
    links: [],
    objectives: [],
    keyResults: [],
    boardTemplates: [],
    savedFilters: [],
    collapsedLanes: {},
  }
}

const cookieOf = (response: Response) =>
  `fl_session=${(response.headers.get('set-cookie') ?? '').match(/fl_session=([^;]+)/)?.[1] ?? ''}`

type Init = RequestInit & { bearer?: string }

async function world() {
  const db = database()
  await writeWorkspace(db, seeded(), 'workspace')
  await db.run('UPDATE instance_settings SET allowed_domains = ?1', [JSON.stringify(['example.com'])])

  const app = createApp({ database: () => db, clientIp: () => '203.0.113.12' })
  const request = (path: string, init: Init = {}) => {
    const { bearer, ...rest } = init
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(rest.headers as Record<string, string>) }
    if (bearer) headers.authorization = `Bearer ${bearer}`
    return app.request(path, { ...rest, headers }, { AUTH_DEV: '1' })
  }

  const signIn = async (email: string, role: 'admin' | 'member' = 'admin') => {
    const response = await request('/api/auth/dev', { method: 'POST', body: JSON.stringify({ email }) })
    if (response.status !== 200) throw new Error(`sign-in refused: ${response.status}`)
    const person = (await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?1', [email]))!
    if (role === 'admin') await db.run("UPDATE instance_members SET role = 'admin' WHERE user_id = ?1", [person.id])
    return {
      id: person.id,
      cookie: cookieOf(response),
      call: (path: string, init: Init = {}) => request(path, { ...init, headers: { cookie: cookieOf(response), ...(init.headers as Record<string, string>) } }),
    }
  }

  /** A SCIM token, minted through the route an administrator's panel calls. */
  const scimToken = async (
    admin: { call: (path: string, init?: Init) => Response | Promise<Response> },
    name = 'our directory',
    defaultRole = 'editor',
  ) => {
    const response = await admin.call('/api/admin/scim/tokens', { method: 'POST', body: JSON.stringify({ name, defaultRole }) })
    if (response.status !== 201) throw new Error(`mint refused: ${response.status} ${await response.text()}`)
    const { secret, token } = (await response.json()) as { secret: string; token: { id: string } }
    const call = (path: string, init: Init = {}) => request(`/scim/v2${path}`, { ...init, bearer: secret })
    return { secret, id: token.id, call }
  }

  return { db, app, request, signIn, scimToken }
}

const body = (value: unknown) => JSON.stringify(value)

describe('the documents an IdP reads first', () => {
  it('answers ServiceProviderConfig, ResourceTypes and Schemas', async () => {
    const { signIn, scimToken } = await world()
    const admin = await signIn('admin@example.com')
    const scim = await scimToken(admin)

    const config = (await (await scim.call('/ServiceProviderConfig')).json()) as {
      schemas: string[]
      patch: { supported: boolean }
      bulk: { supported: boolean }
      filter: { supported: boolean; maxResults: number }
      sort: { supported: boolean }
    }
    expect(config.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig')
    expect(config.patch.supported).toBe(true)
    expect(config.filter.supported).toBe(true)
    expect(config.bulk.supported).toBe(false)
    expect(config.sort.supported).toBe(false)

    const types = (await (await scim.call('/ResourceTypes')).json()) as { Resources: Array<{ id: string }> }
    expect(types.Resources.map((resource) => resource.id)).toEqual(['User', 'Group'])

    const schemas = (await (await scim.call('/Schemas')).json()) as { Resources: Array<{ id: string }> }
    expect(schemas.Resources.map((schema) => schema.id)).toContain('urn:ietf:params:scim:schemas:core:2.0:User')
  })
})

describe('the token', () => {
  it('is shown once, hashed at rest, and refused once revoked', async () => {
    const { db, signIn, scimToken, request } = await world()
    const admin = await signIn('admin@example.com')

    const listBefore = (await (await admin.call('/api/admin/scim/tokens')).json()) as { tokens: unknown[] }
    expect(listBefore.tokens).toHaveLength(0)

    const scim = await scimToken(admin)
    expect(scim.secret.startsWith('fls_')).toBe(true)

    // The row holds a hash, and the list never carries the secret.
    const row = await db.get<{ token_hash: string }>('SELECT token_hash FROM scim_tokens WHERE id = ?1', [scim.id])
    expect(row?.token_hash).not.toContain(scim.secret)
    const list = await (await admin.call('/api/admin/scim/tokens')).text()
    expect(list).not.toContain(scim.secret)

    expect((await scim.call('/Users')).status).toBe(200)

    // Revoked: the next call is 401, and the answer is SCIM's shape, not ours.
    expect((await admin.call(`/api/admin/scim/tokens/${scim.id}`, { method: 'DELETE' })).status).toBe(200)
    const refused = await scim.call('/Users')
    expect(refused.status).toBe(401)
    expect(((await refused.json()) as { schemas: string[] }).schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error')

    // No bearer at all, and a session cookie: both 401 — a browser is not a directory.
    expect((await request('/scim/v2/Users')).status).toBe(401)
    expect((await admin.call('/scim/v2/Users')).status).toBe(401)
  })

  it('cannot make anybody an instance administrator, whatever role it carries', async () => {
    const { db, signIn, scimToken } = await world()
    const admin = await signIn('admin@example.com')
    // The strongest a token may be: workspace administrator.
    const scim = await scimToken(admin, 'ambitious', 'admin')

    const created = await scim.call('/Users', { method: 'POST', body: body({ userName: 'grace@example.com', name: { formatted: 'Grace Hopper' } }) })
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }

    const seat = await db.get<{ role: string }>('SELECT role FROM workspace_members WHERE user_id = ?1', [id])
    const instance = await db.get<{ role: string }>('SELECT role FROM instance_members WHERE user_id = ?1', [id])
    expect(seat).toEqual({ role: 'admin' }) // of the workspace, because the token said so
    expect(instance).toEqual({ role: 'member' }) // never of the deployment
  })
})

describe('users', () => {
  it('creates, reads, filters, replaces, patches and deletes', async () => {
    const { db, signIn, scimToken } = await world()
    const admin = await signIn('admin@example.com')
    const scim = await scimToken(admin, 'our directory', 'editor')

    const created = await scim.call('/Users', {
      method: 'POST',
      body: body({
        userName: 'ada@example.com',
        name: { givenName: 'Ada', familyName: 'Lovelace' },
        externalId: 'dir-42',
      }),
    })
    expect(created.status).toBe(201)
    expect(created.headers.get('location')).toContain(`/scim/v2/Users/`)
    const user = (await created.json()) as { id: string; userName: string; name: { formatted: string }; active: boolean; externalId: string }
    expect(user).toMatchObject({ userName: 'ada@example.com', name: { formatted: 'Ada Lovelace' }, active: true, externalId: 'dir-42' })

    expect((await (await scim.call(`/Users/${user.id}`)).json()) as { id: string }).toMatchObject({ id: user.id })

    const byName = (await (await scim.call('/Users?filter=userName%20eq%20%22ada%40example.com%22')).json()) as { totalResults: number; Resources: Array<{ id: string }> }
    expect(byName.totalResults).toBe(1)
    expect(byName.Resources[0].id).toBe(user.id)

    const byExternal = (await (await scim.call('/Users?filter=externalId%20eq%20%22dir-42%22')).json()) as { totalResults: number }
    expect(byExternal.totalResults).toBe(1)

    // A second create for the same address is a 409, never a second Ada.
    const duplicate = await scim.call('/Users', { method: 'POST', body: body({ userName: 'ADA@example.com', name: { formatted: 'Ada again' } }) })
    expect(duplicate.status).toBe(409)
    expect(await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE lower(email) = 'ada@example.com'")).toEqual({ n: 1 })

    const replaced = await scim.call(`/Users/${user.id}`, {
      method: 'PUT',
      body: body({ userName: 'ada@example.com', name: { formatted: 'Ada King' }, externalId: 'dir-42' }),
    })
    expect(replaced.status).toBe(200)
    expect(((await replaced.json()) as { name: { formatted: string } }).name.formatted).toBe('Ada King')

    const patched = await scim.call(`/Users/${user.id}`, {
      method: 'PATCH',
      body: body({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'replace', path: 'active', value: false },
          { op: 'replace', path: 'name.formatted', value: 'Ada Lovelace King' },
        ],
      }),
    })
    expect(patched.status).toBe(200)
    expect(((await patched.json()) as { active: boolean; name: { formatted: string } })).toMatchObject({ active: false, name: { formatted: 'Ada Lovelace King' } })

    // `DELETE` is the irreversible one, and a second one is the RFC's 404 — not a sync failure.
    expect((await scim.call(`/Users/${user.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(await db.get('SELECT 1 AS seen FROM users WHERE id = ?1', [user.id])).toBeUndefined()
    expect((await scim.call(`/Users/${user.id}`, { method: 'DELETE' })).status).toBe(404)
  })

  it('treats `active: false` as the reversible act, keeping the account and closing the door', async () => {
    const { db, signIn, scimToken, request } = await world()
    const admin = await signIn('admin@example.com')
    const scim = await scimToken(admin)

    const created = await scim.call('/Users', { method: 'POST', body: body({ userName: 'linus@example.com', name: { formatted: 'Linus' } }) })
    const { id } = (await created.json()) as { id: string }

    // They can sign in: the directory created them, so the door knows them.
    const signed = await request('/api/auth/dev', { method: 'POST', body: JSON.stringify({ email: 'linus@example.com' }) })
    expect(signed.status).toBe(200)
    const cookie = cookieOf(signed)
    expect((await request('/api/workspace', { headers: { cookie } })).status).toBe(200)

    await scim.call(`/Users/${id}`, { method: 'PATCH', body: body({ Operations: [{ op: 'replace', path: 'active', value: false }] }) })

    // The account is still there, with its name; the door is closed.
    expect(await db.get<{ status: string }>('SELECT status FROM users WHERE id = ?1', [id])).toEqual({ status: 'inactive' })
    expect((await request('/api/workspace', { headers: { cookie } })).status).toBe(401)

    // And reversible: the same operation with true opens it again.
    await scim.call(`/Users/${id}`, { method: 'PATCH', body: body({ Operations: [{ op: 'replace', path: 'active', value: true }] }) })
    expect(await db.get<{ status: string }>('SELECT status FROM users WHERE id = ?1', [id])).toEqual({ status: 'active' })
  })

  it('names the token in the trail, never the secret, and never a pretend person', async () => {
    const { db, signIn, scimToken } = await world()
    const admin = await signIn('admin@example.com')
    const scim = await scimToken(admin)

    await scim.call('/Users', { method: 'POST', body: body({ userName: 'maya@example.com', name: { formatted: 'Maya Blake' } }) })
    const trail = await db.get<{ actor_id: string | null; action: string; data: string }>(
      "SELECT actor_id, action, data FROM audit_events WHERE action = 'scim.user.create'",
    )
    expect(trail?.actor_id).toBeNull()
    expect(trail?.data).toContain(scim.id)
    expect(trail?.data).not.toContain(scim.secret)
  })
})

describe('groups', () => {
  it('adds and removes membership, and confers no authority by itself', async () => {
    const { db, signIn, scimToken } = await world()
    const admin = await signIn('admin@example.com')
    const scim = await scimToken(admin, 'our directory', 'viewer')

    const created = await scim.call('/Users', { method: 'POST', body: body({ userName: 'grace@example.com', name: { formatted: 'Grace' } }) })
    const { id: grace } = (await created.json()) as { id: string }
    expect(await db.get<{ role: string }>('SELECT role FROM workspace_members WHERE user_id = ?1', [grace])).toEqual({ role: 'viewer' })

    const group = await scim.call('/Groups', { method: 'POST', body: body({ displayName: 'Platform', members: [{ value: grace }] }) })
    expect(group.status).toBe(201)
    const { id: groupId, members } = (await group.json()) as { id: string; members: Array<{ value: string; display: string }> }
    expect(members).toEqual([{ value: grace, display: 'Grace', type: 'User' }])

    // Membership did not change the seat: the group carries a role only when the app grants one.
    expect(await db.get<{ role: string }>('SELECT role FROM workspace_members WHERE user_id = ?1', [grace])).toEqual({ role: 'viewer' })
    expect(await db.get('SELECT 1 AS seen FROM group_workspace_roles WHERE group_id = ?1', [groupId])).toBeUndefined()

    // Patch membership off, and on again.
    const removed = await scim.call(`/Groups/${groupId}`, {
      method: 'PATCH',
      body: body({ Operations: [{ op: 'remove', path: 'members', value: [{ value: grace }] }] }),
    })
    expect(((await removed.json()) as { members: unknown[] }).members).toEqual([])

    const added = await scim.call(`/Groups/${groupId}`, {
      method: 'PATCH',
      body: body({ Operations: [{ op: 'add', path: 'members', value: [{ value: grace }] }] }),
    })
    expect(((await added.json()) as { members: Array<{ value: string }> }).members.map((member) => member.value)).toEqual([grace])

    expect((await scim.call(`/Groups/${groupId}`, { method: 'DELETE' })).status).toBe(204)
    expect(await db.get('SELECT 1 AS seen FROM groups WHERE id = ?1', [groupId])).toBeUndefined()
  })
})

describe('the errors are SCIM’s', () => {
  it('answers every refusal with the Error schema and a matching status', async () => {
    const { signIn, scimToken } = await world()
    const admin = await signIn('admin@example.com')
    const scim = await scimToken(admin)

    const missing = await scim.call('/Users/nobody')
    expect(missing.status).toBe(404)
    const error = (await missing.json()) as { schemas: string[]; detail: string; status: string }
    expect(error.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error'])
    expect(error.status).toBe('404')
    expect(error.detail.length).toBeGreaterThan(10)

    const badFilter = await scim.call('/Users?filter=title%20co%20%22x%22')
    expect(badFilter.status).toBe(400)
    expect(((await badFilter.json()) as { status: string }).status).toBe('400')

    const badBody = await scim.call('/Users', { method: 'POST', body: body({ name: { formatted: 'No address' } }) })
    expect(badBody.status).toBe(400)
    expect(((await badBody.json()) as { schemas: string[] }).schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error')
  })
})

describe('the documentation', () => {
  it('is listed, and names the endpoints the routes mount', async () => {
    const doc = readFileSync(new URL('../docs/identity.md', import.meta.url), 'utf8')
    const index = readFileSync(new URL('../docs/README.md', import.meta.url), 'utf8')
    expect(index).toContain('identity.md')

    const { app } = await world()
    const mounted = new Set(app.routes.filter((route) => route.path.startsWith('/scim/v2')).map((route) => route.path))
    for (const path of [
      '/scim/v2/ServiceProviderConfig',
      '/scim/v2/ResourceTypes',
      '/scim/v2/Schemas',
      '/scim/v2/Users',
      '/scim/v2/Users/:id',
      '/scim/v2/Groups',
      '/scim/v2/Groups/:id',
    ]) {
      expect(mounted).toContain(path)
    }
    // The page states the base URL once and then the resources, which is how a person reads it — so
    // what is compared here is the base and the operations, not a repeated prefix.
    expect(doc).toContain('/scim/v2')
    for (const named of ['ServiceProviderConfig', 'ResourceTypes', 'Schemas', '/Users', '/Groups', '/api/admin/scim/tokens']) {
      expect(doc).toContain(named)
    }
  })
})
