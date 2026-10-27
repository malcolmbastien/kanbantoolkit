import { useMemo } from 'react'
import { Ban, CalendarClock, Check, PanelRight, SquareArrowOutUpRight, TriangleAlert, UserRound } from 'lucide-react'
import { BandBadge } from './BandBadge'
import { myWork, type MyWorkEntry } from '@/domain/mywork'
import { initialsOf } from '@/domain/users'
import { chipColors } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { useStore } from '@/store'

/**
 * My work — everything the workspace's person is assigned to, assembled from every board,
 * with the board and cell it sits in written on each row. It is a view, not a place:
 * clicking a card reads it in the side drawer without leaving the view, and the explicit
 * board button takes you to the cell it lives in when the work has to move.
 */
export function MyWorkView() {
  const meUserId = useStore((s) => s.meUserId)
  const setUser = useStore((s) => s.setUser)
  const users = useStore((s) => s.users)
  const items = useStore((s) => s.items)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const boards = useStore((s) => s.boards)
  const issueTypes = useStore((s) => s.issueTypes)
  const selectBoard = useStore((s) => s.selectBoard)
  const boardId = useStore((s) => s.boardId)
  const openItem = useStore((s) => s.openItem)
  const setMyWork = useStore((s) => s.setMyWork)

  // Who is signed in, when the instance says: on an account, this view is *yours* — the picker is
  // the demo's way of saying who you are, and asking a signed-in person to also pick themselves
  // would let them read somebody else's work under the words "my work".
  const account = useAuth((s) => s.user)
  const signedIn = Boolean(account)

  const groups = useMemo(() => myWork(items, placements, lanes, boards, meUserId), [items, placements, lanes, boards, meUserId])
  const me = users.find((u) => u.id === meUserId)
  const total = groups.reduce((n, g) => n + g.entries.length, 0)

  /**
   * Read the card where it is, without leaving My work. The item's board becomes the board in
   * front (or the board-scoped controls in the drawer would be about a different board), but
   * `showMyWork` is untouched, so the drawer opens beside the list rather than replacing it.
   */
  const openDrawer = (itemBoardId: string, itemId: string) => {
    if (itemBoardId !== boardId) selectBoard(itemBoardId)
    openItem(itemId)
  }

  /** Leave this view for the board the work sits on, and open the item there. */
  const openOnBoard = (itemBoardId: string, itemId: string) => {
    setMyWork(false)
    if (itemBoardId !== boardId) selectBoard(itemBoardId)
    openItem(itemId)
  }

  /** What makes a row worth a second look: blocked, late, or about to be. A resolved card is done. */
  const attentionOf = (entry: MyWorkEntry): 'risk' | 'watch' | undefined =>
    entry.isResolved
      ? undefined
      : entry.item.blocked || entry.isOverdue
        ? 'risk'
        : entry.isDueSoon
          ? 'watch'
          : undefined

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-slate-200 p-4">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2 rounded-lg border border-sky-300 bg-sky-50/70 px-4 py-3">
          <div>
            <div className="flex items-center gap-1.5 text-meta font-bold uppercase tracking-wide text-sky-700">
              <UserRound size={12} /> My work
            </div>
            <div className="text-heading font-semibold text-slate-800">
              {total} assigned item{total === 1 ? '' : 's'}
              {total > 0 ? ` on ${groups.length} board${groups.length === 1 ? '' : 's'}` : ''}
            </div>
            <div className="text-meta text-slate-600">
              Everything you own, assembled from every board. Click a card to read it here; the board
              button takes you to the cell it lives in when the work has to move.
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {signedIn ? (
              <span className="flex items-center gap-1.5 text-meta text-slate-600" data-my-work-person={meUserId ?? ''}>
                <UserRound size={12} className="text-sky-700" />
                Signed in as <strong className="font-semibold text-slate-800">{me?.name ?? account!.name}</strong>
              </span>
            ) : (
            <label className="flex items-center gap-1.5 text-meta text-slate-600">
              Looking at
              <select
                value={meUserId ?? ''}
                onChange={(e) => setUser(e.target.value || undefined)}
                aria-label="Whose work to show"
                className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-meta outline-none focus:ring-2 focus:ring-sky-300"
              >
                <option value="">— no one picked —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            )}
          </div>
        </div>

        {signedIn && !me ? (
          <div className="rounded-lg border border-slate-300 bg-white px-4 py-8 text-center">
            <p className="text-body font-semibold text-slate-800">This workspace has no person for your account.</p>
            <p className="mx-auto mt-1 max-w-md text-meta text-slate-600">
              You are signed in as {account!.name} ({account!.email}), and no one by that name is on this
              workspace — so there is nothing here to assign to you yet. An administrator adds people
              from Admin, and the work assigned to them is what this view shows.
            </p>
          </div>
        ) : !meUserId ? (
          <div className="rounded-lg border border-slate-300 bg-white px-4 py-8 text-center">
            <p className="text-body font-semibold text-slate-800">Who is here?</p>
            <p className="mx-auto mt-1 max-w-md text-meta text-slate-600">
              My work shows what one person owns. This browser's workspace belongs to {users.length === 1 ? users[0].name : `${users.length} people`} — pick yours.
            </p>
            {users.length > 0 && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => setUser(u.id)}
                    className="flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-meta font-medium text-slate-700 transition hover:border-sky-300 hover:text-sky-700"
                    title={`Show ${u.name}'s work`}
                  >
                    <span className="grid h-4 w-4 place-items-center rounded-full bg-slate-700 text-micro font-bold text-white">{initialsOf(u.name)}</span>
                    I'm {u.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-lg border border-slate-300 bg-white px-4 py-8 text-center">
            <p className="text-body font-semibold text-slate-800">Nothing assigned to {me?.name ?? 'you'}.</p>
            <p className="mx-auto mt-1 max-w-md text-meta text-slate-600">
              Assign work from a card's panel — assignees are on the item, so this view follows whatever board the work lives on.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <section key={g.boardId} data-my-work-board={g.boardId} className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-100 px-4 py-2">
                  {/* The band is named and drawn as well as coloured: a coloured dot alone left
                      a colour-blind reader to guess which flight level a board sat at. */}
                  <BandBadge band={g.band} />
                  <span className="text-body font-semibold text-slate-800">{g.boardName}</span>
                  <span className="text-meta text-slate-600">
                    {g.entries.length} item{g.entries.length === 1 ? '' : 's'}
                  </span>
                  {g.entries.some((e) => attentionOf(e)) && (
                    <span className="ml-auto flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-micro font-semibold text-rose-700 ring-1 ring-rose-200">
                      <TriangleAlert size={11} />
                      {g.entries.filter((e) => attentionOf(e)).length} need attention
                    </span>
                  )}
                </div>
                <div className="space-y-2 p-2">
                  {g.entries.map((e) => {
                    const type = issueTypes.find((t) => t.id === e.item.typeId)
                    const typeChip = chipColors(type?.color ?? '#64748b')
                    const attention = attentionOf(e)
                    return (
                      <div
                        key={e.item.id}
                        data-my-work-item={e.item.id}
                        data-attention={attention ?? (e.isResolved ? 'resolved' : 'none')}
                        className={cn(
                          'group flex items-stretch gap-2 rounded-lg border p-2.5 transition',
                          attention === 'risk'
                            ? 'border-rose-300 bg-rose-50/60'
                            : attention === 'watch'
                              ? 'border-amber-300 bg-amber-50/50'
                              : e.isResolved
                                ? 'border-slate-200 bg-slate-50'
                                : 'border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => openDrawer(g.boardId, e.item.id)}
                          title={`Open details for “${e.item.title}”`}
                          className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1"
                        >
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span
                              className="shrink-0 rounded px-1 py-px text-micro font-bold uppercase tracking-wide"
                              style={{ backgroundColor: typeChip.background, color: typeChip.color }}
                            >
                              {type?.name ?? 'Item'}
                            </span>
                            {e.item.blocked && (
                              <span className="flex shrink-0 items-center gap-0.5 rounded bg-rose-100 px-1.5 py-px text-micro font-bold uppercase tracking-wide text-rose-700">
                                <Ban size={10} /> Blocked
                              </span>
                            )}
                            {e.isOverdue && (
                              <span className="flex shrink-0 items-center gap-0.5 rounded bg-rose-100 px-1.5 py-px text-micro font-bold uppercase tracking-wide text-rose-700">
                                <TriangleAlert size={10} /> Overdue
                              </span>
                            )}
                            {e.isDueSoon && (
                              <span className="flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1.5 py-px text-micro font-bold uppercase tracking-wide text-amber-800">
                                <CalendarClock size={10} /> Due soon
                              </span>
                            )}
                            {e.isResolved && (
                              <span className="flex shrink-0 items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-px text-micro font-bold uppercase tracking-wide text-emerald-800">
                                <Check size={10} /> Done
                              </span>
                            )}
                          </span>
                          <span className="min-w-0 truncate text-body font-semibold text-slate-800 group-hover:text-indigo-700">
                            {e.item.title}
                          </span>
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-slate-600">
                            <span className="inline-flex items-center gap-1" title="The cell the work sits in">
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                              {e.cellName}
                            </span>
                            <span className="inline-flex items-center gap-1 text-slate-500">
                              <PanelRight size={11} /> Details
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openOnBoard(g.boardId, e.item.id)}
                          title={`Open “${e.item.title}” on ${g.boardName}`}
                          aria-label={`Open in board — “${e.item.title}” on ${g.boardName}`}
                          className="flex shrink-0 items-center gap-1 self-center rounded-md border border-slate-200 bg-white px-2 py-1 text-micro font-semibold text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                        >
                          <SquareArrowOutUpRight size={12} />
                          <span>Open in board</span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
