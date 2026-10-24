/**
 * The live channel: one per workspace, behind one interface.
 *
 * A change written by one device has to reach another without a reload, and the *transport* that
 * carries it is the one thing the two runtimes disagree about. So the disagreement lives in the
 * entry file and nowhere else:
 *
 * - a **Durable Object** on Cloudflare, because isolates cannot talk to each other;
 * - a **WebSocket server** on the Node entry, because one process can hold every socket;
 * - **polling** where neither exists — the static tier, or an operator who turned the socket off.
 *
 * What travels on the channel is deliberately tiny: a nudge, `{"revision": n}`. It says *that* the
 * feed moved and never *what* moved, so the client keeps the one code path it already had —
 * `GET /api/workspace/changes?since=<cursor>` — and a change cannot arrive twice by two routes, or
 * in two shapes. The nudge is a doorbell, not a parcel.
 *
 * This module is the portable half: an in-process channel for one Node process, and the shape the
 * Durable Object implements. Nothing here imports a runtime.
 */

import type { Database } from './db'
import { workspaceCallerFromCookie } from './access'
import type { WorkspaceCaller } from './access'

/** Where a browser asks for the channel. The same path on both entries. */
export const LIVE_PATH = '/api/workspace/live'

export type Nudge = { revision: number }

type Subscriber = (nudge: Nudge) => void

const channels = new Map<string, Set<Subscriber>>()

/** Listen to a workspace. The returned function is how a connection is closed. */
export function subscribe(workspaceId: string, send: Subscriber): () => void {
  const listeners = channels.get(workspaceId) ?? new Set<Subscriber>()
  listeners.add(send)
  channels.set(workspaceId, listeners)
  return () => {
    listeners.delete(send)
    if (!listeners.size) channels.delete(workspaceId)
  }
}

/**
 * Ring the bell for a workspace.
 *
 * Called after the write that changed the feed, never before: a nudge for a change that did not
 * land would make a client read the feed for nothing, and a nudge that never came is a change that
 * arrives on the next poll.
 */
export function publish(workspaceId: string, revision: number): void {
  const listeners = channels.get(workspaceId)
  if (!listeners) return
  for (const send of listeners) {
    try {
      send({ revision })
    } catch {
      // One broken socket is not the other sockets' problem; it is removed when it closes.
    }
  }
}

/** How many connections a workspace has. For the tests, and for a health line later. */
export function listeners(workspaceId: string): number {
  return channels.get(workspaceId)?.size ?? 0
}

/**
 * Who is asking for the channel.
 *
 * A socket is opened by the browser, so it carries the same session cookie the API does — and it is
 * checked the same way: a session, a membership, and the right to read the board. A connection that
 * fails this is closed rather than left open in the hope that it was going to authenticate.
 */
export async function liveCaller(
  db: Database,
  env: unknown,
  cookie: string | undefined,
  url: string,
): Promise<WorkspaceCaller | undefined> {
  return workspaceCallerFromCookie(db, env, cookie, url, 'board.read')
}
