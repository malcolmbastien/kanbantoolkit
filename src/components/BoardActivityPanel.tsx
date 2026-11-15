import { useEffect, useMemo, useState } from 'react'
import { History, X } from 'lucide-react'
import { initialsOf, nameOfUser } from '@/domain/users'
import type { BoardActivityEvent } from '@/domain/types'
import { SEED_TODAY } from '@/domain/seed'
import { isDemoWorkspace } from '@/lib/demo'
import { fetchBoardActivity } from '@/lib/history'
import { useStore } from '@/store'

/** The day a group belongs to, in the reader's own calendar. */
function dayKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(at: number, now: number): string {
  const date = new Date(at)
  const today = new Date(now)
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (dayKey(at) === dayKey(today.getTime())) return 'Today'
  if (dayKey(at) === dayKey(yesterday.getTime())) return 'Yesterday'
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const CARD_ACTION: Record<'card.created' | 'card.updated' | 'card.deleted', string> = {
  'card.created': 'created a card',
  'card.updated': 'updated a card',
  'card.deleted': 'deleted a card',
}

/**
 * A board's own activity, read in the side drawer.
 *
 * This is the board's stream, not a card's History: card changes are one **updated** row, and a
 * deleted card leaves only the event — no id, title or snapshot. A card that is still live on this
 * board is a link into its drawer; a card that has left the board is named in place; a deleted card
 * is not named at all.
 */
export function BoardActivityPanel() {
  const boardId = useStore((s) => s.boardId)
  const boards = useStore((s) => s.boards)
  const flows = useStore((s) => s.flows)
  const lanes = useStore((s) => s.lanes)
  const board = useStore((s) => s.boards.find((b) => b.id === s.boardId))
  const users = useStore((s) => s.users)
  const items = useStore((s) => s.items)
  const placements = useStore((s) => s.placements)
  const boardActivity = useStore((s) => s.boardActivity)
  const mergeBoardActivity = useStore((s) => s.mergeBoardActivity)
  const setShowBoardActivity = useStore((s) => s.setShowBoardActivity)
  const openItem = useStore((s) => s.openItem)
  const now = useMemo(
    () => (isDemoWorkspace({ boards, flows, lanes, items, placements }) ? SEED_TODAY : Date.now()),
    [boards, flows, lanes, items, placements],
  )
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setCursor(null)
    setLoading(true)
    void fetchBoardActivity(boardId).then((page) => {
      if (!live) return
      if (page) {
        mergeBoardActivity(page.events)
        setCursor(page.nextCursor)
      }
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [boardId, mergeBoardActivity])

  const events = useMemo(
    () =>
      [...(boardActivity ?? [])]
        .filter((event) => event.boardId === boardId)
        .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id)),
    [boardActivity, boardId],
  )

  const groups = useMemo(() => {
    const byDay = new Map<string, BoardActivityEvent[]>()
    for (const event of events) {
      const key = dayKey(event.at)
      const list = byDay.get(key) ?? []
      list.push(event)
      byDay.set(key, list)
    }
    return [...byDay.values()]
  }, [events])

  const loadEarlier = async () => {
    if (!cursor || busy) return
    setBusy(true)
    const page = await fetchBoardActivity(boardId, cursor)
    setBusy(false)
    if (!page) return
    mergeBoardActivity(page.events)
    setCursor(page.nextCursor)
  }

  const actorName = (event: BoardActivityEvent) => {
    if (!event.actorId) return 'You'
    return nameOfUser(users, event.actorId) ?? 'Former member'
  }

  const cardFor = (event: BoardActivityEvent) => {
    if (!event.itemId) return undefined
    const item = items.find((entry) => entry.id === event.itemId)
    const active = Boolean(item && !item.archived && placements.some((p) => p.itemId === event.itemId && p.boardId === boardId))
    return { item, active }
  }

  return (
    <aside
      data-board-activity
      aria-label={`Board activity: ${board?.name ?? 'this board'}`}
      className="flex h-full w-full max-w-[460px] shrink-0 flex-col border-l border-slate-300 bg-slate-50"
    >
      <header className="flex shrink-0 items-start gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <History size={16} className="mt-0.5 shrink-0 text-indigo-600" />
        <div className="min-w-0 flex-1">
          <h2 className="text-title font-semibold text-slate-900">Board activity</h2>
          <p className="mt-0.5 text-meta text-slate-600">
            {events.length > 0 ? `${events.length} ${events.length === 1 ? 'event' : 'events'} loaded` : 'What has changed on this board'}
            {events.length > 0 && <span className="text-slate-500"> · Newest first</span>}
          </p>
        </div>
        <button
          type="button"
          data-board-activity-close
          onClick={() => setShowBoardActivity(false)}
          className="rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          title="Close board activity"
          aria-label="Close board activity"
        >
          <X size={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading && events.length === 0 ? (
          <p className="text-meta text-slate-600" data-board-activity-loading>
            Reading this board&apos;s activity…
          </p>
        ) : events.length === 0 ? (
          <p className="rounded-xl bg-white p-3 text-meta text-slate-600 ring-1 ring-slate-200" data-board-activity-empty>
            No board activity yet. Earlier card changes are in each card&apos;s History.
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={dayKey(group[0].at)} aria-label={dayLabel(group[0].at, now)}>
                <h3 className="mb-1.5 text-micro font-bold uppercase tracking-wide text-slate-500">
                  {dayLabel(group[0].at, now)}
                </h3>
                <ul className="space-y-2">
                  {group.map((event) => {
                    const actor = actorName(event)
                    const card = cardFor(event)
                    const action =
                      event.kind === 'board.updated'
                        ? event.summary ?? 'updated the board'
                        : CARD_ACTION[event.kind as keyof typeof CARD_ACTION]
                    return (
                      <li key={event.id} data-board-activity-row={event.kind} className="flex gap-2.5 rounded-xl bg-white p-2.5 ring-1 ring-slate-200">
                        <span
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-800 text-micro font-semibold text-white"
                          title={actor}
                          aria-hidden
                        >
                          {initialsOf(actor)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-meta leading-snug text-slate-700">
                            <span className="font-semibold text-slate-900">{actor}</span>{' '}
                            {action}
                            {card?.item && card.active ? (
                              <>
                                {' · '}
                                <button
                                  type="button"
                                  onClick={() => openItem(card.item!.id)}
                                  className="font-medium text-indigo-700 underline-offset-2 transition hover:underline"
                                  title={`Open ${card.item.title}`}
                                >
                                  {card.item.title}
                                </button>
                              </>
                            ) : card?.item ? (
                              <span className="text-slate-600"> · {card.item.title}</span>
                            ) : event.itemId ? (
                              <span className="text-slate-600"> · a card that has since been deleted</span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-micro text-slate-500">
                            <time dateTime={new Date(event.at).toISOString()} title={new Date(event.at).toLocaleString()}>
                              {timeLabel(event.at)}
                            </time>
                            {event.via ? ` · via ${event.via}` : ''}
                          </p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
            {cursor && (
              <button
                type="button"
                onClick={() => void loadEarlier()}
                disabled={busy}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-meta text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
              >
                {busy ? 'Loading…' : 'Load earlier activity'}
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
