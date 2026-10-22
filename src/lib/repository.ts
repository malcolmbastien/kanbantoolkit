/**
 * Where a workspace lives.
 *
 * The store never learns whether the bytes end up in `localStorage` or on a server: it hands the
 * persisted slice to a `StateStorage` and the adapter decides what that means. Today there is one
 * adapter, and it is the shipped behaviour exactly — guarded against a full disk, revisioned so two
 * tabs cannot overwrite each other, and synced between them.
 *
 * The server's adapter belongs to task 118.3, with the write path it needs. A repository that could
 * read a server workspace but not save one would lose the first edit, so it is not written until it
 * can keep one — and this interface is what it will be written against.
 *
 * The choice is made in `chooseRepository`, once. Nothing else in the app asks where the workspace
 * lives, which is what makes the two deployments one application rather than two.
 */

import type { StateStorage } from 'zustand/middleware'
import { guardedStorage } from './storage'
import { tabSynced } from './tabSync'

export type RepositoryKind = 'local' | 'http'

export interface Repository {
  readonly kind: RepositoryKind
  /** What `persist` writes through — the only persistence detail the store sees. */
  readonly storage: StateStorage
}

/**
 * The browser's own storage, behind the interface: a write that fails is published rather than
 * thrown, and a write based on a revision another tab has moved past is refused.
 */
export function localRepository(): Repository {
  return { kind: 'local', storage: tabSynced(guardedStorage()) }
}

/**
 * The one place an adapter is chosen (R4).
 *
 * It answers the local adapter because there is one to answer with. When the server can accept a
 * write, this becomes the branch — a session, a build flag, or an instance that offers accounts —
 * and every call site stays as it is.
 */
export function chooseRepository(): Repository {
  return localRepository()
}
