import { describe, expect, it } from 'vitest'
import { initiativeHierarchyReading } from './initiativeHierarchy'
import type { Edge, Item, ItemLink, Lane, Placement } from './types'
import type { StageMove } from './metrics'

const T = Date.UTC(2026, 9, 15, 9, 0, 0)
const DAY = 86_400_000
const day = (offset: number) => new Date(T + offset * DAY).toISOString().slice(0, 10)

const lanes: Lane[] = [
  { id: 'l-backlog', boardId: 'b-1', parentId: null, order: 0, name: 'Backlog', flowId: 'f-1', stage: 'backlog' },
  { id: 'l-not-started', boardId: 'b-1', parentId: null, order: 1, name: 'Not Started', flowId: 'f-1', stage: 'notStarted' },
  { id: 'l-in-progress', boardId: 'b-1', parentId: null, order: 2, name: 'In Progress', flowId: 'f-1', stage: 'inProgress' },
  { id: 'l-done', boardId: 'b-1', parentId: null, order: 3, name: 'Done', flowId: 'f-1', stage: 'done' },
]

const item = (id: string, title: string, over: Partial<Item> = {}): Item => ({
  id,
  title,
  typeId: 't-card',
  createdAt: T - 60 * DAY,
  ...over,
})

const placement = (id: string, itemId: string, laneId: string, laneEnteredAt = T - 20 * DAY): Placement => ({
  id,
  boardId: 'b-1',
  itemId,
  laneId,
  laneEnteredAt,
})

/** An initiative with a done leaf, two in-progress leaves (one blocked), a backlog leaf and a nested one. */
function fixture() {
  const root = item('i-root', 'Programme', {
    typeId: 't-initiative',
    targetStartDate: day(-30),
    targetEndDate: day(50),
  })
  const done = item('i-done', 'Delivered card', {
    resolvedAt: T - 6 * DAY,
    assignees: ['u-1'],
    targetStartDate: day(-10),
    targetEndDate: day(-5),
  })
  const working = item('i-working', 'Working card', {
    targetStartDate: day(-5),
    targetEndDate: day(5),
    dueDate: day(2),
  })
  const blocked = item('i-blocked', 'Blocked card', {
    assignees: ['u-2'],
    blocked: true,
    targetStartDate: day(3),
    targetEndDate: day(20),
    dueDate: day(-2),
  })
  const backlog = item('i-backlog', 'Backlog card', { targetEndDate: day(30), assignees: ['u-2'] })
  const nested = item('i-nested', 'Nested initiative', {
    typeId: 't-initiative',
    assignees: ['u-2'],
    targetEndDate: day(40),
  })
  const nestedLeaf = item('i-nested-leaf', 'Nested leaf', {
    assignees: ['u-2'],
    targetStartDate: day(-20),
    targetEndDate: day(40),
  })
  const discarded = item('i-discarded', 'Discarded card', {
    archived: true,
    discarded: true,
    archivedAt: T - 10 * DAY,
  })
  const items = [root, done, working, blocked, backlog, nested, nestedLeaf, discarded]
  const edges: Edge[] = [
    { id: 'e-1', kind: 'decomposition', from: 'i-root', to: 'i-done' },
    { id: 'e-2', kind: 'decomposition', from: 'i-root', to: 'i-working' },
    { id: 'e-3', kind: 'decomposition', from: 'i-root', to: 'i-blocked' },
    { id: 'e-4', kind: 'decomposition', from: 'i-root', to: 'i-backlog' },
    { id: 'e-5', kind: 'decomposition', from: 'i-root', to: 'i-nested' },
    { id: 'e-6', kind: 'decomposition', from: 'i-nested', to: 'i-nested-leaf' },
    { id: 'e-7', kind: 'decomposition', from: 'i-root', to: 'i-discarded' },
  ]
  const placements: Placement[] = [
    placement('p-root', 'i-root', 'l-in-progress', T - 100 * DAY),
    placement('p-done', 'i-done', 'l-done', T - 6 * DAY),
    placement('p-working', 'i-working', 'l-in-progress', T - 20 * DAY),
    placement('p-blocked', 'i-blocked', 'l-in-progress', T - 20 * DAY),
    placement('p-backlog', 'i-backlog', 'l-backlog', T - 20 * DAY),
    placement('p-nested', 'i-nested', 'l-not-started', T - 20 * DAY),
    placement('p-nested-leaf', 'i-nested-leaf', 'l-not-started', T - 20 * DAY),
    placement('p-discarded', 'i-discarded', 'l-backlog', T - 20 * DAY),
  ]
  const links: ItemLink[] = [{ id: 'l-1', from: 'i-blocked', to: 'i-working' }]
  const moves = new Map<string, readonly StageMove[]>([
    ['i-done', [{ at: T - 6 * DAY, to: 'done' }]],
    ['i-working', [{ at: T - 15 * DAY, to: 'inProgress' }]],
    ['i-blocked', [{ at: T - 3 * DAY, to: 'inProgress' }]],
    ['i-nested-leaf', [{ at: T - 25 * DAY, to: 'notStarted' }]],
  ])
  return {
    item: root,
    graph: { items, edges, links, placements, lanes },
    moves,
  }
}

describe('an initiative’s hierarchy reading', () => {
  it('counts the leaves once, in four stages and in the waiting/working/finished split', () => {
    const { item: root, graph } = fixture()
    const reading = initiativeHierarchyReading(root, graph, T, new Map())
    expect(reading.progress).toMatchObject({
      total: 5,
      done: 1,
      percent: 20,
      backlog: 1,
      notStarted: 1,
      inProgress: 2,
      waiting: 2,
      working: 2,
      finished: 1,
    })
  })

  it('says nothing invented when there are no leaves', () => {
    const root = item('i-alone', 'Alone', { typeId: 't-initiative' })
    const graph = { items: [root], edges: [], links: [], placements: [placement('p', 'i-alone', 'l-backlog')], lanes }
    const reading = initiativeHierarchyReading(root, graph, T, new Map())
    expect(reading.progress.total).toBe(0)
    expect(reading.flags).toEqual([])
    expect(reading.plan).toMatchObject({ dated: 0, total: 0 })
    expect(reading.actual.startStatus).toBe('noLeaves')
    expect(reading.actual.finishStatus).toBe('noLeaves')
  })

  it('reads all leaves done and the actual finish only when all are stamped', () => {
    const { item: root, graph } = fixture()
    const doneIds = new Set(['i-done', 'i-working', 'i-blocked', 'i-backlog', 'i-nested-leaf'])
    const allDone = {
      ...graph,
      items: graph.items.map((entry) =>
        doneIds.has(entry.id) ? { ...entry, resolvedAt: entry.id === 'i-done' ? T - 6 * DAY : T - 2 * DAY } : entry,
      ),
      placements: graph.placements.map((entry) =>
        doneIds.has(entry.itemId) ? { ...entry, laneId: 'l-done' } : entry,
      ),
    }
    const reading = initiativeHierarchyReading(root, allDone, T, new Map())
    expect(reading.progress.done).toBe(reading.progress.total)
    expect(reading.actual.finishStatus).toBe('known')
    expect(reading.actual.finish).toBe(T - 2 * DAY)

    const withoutStamps = {
      ...allDone,
      items: allDone.items.map((entry) => (entry.id === 'i-nested-leaf' ? { ...entry, resolvedAt: undefined } : entry)),
    }
    expect(initiativeHierarchyReading(root, withoutStamps, T, new Map()).actual.finishStatus).toBe('notRecorded')
  })

  it('reads planned dates over the leaves, and shows the initiative’s own window beside them', () => {
    const { item: root, graph } = fixture()
    const reading = initiativeHierarchyReading(root, graph, T, new Map())
    expect(reading.plan).toMatchObject({
      ownStart: day(-30),
      ownEnd: day(50),
      earliestStart: day(-20),
      latestFinish: day(40),
      dated: 5,
      total: 5,
    })
  })

  it('counts only leaves that carry a target date, and says so', () => {
    const { item: root, graph } = fixture()
    const withoutDates = {
      ...graph,
      items: graph.items.map((entry) =>
        entry.id === 'i-backlog' || entry.id === 'i-nested-leaf' ? { ...entry, targetStartDate: undefined, targetEndDate: undefined } : entry,
      ),
    }
    const reading = initiativeHierarchyReading(root, withoutDates, T, new Map())
    expect(reading.plan.dated).toBe(3)
    expect(reading.plan.total).toBe(5)
    expect(reading.plan.earliestStart).toBe(day(-10))
    expect(reading.plan.latestFinish).toBe(day(20))
  })

  it('reads actual start only from a known move history, and never from a lane stamp', () => {
    const { item: root, graph, moves } = fixture()
    expect(initiativeHierarchyReading(root, graph, T, moves).actual).toMatchObject({
      start: T - 25 * DAY,
      startStatus: 'known',
      finishStatus: 'notFinished',
    })
    expect(initiativeHierarchyReading(root, graph, T, undefined).actual.startStatus).toBe('notLoaded')
    // A map with no commitments for started work is "not recorded", not "not started".
    expect(initiativeHierarchyReading(root, graph, T, new Map()).actual.startStatus).toBe('notRecorded')

    const allBacklog = {
      ...graph,
      items: graph.items.map((entry) =>
        entry.id.startsWith('i-') && !entry.id.startsWith('i-root') && !entry.id.startsWith('i-nested')
          ? { ...entry, resolvedAt: undefined }
          : entry,
      ),
      placements: graph.placements.map((entry) =>
        entry.itemId.startsWith('i-') && entry.itemId !== 'i-root' && entry.itemId !== 'i-nested'
          ? { ...entry, laneId: 'l-backlog' }
          : entry,
      ),
    }
    expect(initiativeHierarchyReading(root, allBacklog, T, new Map()).actual.startStatus).toBe('notStarted')
  })

  it('reads the flags from the same rules the board’s attention uses', () => {
    const { item: root, graph } = fixture()
    const flags = initiativeHierarchyReading(root, graph, T, new Map()).flags
    const byKey = Object.fromEntries(flags.map((flag) => [flag.key, flag]))
    expect(byKey.blocked.items).toEqual(['i-blocked'])
    expect(byKey.waiting.items).toEqual(['i-working'])
    expect(byKey.unowned.items).toEqual(['i-working'])
    expect(byKey.stale.items).toEqual(expect.arrayContaining(['i-working', 'i-blocked', 'i-nested-leaf']))
    expect(byKey.overdue.items).toEqual(['i-blocked'])
    expect(byKey.dueSoon.items).toEqual(['i-working'])
    expect(byKey.lateStart.items).toEqual(['i-nested-leaf'])
    expect(byKey.uncommitted.items).toEqual(['i-backlog'])
    expect(byKey.discarded.items).toEqual(['i-discarded'])
    // The labels carry the count, not only a colour.
    expect(byKey.blocked.label).toBe('1 blocked')
    expect(byKey.overdue.label).toBe('1 overdue')
  })

  it('takes every flag’s items from the work below, not from the initiative itself', () => {
    const { item: root, graph } = fixture()
    const reading = initiativeHierarchyReading(root, graph, T, new Map())
    const below = new Set(graph.items.filter((entry) => entry.id !== root.id).map((entry) => entry.id))
    for (const flag of reading.flags) {
      for (const id of flag.items) expect(below.has(id), `${flag.key}: ${id}`).toBe(true)
    }
  })

  it('lets a child on another board be counted and read without moving it here', () => {
    const { item: root, graph } = fixture()
    const movedLanes = [...lanes, { id: 'l-other', boardId: 'b-2', parentId: null, order: 0, name: 'Other', flowId: 'f-2', stage: 'inProgress' as const }]
    const placements = graph.placements.map((entry) =>
      entry.itemId === 'i-working' ? { ...entry, boardId: 'b-2', laneId: 'l-other' } : entry,
    )
    const reading = initiativeHierarchyReading(root, { ...graph, lanes: movedLanes, placements }, T, new Map())
    expect(reading.progress.total).toBe(5)
    expect(reading.flags.find((flag) => flag.key === 'waiting')?.items).toContain('i-working')
  })
})
