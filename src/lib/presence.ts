/**
 * Who holds which card's pen, as this tab sees it.
 *
 * The leases arrive on the same two-second poll as the changes, so there is one picture of the
 * workspace rather than two clocks. A lock is drawn from this store and nowhere else; the drawer
 * reads it to decide whether to offer its fields, and the card reads it to say so on its face.
 */

import { create } from 'zustand'

export interface Lock {
  itemId: string
  userId: string
  sessionId: string
  holderName: string
  expiresAt: string
}

/** This tab's name. Two tabs of one person are two sessions, which is what the lease keys on. */
export const TAB = crypto.randomUUID()

interface Presence {
  locks: Record<string, Lock>
  receive(locks: Lock[]): void
}

export const usePresence = create<Presence>((set) => ({
  locks: {},
  receive: (locks) => set({ locks: Object.fromEntries(locks.map((lock) => [lock.itemId, lock])) }),
}))

/** The lease on a card, when it is somebody else's. This tab's own lease is not a reason to stop. */
export function heldByOther(locks: Record<string, Lock>, itemId: string | null | undefined): Lock | undefined {
  if (!itemId) return undefined
  const lock = locks[itemId]
  if (!lock || lock.sessionId === TAB) return undefined
  return lock
}
