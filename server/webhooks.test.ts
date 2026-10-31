import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { Database } from './db'
import { createSeed } from '../src/domain/seed'
import { emitEvent, emitItemChange } from './events'
import { writeItem, writeWorkspace } from './workspace/write'
import { fromSqlite } from './sqlite'
import { mapInitiative, type OpCaller } from './operations'
import { dispatchDue, queueTestEvent, retryDelivery, sign } from './webhooks'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

function database(): Database {
  const db = new DatabaseSync(':memory:')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  return fromSqlite(db)
}

async function endpoint(
  db: Database,
  over: { id?: string; eventTypes?: string[]; active?: number; secret?: string; url?: string } = {},
): Promise<string> {
  const id = over.id ?? 'w-1'
  await db.run(
    `INSERT INTO webhook_endpoints (id, workspace_id, url, secret, event_types, active, created_at)
     VALUES (?1, 'workspace', ?2, ?3, ?4, ?5, ?6)`,
    [
      id,
      over.url ?? 'https://receiver.example/events',
      over.secret ?? 'secret',
      JSON.stringify(over.eventTypes ?? []),
      over.active ?? 1,
      Date.now(),
    ],
  )
  return id
}

const events = async (db: Database) =>
  db.all<{ id: string; type: string; payload: string }>('SELECT id, type, payload FROM outbound_events ORDER BY occurred_at, id')

describe('outbound webhooks', () => {
  it('signs the timestamp and the exact body with the endpoint secret', async () => {
    expect(await sign('secret', 1_700_000_000_000, '{"a":1}')).toBe(
      'v1=4ef2732b0d632a6897af3a6d02a6de287f60d6c5f15dabdb0ceb045a34e3c5a7',
    )
  })

  it('records an event once and fans it out only to interested, active endpoints', async () => {
    const db = database()
    await endpoint(db, { id: 'all' })
    await endpoint(db, { id: 'created', eventTypes: ['item.created'] })
    await endpoint(db, { id: 'moved', eventTypes: ['item.moved'] })
    await endpoint(db, { id: 'paused', eventTypes: ['item.created'], active: 0 })

    await emitEvent(db, 'workspace', 'item.created', { itemId: 'i-1' })
    expect(await events(db)).toHaveLength(1)
    expect(JSON.parse((await events(db))[0].payload)).toMatchObject({
      type: 'item.created',
      workspaceId: 'workspace',
      data: { itemId: 'i-1' },
    })
    expect(await db.all('SELECT endpoint_id FROM webhook_deliveries ORDER BY endpoint_id')).toEqual([
      { endpoint_id: 'all' },
      { endpoint_id: 'created' },
    ])
  })

  it('delivers with the signature and the event headers, then marks it delivered', async () => {
    const db = database()
    await endpoint(db)
    await emitEvent(db, 'workspace', 'item.created', { itemId: 'i-1' })
    const payload = (await events(db))[0].payload
    const now = Date.now() + 1_000
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response('', { status: 200 })
    }

    expect(await dispatchDue(db, { now, fetchImpl })).toEqual({ delivered: 1, retried: 0, failed: 0 })
    expect(calls).toHaveLength(1)
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['x-kanban-event']).toBe('item.created')
    expect(headers['x-kanban-signature']).toBe(await sign('secret', now, payload))
    expect(await db.get('SELECT status, attempts, response_status FROM webhook_deliveries')).toEqual({
      status: 'delivered',
      attempts: 1,
      response_status: 200,
    })
  })

  it('retries a failure on the backoff and disables an endpoint that answers 410', async () => {
    const db = database()
    await endpoint(db, { id: 'retry' })
    await emitEvent(db, 'workspace', 'item.moved', { itemId: 'i-1' })
    await dispatchDue(db, { now: Date.now() + 1_000, fetchImpl: async () => new Response('', { status: 500 }) })
    expect(await db.get('SELECT status, attempts FROM webhook_deliveries')).toEqual({ status: 'pending', attempts: 1 })

    // The retry is not due yet: the dispatcher says so by doing nothing.
    const next = (await db.get<{ next_attempt_at: number }>('SELECT next_attempt_at FROM webhook_deliveries'))!.next_attempt_at
    expect(await dispatchDue(db, { now: next - 1, fetchImpl: async () => new Response('', { status: 200 }) })).toEqual({
      delivered: 0,
      retried: 0,
      failed: 0,
    })
    expect(await dispatchDue(db, { now: next, fetchImpl: async () => new Response('', { status: 200 }) })).toEqual({
      delivered: 1,
      retried: 0,
      failed: 0,
    })

    await endpoint(db, { id: 'gone', eventTypes: ['item.blocked'] })
    await emitEvent(db, 'workspace', 'item.blocked', { itemId: 'i-1' })
    await dispatchDue(db, { now: next, fetchImpl: async () => new Response('', { status: 410 }) })
    expect(await db.get('SELECT active, disabled_reason FROM webhook_endpoints WHERE id = ?1', ['gone'])).toEqual({
      active: 0,
      disabled_reason: 'endpoint answered 410 Gone',
    })
  })

  it('queues a test event regardless of the subscription, and retries a failed delivery', async () => {
    const db = database()
    await endpoint(db, { id: 'tested', eventTypes: ['item.moved'] })
    const deliveryId = await queueTestEvent(db, 'workspace', 'tested', 'u-1')
    expect(deliveryId).toBeTruthy()
    expect(await db.get('SELECT type FROM outbound_events')).toEqual({ type: 'webhook.test' })

    await dispatchDue(db, { now: Date.now() + 1_000, fetchImpl: async () => new Response('', { status: 500 }) })
    expect(await db.get('SELECT status FROM webhook_deliveries WHERE id = ?1', [deliveryId!])).toEqual({ status: 'pending' })
    expect(await retryDelivery(db, 'workspace', deliveryId!)).toBe(true)
    expect(await db.get('SELECT status, error FROM webhook_deliveries WHERE id = ?1', [deliveryId!])).toEqual({
      status: 'pending',
      error: null,
    })
    expect(await retryDelivery(db, 'another-workspace', deliveryId!)).toBe(false)
  })
})

describe('the events a card write produces', () => {
  const card = (over: Partial<import('../src/domain/types').Item> = {}) => ({
    id: 'i-1',
    title: 'A card',
    typeId: 't-card',
    createdAt: 0,
    ...over,
  })
  const graph = { items: [], edges: [], links: [], placements: [], lanes: [] }

  it('says created, blocked and moved from the before and after item', async () => {
    const db = database()
    const created = card()
    await emitItemChange(db, 'workspace', undefined, created, graph, 'u-1')
    await emitItemChange(
      db,
      'workspace',
      created,
      card({ blocked: true, blockedReason: 'Waiting on legal' }),
      graph,
      'u-1',
    )
    await emitItemChange(
      db,
      'workspace',
      card(),
      card({
        log: [
          {
            id: 'l-1',
            at: 2,
            kind: 'moved',
            note: 'Backlog → Done',
            fromStage: 'backlog',
            toStage: 'done',
            toLaneId: 'l-done',
            boardId: 'b-1',
          },
        ],
      }),
      graph,
      'u-1',
    )
    const recorded = await events(db)
    expect(recorded.map((event) => event.type).sort()).toEqual(['item.blocked', 'item.created', 'item.moved'])
    expect(JSON.parse(recorded.find((event) => event.type === 'item.moved')!.payload).data).toMatchObject({
      itemId: 'i-1',
      boardId: 'b-1',
      fromStage: 'backlog',
      toStage: 'done',
    })
  })
})

describe('derived initiative health', () => {
  it('emits only when the health of an initiative above the card actually changes', async () => {
    const db = database()
    const seed = createSeed()
    await writeWorkspace(db, { ...seed, savedFilters: [], collapsedLanes: {}, boardId: 'b-atlas' }, 'workspace')
    const card = seed.items.find((item) => item.id === 'st-signup-rebuild')!
    const beforeGraph = {
      items: seed.items,
      edges: seed.edges,
      links: seed.links,
      placements: seed.placements,
      lanes: seed.lanes,
    }
    const blocked = { ...card, blocked: true, blockedReason: 'Waiting on legal' }
    await writeItem(db, blocked, 'workspace')
    await emitItemChange(db, 'workspace', card, blocked, beforeGraph, 'u-1')
    expect((await events(db)).some((event) => event.type === 'initiative.health_changed')).toBe(true)

    // A second write that leaves the reading where it was is not another event.
    const afterGraph = { ...beforeGraph, items: seed.items.map((item) => (item.id === card.id ? blocked : item)) }
    await db.run('DELETE FROM outbound_events')
    await emitItemChange(db, 'workspace', blocked, blocked, afterGraph, 'u-1')
    expect(await events(db)).toEqual([])
  })
})

describe('objective mapping', () => {
  it('emits mapped and unmapped from the one operation that owns attribution', async () => {
    const db = database()
    const seed = createSeed()
    await writeWorkspace(db, { ...seed, savedFilters: [], collapsedLanes: {}, boardId: 'b-strategy' }, 'workspace')
    const caller = {
      db,
      workspaceId: 'workspace',
      user: { id: 'u-1', name: 'Ada', email: 'ada@example.com' },
      tokenId: 't-1',
      scopes: ['items:write'],
      role: 'admin',
    } as unknown as OpCaller

    expect((await mapInitiative(caller, 'obj-activation', 'init-trust', true)).ok).toBe(true)
    expect((await events(db)).map((event) => event.type)).toEqual(['objective.mapped'])
    expect((await mapInitiative(caller, 'obj-activation', 'init-trust', false)).ok).toBe(true)
    expect((await events(db)).map((event) => event.type)).toEqual(['objective.mapped', 'objective.unmapped'])
  })
})
