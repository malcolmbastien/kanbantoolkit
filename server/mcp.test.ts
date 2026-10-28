/**
 * The MCP server, through both transports (task 170).
 *
 * What is asserted here is the part a protocol test can see: the tool list a credential is offered,
 * the shape of a refusal (a result with `isError`, carrying the operation's sentence), that a write
 * lands and is audited with the token, and that the stdio bridge frames the same conversation the
 * HTTP door answers. The rules themselves are the domain's and are tested where they live.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { writeWorkspace } from './workspace/write'
import type { Workspace } from './workspace/types'
import { FORBIDDEN_TOOL_NAMES, TOOLS, toolsFor } from './mcp/tools'
import { bridgeLine } from './mcp'
import type { Board, Item, Lane, Placement } from '../src/domain/types'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

function database(): Database {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

const lane = (id: string, stage: Lane['stage'], extra: Partial<Lane> = {}): Lane => ({
  id,
  boardId: 'b-1',
  parentId: null,
  order: 0,
  name: id,
  workflow: 'cards',
  stage,
  ...extra,
})

const item = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  title: `Card ${id}`,
  typeId: 't-card',
  createdAt: 1_700_000_000_000,
  rev: 1,
  ...extra,
})

const place = (itemId: string, laneId: string, rank = 0): Placement => ({
  id: `p-${itemId}`,
  boardId: 'b-1',
  itemId,
  laneId,
  laneEnteredAt: 1_700_000_000_000,
  rank,
})

function seeded(): Workspace {
  const board: Board = { id: 'b-1', name: 'Atlas', band: 'team', description: 'A board.' }
  return {
    meUserId: 'u-admin',
    boardId: 'b-1',
    users: [],
    issueTypes: [
      { id: 't-card', name: 'Card', color: '#0ea5e9' },
      { id: 't-init', name: 'Initiative', color: '#8b5cf6' },
    ],
    boards: [board],
    lanes: [
      lane('l-backlog', 'backlog', { order: 0 }),
      lane('l-doing', 'inProgress', { order: 1 }),
      lane('l-done', 'done', { order: 2, wipLimit: 1 }),
      lane('l-sec', 'backlog', { order: 0, workflow: 'initiatives', name: 'Backlog (initiatives)' }),
      lane('l-cell', 'backlog', { order: 0, workflow: 'initiatives', parentId: 'l-sec', name: 'Uncommitted' }),
    ],
    items: [item('i-1'), item('i-2'), item('i-3'), item('i-init', { typeId: 't-init' }), item('i-kid', { typeId: 't-init' })],
    placements: [
      place('i-1', 'l-backlog', 0),
      place('i-2', 'l-backlog', 1),
      place('i-3', 'l-done', 0),
      place('i-init', 'l-cell', 0),
      place('i-kid', 'l-cell', 1),
    ],
    edges: [{ id: 'e-1', kind: 'decomposition', from: 'i-init', to: 'i-kid' }],
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

  const app = createApp({ database: () => db, clientIp: () => '203.0.113.11' })
  const env = { AUTH_DEV: '1' }
  const request = (path: string, init: Init = {}) => {
    const { bearer, ...rest } = init
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(rest.headers as Record<string, string>) }
    if (bearer) headers.authorization = `Bearer ${bearer}`
    return app.request(path, { ...rest, headers }, env)
  }

  const signIn = async (email: string, role: 'viewer' | 'editor' | 'admin' | 'instance' = 'editor') => {
    const response = await request('/api/auth/dev', { method: 'POST', body: JSON.stringify({ email }) })
    if (response.status !== 200) throw new Error(`sign-in refused: ${response.status}`)
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
    return {
      id: person.id,
      cookie,
      call: (path: string, init: Init = {}) => request(path, { ...init, headers: { cookie, ...(init.headers as Record<string, string>) } }),
    }
  }

  const token = async (
    person: { call: (path: string, init?: Init) => Response | Promise<Response> },
    scopes: string[],
    name = 'agent',
  ) => {
    const response = await person.call('/api/tokens', { method: 'POST', body: JSON.stringify({ name, scopes }) })
    if (response.status !== 201) throw new Error(`mint refused: ${response.status} ${await response.text()}`)
    const { secret, token: row } = (await response.json()) as { secret: string; token: { id: string } }
    return {
      secret,
      id: row.id,
      rpc: (message: unknown) => request('/mcp', { method: 'POST', body: JSON.stringify(message), bearer: secret }),
      post: async (body: string) => {
        const answer = await request('/mcp', { method: 'POST', body, bearer: secret })
        return { status: answer.status, text: await answer.text() }
      },
    }
  }

  return { db, app, request, signIn, token }
}

/** One `tools/call`, answered as the protocol answers: a JSON-RPC result whose `result` is a tool
 * result. */
const call = async (rpc: (message: unknown) => Response | Promise<Response>, name: string, args: Record<string, unknown> = {}) => {
  const answer = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  expect(answer.status).toBe(200)
  return (await answer.json()) as {
    result?: { content: Array<{ type: string; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean }
    error?: { code: number; message: string }
  }
}

describe('the tool table', () => {
  it('names only acts a person has, and no generative one', () => {
    const names = TOOLS.map((tool) => tool.name)
    expect(names).toEqual([
      'list_boards',
      'get_board',
      'search_items',
      'get_item',
      'list_objectives',
      'list_people',
      'workspace_summary',
      'create_item',
      'update_item',
      'move_item',
      'set_parent',
    ])
    // R6, spelled out: a tool that invented words would be the app writing what nobody wrote.
    for (const name of names) {
      for (const forbidden of FORBIDDEN_TOOL_NAMES) expect(name).not.toContain(forbidden)
    }
  })

  it('describes every tool for a model, and says what it refuses', () => {
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(80)
      expect(tool.inputSchema).toMatchObject({ type: 'object' })
      expect(['boards:read', 'items:read', 'people:read', 'items:write']).toContain(tool.scope)
    }
    // The four writes are the four acts; nothing else in the table writes.
    expect(TOOLS.filter((tool) => tool.scope === 'items:write').map((tool) => tool.name)).toEqual([
      'create_item',
      'update_item',
      'move_item',
      'set_parent',
    ])
  })

  it('offers a read-only credential no write tool at all', () => {
    const readOnly = toolsFor(['boards:read', 'items:read', 'people:read']).map((tool) => tool.name)
    expect(readOnly).not.toContain('create_item')
    expect(readOnly).not.toContain('move_item')
    expect(readOnly).not.toContain('set_parent')
    expect(readOnly).toContain('get_board')

    const writer = toolsFor(['boards:read', 'items:read', 'items:write']).map((tool) => tool.name)
    expect(writer).toContain('move_item')
  })
})

describe('the HTTP door', () => {
  it('refuses a request with no token, and a session cookie is not a token', async () => {
    const { request, signIn } = await world()
    const person = await signIn('editor@example.com', 'editor')

    const bare = await request('/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
    expect(bare.status).toBe(401)
    expect(((await bare.json()) as { error: { code: string } }).error.code).toBe('token_required')

    const cookie = await person.call('/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
    expect(cookie.status).toBe(401)
  })

  it('initializes, answers a ping, and lists what the credential may do', async () => {
    const { signIn, token } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const reader = await token(person, ['boards:read', 'items:read'], 'reader')
    const writer = await token(person, ['boards:read', 'items:read', 'items:write'], 'writer')

    const init = (await (await reader.rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).json()) as {
      result: { protocolVersion: string; capabilities: { tools: unknown }; serverInfo: { name: string } }
    }
    expect(init.result.protocolVersion).toBe('2025-06-18')
    expect(init.result.capabilities.tools).toBeTruthy()
    expect(init.result.serverInfo.name).toBe('kanbantoolkit')

    const ping = await reader.rpc({ jsonrpc: '2.0', id: 2, method: 'ping' })
    expect(ping.status).toBe(200)

    const listed = async (rpc: typeof reader.rpc) =>
      ((await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).json()) as {
        result: { tools: Array<{ name: string }> }
      }).result.tools.map((tool) => tool.name)

    expect(await listed(reader.rpc)).not.toContain('move_item')
    expect(await listed(writer.rpc)).toContain('move_item')
  })

  it('answers a notification with 202 and no body', async () => {
    const { signIn, token } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const writer = await token(person, ['items:write'], 'writer')
    const answer = await writer.rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(answer.status).toBe(202)
    expect(await answer.text()).toBe('')
  })
})

describe('the tools do what the doors do', () => {
  it('creates, moves, and records the token in the trail', async () => {
    const { signIn, token, db } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const writer = await token(person, ['boards:read', 'items:read', 'items:write'], 'agent')

    const created = await call(writer.rpc, 'create_item', { boardId: 'b-1', title: 'Filed by an agent', typeId: 't-card' })
    expect(created.result?.isError).toBeUndefined()
    const made = created.result!.structuredContent as { item: { id: string; laneId: string; rev: number } }
    expect(made.item.laneId).toBe('l-backlog')

    // Done holds one card and its limit is one; moving in without a reason is a refusal with the
    // server's sentence, not an exception.
    await db.run("UPDATE boards SET wip_enforcement = 'justify' WHERE id = 'b-1'")
    const held = await call(writer.rpc, 'move_item', { boardId: 'b-1', itemId: made.item.id, laneId: 'l-done' })
    expect(held.result?.isError).toBe(true)
    expect(held.result?.content[0].text).toContain('a reason is needed')
    expect(held.result?.structuredContent).toMatchObject({ error: 'reason_required' })

    const moved = await call(writer.rpc, 'move_item', {
      boardId: 'b-1',
      itemId: made.item.id,
      laneId: 'l-done',
      reason: 'Signed off',
    })
    expect(moved.result?.isError).toBeUndefined()
    expect(await db.get('SELECT lane_id FROM placements WHERE item_id = ?1', [made.item.id])).toEqual({ lane_id: 'l-done' })

    // The write is in the trail, as the token's owner, naming the token.
    const entry = await db.get<{ actor_id: string; data: string }>(
      "SELECT actor_id, data FROM audit_events WHERE action = 'api.write' ORDER BY at DESC LIMIT 1",
    )
    expect(entry?.actor_id).toBe(person.id)
    expect(entry?.data).toContain(writer.id)
    expect(entry?.data).toContain('item.move')
  })

  it('refuses a cycle through `set_parent`, in the domain’s words', async () => {
    const { signIn, token } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const writer = await token(person, ['items:write'], 'agent')

    // `i-kid` is already below `i-init`; asking for the reverse would make a ring.
    const answer = await call(writer.rpc, 'set_parent', { itemId: 'i-init', parentId: 'i-kid' })
    expect(answer.result?.isError).toBe(true)
    expect(answer.result?.structuredContent).toMatchObject({ error: 'parent_invalid' })
    expect(answer.result?.content[0].text).toContain('its own ancestor')
  })

  it('refuses a stale revision with the current item', async () => {
    const { signIn, token } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const writer = await token(person, ['items:write'], 'agent')

    const first = await call(writer.rpc, 'update_item', { itemId: 'i-1', baseRev: 1, title: 'First' })
    expect(first.result?.isError).toBeUndefined()
    const stale = await call(writer.rpc, 'update_item', { itemId: 'i-1', baseRev: 1, title: 'Second' })
    expect(stale.result?.isError).toBe(true)
    expect(stale.result?.structuredContent).toMatchObject({ error: 'stale' })
    // The answer carries the truth a model needs to recover: the current revision and title.
    const details = stale.result?.structuredContent?.details as { item: { rev: number; title: string } }
    expect(details.item).toMatchObject({ rev: 2, title: 'First' })
  })

  it('is bounded: a read returns a page, not the whole workspace', async () => {
    const { signIn, token } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const reader = await token(person, ['boards:read', 'items:read'], 'reader')

    const answer = await call(reader.rpc, 'list_boards', { limit: 1 })
    const value = answer.result!.structuredContent as { data: unknown[]; nextCursor: string | null }
    expect(value.data).toHaveLength(1)

    const summary = await call(reader.rpc, 'workspace_summary')
    expect(summary.result?.structuredContent).toMatchObject({ counts: { initiatives: 2 }, boards: [{ id: 'b-1' }] })
  })
})

describe('the stdio bridge', () => {
  it('frames the same conversation as the HTTP door', async () => {
    const { signIn, token } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const reader = await token(person, ['boards:read', 'items:read'], 'reader')

    const inside = await bridgeLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }), reader.post)
    expect(inside).toContain('"protocolVersion"')

    const listed = await bridgeLine(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), reader.post)
    expect(listed).toContain('list_boards')
    expect(listed).not.toContain('create_item')

    // A notification has no line to write: the client asked nothing.
    expect(await bridgeLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), reader.post)).toBeNull()

    const called = await bridgeLine(
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_boards', arguments: {} } }),
      reader.post,
    )
    expect(called).toContain('"result"')
    expect(called).toContain('b-1')
  })

  it('is a bridge, not a second server: it decides nothing', () => {
    // The stdio process forwards; the tools, the scopes and the trail are the instance's. This is
    // the structural half of "one tool table, two transports".
    const source = readFileSync(new URL('./mcp.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('/api/v1')
    expect(source).not.toMatch(/INSERT|UPDATE|DELETE/i)
    expect(source).toContain('/mcp')
  })
})
