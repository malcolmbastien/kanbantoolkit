/**
 * Changes that happened elsewhere, arriving here.
 *
 * One feed, `GET /api/workspace/changes?since=…`, which is the transport every deployment can
 * answer: a Worker and a self-hosted Node process both serve it, and neither needs anything extra
 * to do so. On top of it sits a **nudge**: a socket that says only *that* the feed moved —
 * `{"revision": n}` — never what moved. The client then reads the feed it already knows how to
 * read, so a change has one shape and one path into the store whichever way it arrived, and a
 * deployment with no socket (or a browser that cannot open one) is simply two seconds behind.
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
/** The nudge channel. The same path on both entries. */
const SOCKET_PATH = '/api/workspace/live'
/** How long to wait before trying the socket again, in order: quickly at first, then calmly. */
const RETRIES = [2_000, 5_000, 15_000, 30_000, 60_000]

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
let socket: WebSocket | undefined
let retry: ReturnType<typeof setTimeout> | undefined
let attempts = 0
let watching = false
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
  if (timer !== undefined || socket || !useAuth.getState().user) return
  watchVisibility()
  // The instance says which transport it has. A socket that fails to open falls back to the poll,
  // so this is a preference rather than a requirement.
  if (useAuth.getState().live === 'socket' && connect()) return
  schedule(0)
}

export function stopLive(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  if (retry !== undefined) clearTimeout(retry)
  retry = undefined
  attempts = 0
  const open = socket
  socket = undefined
  open?.close()
}

/** Forget where this client had read to — a fresh workspace starts from the beginning of the feed. */
export function resetLive(): void {
  stopLive()
  cursor = 0
}

/**
 * Open the nudge channel.
 *
 * The session cookie travels with the handshake, so the server checks the connection the way it
 * checks any request. Nothing is sent until the server rings the bell, and the bell carries no
 * content: `poll()` is still the only way a change enters the store.
 */
function connect(): boolean {
  if (typeof WebSocket === 'undefined' || typeof location === 'undefined') return false
  try {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
    socket = new WebSocket(`${scheme}//${location.host}${SOCKET_PATH}`)
  } catch {
    return false
  }

  const current = socket
  current.onopen = () => {
    attempts = 0
    // The socket is the clock now; the poll would only be a second reader of the same feed.
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    // Whatever moved while this browser was reconnecting is read once, here.
    void poll()
  }
  current.onmessage = () => {
    void poll()
  }
  current.onclose = () => {
    if (socket !== current) return
    socket = undefined
    if (!useAuth.getState().user) return
    // Live by poll from this moment, and live by socket again as soon as one can be opened.
    schedule(0)
    again()
  }
  current.onerror = () => current.close()
  return true
}

/** Try the socket again, backing off — a server that is down should not be hammered. */
function again(): void {
  if (retry !== undefined || socket || !useAuth.getState().user) return
  const wait = RETRIES[Math.min(attempts, RETRIES.length - 1)]
  attempts += 1
  retry = setTimeout(() => {
    retry = undefined
    if (useAuth.getState().live === 'socket' && !socket && useAuth.getState().user) connect()
  }, wait)
}

/** A hidden tab does not poll; it catches up when it is looked at. */
function watchVisibility(): void {
  if (watching || typeof document === 'undefined') return
  watching = true
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return
    if (!useAuth.getState().user) return
    // Either the socket was open the whole time (nothing to do but read what arrived) or polling
    // resumes — both are one poll.
    if (timer === undefined) void poll()
    if (!socket && useAuth.getState().live === 'socket') connect()
    schedule(0)
  })
}

function schedule(delay: number): void {
  if (!useAuth.getState().user) return
  // A socket is open: the nudge is the clock, and a poll beside it would be a second reader.
  if (socket) return
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
