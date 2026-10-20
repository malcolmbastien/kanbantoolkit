/**
 * Snapshots: the workspace, kept in a ring so a mistake can be undone.
 *
 * The ring lives in IndexedDB rather than beside the workspace in `localStorage`: it is the same
 * data twenty times over, and `localStorage` is where the workspace itself already spends its
 * quota. It is deliberately **not** a backup — clearing the site's data removes both — but it
 * covers the things that actually happen: a bad edit, a save that was interrupted, a corrupt
 * slice, a migration that went wrong.
 *
 * The module knows nothing about the store. `startSnapshotSchedule` is handed the slice and the
 * subscription, which keeps the ring testable in plain Node and the wiring in one place.
 */

export interface SnapshotRecord {
  id: string
  /** When the copy was taken, in epoch milliseconds. */
  at: number
  /** The persisted schema the copy was written in — the same number `migrate` reads. */
  version: number
  state: Record<string, unknown>
}

export type SnapshotMeta = Pick<SnapshotRecord, 'id' | 'at' | 'version'>

/** How many copies the ring keeps. */
export const SNAPSHOT_LIMIT = 20
/** The shortest gap between two copies while someone is working. */
export const SNAPSHOT_INTERVAL = 60_000

/**
 * A record read back, or nothing when it cannot be understood. Refusing a half-record is the
 * point: a restore must never run on a slice that is missing its state.
 */
export function parseSnapshot(raw: unknown): SnapshotRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Partial<SnapshotRecord>
  if (typeof r.id !== 'string' || r.id === '') return null
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return null
  if (typeof r.version !== 'number' || !Number.isFinite(r.version)) return null
  if (!r.state || typeof r.state !== 'object' || Array.isArray(r.state)) return null
  return { id: r.id, at: r.at, version: r.version, state: r.state as Record<string, unknown> }
}

/**
 * The ids a ring must drop to stay within `limit`, oldest first. A record whose `at` cannot be
 * read is dropped before a readable one: corruption leaves the ring first.
 */
export function snapshotsToDrop(
  records: readonly { id: string; at: number }[],
  limit = SNAPSHOT_LIMIT,
): string[] {
  if (records.length <= limit) return []
  return [...records]
    .sort((a, b) => a.at - b.at)
    .slice(0, records.length - limit)
    .map((r) => r.id)
}

/** Two persisted slices that hold the same references hold the same workspace. */
function sameSlice(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((k) => Object.is(a[k], b[k]))
}

/**
 * The decision to write, without the clock or the storage.
 *
 * A burst of typing is one snapshot, not forty: the first change marks the slice dirty and the
 * write waits for the interval. A change that leaves the persisted slice alone — opening a card,
 * moving a filter — costs a handful of reference comparisons and marks nothing, so a view-only
 * session never grows the ring.
 */
export function snapshotScheduler(opts: {
  read: () => Record<string, unknown>
  write: (state: Record<string, unknown>, version: number) => void
  version: number
  now: () => number
  interval?: number
}) {
  const interval = opts.interval ?? SNAPSHOT_INTERVAL
  let dirty = false
  let last = 0
  let previous: Record<string, unknown> | null = null

  return {
    /** Note that the store changed. Answers whether it left something to write. */
    mark(): boolean {
      const next = opts.read()
      if (previous && sameSlice(previous, next)) return false
      previous = next
      dirty = true
      return true
    },
    /** Write if something is pending and the interval has passed — or `force`, for a tab closing. */
    flush(force = false): boolean {
      if (!dirty) return false
      const at = opts.now()
      if (!force && at - last < interval) return false
      // Cleared before the write, so a storage failure cannot wedge the schedule: the next change
      // arms it again.
      dirty = false
      last = at
      opts.write(opts.read(), opts.version)
      return true
    },
    /** When the next write is due, or `Infinity` when nothing is pending. */
    dueAt(): number {
      return dirty ? last + interval : Number.POSITIVE_INFINITY
    },
  }
}

// ---------------------------------------------------------------------------------------------
// The ring itself

const DB_NAME = 'flowline-snapshots'
const STORE = 'snapshots'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('at', 'at')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('snapshot database refused to open'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openDb()
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const tx = database.transaction(STORE, mode)
        const req = request(tx.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('snapshot request failed'))
        tx.onabort = () => reject(tx.error ?? new Error('snapshot transaction aborted'))
      }),
  )
}

async function allRaw(): Promise<unknown[]> {
  const values = await run<unknown[]>('readonly', (store) => store.getAll() as IDBRequest<unknown[]>)
  return Array.isArray(values) ? values : []
}

/** The snapshots, newest first. Unreadable records are skipped rather than shown as broken rows. */
export async function listSnapshots(): Promise<SnapshotMeta[]> {
  try {
    const records = (await allRaw())
      .map(parseSnapshot)
      .filter((r): r is SnapshotRecord => r !== null)
      .sort((a, b) => b.at - a.at)
    return records.map(({ id, at, version }) => ({ id, at, version }))
  } catch {
    return []
  }
}

export async function readSnapshot(id: string): Promise<SnapshotRecord | null> {
  try {
    return parseSnapshot(await run<unknown>('readonly', (store) => store.get(id) as IDBRequest<unknown>))
  } catch {
    return null
  }
}

/**
 * Copy the workspace into the ring, pruning beyond the limit. Answers whether it landed: a
 * failure is reported to the caller and never thrown at the workspace, which must keep working
 * whether or not a copy could be written.
 */
export async function writeSnapshot(
  state: Record<string, unknown>,
  version: number,
  at = Date.now(),
): Promise<boolean> {
  try {
    const record: SnapshotRecord = {
      id: `${at}-${Math.random().toString(36).slice(2, 8)}`,
      at,
      version,
      state,
    }
    await run('readwrite', (store) => store.put(record))
    await prune()
    return true
  } catch {
    return false
  }
}

/** Keep the ring bounded. An unreadable record is treated as the oldest, so it leaves first. */
async function prune(): Promise<void> {
  const raw = await allRaw()
  const droppable: { id: string; at: number }[] = []
  for (const value of raw) {
    const parsed = parseSnapshot(value)
    if (parsed) {
      droppable.push({ id: parsed.id, at: parsed.at })
    } else {
      // A record we cannot read has no `at`, so it sorts as older than anything readable and is
      // dropped first — corruption leaves the ring rather than accumulating in it.
      const id = (value as { id?: unknown } | null)?.id
      if (typeof id === 'string') droppable.push({ id, at: Number.NEGATIVE_INFINITY })
    }
  }
  for (const id of snapshotsToDrop(droppable)) {
    await run('readwrite', (store) => store.delete(id))
  }
}

// ---------------------------------------------------------------------------------------------
// Wiring

/**
 * Start writing snapshots: one a minute while the workspace changes, and one more when the tab is
 * hidden or the page is being dismissed. Started outside React, once, so StrictMode's double
 * render cannot start it twice.
 *
 * Returns a stop function for tests and hot reload.
 */
export function startSnapshotSchedule(opts: {
  read: () => Record<string, unknown>
  subscribe: (listener: () => void) => () => void
  version: number
  interval?: number
}): () => void {
  const interval = opts.interval ?? SNAPSHOT_INTERVAL
  const scheduler = snapshotScheduler({
    read: opts.read,
    version: opts.version,
    interval,
    now: () => Date.now(),
    write: (state, version) => {
      // Fire and forget: the copy is a courtesy, and the workspace must never wait on it.
      void writeSnapshot(state, version)
    },
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    if (timer !== undefined) return
    const due = scheduler.dueAt()
    if (!Number.isFinite(due)) return
    timer = setTimeout(() => {
      timer = undefined
      scheduler.flush()
      arm()
    }, Math.max(0, due - Date.now()))
  }

  const unsubscribe = opts.subscribe(() => {
    scheduler.mark()
    arm()
  })

  const flushNow = () => {
    scheduler.flush(true)
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flushNow()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', flushNow)

  return () => {
    unsubscribe()
    if (timer !== undefined) clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', flushNow)
  }
}
