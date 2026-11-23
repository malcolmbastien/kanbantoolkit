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
import type { Board, BoardFlow, Item, Lane, Placement } from '../src/domain/types'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

function database(): Database {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

const CARDS = 'f-cards'
const INIT = 'f-init'
const flows = (boardId = 'b-1'): BoardFlow[] => [
  { id: CARDS, boardId, kind: 'cards', name: 'Cards', order: 0 },
  { id: INIT, boardId, kind: 'initiatives', name: 'Initiatives', order: 0 },
]

const lane = (id: string, stage: Lane['stage'], extra: Partial<Lane> = {}): Lane => ({
  id,
  boardId: 'b-1',
  parentId: null,
  order: 0,
  name: id,
  flowId: CARDS,
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
    flows: flows(),
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
      lane('l-sec', 'backlog', { order: 0, flowId: INIT, name: 'Backlog (initiatives)' }),
      lane('l-cell', 'backlog', { order: 0, flowId: INIT, parentId: 'l-sec', name: 'Uncommitted' }),
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
    periods: [],
    keyResults: [],
    boardTemplates: [],
    savedFilters: [],
    collapsedLanes: {},
  }
}

const cookieOf = (response: Response) =>
  `fl_session=${(response.headers.get('set-cookie') ?? '').match(/fl_session=([^;]+)/)?.[1] ?? ''}`

type Init = RequestInit & { bearer?: string }

async function world(env: Record<string, string> = { AUTH_DEV: '1' }) {
  const db = database()
  await writeWorkspace(db, seeded(), 'workspace')
  await db.run('UPDATE instance_settings SET allowed_domains = ?1', [JSON.stringify(['example.com'])])

  const app = createApp({ database: () => db, clientIp: () => '203.0.113.11' })
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
      'whoami',
      'list_boards',
      'get_board',
      'search_items',
      'list_items',
      'list_attention',
      'get_item',
      'list_objectives',
      'get_vocabulary',
      'list_activity',
      'list_people',
      'workspace_summary',
      'create_item',
      'update_item',
      'block_item',
      'unblock_item',
      'move_item',
      'convert_to_initiative',
      'set_parent',
      'add_dependency',
      'remove_dependency',
      'map_initiative',
      'unmap_initiative',
      'add_note',
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
      expect(['boards:read', 'items:read', 'people:read', 'items:write', 'items:comment']).toContain(tool.scope)
    }
    // The writes are the acts a person has; nothing else in the table writes.
    expect(TOOLS.filter((tool) => tool.scope === 'items:write').map((tool) => tool.name)).toEqual([
      'create_item',
      'update_item',
      'block_item',
      'unblock_item',
      'move_item',
      'convert_to_initiative',
      'set_parent',
      'add_dependency',
      'remove_dependency',
      'map_initiative',
      'unmap_initiative',
    ])
  })

  it('offers a read-only credential no write tool at all', () => {
    const readOnly = toolsFor(['boards:read', 'items:read', 'people:read']).map((tool) => tool.name)
    expect(readOnly).not.toContain('create_item')
    expect(readOnly).not.toContain('move_item')
    expect(readOnly).not.toContain('set_parent')
    expect(readOnly).toContain('get_board')
    // The planner's reads are read-only too: who am I, what is mine, what changed, what may a card be.
    expect(readOnly).toEqual(expect.arrayContaining(['whoami', 'list_items', 'list_attention', 'list_activity', 'get_vocabulary']))

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
  it('lets an agent leave a note, and says which token wrote it', async () => {
    const { signIn, token } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const agent = await token(person, ['boards:read', 'items:read', 'items:comment'], 'CI bot')

    const noted = await call(agent.rpc, 'add_note', { itemId: 'i-1', text: 'Deployed to staging; smoke test is green.' })
    expect(noted.result?.isError).toBeUndefined()

    // The note is in the card's own history, with the person it speaks for and the token it came
    // through — a script's note must not read as a person's.
    const read = await call(agent.rpc, 'get_item', { itemId: 'i-1' })
    const item = read.result!.structuredContent as {
      log: Array<{ kind: string; note?: string; by?: string; via?: string }>
    }
    expect(item.log.find((entry) => entry.kind === 'noted')).toMatchObject({
      note: 'Deployed to staging; smoke test is green.',
      by: person.id,
      via: 'CI bot',
    })

    // Empty is not a note; the operation's sentence is the answer, not an invented entry.
    const empty = await call(agent.rpc, 'add_note', { itemId: 'i-1', text: '   ' })
    expect(empty.result?.isError).toBe(true)
    expect(empty.result?.structuredContent).toMatchObject({ error: 'invalid' })

    // A credential without `items:comment` does not have the tool at all — not one that refuses.
    const reader = await token(person, ['boards:read', 'items:read'], 'reader')
    const listed = (await (await reader.rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).json()) as {
      result: { tools: Array<{ name: string }> }
    }
    expect(listed.result.tools.map((tool) => tool.name)).not.toContain('add_note')
  })

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
    expect(summary.result?.structuredContent).toMatchObject({
      counts: { initiatives: 2 },
      boards: [{ id: 'b-1' }],
      // Every cards flow the summary reports is named, so an agent does not plan against the first.
      flows: [{ name: 'Cards' }],
    })
  })
})

describe('the planner’s questions', () => {
  /** The structured content of a tool answer, or an empty object when the call refused. */
  const dataOf = <T,>(result: Awaited<ReturnType<typeof call>>): T => (result.result?.structuredContent ?? {}) as T
  const ids = (result: Awaited<ReturnType<typeof call>>) =>
    dataOf<{ data: Array<{ id: string }> }>(result).data.map((entry) => entry.id)

  it('answers "my open work" from whoami and the item filters', async () => {
    const { signIn, token, db } = await world()
    const person = await signIn('editor@example.com', 'editor')
    // The roster is the workspace's copy of the account, and an assignee has to be on it.
    await db.run("INSERT OR REPLACE INTO people (id, name, workspace_id) VALUES (?1, 'Editor', 'workspace')", [person.id])
    const agent = await token(person, ['boards:read', 'items:read', 'items:write'], 'planner')

    const me = await call(agent.rpc, 'whoami')
    expect(me.result?.structuredContent).toMatchObject({
      user: { id: person.id, email: 'editor@example.com' },
      role: 'editor',
      token: { name: 'planner' },
    })

    // A card of this person's own, promised for a day that has passed.
    await call(agent.rpc, 'update_item', { itemId: 'i-1', baseRev: 1, assignees: [person.id], dueDate: '2020-01-31' })

    expect(ids(await call(agent.rpc, 'list_items', { assignee: 'me' }))).toEqual(['i-1'])
    expect(ids(await call(agent.rpc, 'list_items', { unassigned: true }))).toEqual(['i-2', 'i-3', 'i-init', 'i-kid'])
    // The stage is the column's, inherited by its cells — not a word in a title.
    expect(ids(await call(agent.rpc, 'list_items', { stage: 'done' }))).toEqual(['i-3'])
    expect(ids(await call(agent.rpc, 'list_items', { dueBefore: '2020-02-01' }))).toEqual(['i-1'])
    // Filters compose: the board's backlog cards are not its backlog initiatives.
    expect(ids(await call(agent.rpc, 'list_items', { boardId: 'b-1', stage: 'backlog', typeId: 't-card' }))).toEqual(['i-1', 'i-2'])

    // A filter that is not a stage is refused with the sentence, not silently empty.
    expect((await call(agent.rpc, 'list_items', { stage: 'nowhere' })).result?.isError).toBe(true)

    const vocabulary = await call(agent.rpc, 'get_vocabulary')
    const document = vocabulary.result?.structuredContent as { issueTypes: Array<{ id: string }> }
    expect(document.issueTypes.map((type) => type.id)).toEqual(['t-card', 't-init'])
  })

  it('reports what became blocked, and when, from the event stream', async () => {
    const { signIn, token } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const agent = await token(person, ['boards:read', 'items:read', 'items:write'], 'triage')

    const blocked = await call(agent.rpc, 'block_item', { itemId: 'i-2', baseRev: 1, reason: 'Waiting on legal' })
    expect(blocked.result?.isError).toBeUndefined()

    const only = await call(agent.rpc, 'list_items', { blocked: true })
    expect(dataOf<{ data: Array<Record<string, unknown>> }>(only).data[0]).toMatchObject({
      id: 'i-2',
      blocked: true,
      blockedReason: 'Waiting on legal',
    })

    // The block is its own history entry, written through the token.
    const read = await call(agent.rpc, 'get_item', { itemId: 'i-2' })
    const item = dataOf<{ log: Array<{ kind: string; note?: string; via?: string }> }>(read)
    expect(item.log.find((entry) => entry.kind === 'blocked')).toMatchObject({ note: 'Waiting on legal', via: 'triage' })

    // And it is on the stream, so "what appeared since yesterday?" is one call rather than a read
    // of every card's history.
    const stream = await call(agent.rpc, 'list_activity', { since: 0 })
    const events = dataOf<{ data: Array<{ type: string; itemId?: string }> }>(stream).data
    expect(events.some((event) => event.type === 'item.blocked' && event.itemId === 'i-2')).toBe(true)

    const typed = await call(agent.rpc, 'list_activity', { type: 'item.blocked' })
    const onlyBlocked = dataOf<{ data: Array<{ type: string }> }>(typed).data
    expect(onlyBlocked).toHaveLength(1)
    expect(onlyBlocked[0].type).toBe('item.blocked')

    const later = await call(agent.rpc, 'list_activity', { since: Date.now() + 60_000 })
    expect(dataOf<{ data: unknown[] }>(later).data).toEqual([])

    // Clearing it is the other act, and the item is open work again.
    const cleared = await call(agent.rpc, 'unblock_item', { itemId: 'i-2', baseRev: 2 })
    expect(cleared.result?.isError).toBeUndefined()
    expect((await call(agent.rpc, 'get_item', { itemId: 'i-2' })).result?.structuredContent).toMatchObject({ rev: 3 })
    expect(dataOf<{ data: unknown[] }>(await call(agent.rpc, 'list_items', { blocked: true })).data).toEqual([])
  })

  it('links the work that waits, and refuses a link that runs along the hierarchy', async () => {
    const { signIn, token } = await world()
    const person = await signIn('editor@example.com', 'editor')
    const agent = await token(person, ['boards:read', 'items:read', 'items:write'], 'planner')

    const linked = await call(agent.rpc, 'add_dependency', { itemId: 'i-3', dependsOn: 'i-1', reason: 'Ships with it' })
    expect(linked.result?.isError).toBeUndefined()
    expect(linked.result?.structuredContent).toMatchObject({ itemId: 'i-3', dependsOn: 'i-1', linked: true })

    // The dependent's history says what it now waits on, and its revision moved.
    const read = await call(agent.rpc, 'get_item', { itemId: 'i-3' })
    expect(dataOf<{ rev: number; log: Array<{ kind: string; note?: string }> }>(read)).toMatchObject({ rev: 2 })
    expect(dataOf<{ log: Array<{ kind: string; note?: string }> }>(read).log).toContainEqual(
      expect.objectContaining({ kind: 'linked', note: 'waits on Card i-1' }),
    )

    // A link that would close a loop is refused in the domain's words.
    expect((await call(agent.rpc, 'add_dependency', { itemId: 'i-1', dependsOn: 'i-3' })).result?.isError).toBe(true)
    // So is one along the decomposition: the rollup already orders a parent and its child.
    expect((await call(agent.rpc, 'add_dependency', { itemId: 'i-kid', dependsOn: 'i-init' })).result?.isError).toBe(true)

    const removed = await call(agent.rpc, 'remove_dependency', { itemId: 'i-3', dependsOn: 'i-1' })
    expect(removed.result?.structuredContent).toMatchObject({ linked: false })
    expect((await call(agent.rpc, 'remove_dependency', { itemId: 'i-3', dependsOn: 'i-1' })).result?.isError).toBe(true)
  })

  it('asks for attention within a scope: every board, one board, or mine', async () => {
    const { signIn, token, db } = await world()
    const person = await signIn('editor@example.com', 'editor')
    await db.run("INSERT OR REPLACE INTO people (id, name, workspace_id) VALUES (?1, 'Editor', 'workspace')", [person.id])
    const agent = await token(person, ['boards:read', 'items:read', 'items:write'], 'planner')

    // One owned card that is late, and one blocked card nobody owns.
    await call(agent.rpc, 'update_item', { itemId: 'i-1', baseRev: 1, assignees: [person.id], dueDate: '2020-01-31' })
    await call(agent.rpc, 'block_item', { itemId: 'i-2', baseRev: 1, reason: 'Waiting on legal' })

    const all = await call(agent.rpc, 'list_attention')
    const everything = dataOf<{
      scope: { boardId: string | null; boards: number }
      counts: Record<string, number>
      data: Array<{ item: { id: string }; boardId: string; boardName: string; signals: Array<{ key: string; label: string }> }>
    }>(all)
    expect(everything.scope).toMatchObject({ boardId: null, boards: 1 })
    expect(everything.data.map((row) => row.item.id)).toEqual(['i-1', 'i-2'])
    expect(everything.counts).toMatchObject({ overdue: 1, blocked: 1 })
    expect(everything.data.find((row) => row.item.id === 'i-2')).toMatchObject({
      boardId: 'b-1',
      boardName: 'Atlas',
      signals: [{ key: 'blocked', label: 'Blocked' }],
    })

    // One board is the same board here; the scope is echoed so a report can say what it read.
    const one = await call(agent.rpc, 'list_attention', { boardId: 'b-1' })
    expect(dataOf<{ scope: { boardId: string | null } }>(one).scope.boardId).toBe('b-1')
    expect((await call(agent.rpc, 'list_attention', { boardId: 'b-missing' })).result?.isError).toBe(true)

    // Mine is the token owner's own work, not the unowned card.
    const mine = await call(agent.rpc, 'list_attention', { assignee: 'me' })
    expect(dataOf<{ data: Array<{ item: { id: string } }> }>(mine).data.map((row) => row.item.id)).toEqual(['i-1'])

    // One tile, while the counts still describe the scope.
    const blocked = await call(agent.rpc, 'list_attention', { signal: 'blocked' })
    expect(dataOf<{ data: Array<{ item: { id: string } }> }>(blocked).data.map((row) => row.item.id)).toEqual(['i-2'])
    expect(dataOf<{ counts: Record<string, number> }>(blocked).counts).toMatchObject({ overdue: 1, blocked: 1 })
    expect((await call(agent.rpc, 'list_attention', { signal: 'nope' })).result?.isError).toBe(true)
  })

  it('spends from the same token window as the v1 routes', async () => {
    const { signIn, token } = await world({ AUTH_DEV: '1', API_RATE_LIMIT: '2' })
    const person = await signIn('limited@example.com', 'editor')
    const agent = await token(person, ['boards:read'], 'limited')

    // Two calls fit the window; the third is refused at the MCP door.
    const message = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    expect((await agent.rpc(message)).status).toBe(200)
    expect((await agent.rpc(message)).status).toBe(200)
    const over = await agent.rpc(message)
    expect(over.status).toBe(429)
    expect(over.headers.get('retry-after')).toBeTruthy()

    // The same credential on the v1 door is still spent: one budget, whichever way in.
    const v1 = await person.call('/api/v1/boards', {
      headers: { authorization: `Bearer ${agent.secret}` },
    })
    expect(v1.status).toBe(429)
  })

  it('maps an initiative to an objective, and refuses one that is part of another', async () => {
    const { signIn, token, db } = await world()
    await db.run("INSERT INTO objectives (id, title, status, workspace_id) VALUES ('o-1', 'Grow', 'active', 'workspace')")
    const person = await signIn('editor@example.com', 'editor')
    const agent = await token(person, ['boards:read', 'items:read', 'items:write'], 'strategy')

    const mapped = await call(agent.rpc, 'map_initiative', { objectiveId: 'o-1', itemId: 'i-init' })
    expect(mapped.result?.structuredContent).toMatchObject({ objectiveId: 'o-1', itemId: 'i-init', mapped: true })

    // A nested initiative inherits its parent's objective; it is not an outcome of its own.
    const nested = await call(agent.rpc, 'map_initiative', { objectiveId: 'o-1', itemId: 'i-kid' })
    expect(nested.result?.isError).toBe(true)

    const unmapped = await call(agent.rpc, 'unmap_initiative', { objectiveId: 'o-1', itemId: 'i-init' })
    expect(unmapped.result?.structuredContent).toMatchObject({ mapped: false })
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
