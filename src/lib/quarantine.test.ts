import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KEPT_PREFIX, WORKSPACE_KEY, forgetKeptWorkspace, keptWorkspace, keptWorkspaceFile, quarantineUnreadable } from './quarantine'
import { migratePersisted } from '@/store'

// A storage that behaves like the real one closely enough for the ring of kept copies.
const data = new Map<string, string>()
vi.stubGlobal('localStorage', {
  get length() {
    return data.size
  },
  key: (i: number) => [...data.keys()][i] ?? null,
  getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => {
    data.set(k, v)
  },
  removeItem: (k: string) => {
    data.delete(k)
  },
})

const envelope = (version: number, state: Record<string, unknown> = { boards: [{ id: 'b1' }] }) =>
  JSON.stringify({ state, version })

const quarantine = () => quarantineUnreadable({ build: 33, minKnown: 9 })

describe('a workspace this build cannot read', () => {
  beforeEach(() => data.clear())

  it('leaves a readable workspace exactly where it is', () => {
    data.set(WORKSPACE_KEY, envelope(33))
    expect(quarantine()).toBe(null)
    expect(data.get(WORKSPACE_KEY)).toBe(envelope(33))
    expect(keptWorkspace()).toBe(null)
  })

  it('moves a newer workspace aside, untouched, and names the version it found', () => {
    const raw = envelope(34)
    data.set(WORKSPACE_KEY, raw)
    const kept = quarantine()

    expect(kept?.found).toBe(34)
    // The copy is byte for byte what was stored...
    expect(data.get(KEPT_PREFIX)).toBe(raw)
    // ...and the workspace is no longer sitting there to be read as theirs.
    expect(data.get(WORKSPACE_KEY)).toBeUndefined()
  })

  it('keeps a state it cannot even parse, rather than deleting it', () => {
    data.set(WORKSPACE_KEY, 'this is not json')
    const kept = quarantine()
    expect(kept?.found).toBe(null)
    expect(data.get(KEPT_PREFIX)).toBe('this is not json')
    expect(data.get(WORKSPACE_KEY)).toBeUndefined()
  })

  it('keeps a workspace older than the migration floor, rather than seeding over it', () => {
    data.set(WORKSPACE_KEY, envelope(8))
    expect(quarantine()?.found).toBe(8)
    expect(data.get(KEPT_PREFIX)).toBe(envelope(8))
  })

  it('never overwrites a kept copy: a second one gets its own key', () => {
    data.set(WORKSPACE_KEY, envelope(40))
    quarantine()
    const first = data.get(KEPT_PREFIX)
    data.set(WORKSPACE_KEY, envelope(41))
    quarantine()
    expect(data.get(KEPT_PREFIX)).toBe(first)
    expect(data.get(`${KEPT_PREFIX}.2`)).toBe(envelope(41))
    // The newest copy is the one the app shows and offers.
    expect(keptWorkspace()?.key).toBe(`${KEPT_PREFIX}.2`)
    expect(keptWorkspace()?.found).toBe(41)
  })

  it('offers the copy as a workspace file a later build can import', () => {
    data.set(WORKSPACE_KEY, envelope(34, { boards: [{ id: 'b1', name: 'Atlas' }] }))
    const kept = quarantine()!
    const file = keptWorkspaceFile(kept)
    const parsed = JSON.parse(file.text) as { app: string; version: number; state: { boards: { name: string }[] } }
    expect(parsed.app).toBe('kanbantoolkit')
    expect(parsed.version).toBe(34)
    expect(parsed.state.boards[0].name).toBe('Atlas')
    expect(file.filename).toMatch(/^kanbantoolkit-kept-\d{4}-\d{2}-\d{2}\.json$/)
  })

  it('forgets a copy only when asked', () => {
    data.set(WORKSPACE_KEY, envelope(40))
    const kept = quarantine()!
    forgetKeptWorkspace(kept.key)
    expect(data.get(kept.key)).toBeUndefined()
    expect(keptWorkspace()).toBe(null)
  })

  it('refuses to migrate below the floor instead of returning the demo', () => {
    expect(() => migratePersisted({}, 8)).toThrow(/Cannot migrate a workspace written at version 8/)
    // The floor itself is a version this build does place.
    expect(migratePersisted({ boards: [] }, 9)).toBeTruthy()
  })
})
