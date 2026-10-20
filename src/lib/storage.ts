import { create } from 'zustand'
import type { StateStorage } from 'zustand/middleware'

/**
 * What the app knows about the storage it lives in.
 *
 * Session state, never persisted: writing "the disk is full" into the disk that is full would be
 * a joke with a bad punchline. The banner and the workspace panel read it; `guardedStorage` is
 * the only thing that writes it.
 */
export interface StorageStatus {
  /** A write failed, and none has succeeded since. */
  failed: boolean
  /** Whether the browser has promised not to evict the origin. `null` until it is asked. */
  persisted: boolean | null
  /** Bytes used, from the browser's own estimate. */
  usage: number | null
  /** Bytes available, from the browser's own estimate. */
  quota: number | null
}

export const useStorageStatus = create<StorageStatus>(() => ({
  failed: false,
  persisted: null,
  usage: null,
  quota: null,
}))

/** The last value a write claimed to store, kept for the read-back check. */
let lastWritten: { name: string; value: string } | null = null
let asked = false

function setFailed(failed: boolean) {
  if (useStorageStatus.getState().failed !== failed) useStorageStatus.setState({ failed })
}

/**
 * The workspace's storage, wrapped so a failed write is **known** rather than assumed.
 *
 * The throw is swallowed — the app must keep working with a full disk, and losing the edit in the
 * store because the save failed would be the worst of both — and the failure is published so the
 * banner can say so and the export can rescue it. A later successful write clears it.
 */
export function guardedStorage(): StateStorage {
  // A fresh adapter has not written anything yet: the read-back check belongs to the writes this
  // adapter makes, not to another one's.
  lastWritten = null
  return {
    getItem: (name) => localStorage.getItem(name),
    setItem: (name, value) => {
      try {
        localStorage.setItem(name, value)
        lastWritten = { name, value }
        setFailed(false)
        void requestPersistence()
      } catch {
        setFailed(true)
      }
    },
    removeItem: (name) => localStorage.removeItem(name),
  }
}

/**
 * Read the workspace back and compare. A browser can accept a write and keep nothing — quota
 * accounting that lags, or a private-mode store that discards — so a write is only *known* to
 * have landed when it is read back. Called on a slow timer, never on a keystroke.
 */
export function verifyStorage(): void {
  if (!lastWritten) return
  try {
    setFailed(localStorage.getItem(lastWritten.name) !== lastWritten.value)
  } catch {
    setFailed(true)
  }
}

/**
 * Ask the browser to keep this origin's data. Safari evicts a non-persistent origin after about a
 * week of non-use, which is a holiday erasing a workspace; this is the answer to that. Asked once,
 * after the first successful save — and again on demand, from a control, because some browsers
 * only grant it in response to a gesture.
 */
export async function requestPersistence(force = false): Promise<void> {
  if (asked && !force) return
  asked = true
  try {
    const storage = navigator.storage
    if (!storage) return
    const already = (await storage.persisted?.()) ?? false
    const granted = already || ((await storage.persist?.()) ?? false)
    useStorageStatus.setState({ persisted: granted })
  } catch {
    // A browser that refuses is not an error the person can act on.
  }
}

/** Refresh the usage figures the workspace panel shows. */
export async function measureStorage(): Promise<void> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    useStorageStatus.setState({ usage: estimate?.usage ?? null, quota: estimate?.quota ?? null })
  } catch {
    // Keep the last figures rather than blanking them.
  }
}

/** Bytes, in the words a person reads. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return 'unknown'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
