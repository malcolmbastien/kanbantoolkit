/**
 * Machine credentials, through the routes (task 148).
 *
 * Every test here signs somebody in, mints a token, and then *stops*: from that point on the requests
 * carry a bearer and no cookie, because that is the only thing a script has. The property worth
 * proving is the one no unit test can see — that the credential reaches exactly as far as the scope
 * says and no further than the person's role allows, and that revoking or expiring it ends it on the
 * very next request.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import type { Role } from '../src/domain/roles'
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

type Init = RequestInit & { bearer?: string }

async function world() {
  const db = database()
  await writeWorkspace(db, seeded(), 'workspace')
  await db.run(
    "INSERT INTO items (id, title, type_id, created_at, rev, workspace_id) VALUES ('i-1', 'A card', 't-card', 0, 1, 'workspace')",
  )
  await db.run('UPDATE instance_settings SET allowed_domains = ?1', [JSON.stringify(['example.com'])])

  const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
  const request = (path: string, init: Init = {}) => {
    const { bearer, ...rest } = init
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(rest.headers as Record<string, string>) }
    if (bearer) headers.authorization = `Bearer ${bearer}`
    return app.request(path, { ...rest, headers }, { AUTH_DEV: '1' })
  }

  /** A person, signed in, with the role this test needs. */
  const signIn = async (email: string, role: Role | 'instance' = 'viewer') => {
    const response = await request('/api/auth/dev', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
    if (response.status !== 200) throw new Error(`sign-in refused for ${email}: ${response.status}`)
    const person = (await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?1', [email]))!
    if (role === 'instance') {
      await db.run("UPDATE instance_members SET role = 'admin' WHERE user_id = ?1", [person.id])
      await db.run('DELETE FROM workspace_members WHERE user_id = ?1', [person.id])
    } else {
      await db.run(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('workspace', ?1, ?2)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`,
        [person.id, role],
      )
    }
    const cookie = cookieOf(response)
    const call = (path: string, init: Init = {}) =>
      request(path, { ...init, headers: { cookie, ...(init.headers as Record<string, string>) } })
    return { id: person.id, email, cookie, call }
  }

  /** A token holder: the only credential a script has. */
  const asToken = (secret: string) => (path: string, init: Init = {}) => request(path, { ...init, bearer: secret })

  return { db, request, signIn, asToken }
}

describe('a token is a credential with a ceiling', () => {
  it('reads what it was minted for, and nothing else', async () => {
    const { signIn, asToken } = await world()
    await signIn('owner@example.com', 'instance')
    const editor = await signIn('editor@example.com', 'editor')

    const answer = await editor.call('/api/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'ci export', scopes: ['boards:read', 'items:comment'] }),
    })
    expect(answer.status).toBe(201)
    const { secret, token } = (await answer.json()) as {
      secret: string
      token: { id: string; name: string; scopes: string[]; origin: string }
    }

    // R1: a recognisable, long secret, and the row holds its hash rather than itself.
    expect(secret.startsWith('flt_')).toBe(true)
    expect(secret.length).toBeGreaterThan(40)
    expect(token.scopes).toEqual(['boards:read', 'items:comment'])
    expect(token.origin).toBe('self')

    const bearer = asToken(secret)
    // The workspace read is `board.read`: in the scope, so it answers.
    expect((await bearer('/api/workspace')).status).toBe(200)

    // A write is outside the scopes, and the sentence says so — not "a viewer may not".
    const write = await bearer('/api/workspace/items/i-1', {
      method: 'PATCH',
      body: JSON.stringify({ baseRev: 1, item: { id: 'i-1', title: 'Changed', typeId: 't-card', createdAt: 0 } }),
    })
    expect(write.status).toBe(403)
    expect(((await write.json()) as { error: string }).error).toBe('this credential may not item.write')

    // A comment is inside it, and the editor's role allows it too.
    const note = await bearer('/api/workspace/items/i-1', {
      method: 'PATCH',
      body: JSON.stringify({
        baseRev: 1,
        item: {
          id: 'i-1',
          title: 'A card',
          typeId: 't-card',
          createdAt: 0,
          log: [{ id: 'e-1', at: 1, kind: 'noted', by: editor.id, note: 'from a script' }],
        },
      }),
    })
    expect(note.status).toBe(200)
  })

  it('is listed without its secret or its hash, and says when it was last used', async () => {
    const { signIn, db } = await world()
    await signIn('owner@example.com', 'instance')
    const person = await signIn('person@example.com', 'editor')

    const { secret } = (await (
      await person.call('/api/tokens', { method: 'POST', body: JSON.stringify({ name: 'a bot', scopes: ['boards:read'] }) })
    ).json()) as { secret: string }

    // Used once, so the touch is written (a null last_used_at always updates).
    expect((await person.call('/api/workspace', { headers: { authorization: `Bearer ${secret}` } })).status).toBe(200)

    const list = await person.call('/api/tokens')
    const text = await list.text()
    expect(text).not.toContain(secret)
    const rows = (JSON.parse(text) as { tokens: Array<{ name: string; lastUsedAt: string | null }> }).tokens
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('a bot')
    expect(rows[0].lastUsedAt).toBeTruthy()

    // And the hash — the thing a database copy leaks — is not in an answer either.
    const hash = await db.get<{ token_hash: string }>('SELECT token_hash FROM api_tokens')
    expect(text).not.toContain(hash!.token_hash)
  })

  it('stops on the request after it is revoked', async () => {
    const { signIn, asToken } = await world()
    await signIn('owner@example.com', 'instance')
    const person = await signIn('person@example.com', 'editor')

    const { secret, token } = (await (
      await person.call('/api/tokens', { method: 'POST', body: JSON.stringify({ name: 'doomed', scopes: ['boards:read'] }) })
    ).json()) as { secret: string; token: { id: string } }

    expect((await asToken(secret)('/api/workspace')).status).toBe(200)
    expect((await person.call(`/api/tokens/${token.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await asToken(secret)('/api/workspace')).status).toBe(401)
    // Revoking twice finds nothing to revoke.
    expect((await person.call(`/api/tokens/${token.id}`, { method: 'DELETE' })).status).toBe(404)
  })

  it('stops when it expires, and answers 401 rather than 403', async () => {
    const { signIn, asToken, db } = await world()
    await signIn('owner@example.com', 'instance')
    const person = await signIn('person@example.com', 'editor')

    const { secret } = (await (
      await person.call('/api/tokens', { method: 'POST', body: JSON.stringify({ name: 'old', scopes: ['boards:read'] }) })
    ).json()) as { secret: string }

    await db.run('UPDATE api_tokens SET expires_at = ?1', ['2000-01-01T00:00:00.000Z'])
    const answer = await asToken(secret)('/api/workspace')
    expect(answer.status).toBe(401)
    // An expired credential is not a person short of authority.
    expect(((await answer.json()) as { error: string }).error).toBe('that credential is not valid')
  })

  it('is refused past the owner’s role, whatever its scopes say', async () => {
    const { signIn, asToken, db } = await world()
    await signIn('owner@example.com', 'instance')
    const person = await signIn('editor@example.com', 'editor')

    const { secret } = (await (
      await person.call('/api/tokens', { method: 'POST', body: JSON.stringify({ name: 'writes', scopes: ['items:write', 'boards:read'] }) })
    ).json()) as { secret: string }

    // The editor may write, so the token does too…
    const first = await asToken(secret)('/api/workspace/items/i-1', {
      method: 'PATCH',
      body: JSON.stringify({ baseRev: 1, item: { id: 'i-1', title: 'Changed', typeId: 't-card', createdAt: 0 } }),
    })
    expect(first.status).toBe(200)

    // …until the person is demoted. Nothing has to be revoked: the role is read per request.
    await db.run("UPDATE workspace_members SET role = 'viewer' WHERE user_id = ?1", [person.id])
    const after = await asToken(secret)('/api/workspace/items/i-1', {
      method: 'PATCH',
      body: JSON.stringify({ baseRev: 2, item: { id: 'i-1', title: 'Again', typeId: 't-card', createdAt: 0 } }),
    })
    expect(after.status).toBe(403)
    expect(((await after.json()) as { error: string }).error).toBe('a viewer may not item.write')
  })

  it('refuses a Viewer the writing scopes at mint time, and names them', async () => {
    const { signIn } = await world()
    await signIn('owner@example.com', 'instance')
    const viewer = await signIn('viewer@example.com', 'viewer')

    const answer = await viewer.call('/api/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'hopeful', scopes: ['items:write'] }),
    })
    expect(answer.status).toBe(422)
    const body = (await answer.json()) as { error: string; scopes: string[] }
    expect(body.scopes).toEqual(['items:write'])
    expect(body.error).toContain('may not hold items:write')

    // Reading, and commenting, are theirs.
    expect(
      (
        await viewer.call('/api/tokens', {
          method: 'POST',
          body: JSON.stringify({ name: 'reader', scopes: ['boards:read', 'items:read', 'items:comment'] }),
        })
      ).status,
    ).toBe(201)

    // A scope this server does not know is a refusal, not a stored string.
    expect(
      (
        await viewer.call('/api/tokens', {
          method: 'POST',
          body: JSON.stringify({ name: 'guess', scopes: ['boards:*'] }),
        })
      ).status,
    ).toBe(422)
  })
})

describe('the device flow: a tool asks, a person approves', () => {
  const device = async (request: Awaited<ReturnType<typeof world>>['request'], body: unknown) =>
    (await request('/api/tokens/device', { method: 'POST', body: JSON.stringify(body) })).json() as Promise<{
      device_code: string
      user_code: string
      verification_uri: string
      expires_in: number
    }>

  it('hands the secret to the tool, once, after the person approved', async () => {
    const { request, signIn, asToken, db } = await world()
    await signIn('owner@example.com', 'instance')
    const person = await signIn('person@example.com', 'editor')

    const asked = await device(request, { name: 'flowline-cli on ada’s laptop', scopes: ['boards:read'] })
    expect(asked.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(asked.verification_uri).toContain(`/app?approve=`)

    // Before anybody approves, the tool waits rather than fails.
    const pending = await request('/api/tokens/device/token', {
      method: 'POST',
      body: JSON.stringify({ device_code: asked.device_code }),
    })
    expect(pending.status).toBe(428)

    // What the approval screen shows: the tool, the scopes in words, and nothing else.
    const shown = await person.call(`/api/tokens/device/${asked.user_code}`)
    expect(shown.status).toBe(200)
    const details = (await shown.json()) as { name: string; scopes: string[]; approved: boolean }
    expect(details.name).toBe('flowline-cli on ada’s laptop')
    expect(details.scopes).toEqual(['boards:read'])
    expect(details.approved).toBe(false)

    // The person approves — typed however they typed it.
    const approved = await person.call('/api/tokens/device/approve', {
      method: 'POST',
      body: JSON.stringify({ user_code: asked.user_code.toLowerCase().replace('-', ' ') }),
    })
    expect(approved.status).toBe(200)

    // Approving twice is not two credentials.
    expect(
      (
        await person.call('/api/tokens/device/approve', {
          method: 'POST',
          body: JSON.stringify({ user_code: asked.user_code }),
        })
      ).status,
    ).toBe(409)

    const exchange = await request('/api/tokens/device/token', {
      method: 'POST',
      body: JSON.stringify({ device_code: asked.device_code }),
    })
    expect(exchange.status).toBe(200)
    const { secret, token } = (await exchange.json()) as { secret: string; token: { origin: string } }
    expect(token.origin).toBe('device')
    expect((await asToken(secret)('/api/workspace')).status).toBe(200)

    // The code is spent: the same exchange again is a new code away, not a second token.
    expect(
      (
        await request('/api/tokens/device/token', {
          method: 'POST',
          body: JSON.stringify({ device_code: asked.device_code }),
        })
      ).status,
    ).toBe(410)

    // And the approval is in the trail — by whom, for which tool, with which scopes, never the value.
    const trail = await db.get<{ data: string }>(
      "SELECT data FROM audit_events WHERE action = 'token.approve' ORDER BY at DESC LIMIT 1",
    )
    expect(trail?.data).toContain('flowline-cli on ada’s laptop')
    expect(trail?.data).not.toContain(secret)
  })

  it('will not let a person approve a scope they could not hold', async () => {
    const { request, signIn } = await world()
    await signIn('owner@example.com', 'instance')
    const viewer = await signIn('viewer@example.com', 'viewer')

    const asked = await device(request, { name: 'greedy', scopes: ['items:write', 'boards:read'] })
    const answer = await viewer.call('/api/tokens/device/approve', {
      method: 'POST',
      body: JSON.stringify({ user_code: asked.user_code }),
    })
    expect(answer.status).toBe(422)
    expect(((await answer.json()) as { scopes: string[] }).scopes).toEqual(['items:write'])

    // Narrowing to what they may hold is how a person says yes to a smaller thing.
    const narrowed = await viewer.call('/api/tokens/device/approve', {
      method: 'POST',
      body: JSON.stringify({ user_code: asked.user_code, scopes: ['boards:read'] }),
    })
    expect(narrowed.status).toBe(200)
  })

  it('refuses an unknown or expired code, and a code nobody approved', async () => {
    const { request, signIn } = await world()
    await signIn('owner@example.com', 'instance')
    const person = await signIn('person@example.com', 'editor')

    expect((await person.call('/api/tokens/device/ZZZZ-ZZZZ')).status).toBe(404)
    expect(
      (await request('/api/tokens/device/token', { method: 'POST', body: JSON.stringify({ device_code: 'flt_nope' }) })).status,
    ).toBe(410)

    // A tool may not exchange a code nobody approved, however long it waits.
    const asked = await device(request, { name: 'patient', scopes: ['boards:read'] })
    expect(
      (
        await request('/api/tokens/device/token', {
          method: 'POST',
          body: JSON.stringify({ device_code: asked.device_code }),
        })
      ).status,
    ).toBe(428)
  })
})

describe('an administrator, for somebody else', () => {
  it('lists, mints within the owner’s role, and revokes with a trail entry', async () => {
    const { signIn, db, asToken } = await world()
    const admin = await signIn('owner@example.com', 'instance')
    const viewer = await signIn('viewer@example.com', 'viewer')
    // The administrator runs the instance; give them a workspace to act in as well.
    await db.run(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('workspace', ?1, 'admin')
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`,
      [admin.id],
    )

    // The owner's ceiling, not the administrator's: a Viewer still cannot be handed a writing token.
    const tooWide = await admin.call(`/api/admin/users/${viewer.id}/tokens`, {
      method: 'POST',
      body: JSON.stringify({ name: 'helpful', scopes: ['items:write'] }),
    })
    expect(tooWide.status).toBe(422)

    const made = await admin.call(`/api/admin/users/${viewer.id}/tokens`, {
      method: 'POST',
      body: JSON.stringify({ name: 'nightly export', scopes: ['boards:read'] }),
    })
    expect(made.status).toBe(201)
    const { secret, token } = (await made.json()) as { secret: string; token: { id: string; origin: string } }
    expect(token.origin).toBe('admin')

    // It works, for its owner and no wider.
    expect((await asToken(secret)('/api/workspace')).status).toBe(200)

    const list = await admin.call(`/api/admin/users/${viewer.id}/tokens`)
    const text = await list.text()
    expect(text).not.toContain(secret)
    expect((JSON.parse(text) as { tokens: unknown[] }).tokens).toHaveLength(1)

    expect((await admin.call(`/api/admin/users/${viewer.id}/tokens/${token.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await asToken(secret)('/api/workspace')).status).toBe(401)

    const entry = await db.get<{ actor_id: string; action: string; target_id: string }>(
      "SELECT actor_id, action, target_id FROM audit_events WHERE action = 'token.revoke'",
    )
    expect(entry).toEqual({ actor_id: admin.id, action: 'token.revoke', target_id: viewer.id })
  })

  it('is not a door a non-administrator can use', async () => {
    const { signIn } = await world()
    await signIn('owner@example.com', 'instance')
    const editor = await signIn('editor@example.com', 'editor')

    expect((await editor.call('/api/admin/users/someone/tokens')).status).toBe(403)
    expect(
      (
        await editor.call('/api/admin/users/someone/tokens', {
          method: 'POST',
          body: JSON.stringify({ name: 'nope', scopes: ['boards:read'] }),
        })
      ).status,
    ).toBe(403)
  })
})
