/**
 * The workspace schema and the read.
 *
 * The strong test is a round trip: a workspace goes in through the writer and comes back through
 * the endpoint, and the two are the same object. That is what "shaped exactly as `persistedSlice`"
 * means in practice — not that the columns look plausible, but that nothing is lost or renamed on
 * the way through.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { issueSession } from './auth/session'
import type { Database } from './db'
import { fromSqlite } from './sqlite'
import { readWorkspace } from './workspace/read'
import type { Item } from '../src/domain/types'
import type { Workspace } from './workspace/types'
import { writeWorkspace } from './workspace/write'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

function database(): Database {
  const db = new DatabaseSync(':memory:')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

async function signedIn(db: Database, id = 'u-ada', member = true): Promise<{ cookie: string }> {
  await db.run('INSERT OR IGNORE INTO users (id, name, email) VALUES (?1, ?2, ?3)', [id, 'Ada', `${id}@example.com`])
  if (member) await db.run('INSERT OR IGNORE INTO members (user_id, role) VALUES (?1, ?2)', [id, 'owner'])
  const session = await issueSession(db, id)
  return { cookie: `fl_session=${session.token}` }
}

function instance(db: Database) {
  const app = createApp({ database: () => db, clientIp: () => '203.0.113.7' })
  return (path: string, init?: RequestInit) => app.request(path, init, {})
}

/** A workspace that uses every table, most optional fields, and a tree three lanes deep. */
const workspace: Workspace = {
  users: [
    { id: 'u-ada', name: 'Ada' },
    { id: 'u-grace', name: 'Grace', avatarUrl: 'data:image/png;base64,AAAA' },
  ],
  issueTypes: [{ id: 't-card', name: 'Card', color: '#3b82f6' }],
  boards: [
    {
      id: 'b-atlas',
      name: 'Team Atlas',
      band: 'team',
      description: 'What we are doing, and why.',
      initiativeTypes: [{ id: 'k-bet', name: 'Bet', color: '#7c3aed' }],
      tags: [{ id: 'g-ux', name: 'UX', color: '#0ea5e9' }],
      linkedBoardIds: [],
      archived: false,
      defaultCardTypeId: 't-card',
      defaultDropLaneId: 'l-now',
      wipEnforcement: 'justify',
    },
    {
      id: 'b-port',
      name: 'Portfolio',
      band: 'portfolio',
      description: '',
      archived: true,
      archivedAt: 1_700_000_000_000,
    },
  ],
  lanes: [
    { id: 'l-start', boardId: 'b-atlas', parentId: null, order: 0, name: 'Not Started', workflow: 'cards', stage: 'notStarted' },
    {
      id: 'l-ready',
      boardId: 'b-atlas',
      parentId: 'l-start',
      order: 0,
      name: 'Ready',
      workflow: 'cards',
      orientation: 'columns',
      wipLimit: 2,
      description: 'Only work that is actually ready.',
    },
    { id: 'l-ready-named', boardId: 'b-atlas', parentId: 'l-ready', order: 0, name: 'Named', workflow: 'cards' },
    { id: 'l-now', boardId: 'b-atlas', parentId: null, order: 0, name: 'Now', workflow: 'initiatives', stage: 'inProgress' },
    { id: 'l-done', boardId: 'b-port', parentId: null, order: 0, name: 'Done', workflow: 'initiatives', stage: 'done' },
  ],
  items: [
    {
      id: 'i-signin',
      title: 'Sign in with a provider',
      description: 'Google or Microsoft, and no passwords.',
      typeId: 't-card',
      size: 3,
      initiativeTypeId: 'k-bet',
      tagIds: ['g-ux'],
      assignees: ['u-ada'],
      priority: 'high',
      targetStartDate: '2026-10-01',
      targetEndDate: '2026-10-31',
      createdAt: 1_700_000_000_000,
      rev: 4,
      lastMoveReason: 'pulled forward',
      blocked: true,
      blockedReason: 'waiting on legal',
      archived: false,
      archivedAt: 1_700_000_001_000,
      checklist: [
        { id: 'c-1', text: 'draft', done: true },
        { id: 'c-2', text: 'review', done: false },
      ],
      log: [
        { id: 'e-1', at: 1_700_000_000_000, kind: 'created', by: 'u-ada' },
        {
          id: 'e-2',
          at: 1_700_000_001_000,
          kind: 'moved',
          by: 'u-ada',
          note: 'Ready → Now',
          fromLaneId: 'l-ready-named',
          toLaneId: 'l-now',
          fromStage: 'notStarted',
          toStage: 'inProgress',
          boardId: 'b-atlas',
        },
      ],
    },
    { id: 'i-outcome', title: 'A portfolio outcome', typeId: 't-init', createdAt: 1_700_000_002_000 },
  ],
  placements: [
    { id: 'pl-1', boardId: 'b-atlas', itemId: 'i-signin', laneId: 'l-ready-named', laneEnteredAt: 1_700_000_001_000, rank: 2 },
    { id: 'pl-2', boardId: 'b-atlas', itemId: 'i-outcome', laneId: 'l-now' },
  ],
  edges: [
    { id: 'ed-1', kind: 'decomposition', from: 'i-outcome', to: 'i-signin' },
    { id: 'ed-2', kind: 'attribution', from: 'o-1', to: 'i-outcome' },
  ],
  links: [{ id: 'lk-1', from: 'i-outcome', to: 'i-signin', reason: 'needs it first' }],
  objectives: [
    { id: 'o-1', title: 'Ship the server', period: '2026-Q4', status: 'active' },
    { id: 'o-2', title: 'Grow', period: '2026-Q3', status: 'scored', score: 0.7 },
  ],
  keyResults: [{ id: 'kr-1', objectiveId: 'o-1', title: 'Two devices, one board' }],
  boardTemplates: [
    {
      id: 'bt-1',
      name: 'Standard team',
      band: 'team',
      defaultCardTypeId: 't-card',
      wipEnforcement: 'visualize',
      lanes: [
        { key: 'a', parentKey: null, order: 0, name: 'Backlog' },
        { key: 'b', parentKey: 'a', order: 0, name: 'Ready', orientation: 'rows', stage: 'notStarted', wipLimit: 3, description: 'Groomed.' },
      ],
    },
  ],
  autoArchiveDays: 30,
  savedFilters: [
    {
      id: 'f-1',
      name: 'Blocked and mine',
      boardId: 'b-atlas',
      filters: {
        text: 'acme',
        typeIds: ['t-card'],
        blocked: true,
        overdue: false,
        dueSoon: false,
        unassigned: false,
        assigneeIds: ['u-ada'],
        priorities: ['high'],
        tagIds: ['g-ux'],
        minAgeDays: 5,
        initiativeId: 'i-outcome',
      },
    },
  ],
  collapsedLanes: { 'l-now': true },
  boardId: 'b-atlas',
}

describe('the workspace', () => {
  it('comes back exactly as it went in', async () => {
    const db = database()
    await writeWorkspace(db, workspace)

    // Lanes are compared as a set: a lane carries its own `order`, and the order of the array it
    // happens to sit in is not part of the contract. Everything else keeps the order it was written
    // in, because for boards and for lists that order *is* the data.
    const read = await readWorkspace(db)
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)
    expect({ ...read, lanes: [...read.lanes].sort(byId) }).toEqual({
      ...workspace,
      lanes: [...workspace.lanes].sort(byId),
    })
  })

  it('is empty rather than broken when nothing has been written', async () => {
    const db = database()
    expect(await readWorkspace(db)).toEqual({
      boardId: '',
      savedFilters: [],
      collapsedLanes: {},
      users: [],
      issueTypes: [],
      items: [],
      edges: [],
      links: [],
      objectives: [],
      keyResults: [],
      boardTemplates: [],
      boards: [],
      lanes: [],
      placements: [],
    })
  })

  it('is handed back whole, in one request, to the person signed in', async () => {
    const db = database()
    await writeWorkspace(db, workspace)
    const request = instance(db)
    const { cookie } = await signedIn(db)

    const response = await request('/api/workspace', { headers: { cookie } })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Workspace & { meUserId: string }

    // The session answers "whose workspace", so the browser keeps no pointer of its own.
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)
    expect({ ...body, lanes: [...body.lanes].sort(byId) }).toEqual({
      ...workspace,
      meUserId: 'u-ada',
      lanes: [...workspace.lanes].sort(byId),
    })
  })

  it('answers nobody who is not signed in', async () => {
    const db = database()
    const request = instance(db)
    expect((await request('/api/workspace')).status).toBe(401)
  })

  it('answers nobody who is signed in without a membership', async () => {
    const db = database()
    const request = instance(db)
    const { cookie } = await signedIn(db, 'u-stranger', false)
    expect((await request('/api/workspace', { headers: { cookie } })).status).toBe(403)
  })
})

describe('writing one item', () => {
  const card = (over: Partial<Item> = {}): Item => ({
    id: 'i-card',
    title: 'A card',
    typeId: 't-card',
    createdAt: 1_700_000_000_000,
    ...over,
  })

  async function writer() {
    const db = database()
    const { cookie } = await signedIn(db)
    const request = instance(db)
    const patch = (id: string, body: unknown, signed = true) =>
      request(`/api/workspace/items/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...(signed ? { cookie } : {}) },
        body: JSON.stringify(body),
      })
    return { db, request, patch, cookie }
  }

  it('creates an item based on nothing, and keeps the server\'s revision', async () => {
    const { request, patch, cookie } = await writer()

    // A field the server does not know is not a field it stores.
    const response = await patch('i-card', { baseRev: 0, item: { ...card(), extra: 'not a field' } })
    expect(response.status).toBe(200)
    const answer = (await response.json()) as { item: Item }
    expect(answer.item.rev).toBe(1)
    expect((answer.item as unknown as Record<string, unknown>).extra).toBeUndefined()

    const body = (await (await request('/api/workspace', { headers: { cookie } })).json()) as Workspace
    expect(body.items.map((entry) => entry.id)).toEqual(['i-card'])
  })

  it('creates an item the server has never seen, whatever revision the browser based it on', async () => {
    const { patch } = await writer()
    // A workspace that has lived only in a browser arrives with revisions of its own; nothing here
    // has moved past anything, so the first write is a creation.
    const response = await patch('i-card', { baseRev: 7, item: card({ rev: 7 }) })
    expect(response.status).toBe(200)
    expect(((await response.json()) as { item: Item }).item.rev).toBe(8)
  })

  it('updates an item with the revision it was based on', async () => {
    const { patch } = await writer()
    await patch('i-card', { baseRev: 0, item: card() })

    const response = await patch('i-card', { baseRev: 1, item: card({ title: 'Renamed', rev: 1 }) })
    expect(response.status).toBe(200)
    const answer = (await response.json()) as { item: Item }
    expect(answer.item.title).toBe('Renamed')
    expect(answer.item.rev).toBe(2)
  })

  it('refuses a write the workspace has moved past, and answers with what is there now', async () => {
    const { patch, request, cookie } = await writer()
    await patch('i-card', { baseRev: 0, item: card() })
    await patch('i-card', { baseRev: 1, item: card({ title: 'Theirs', rev: 1 }) })

    // A tab that still believes the card is at revision 1 tries to write over revision 2.
    const stale = await patch('i-card', { baseRev: 1, item: card({ title: 'Mine', rev: 1 }) })
    expect(stale.status).toBe(409)
    const answer = (await stale.json()) as { item: Item }
    expect(answer.item.title).toBe('Theirs')
    expect(answer.item.rev).toBe(2)

    // Refused is not applied: the stored card is still theirs.
    const body = (await (await request('/api/workspace', { headers: { cookie } })).json()) as Workspace
    expect(body.items.find((entry) => entry.id === 'i-card')?.title).toBe('Theirs')
  })

  it('will not write without knowing what it was based on', async () => {
    const { patch } = await writer()
    expect((await patch('i-card', { item: card() })).status).toBe(400)
    expect((await patch('i-card', { baseRev: -1, item: card() })).status).toBe(400)
  })

  it('will not write a card to a path that names another card', async () => {
    const { patch } = await writer()
    expect((await patch('i-other', { baseRev: 0, item: card() })).status).toBe(400)
  })

  it('applies a retried change once, and answers the retry', async () => {
    const { patch, request, cookie } = await writer()
    await patch('i-card', { baseRev: 0, item: card() })

    const change = { baseRev: 1, item: card({ title: 'Once', rev: 1 }), key: 'change-1' }
    expect((await patch('i-card', change)).status).toBe(200)
    // The same key again is the same change: 200, not 409, and not applied a second time.
    expect((await patch('i-card', change)).status).toBe(200)

    const body = (await (await request('/api/workspace', { headers: { cookie } })).json()) as Workspace
    const stored = body.items.find((entry) => entry.id === 'i-card')!
    expect(stored.rev).toBe(2)
    expect(stored.title).toBe('Once')
  })

  it('will not write without a session', async () => {
    const { patch } = await writer()
    expect((await patch('i-card', { baseRev: 0, item: card() }, false)).status).toBe(401)
  })
})
