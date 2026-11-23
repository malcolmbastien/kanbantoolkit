import { describe, expect, it } from 'vitest'
import { changedFields, sameValue } from './events'
import type { Item } from '../src/domain/types'

const item = (extra: Partial<Item> = {}): Item => ({
  id: 'i-1',
  title: 'Card',
  typeId: 't-card',
  createdAt: 0,
  ...extra,
})

describe('the fields a card write changed', () => {
  it('names each edited label once, in the vocabulary the trail uses', () => {
    const before = item({ priority: 'low', checklist: [{ id: 'c1', text: 'One', done: false }] })
    const after = item({
      priority: 'high',
      checklist: [{ id: 'c1', text: 'One', done: true }],
      externalLabel: 'Ticket',
      externalUrl: 'https://example.test/1',
    })
    expect(changedFields(before, after)).toEqual(['priority', 'external link', 'checklist'])
  })

  it('does not call a nested body change a field change when the value is the same', () => {
    expect(sameValue([{ id: 'c1', done: true }], [{ id: 'c1', done: true }])).toBe(true)
    expect(changedFields(item(), item())).toEqual([])
  })
})

describe('the initiative health fan-out', () => {
  it('emits one event when a card below changes what its initiative is telling a reader', async () => {
    const { createFixture } = await import('../src/domain/fixture')
    const { readFileSync, readdirSync } = await import('node:fs')
    const { DatabaseSync } = await import('node:sqlite')
    const { fromSqlite } = await import('./sqlite')
    const { emitItemChange } = await import('./events')

    const db = new DatabaseSync(':memory:')
    const migrations = new URL('../migrations/', import.meta.url)
    for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
      db.exec(readFileSync(new URL(file, migrations), 'utf8'))
    }
    const database = fromSqlite(db)
    const s = createFixture()
    const beforeGraph = { items: s.items, edges: s.edges, links: s.links, placements: s.placements, lanes: s.lanes }
    const initiative = s.items.find((item) => item.id === 'init-welcome')
    const card = s.items.find((item) => item.id === 'st-welcome-copy')
    const doing = s.lanes.find((lane) => lane.boardId === 'b-nova' && lane.stage === 'inProgress' && lane.parentId !== null)
    if (!initiative || !card || !doing) throw new Error('fixture did not provide the initiative, card and lane')

    // The card is unowned and in progress after the write; before it is still uncommitted work.
    const afterPlacements = s.placements.map((placement) =>
      placement.itemId === card.id ? { ...placement, laneId: doing.id } : placement,
    )
    const afterGraph = { ...beforeGraph, placements: afterPlacements }
    await emitItemChange(database, 'workspace', initiative, initiative, beforeGraph, undefined, {
      graph: afterGraph,
      issueTypes: s.issueTypes,
    })

    const events = await database.all<{ type: string; payload: string }>(
      "SELECT type, payload FROM outbound_events WHERE type = 'initiative.health_changed'",
    )
    expect(events).toHaveLength(1)
    expect(JSON.parse(events[0].payload).data.initiativeId).toBe(initiative.id)
  })
})
