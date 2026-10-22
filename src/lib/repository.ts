/**
 * Where a workspace lives.
 *
 * The store reaches persistence through this interface and nothing else: it hands the persisted
 * slice to a `StateStorage`, and hands an accepted item change to `commitItem`. Whether either goes
 * anywhere beyond this browser is the adapter's business.
 *
 * The storage half is the browser's own in both cases, because the browser holds a cache either
 * way — that was task 118's premise. What changes when someone is signed in is `commitItem`: the
 * change is sent, and the server's answer is the version the app keeps.
 *
 * The choice is still made in one place (`chooseRepository`). It reads the session at call time
 * rather than at boot, because the same build is both deployments: an instance with no accounts and
 * no server *is* the local adapter, and nothing needs to be rebuilt to say so.
 */

import type { StateStorage } from 'zustand/middleware'
import type { Item } from '@/domain/types'
import { useAuth } from './auth'
import { guardedStorage } from './storage'
import { tabSynced } from './tabSync'

export type RepositoryKind = 'local' | 'http'

export type CommitAnswer =
  /** The change was accepted (or did not need sending). This is the version to keep. */
  | { kind: 'kept'; item: Item }
  /** The workspace has moved past the revision the change was based on. */
  | { kind: 'refused'; item: Item | null }
  /** Nothing answered. */
  | { kind: 'unreachable' }

export interface Repository {
  readonly kind: RepositoryKind
  /** What `persist` writes through — the only persistence detail the store sees. */
  readonly storage: StateStorage
  /**
   * Send one accepted item change, and answer with the version that is now the truth.
   *
   * `key` names the change rather than the attempt, so a queue that retries after a lost response
   * is answered rather than applied twice.
   */
  commitItem(item: Item, baseRev: number, key?: string): Promise<CommitAnswer>
}

/** The browser's own storage, behind the interface: nothing to send, because nowhere else has it. */
export function localRepository(): Repository {
  return {
    kind: 'local',
    storage: tabSynced(guardedStorage()),
    async commitItem(item) {
      return { kind: 'kept', item }
    },
  }
}

/** The same cache, with every accepted change sent to the instance that owns the workspace. */
export function httpRepository(): Repository {
  return {
    kind: 'http',
    storage: tabSynced(guardedStorage()),
    commitItem: sendItem,
  }
}

async function sendItem(item: Item, baseRev: number, key?: string): Promise<CommitAnswer> {
  try {
    const response = await fetch(`/api/workspace/items/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev, item, ...(key ? { key } : {}) }),
    })

    if (response.status === 409) {
      const body = (await response.json().catch(() => null)) as { item?: Item | null } | null
      return { kind: 'refused', item: body?.item ?? null }
    }

    // A refusal with the reason is still a refusal: 400 and 401 are the server saying no.
    if (response.status >= 400 && response.status < 500) return { kind: 'refused', item: null }
    if (!response.ok) return { kind: 'unreachable' }

    const body = (await response.json()) as { item: Item }
    return { kind: 'kept', item: body.item }
  } catch {
    return { kind: 'unreachable' }
  }
}

/**
 * The one place an adapter is chosen (R4).
 *
 * The answer is stable — one storage, one commit function — but what `commitItem` does depends on
 * whether there is a session *now*, because signing in is a thing that happens to a running app.
 */
export function chooseRepository(): Repository {
  return {
    get kind(): RepositoryKind {
      return useAuth.getState().user ? 'http' : 'local'
    },
    storage: tabSynced(guardedStorage()),
    commitItem: (item, baseRev, key) =>
      useAuth.getState().user ? sendItem(item, baseRev, key) : Promise.resolve({ kind: 'kept', item }),
  }
}
