/**
 * This tab's lease on a card.
 *
 * Taken on **edit intent** — a focus into a field, never on opening the card, because reading is
 * free and two people may read the same card. Renewed while the drawer is open, released when it
 * closes, and let go on `pagehide`; the sixty-second life covers the close that never happens.
 *
 * A refused acquisition is not an error: it means somebody else has the pen, which the presence
 * store has already heard from the same poll, so nothing is said twice.
 */

import { TAB } from './presence'

/** Comfortably inside the sixty-second lease, so one slow request does not lose it. */
const HEARTBEAT_MS = 15_000

/** The cards this tab is holding, so the heartbeat knows what to renew. */
const holding = new Set<string>()
let timer: ReturnType<typeof setInterval> | undefined

const headers = (): HeadersInit => ({ 'x-flowline-tab': TAB })

async function take(itemId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/workspace/items/${encodeURIComponent(itemId)}/lock`, {
      method: 'POST',
      headers: headers(),
    })
    return response.ok
  } catch {
    return false
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
export async function takeLease(itemId: string): Promise<void> {
  if (holding.has(itemId)) return
  if (!(await take(itemId))) return
  holding.add(itemId)
  start()
}

/** Let go of a card. Idempotent, and called from paths that may never have had it. */
export async function dropLease(itemId: string): Promise<void> {
  holding.delete(itemId)
  try {
    await fetch(`/api/workspace/items/${encodeURIComponent(itemId)}/lock`, { method: 'DELETE', headers: headers() })
  } catch {
    // The lease lapses on its own; this is the tidy version, not the only version.
  }
  if (holding.size === 0) stop()
}

function start(): void {
  if (timer !== undefined) return
  timer = setInterval(() => {
    for (const itemId of [...holding]) {
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
  // A tab being hidden or closed is the last chance to be polite about a lease.
  window.addEventListener('pagehide', () => {
    for (const itemId of [...holding]) void dropLease(itemId)
  })
}
