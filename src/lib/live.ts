/**
 * Changes that happened elsewhere, arriving here.
 *
 * One feed, `GET /api/workspace/changes?since=…`, which is the transport every deployment can
 * answer: a Worker and a self-hosted Node process both serve it, and neither needs anything extra
 * to do so. The websocket the design calls for is an optimisation over this same feed — the cursor
 * and the shape of a change do not move when it arrives.
 *
 * Nothing here compares text or merges anything. An arriving card is adopted only when its revision
 * is *greater* than the one held, which is also what stops an echo: the tab that wrote already has
 * that revision, so it has nothing to do. Two tabs cannot answer each other for ever by
 * construction, the lesson task 113 taught about writing back what you just received.
 */

import type { Item } from '@/domain/types'
import { useAuth } from './auth'
import { usePresence } from './presence'
import type { Lock } from './presence'

/** Two seconds: quick enough to feel live, slow enough not to be a busy loop on a phone. */
const INTERVAL = 2_000
/** The server pages the feed, so a client that has been away catches up over a few polls. */
const PATH = '/api/workspace/changes'

interface Change {
  id: number
  rev: number
  item: Item | null
}

interface Feed {
  changes: Change[]
  cursor: number
  locks?: Lock[]
}

let cursor = 0
let timer: ReturnType<typeof setTimeout> | undefined
let adopt: (item: Item) => void = () => {}

/** What to do with a card that arrived. Registered once, by the store. */
export function onLiveItem(handler: (item: Item) => void): void {
  adopt = handler
}

/** The cursor this client has read up to, for tests and for a future reconnect. */
export function liveCursor(): number {
  return cursor
}

/**
 * One round of the feed. Returns the changes it carried, so a test can drive it without a clock.
 */
export async function poll(): Promise<Change[]> {
  if (!useAuth.getState().user) return []

  const response = await fetch(`${PATH}?since=${cursor}`)
  if (!response.ok) return []

  const feed = (await response.json()) as Feed
  for (const change of feed.changes) {
    if (change.item) adopt(change.item)
  }
  cursor = feed.cursor
  // The leases ride the same poll as the changes: one request, one picture.
  usePresence.getState().receive(feed.locks ?? [])
  return feed.changes
}

export function startLive(): void {
  if (timer !== undefined || !useAuth.getState().user) return
  schedule(0)
}

export function stopLive(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
}

/** Forget where this client had read to — a fresh workspace starts from the beginning of the feed. */
export function resetLive(): void {
  stopLive()
  cursor = 0
}

function schedule(delay: number): void {
  if (!useAuth.getState().user) return
  // A hidden tab does not poll; it catches up when it is looked at, which is the only time a change
  // is worth drawing.
  if (typeof document !== 'undefined' && document.hidden) return
  timer = setTimeout(async () => {
    timer = undefined
    try {
      await poll()
    } catch {
      // A poll that did not answer is a poll that will try again.
    }
    schedule(INTERVAL)
  }, delay)
}
