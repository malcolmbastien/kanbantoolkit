import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chooseRepository, localRepository } from './repository'
import { useStorageStatus } from './storage'
import { useTabSync } from './tabSync'

// The two ways a browser fails to save, so the adapter can be shown to be the shipped one rather
// than merely something that compiles.
const data = new Map<string, string>()
let throwing = false

vi.stubGlobal('localStorage', {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (throwing) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    data.set(key, value)
  },
  removeItem: (key: string) => {
    data.delete(key)
  },
})

const NAME = 'flowline-state-v3'
const envelope = (state: Record<string, unknown>) => JSON.stringify({ state, version: 33 })

describe('where the workspace lives', () => {
  beforeEach(() => {
    data.clear()
    throwing = false
    useStorageStatus.setState({ failed: false, persisted: null, usage: null, quota: null })
    useTabSync.setState({ stale: false })
  })

  it('is decided in one place, and today that place answers the browser', () => {
    expect(chooseRepository().kind).toBe('local')
  })

  it('carries the persisted slice exactly as it is, with the revision beside it', () => {
    const repository = localRepository()
    repository.storage.getItem(NAME)
    repository.storage.setItem(NAME, envelope({ boards: [{ id: 'b-atlas' }] }))

    const stored = JSON.parse(data.get(NAME)!) as { state: unknown; version: number; rev: number }
    // The slice is not reshaped on the way through: the adapter is a door, not a second model.
    expect(stored.state).toEqual({ boards: [{ id: 'b-atlas' }] })
    expect(stored.version).toBe(33)
    // Still revisioned, so one tab still cannot overwrite another's work.
    expect(stored.rev).toBe(1)
  })

  it('publishes a failed write rather than throwing, as it did before the boundary', () => {
    const repository = localRepository()
    repository.storage.getItem(NAME)
    throwing = true

    expect(() => repository.storage.setItem(NAME, envelope({ boards: [] }))).not.toThrow()
    expect(useStorageStatus.getState().failed).toBe(true)
  })
})
