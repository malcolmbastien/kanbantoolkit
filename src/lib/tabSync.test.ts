import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncFromStorage, tabSynced, useTabSync } from './tabSync'

// Two tabs are two adapters over one storage; the module state (`seen`, `applying`) is the tab's
// own, so each test starts by reading, as a boot does.
const NAME = 'kanbantoolkit-state-v3'
const data = new Map<string, string>()
const base = {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => {
    data.set(key, value)
  },
  removeItem: (key: string) => {
    data.delete(key)
  },
}

vi.stubGlobal('localStorage', { ...base, get length() { return data.size } })

const envelope = (state: Record<string, unknown>, rev?: number) => JSON.stringify({ state, version: 33, ...(rev === undefined ? {} : { rev }) })
const stored = () => JSON.parse(data.get(NAME)!) as { state: Record<string, unknown>; rev?: number }

describe('the revision a tab writes beside the workspace', () => {
  beforeEach(() => {
    data.clear()
    useTabSync.setState({ stale: false })
  })

  it('numbers each write, and keeps the slice exactly as it was', () => {
    const tab = tabSynced(base)
    tab.getItem(NAME)
    tab.setItem(NAME, envelope({ boards: ['A'] }))
    expect(stored().rev).toBe(1)
    expect(stored().state).toEqual({ boards: ['A'] })

    tab.setItem(NAME, envelope({ boards: ['A', 'B'] }))
    expect(stored().rev).toBe(2)
    expect(stored().state).toEqual({ boards: ['A', 'B'] })
  })

  it('refuses a write based on a revision another tab has already moved past', () => {
    const tab = tabSynced(base)
    // This tab read revision 1...
    data.set(NAME, envelope({ boards: ['A'] }, 1))
    tab.getItem(NAME)

    // ...and another tab wrote revision 2 while it was thinking.
    data.set(NAME, envelope({ boards: ['A', 'theirs'] }, 2))

    tab.setItem(NAME, envelope({ boards: ['mine'] }))

    // The newer workspace is untouched, and the tab knows it is behind.
    expect(stored().state).toEqual({ boards: ['A', 'theirs'] })
    expect(stored().rev).toBe(2)
    expect(useTabSync.getState().stale).toBe(true)
  })

  it('adopts another tab\u2019s write without echoing it back, and is then current again', () => {
    data.set(NAME, envelope({ boards: ['theirs'] }, 7))
    let adopted: Record<string, unknown> | null = null
    const tab = tabSynced(base)

    // What the app does on a channel message: read, apply — and the store's write follows.
    const ok = syncFromStorage(NAME, (state) => {
      adopted = state
      tab.setItem(NAME, envelope(state))
    })

    expect(ok).toBe(true)
    expect(adopted).toEqual({ boards: ['theirs'] })
    // The echo was suppressed: the revision did not move and nothing was rewritten.
    expect(stored().rev).toBe(7)
    expect(stored().state).toEqual({ boards: ['theirs'] })
    expect(useTabSync.getState().stale).toBe(false)

    // And the next real change writes straight on from there.
    tab.setItem(NAME, envelope({ boards: ['theirs', 'mine'] }))
    expect(stored().rev).toBe(8)
    expect(stored().state).toEqual({ boards: ['theirs', 'mine'] })
  })

  it('does nothing when there is no stored copy to adopt', () => {
    data.clear()
    expect(syncFromStorage(NAME, () => {})).toBe(false)
  })
})

describe('adoption reaches the store', () => {
  it('applies another tab’s slice', async () => {
    const { adoptWorkspace, useStore } = await import('@/store')
    const before = useStore.getState().items.length
    const card = { id: 'tab-card', title: 'From the other tab', typeId: 't-story', createdAt: 0 }
    adoptWorkspace({ items: [...useStore.getState().items, card] })
    expect(useStore.getState().items.length).toBe(before + 1)
    expect(useStore.getState().items.some((i) => i.id === 'tab-card')).toBe(true)
  })
})
