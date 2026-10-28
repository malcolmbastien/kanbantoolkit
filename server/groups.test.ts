/**
 * Groups: a role granted once to many.
 *
 * What is being defended: a group cannot hand out more than it is given (no nesting, no authority
 * of its own), an inactive group hands out nothing at all, and the last administrator rule counts a
 * person who is one *because of a group* — otherwise a role could be removed through a side door
 * and leave a workspace nobody can administer.
 *
 * The action the tests use to tell roles apart is a card's pen: `item.write`, which an editor has
 * and a viewer does not.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { effectiveRole } from './groups'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

function database(): Database {
  const db = new DatabaseSync(':memory:')
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

  const dev = async (email: string) => {
    const response = await request('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    return { response, cookie: cookieOf(response) }
  }

  const ada = await dev('ada@example.com')
  // Every other person arrives through a domain the instance admits: the roster is closed.
  await db.run('UPDATE instance_settings SET allowed_domains = ?1', [JSON.stringify(['example.com'])])
  const grace = await dev('grace@example.com')
  const linus = await dev('linus@example.com')

  const id = async (email: string) =>
    (await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?1', [email]))!.id

  // Being in a group grants a role; being in the workspace is an invitation (task 162). The people
  // in these tests are invited as viewers first, which is the seat the group then raises.
  for (const email of ['grace@example.com', 'linus@example.com']) {
    await db.run(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('workspace', ?1, 'viewer')`,
      [await id(email)],
    )
  }

  const as = (cookie: string) => (path: string, init: RequestInit = {}) =>
    request(path, { ...init, headers: { 'content-type': 'application/json', cookie, ...init.headers } })

  const admin = as(ada.cookie)
  const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

  /** A group with `emails` in it, carrying `role` here. Answers its id. */
  const group = async (name: string, emails: string[], role?: 'viewer' | 'editor' | 'admin') => {
    const created = await admin('/api/admin/groups', json('POST', { name }))
    const { id: groupId } = (await created.json()) as { id: string }
    for (const email of emails) {
      await admin(`/api/admin/groups/${groupId}/members`, json('POST', { userId: await id(email) }))
    }
    if (role) await admin(`/api/admin/groups/${groupId}/role`, json('PUT', { role }))
    return groupId
  }

  const pen = (cookie: string, card: string) =>
    request(`/api/workspace/items/${card}/lock`, {
      method: 'POST',
      headers: { cookie, 'x-kanbantoolkit-tab': 'test' },
    })

  return { db, request, dev, id, admin, as, json, group, pen, ada, grace, linus }
}

describe('a group’s role', () => {
  it('applies to every active member, and only while the group is active', async () => {
    const { admin, grace, linus, id, group, pen, db, json } = await world()
    const groupId = await group('Platform Leads', ['grace@example.com', 'linus@example.com'], 'editor')

    // An editor may take a card's pen; a viewer may not.
    expect((await pen(grace.cookie, 'card-1')).status).toBe(200)
    expect((await pen(linus.cookie, 'card-2')).status).toBe(200)

    // A direct Viewer row, so the second half is about keeping it rather than about having nothing.
    await admin(`/api/admin/workspace/members/${await id('grace@example.com')}`, json('PATCH', { role: 'viewer' }))
    expect((await pen(grace.cookie, 'card-3')).status).toBe(200) // the group still says editor

    const off = await admin(`/api/admin/groups/${groupId}`, json('PATCH', { active: false }))
    expect(off.status).toBe(200)

    // Immediately: nothing the group granted survives, and the direct Viewer is what is left.
    expect((await pen(grace.cookie, 'card-4')).status).toBe(403)
    expect((await pen(linus.cookie, 'card-5')).status).toBe(403)

    const grant = await effectiveRole(db, await id('grace@example.com'), 'workspace')
    expect(grant).toMatchObject({ role: 'viewer', source: 'direct' })
  })

  it('gives the highest role, whichever side it comes from — and names the source', async () => {
    const { admin, grace, linus, id, group, db, request } = await world()
    await group('Broad', ['grace@example.com'], 'viewer')
    await group('Leads', ['grace@example.com'], 'admin')

    // A direct editor plus a group viewer is still an editor…
    await admin(`/api/admin/workspace/members/${await id('grace@example.com')}`, { method: 'PATCH', body: JSON.stringify({ role: 'viewer' }) })
    const before = await effectiveRole(db, await id('grace@example.com'), 'workspace')
    expect(before).toMatchObject({ role: 'admin', source: 'group:Leads' })

    // …and the client is told the effective role, not the direct one.
    const session = (await (await request('/api/auth/session', { headers: { cookie: grace.cookie } })).json()) as {
      workspaces: Array<{ role: string }>
    }
    expect(session.workspaces[0].role).toBe('admin')

    // Linus is in no group, so what he has is the row every admitted person arrives with: a viewer.
    const plain = (await (await request('/api/auth/session', { headers: { cookie: linus.cookie } })).json()) as {
      workspaces: Array<{ role: string }>
    }
    expect(plain.workspaces).toEqual([{ id: 'workspace', role: 'viewer' }])
  })
})

describe('the last administrator', () => {
  it('counts a group-granted administrator, and refuses to remove the last one three ways', async () => {
    const { admin, id, group, json, db } = await world()
    // Ada is the only administrator until the group makes Grace one; then take Ada's away.
    const groupId = await group('Leads', ['grace@example.com'], 'admin')
    await db.run(
      "UPDATE workspace_members SET role = 'viewer' WHERE user_id = (SELECT id FROM users WHERE email = 'ada@example.com')",
    )

    // Grace is the workspace's only administrator, and only because of the group.
    expect(await db.get("SELECT role FROM workspace_members WHERE user_id = ?1", [await id('grace@example.com')])).toEqual({
      role: 'viewer',
    })

    const demote = await admin(`/api/admin/groups/${groupId}/role`, json('PUT', { role: 'editor' }))
    expect(demote.status).toBe(409)
    expect(((await demote.json()) as { error: string }).error).toContain('nobody able to administer')

    const remove = await admin(`/api/admin/groups/${groupId}/members/${await id('grace@example.com')}`, { method: 'DELETE' })
    expect(remove.status).toBe(409)

    const off = await admin(`/api/admin/groups/${groupId}`, json('PATCH', { active: false }))
    expect(off.status).toBe(409)

    // Nothing was changed by any of the refusals.
    expect(await db.get('SELECT role, g.active FROM group_workspace_roles r JOIN groups g ON g.id = r.group_id WHERE r.group_id = ?1', [groupId])).toEqual({
      role: 'admin',
      active: 1,
    })
  })
})

describe('the shape of a group', () => {
  it('has no way to contain another group', async () => {
    // R5, as a fact about the schema rather than a promise: there is no column to point at.
    const { db } = await world()
    const columns = await db.all<{ name: string }>('PRAGMA table_info(groups)')
    expect(columns.map((column) => column.name).sort()).toEqual(['active', 'created_at', 'created_by', 'description', 'id', 'name'])
  })
})

describe('the trail and the screen', () => {
  it('records every change it makes', async () => {
    const { admin, id, group, db, json } = await world()
    const groupId = await group('Platform Leads', ['grace@example.com'], 'editor')
    await admin(`/api/admin/groups/${groupId}`, json('PATCH', { name: 'Platform', description: 'The platform team' }))

    const actions = (await db.all<{ action: string }>('SELECT action FROM audit_events ORDER BY id')).map((row) => row.action)
    expect(actions).toContain('group.create')
    expect(actions).toContain('group.member')
    expect(actions).toContain('group.role')
    expect(actions).toContain('group.edit')

    // The role change names the workspace and the role, so the sentence can be written later.
    const role = await db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'group.role'")
    expect(JSON.parse(role!.data)).toMatchObject({ workspaceId: 'workspace', role: 'editor' })
    void id
  })

  it('lists the group with its people and its role, and says where a person’s role comes from', async () => {
    const { admin, group } = await world()
    await group('Platform Leads', ['grace@example.com'], 'editor')

    const listed = (await (await admin('/api/admin/groups')).json()) as {
      groups: Array<{ name: string; members: Array<{ email: string }>; roles: Record<string, string>; active: boolean }>
    }
    expect(listed.groups).toHaveLength(1)
    expect(listed.groups[0]).toMatchObject({ name: 'Platform Leads', active: true })
    expect(listed.groups[0].members.map((member) => member.email)).toEqual(['grace@example.com'])
    expect(listed.groups[0].roles).toEqual({ workspace: 'editor' })

    // The people list explains the role rather than showing a bare word.
    const people = (await (await admin('/api/admin/users')).json()) as {
      people: Array<{ email: string; role: string; effectiveRole: string; roleGroup?: string }>
    }
    const grace = people.people.find((person) => person.email === 'grace@example.com')!
    expect(grace).toMatchObject({ effectiveRole: 'editor', roleGroup: 'Platform Leads' })
  })
})
