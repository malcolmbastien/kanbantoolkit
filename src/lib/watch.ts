/**
 * The network half of watching and the inbox.
 *
 * The store keeps a local record either way — it has to, because the board renders before a request
 * returns and a static build has no server to ask. What changes is who owns it: a demo owns its
 * watch list and cursor in this browser, and an instance owns them on the account, so the functions
 * here replace the cache with the server's answer and send a toggle before believing it.
 *
 * Every function answers quietly when there is no server: `useAuth` saying nobody is signed in is
 * the same deployment question `repository.ts` asks, and the demo is a first-class instance.
 */

import { useAuth } from './auth'
import { useStore } from '@/store'
import type { InboxRow } from '@/domain/inbox'

const hosted = () => Boolean(useAuth.getState().user)

/** The account's watch list, replacing this browser's cache. */
export async function refreshWatches(): Promise<void> {
  if (!hosted()) return
  try {
    const response = await fetch('/api/workspace/watches', { headers: { accept: 'application/json' } })
    if (!response.ok) return
    const body = (await response.json()) as { itemIds?: unknown }
    if (Array.isArray(body.itemIds)) {
      useStore.getState().replaceWatches(body.itemIds.filter((id): id is string => typeof id === 'string'))
    }
  } catch {
    // A watch is not worth an error banner: the local cache still answers, and the next read tries
    // again. The board is the thing being used, not the bell.
  }
}

/** One page of this person's inbox, replacing the local reading. */
export async function refreshInbox(): Promise<void> {
  if (!hosted()) {
    useStore.getState().recomputeInbox()
    return
  }
  try {
    const response = await fetch('/api/workspace/inbox', { headers: { accept: 'application/json' } })
    if (!response.ok) return
    const body = (await response.json()) as { rows?: unknown; unread?: unknown }
    if (!Array.isArray(body.rows)) return
    useStore.getState().replaceInbox(body.rows as InboxRow[], typeof body.unread === 'number' ? body.unread : 0)
  } catch {
    // Same rule as the watch list: the next poll or the next opening reads it.
  }
}

/**
 * Watch or unwatch one item.
 *
 * The control answers at once; an instance is told in the background, and a refusal puts the switch
 * back. A toggle is idempotent on the server, so a retry after a lost answer is safe.
 */
export async function toggleWatch(itemId: string): Promise<void> {
  const store = useStore.getState()
  const watching = !store.watchedItemIds.includes(itemId)
  store.setWatching(itemId, watching)
  if (!hosted()) return
  try {
    const response = await fetch(`/api/workspace/items/${encodeURIComponent(itemId)}/watch`, {
      method: watching ? 'POST' : 'DELETE',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) {
      store.setWatching(itemId, !watching)
      return
    }
    await refreshInbox()
  } catch {
    // The server never heard it, so the local switch would be a claim about the account. Put it
    // back rather than let the bell and the server disagree.
    store.setWatching(itemId, !watching)
  }
}

/** Mark everything currently in the inbox read. */
export async function markInboxRead(): Promise<void> {
  if (!hosted()) {
    useStore.getState().markInboxReadLocally()
    return
  }
  try {
    const response = await fetch('/api/workspace/inbox/read', {
      method: 'POST',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return
    const store = useStore.getState()
    store.replaceInbox(store.inboxRows.map((row) => ({ ...row, read: true })), 0)
  } catch {
    // The bell keeps saying unread until the server can answer; that is the honest state.
  }
}
