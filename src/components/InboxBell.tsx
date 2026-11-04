import { useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, Inbox } from 'lucide-react'
import { useStore } from '@/store'
import { useAuth } from '@/lib/auth'
import { inboxSentence, inboxWhere, type InboxRow } from '@/domain/inbox'
import { markInboxRead, refreshInbox, refreshWatches } from '@/lib/watch'
import { cn } from '@/lib/utils'

/** How often an instance's bell is read again while the app is open. */
const POLL_MS = 30_000

/**
 * The inbox: what happened to the work you watch.
 *
 * A bell in the top bar, with a count and a list newest first. A row is a sentence — "Maya moved
 * Rebuild the signup form to Done" — with the board and cell beneath it, and pressing it opens the
 * card where it lives. The panel is the only reader of the rows; the store holds whatever the
 * server or the demo answered.
 *
 * The demo has no server, so the watch list and cursor are this browser's and the panel says so in
 * one line. An instance keeps both on the account, and the bell reads them from `/api/workspace`.
 */
export function InboxBell() {
  const user = useAuth((state) => state.user)
  const rows = useStore((state) => state.inboxRows)
  const unread = useStore((state) => state.inboxUnread)
  const items = useStore((state) => state.items)
  const watchedItemIds = useStore((state) => state.watchedItemIds)
  const watchStartedAt = useStore((state) => state.watchStartedAt)
  const inboxReadAt = useStore((state) => state.inboxReadAt)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // An instance's list and inbox come from the account; the demo computes its own from the logs.
  useEffect(() => {
    if (!user) return
    void refreshWatches()
    void refreshInbox()
    const timer = window.setInterval(() => void refreshInbox(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [user])

  // The demo has no outbox, so its inbox is a reading of the histories. Rebuild it when the board
  // or the watch list moves; a row appears as soon as the change does.
  useEffect(() => {
    if (user) return
    useStore.getState().recomputeInbox()
  }, [user, items, watchedItemIds, watchStartedAt, inboxReadAt])

  // An instance's changes arrive through the live feed as items, so the bell reads the outbox again
  // shortly after the board moves — debounced, because a person typing edits the card on every key.
  useEffect(() => {
    if (!user) return
    const timer = window.setTimeout(() => void refreshInbox(), 1_000)
    return () => window.clearTimeout(timer)
  }, [user, items])

  // Opening the panel reads the current page; an instance's rows may have moved since the poll.
  useEffect(() => {
    if (!open) return
    void refreshInbox()
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const openRow = (row: InboxRow) => {
    const state = useStore.getState()
    // Where it lives, not where the reader happens to be: switching board first also clears the
    // old selection, so the item opens in the place the sentence names.
    if (row.boardId && row.boardId !== state.boardId) state.selectBoard(row.boardId)
    state.openItem(row.itemId)
    setOpen(false)
  }

  const label = unread > 0 ? `Inbox — ${unread} unread` : 'Inbox'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-inbox-trigger
        onClick={() => setOpen((value) => !value)}
        aria-label={label}
        aria-expanded={open}
        title={label}
        className={cn(
          'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-white transition',
          unread > 0
            ? 'border-amber-300 text-amber-700 hover:bg-amber-50'
            : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900',
        )}
      >
        <Bell size={14} />
        {unread > 0 && (
          <span
            data-inbox-unread
            className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-micro font-bold leading-none text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          data-inbox-panel
          className="absolute right-0 top-full z-50 mt-1 flex max-h-[70vh] w-[24rem] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <span className="flex items-center gap-1.5 text-meta font-semibold text-slate-800">
              <Inbox size={13} /> Inbox
            </span>
            {unread > 0 && <span className="text-micro text-amber-700">{unread} unread</span>}
            <button
              type="button"
              onClick={() => void markInboxRead()}
              disabled={unread === 0}
              className="ml-auto flex items-center gap-1 rounded px-1.5 py-1 text-micro font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-40"
            >
              <CheckCheck size={12} /> Mark all read
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {rows.length === 0 ? (
              <p className="px-3 py-4 text-meta text-slate-500">
                Nothing yet. Watch a card or an initiative, and what happens to it will show up here.
              </p>
            ) : (
              rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  data-inbox-row={row.type}
                  onClick={() => openRow(row)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 border-b border-slate-100 px-3 py-2 text-left transition last:border-b-0 hover:bg-slate-50',
                    row.read ? 'text-slate-600' : 'text-slate-900',
                  )}
                >
                  <span className="flex items-start gap-1.5">
                    {/* Unread is a dot rather than only a weight: a skimming reader sees the new
                        rows before reading a word. */}
                    <span
                      className={cn(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        row.read ? 'bg-transparent' : 'bg-amber-500',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 text-meta">{inboxSentence(row)}</span>
                  </span>
                  {inboxWhere(row) && (
                    <span className="pl-3 text-micro text-slate-500">{inboxWhere(row)}</span>
                  )}
                </button>
              ))
            )}
          </div>

          {!user && (
            <p className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-micro text-slate-500">
              On the demo, the watch list and the inbox live in this browser.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
