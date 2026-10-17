import { useMemo } from 'react'
import { UserRound } from 'lucide-react'
import { BAND_STYLES } from './BandBadge'
import { buildRefs } from '@/domain/board'
import { myWork } from '@/domain/mywork'
import { initialsOf } from '@/domain/users'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

/**
 * My work — everything the workspace's person is assigned to, assembled from every board,
 * with the board and cell it sits in written on each row. It is a view, not a place:
 * moving work still happens on its board, so opening a row takes you there.
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
  const openItem = useStore((s) => s.openItem)
  const setMyWork = useStore((s) => s.setMyWork)

  const groups = useMemo(() => myWork(items, placements, lanes, boards, meUserId), [items, placements, lanes, boards, meUserId])
  const refs = buildRefs(items, issueTypes)
  const me = users.find((u) => u.id === meUserId)
  const total = groups.reduce((n, g) => n + g.entries.length, 0)

  /** Leave this view for the board the work sits on, and open the item there. */
  const open = (boardId: string, itemId: string) => {
    setMyWork(false)
    selectBoard(boardId)
    openItem(itemId)
  }

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
              Everything you own, assembled from every board. Moves still happen on the boards — opening a card takes you there.
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
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
          </div>
        </div>

        {!meUserId ? (
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
                <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-4 py-2">
                  <span className={cn('h-2 w-2 rounded-full', (BAND_STYLES[g.band] ?? BAND_STYLES.team).chip.split(' ')[0])} />
                  <span className="text-body font-semibold text-slate-800">{g.boardName}</span>
                  <span className="text-meta text-slate-600">
                    {g.entries.length} item{g.entries.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div>
                  {g.entries.map((e) => {
                    const type = issueTypes.find((t) => t.id === e.item.typeId)
                    return (
                      <button
                        key={e.item.id}
                        onClick={() => open(g.boardId, e.item.id)}
                        className="flex w-full items-center gap-2 border-b border-slate-100 px-4 py-2 text-left transition last:border-0 hover:bg-slate-50"
                        title={`Open on ${g.boardName}`}
                      >
                        <span
                          className="shrink-0 rounded px-1 py-px text-micro font-bold uppercase tracking-wide text-white"
                          style={{ backgroundColor: type?.color ?? '#64748b' }}
                        >
                          {type?.name ?? 'Item'}
                        </span>
                        <span className="shrink-0 text-micro font-semibold text-slate-600">{refs.get(e.item.id)}</span>
                        <span className="min-w-0 flex-1 truncate text-body font-semibold text-slate-800">{e.item.title}</span>
                        {e.item.blocked && (
                          <span className="shrink-0 rounded bg-rose-50 px-1.5 py-px text-micro font-bold uppercase tracking-wide text-rose-700">
                            Blocked
                          </span>
                        )}
                        {e.isOverdue ? (
                          <span className="shrink-0 text-meta font-semibold text-rose-600">Overdue</span>
                        ) : e.isDueSoon ? (
                          <span className="shrink-0 text-meta font-semibold text-amber-600">Due soon</span>
                        ) : null}
                        <span className="shrink-0 text-meta text-slate-600" title="The cell the work sits in">
                          {e.cellName}
                        </span>
                      </button>
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
