/**
 * Changes that were accepted here and have not reached the server.
 *
 * The queue holds *accepted* writes only. A write the server refused is never put here: replaying a
 * refusal would apply the lost update the revision exists to prevent. What is here is work the
 * person really did, waiting for a connection.
 *
 * Each entry carries the revision it was based on and a key that names the change rather than the
 * attempt, so a flush that is interrupted can be tried again without applying anything twice. The
 * order is the order the changes were made — the server must never see a state the person did not
 * pass through.
 *
 * It lives in `localStorage` because a reload is not a reason to lose work, and it is bounded so a
 * browser that is offline for a week cannot fill the disk with a queue nobody will ever send.
 */

import type { Item } from '@/domain/types'

export interface QueuedWrite {
  /** Names this change, not this attempt. */
  key: string
  item: Item
  baseRev: number
  at: number
}

const KEY = 'kanbantoolkit-queue-v1'
/** Beyond this the queue is full: the app says so rather than quietly dropping the oldest work. */
export const QUEUE_LIMIT = 500

function isWrite(value: unknown): value is QueuedWrite {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.key === 'string' &&
    typeof entry.baseRev === 'number' &&
    typeof entry.at === 'number' &&
    Boolean(entry.item) &&
    typeof (entry.item as Item).id === 'string'
  )
}

function read(): QueuedWrite[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isWrite) : []
  } catch {
    // A queue that cannot be read is not a queue that can be trusted.
    return []
  }
}

function write(list: QueuedWrite[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // A full disk is reported by `useSync`, which the store already watches.
  }
}

export const queue = {
  all(): QueuedWrite[] {
    return read()
  },
  size(): number {
    return read().length
  },
  /** `false` when the queue is full, so the caller can say so rather than pretend it is held. */
  add(entry: QueuedWrite): boolean {
    const list = read()
    if (list.length >= QUEUE_LIMIT) return false
    write([...list, entry])
    return true
  },
  remove(key: string): void {
    write(read().filter((entry) => entry.key !== key))
  },
  clear(): void {
    write([])
  },
}

/** A key nobody can guess, and the same key when the same change is retried. */
export function newKey(): string {
  return crypto.randomUUID()
}
