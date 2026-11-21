import { afterEach, describe, expect, it, vi } from 'vitest'
import { dismissMentionKey, dismissedMentionKeys, mentionEntryKey } from './dismissedMentions'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('dismissed comment notifications', () => {
  it('remembers one mention per person, and reads an empty list without storage', () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    expect(dismissedMentionKeys('u-1')).toEqual(new Set())

    const key = mentionEntryKey('i-1', 'e-1')
    dismissMentionKey('u-1', key)
    expect(dismissedMentionKeys('u-1')).toEqual(new Set([key]))
    // Another person's browser state is their own.
    expect(dismissedMentionKeys('u-2')).toEqual(new Set())
  })

  it('survives malformed storage and a storage that refuses to write', () => {
    const storage = new MemoryStorage()
    storage.setItem('kanbantoolkit-dismissed-mentions:u-1', '{not json')
    vi.stubGlobal('localStorage', storage)
    expect(dismissedMentionKeys('u-1')).toEqual(new Set())

    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage off')
      },
      setItem: () => {
        throw new Error('storage off')
      },
    })
    expect(dismissedMentionKeys('u-1')).toEqual(new Set())
    expect(() => dismissMentionKey('u-1', mentionEntryKey('i-1', 'e-1'))).not.toThrow()
  })
})
