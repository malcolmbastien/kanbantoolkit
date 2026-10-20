import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SNAPSHOT_LIMIT, parseSnapshot, snapshotScheduler, snapshotsToDrop } from './snapshots'
import { createFixture } from '@/domain/fixture'
import { PERSIST_VERSION, persistedSlice, useStore } from '@/store'

// The store persists to `localStorage` on import, and the ring is exercised against the real
// store for the fidelity case — so the suite stands in a no-op storage, as the store suite does.
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
})

const record = (id: string, at: number) => ({ id, at, version: PERSIST_VERSION, state: { boards: [] } })

describe('the snapshot ring', () => {
  it('refuses a record it cannot understand rather than reading half of one', () => {
    expect(parseSnapshot(record('a', 1))).toEqual(record('a', 1))
    // No state: a restore must never run on this.
    expect(parseSnapshot({ id: 'a', at: 1, version: PERSIST_VERSION })).toBe(null)
    // A string where a number belongs.
    expect(parseSnapshot({ ...record('a', 1), at: '1' })).toBe(null)
    expect(parseSnapshot({ ...record('a', 1), state: [] })).toBe(null)
    expect(parseSnapshot(null)).toBe(null)
    expect(parseSnapshot('a')).toBe(null)
  })

  it('drops the oldest records beyond the limit, and nothing at or under it', () => {
    const records = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, at: i }))
    expect(snapshotsToDrop(records)).toEqual(['s0', 's1', 's2', 's3', 's4'])
    expect(snapshotsToDrop(records.slice(0, SNAPSHOT_LIMIT))).toEqual([])
    expect(snapshotsToDrop(records.slice(0, 19))).toEqual([])
    expect(snapshotsToDrop([])).toEqual([])
    // Order in the store is insertion order, not necessarily time order.
    expect(snapshotsToDrop([{ id: 'old', at: 9 }, { id: 'new', at: 1 }, { id: 'mid', at: 5 }], 2)).toEqual([
      'new',
    ])
  })

  it('writes one snapshot for a burst, with the last state, and nothing for a view-only change', () => {
    let now = 1_000_000
    let slice: Record<string, unknown> = { boards: ['a'] }
    const written: Record<string, unknown>[] = []
    const sched = snapshotScheduler({
      read: () => slice,
      write: (state) => written.push(state),
      version: PERSIST_VERSION,
      now: () => now,
      interval: 60_000,
    })

    // The first change is a change; it writes straight away, with nothing before it to compare to.
    expect(sched.mark()).toBe(true)
    expect(sched.flush()).toBe(true)
    expect(written).toHaveLength(1)

    // Opening a card changes the store but not the persisted slice: not dirty, nothing due.
    expect(sched.mark()).toBe(false)
    expect(sched.dueAt()).toBe(Number.POSITIVE_INFINITY)
    expect(sched.flush()).toBe(false)

    // Typing: dirty, but the interval has not passed.
    slice = { boards: ['a', 'b'] }
    expect(sched.mark()).toBe(true)
    expect(sched.flush()).toBe(false)
    // Still only the first snapshot: the burst is waiting for the interval.
    expect(written).toHaveLength(1)

    // More typing inside the interval is still one write.
    slice = { boards: ['a', 'b', 'c'] }
    expect(sched.mark()).toBe(true)

    now += 60_000
    expect(sched.flush()).toBe(true)
    expect(written).toHaveLength(2)
    expect(written[1]).toEqual({ boards: ['a', 'b', 'c'] })

    // Nothing pending: a second flush writes nothing.
    expect(sched.flush()).toBe(false)
    expect(written).toHaveLength(2)
  })

  it('writes on force even inside the interval, for a tab being hidden', () => {
    let now = 1_000
    let slice: Record<string, unknown> = { boards: ['a'] }
    const written: unknown[] = []
    const sched = snapshotScheduler({
      read: () => slice,
      write: (state) => written.push(state),
      version: PERSIST_VERSION,
      now: () => now,
    })
    slice = { boards: ['b'] }
    sched.mark()
    now += 1_000
    expect(sched.flush(true)).toBe(true)
    expect(written).toEqual([{ boards: ['b'] }])
  })

  it('is not wedged by a write that fails', () => {
    let now = 1_000
    let slice: Record<string, unknown> = { boards: ['a'] }
    let attempts = 0
    const sched = snapshotScheduler({
      read: () => slice,
      write: () => {
        attempts += 1
        if (attempts === 1) throw new Error('disk full')
      },
      version: PERSIST_VERSION,
      now: () => now,
    })
    slice = { boards: ['b'] }
    sched.mark()
    expect(() => sched.flush(true)).toThrow('disk full')
    // The failure cleared the pending flag; the next change arms it again.
    slice = { boards: ['c'] }
    now += 60_000
    sched.mark()
    expect(sched.flush()).toBe(true)
    expect(attempts).toBe(2)
  })
})

describe('what a snapshot carries', () => {
  beforeEach(() => {
    useStore.getState().resetDemo()
    useStore.setState({ ...createFixture() })
  })

  it('is the workspace and nothing about the view', () => {
    const slice = persistedSlice(useStore.getState())
    expect(slice).toHaveProperty('boards')
    expect(slice).toHaveProperty('items')
    expect(slice).toHaveProperty('lanes')
    expect(slice).toHaveProperty('placements')
    // View state is not the workspace.
    expect(slice).not.toHaveProperty('selectedItemId')
    expect(slice).not.toHaveProperty('multiSelect')
    expect(slice).not.toHaveProperty('filters')
    expect(slice).not.toHaveProperty('showFilters')
    expect(slice).not.toHaveProperty('confirm')
  })

  it('restores into a fresh store with every entity intact', () => {
    const before = useStore.getState()
    const snapshot = JSON.parse(JSON.stringify(persistedSlice(before))) as Record<string, unknown>

    useStore.getState().resetDemo()
    useStore.getState().importWorkspace(snapshot, PERSIST_VERSION)

    const after = useStore.getState()
    expect(after.boards.map((b) => b.name)).toEqual(before.boards.map((b) => b.name))
    expect(after.lanes.length).toBe(before.lanes.length)
    expect(after.items.length).toBe(before.items.length)
    expect(after.placements.length).toBe(before.placements.length)
    expect(after.items.find((i) => i.id === 'st-signup-form')?.title).toBe(
      before.items.find((i) => i.id === 'st-signup-form')?.title,
    )
    // And a card's history crosses with it: the log is part of the workspace.
    expect(after.items.find((i) => i.id === 'st-signup-form')?.log?.length).toBe(
      before.items.find((i) => i.id === 'st-signup-form')?.log?.length,
    )
  })
})
