import { create } from 'zustand'
import type { StateStorage } from 'zustand/middleware'

/**
 * One workspace, several tabs.
 *
 * `localStorage` is shared, but each tab holds its own copy in memory and `persist` writes the
 * whole slice on every change. Without help the last tab to write wins, silently: rename a board
 * in one tab, drag a card in the other, and the rename is gone.
 *
 * Two things prevent that. A **revision** is written beside the state, so a tab can tell whether
 * the stored slice is still the one it read; and a **channel** carries the news that a write
 * happened, so the other tabs read it and adopt it rather than drifting. A write is refused only
 * when it races a newer one — and the tab that was refused says so instead of failing quietly.
 *
 * The value a tab is already *current* with is not a change. That single test is what keeps the
 * protocol quiet: a reload writes back what it just read, an adoption writes back what it just
 * took, and neither is news for anyone.
 *
 * Only the persisted slice is broadcast. Selection, filters, the open drawer and the active view
 * are not the workspace, and never cross.
 */

interface Envelope {
  state?: Record<string, unknown>
  version?: number
  rev?: number
}

/** The revision this tab last read, wrote or adopted. `null` until the first read. */
let seen: number | null = null
/** The value this tab is current with — the envelope as the store writes it, without the revision. */
let current: string | null = null
/** The channel writes are announced on. Null until this tab starts listening. */
let channel: BroadcastChannel | null = null

/** This tab is out of date: it read a revision that is no longer the stored one. */
export const useTabSync = create<{ stale: boolean }>(() => ({ stale: false }))

function markStale(stale: boolean) {
  if (useTabSync.getState().stale !== stale) useTabSync.setState({ stale })
}

/** The stored text, for the synchronous storage this app uses. */
function read(base: StateStorage, name: string): string | null {
  const value = base.getItem(name)
  return typeof value === 'string' ? value : null
}

function parse(text: string | null): Envelope | null {
  if (text === null) return null
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Envelope) : null
  } catch {
    return null
  }
}

/**
 * The envelope as `persist` writes it, revision aside — the thing this tab compares against to
 * decide whether a write is a change or a write-back.
 */
function asStoredValue(envelope: Envelope): string | null {
  return envelope.state ? JSON.stringify({ state: envelope.state, version: envelope.version }) : null
}

/**
 * The persist storage: the storage underneath, with the slice's revision kept beside it in the
 * same value — one write, so the state and its revision can never disagree.
 *
 * A write based on a revision that is no longer the stored one is refused. The tab is stale, the
 * newer workspace is someone else's, and an older idea of it must not overwrite it.
 */
export function tabSynced(base: StateStorage): StateStorage {
  return {
    getItem: (name) => {
      const text = read(base, name)
      const envelope = parse(text)
      seen = typeof envelope?.rev === 'number' ? envelope.rev : null
      current = envelope ? asStoredValue(envelope) : null
      return base.getItem(name)
    },
    setItem: (name, value) => {
      const stored = parse(read(base, name))
      const storedRev = typeof stored?.rev === 'number' ? stored.rev : 0

      // Writing back what this tab is already current with is not a change — but if the stored
      // slice has moved on since, the tab is behind, not idle.
      if (value === current) {
        if (seen === null || storedRev === seen) return
        markStale(true)
        return
      }

      if (seen !== null && storedRev !== seen) {
        markStale(true)
        return
      }

      const envelope = parse(value) ?? {}
      const rev = storedRev + 1
      base.setItem(name, JSON.stringify({ ...envelope, rev }))
      seen = rev
      current = value
      markStale(false)
      channel?.postMessage({ rev })
    },
    removeItem: (name) => base.removeItem(name),
  }
}

/**
 * Read the stored workspace and adopt it. The store's write-back of it will be recognised as the
 * same value, so adopting does not become the next tab's news — which is what keeps two tabs from
 * answering each other for ever.
 */
export function syncFromStorage(name: string, adopt: (state: Record<string, unknown>) => void): boolean {
  const envelope = parse(localStorage.getItem(name))
  if (!envelope?.state) return false
  adopt(envelope.state)
  current = asStoredValue(envelope)
  if (typeof envelope.rev === 'number') seen = envelope.rev
  markStale(false)
  return true
}

/**
 * Listen for other tabs. Neither signal carries state — both say only that there is some — so a
 * message makes this tab read the stored slice and adopt it. Adopting twice is harmless, which is
 * why both are listened to rather than choosing between them:
 *
 * - the `storage` event, which the browser fires in every *other* tab for a changed key, and
 * - `BroadcastChannel`, where it exists, which announces the write directly.
 */
export function listenForTabs(name: string, adopt: (state: Record<string, unknown>) => void): () => void {
  const take = () => {
    syncFromStorage(name, adopt)
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === name) take()
  }
  window.addEventListener('storage', onStorage)

  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('flowline-workspace')
    channel.onmessage = take
  }

  return () => {
    window.removeEventListener('storage', onStorage)
    channel?.close()
    channel = null
  }
}
