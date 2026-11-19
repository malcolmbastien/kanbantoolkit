/**
 * This tab's lease on a card.
 *
 * Taken on **opening the card**: a card somebody has open is locked for everybody else, so the
 * drawer asks for the pen as it appears rather than at the first keystroke. Renewed while it is
 * open, released when it closes, and let go on `pagehide`; the sixty-second life covers the close
 * that never happens.
 *
 * A refused acquisition is not an error: it means somebody else has the card open, and the answer
 * names them, so the drawer can be read-only from its first frame rather than after the next poll.
 */

import { TAB } from './presence'

/** Comfortably inside the sixty-second lease, so one slow request does not lose it. */
const HEARTBEAT_MS = 15_000

/** The cards this tab is holding, so the heartbeat knows what to renew. */
const holding = new Set<string>()
let timer: ReturnType<typeof setInterval> | undefined

/** What the server said about a request for the pen. */
export interface LeaseAnswer {
  /** This tab now holds the card. */
  ok: boolean
  /** The person who has it, when the request was refused. */
  holderName?: string
  /** That person's id, so the drawer can tell "another tab of mine" from somebody else. */
  holderId?: string
  /**
   * The server could not answer. That is not a refusal: an offline drawer stays editable and its
   * writes wait in the queue, because "I cannot ask" is not "somebody else has it".
   */
  unreachable?: boolean
}

const headers = (): HeadersInit => ({ 'x-kanbantoolkit-tab': TAB })

async function take(itemId: string): Promise<LeaseAnswer> {
  try {
    const response = await fetch(`/api/workspace/items/${encodeURIComponent(itemId)}/lock`, {
      method: 'POST',
      headers: headers(),
    })
    if (response.ok) return { ok: true }
    // A refusal names the holder: the drawer says who has it without waiting for the feed to catch up.
    if (response.status === 423) {
      const body = (await response.json().catch(() => null)) as
        | { holder?: { userId?: string; holderName?: string } | null }
        | null
      return { ok: false, holderName: body?.holder?.holderName, holderId: body?.holder?.userId }
    }
    return { ok: false, unreachable: true }
  } catch {
    return { ok: false, unreachable: true }
  }
}

async function renew(itemId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/workspace/items/${encodeURIComponent(itemId)}/heartbeat`, {
      method: 'POST',
      headers: headers(),
    })
    return response.ok
  } catch {
    return false
  }
}

/** Ask for the pen on a card. Repeated calls are cheap: the same session re-taking is a renewal. */
export async function takeLease(itemId: string): Promise<LeaseAnswer> {
  if (holding.has(itemId)) return { ok: true }
  const answer = await take(itemId)
  if (!answer.ok) return answer
  holding.add(itemId)
  start()
  return { ok: true }
}

/** Let go of a card. Idempotent, and called from paths that may never have had it. */
export async function dropLease(itemId: string): Promise<void> {
  holding.delete(itemId)
  try {
    // `keepalive` is what makes the release survive the page that is closing: the tab that goes
    // away mid-request still hands the card back instead of leaving it locked until the TTL.
    await fetch(`/api/workspace/items/${encodeURIComponent(itemId)}/lock`, {
      method: 'DELETE',
      headers: headers(),
      keepalive: true,
    })
  } catch {
    // The lease lapses on its own; this is the tidy version, not the only version.
  }
  if (holding.size === 0) stop()
}

function start(): void {
  if (timer !== undefined) return
  timer = setInterval(() => {
    for (const itemId of holding) {
      void renew(itemId).then((kept) => {
        // A lease that could not be renewed is gone — taken over or lapsed — and this tab should
        // stop pretending to hold it.
        if (!kept) holding.delete(itemId)
      })
    }
    if (holding.size === 0) stop()
  }, HEARTBEAT_MS)
}

function stop(): void {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
}

/** The cards this tab is holding — for tests, and for the drawer's own reading. */
export function holdingLeases(): string[] {
  return [...holding]
}

if (typeof window !== 'undefined') {
  // A tab being hidden or closed is the last chance to be polite about a lease. `forEach` visits
  // the entries still left even as `dropLease` removes the one it is handing back.
  window.addEventListener('pagehide', () => {
    holding.forEach((itemId) => void dropLease(itemId))
  })
}
