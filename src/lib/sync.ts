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
}

interface SyncStatus {
  /** Changes the workspace has moved past, most recent last. */
  refusals: Refusal[]
  /** The server could not be reached at all. */
  unreachable: boolean
  refuse(entry: Refusal): void
  /** A later write for this item landed, so the refusal no longer stands. */
  resolve(id: string): void
  unreachableNow(): void
  reachable(): void
  clear(): void
}

const LIMIT = 20

export const useSync = create<SyncStatus>((set) => ({
  refusals: [],
  unreachable: false,

  refuse: (entry) =>
    set((state) => ({
      refusals: [...state.refusals.filter((seen) => seen.id !== entry.id), entry].slice(-LIMIT),
      unreachable: false,
    })),

  resolve: (id) =>
    set((state) =>
      state.refusals.some((seen) => seen.id === id)
        ? { refusals: state.refusals.filter((seen) => seen.id !== id) }
        : state,
    ),

  unreachableNow: () => set({ unreachable: true }),
  reachable: () => set({ unreachable: false }),
  clear: () => set({ refusals: [], unreachable: false }),
}))
