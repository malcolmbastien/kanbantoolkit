/**
 * What the app knows about saving, rather than about storage.
 *
 * A refused write is not a failed write: the server answered, and it answered no. Both are surfaced
 * here — one as a refusal with the card it was about, one as a connection that is not there — and
 * both are session state, never persisted, because "could not save" belongs in memory rather than
 * in the thing that could not save.
 */

import { create } from 'zustand'

export interface Refusal {
  id: string
  title: string
  at: number
  /** Another person's lease, or a revision this write was not based on. */
  reason: 'held' | 'changed' | 'other'
  holderName?: string
  /** The version the server holds — offered, never applied over the local words. */
  server?: import('@/domain/types').Item
}

interface SyncStatus {
  /** Cards whose last write was refused, by id. */
  refusals: Record<string, Refusal>
  /** The server could not be reached at all. */
  unreachable: boolean
  /** Accepted changes still waiting for a connection. */
  waiting: number
  /** The queue is full, so the next change would not be held. */
  overflow: boolean
  /** Item writes accepted in this browser but not yet answered by the server. */
  pending: number
  refuse(entry: Refusal): void
  /** A later write for this item landed, so the refusal no longer stands. */
  resolve(id: string): void
  /** Forget one refusal — after the person has copied the words or taken the server's version. */
  forget(id: string): void
  unreachableNow(): void
  reachable(): void
  setWaiting(count: number): void
  full(): void
  clear(): void
}

const LIMIT = 20

export const useSync = create<SyncStatus>((set) => ({
  refusals: {},
  unreachable: false,
  waiting: 0,
  overflow: false,
  pending: 0,

  refuse: (entry) =>
    set((state) => ({
      // Bounded by card rather than by count: a refusal is a state a card is in, not a log.
      refusals: { ...Object.fromEntries(Object.entries(state.refusals).slice(-(LIMIT - 1))), [entry.id]: entry },
      unreachable: false,
    })),

  resolve: (id) =>
    set((state) => {
      if (!state.refusals[id]) return state
      const refusals = { ...state.refusals }
      delete refusals[id]
      return { refusals }
    }),

  forget: (id) =>
    set((state) => {
      if (!state.refusals[id]) return state
      const refusals = { ...state.refusals }
      delete refusals[id]
      return { refusals }
    }),

  unreachableNow: () => set({ unreachable: true }),
  reachable: () => set({ unreachable: false }),
  setWaiting: (count) => set({ waiting: count, ...(count > 0 ? {} : { overflow: false }) }),
  full: () => set({ overflow: true }),
  clear: () => set({ refusals: {}, unreachable: false, waiting: 0, overflow: false, pending: 0 }),
}))

/**
 * Whether this card is frozen: no further writes are sent until the person has dealt with the
 * refusal. The words stay on screen — losing what somebody typed is the worst outcome — but they
 * stop travelling, because a refused change replayed is the lost update the revision prevents.
 */
export function isFrozen(itemId: string): boolean {
  return Boolean(useSync.getState().refusals[itemId])
}
