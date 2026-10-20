import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatBytes, guardedStorage, useStorageStatus, verifyStorage } from './storage'

// A storage that can be made to throw, or to accept a write and keep nothing — the two ways a
// browser fails to save.
const data = new Map<string, string>()
let throwing = false
let silent = false

vi.stubGlobal('localStorage', {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (throwing) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    if (!silent) data.set(key, value)
  },
  removeItem: (key: string) => {
    data.delete(key)
  },
})

const failed = () => useStorageStatus.getState().failed

describe('the storage the workspace lives in', () => {
  beforeEach(() => {
    data.clear()
    throwing = false
    silent = false
    useStorageStatus.setState({ failed: false, persisted: null, usage: null, quota: null })
  })

  it('knows a write landed, and never claims one did when it threw', () => {
    const storage = guardedStorage()
    storage.setItem('flowline-state-v3', '{"a":1}')
    expect(failed()).toBe(false)
    expect(data.get('flowline-state-v3')).toBe('{"a":1}')

    throwing = true
    // The throw is swallowed: a full disk must not take the app down with it.
    expect(() => storage.setItem('flowline-state-v3', '{"a":2}')).not.toThrow()
    expect(failed()).toBe(true)
    // The old copy is still what the browser holds.
    expect(data.get('flowline-state-v3')).toBe('{"a":1}')

    // And a later success clears the warning: the workspace is safe again.
    throwing = false
    storage.setItem('flowline-state-v3', '{"a":3}')
    expect(failed()).toBe(false)
  })

  it('catches a write that was accepted and kept nothing', () => {
    const storage = guardedStorage()
    silent = true
    storage.setItem('flowline-state-v3', '{"a":1}')
    // From the write alone there is nothing to know...
    expect(failed()).toBe(false)
    // ...but reading it back is the truth.
    verifyStorage()
    expect(failed()).toBe(true)

    silent = false
    storage.setItem('flowline-state-v3', '{"a":2}')
    verifyStorage()
    expect(failed()).toBe(false)
  })

  it('does not read back before anything has been written', () => {
    guardedStorage()
    useStorageStatus.setState({ failed: false })
    verifyStorage()
    expect(failed()).toBe(false)
  })

  it('writes bytes the way a person reads them', () => {
    expect(formatBytes(null)).toBe('unknown')
    expect(formatBytes(Number.NaN)).toBe('unknown')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB')
  })
})
