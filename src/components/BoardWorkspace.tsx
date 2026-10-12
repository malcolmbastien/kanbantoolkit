import { useState } from 'react'
import { Columns3, ExternalLink, Search, Trash2 } from 'lucide-react'
import { BAND_STYLES } from './BandBadge'
import { boardsByBand } from '@/domain/board'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Board } from '@/domain/types'

/**
 * The board workspace: every board in the organisation, grouped by flight level, with a
 * name filter.
 *
 * Each board appears **exactly once** — the aggregation graph is a DAG, so nesting a
 * board under one of its parents would either duplicate it or pick a parent and lie.
 *
 * Browsing is the point; opening a board leaves the workspace. Board admin also stays
 * inside each board: this is another way in, not the only one.
 */
export function BoardWorkspace() {
  const boards = useStore((s) => s.boards)
  const boardId = useStore((s) => s.boardId)
  const selectBoard = useStore((s) => s.selectBoard)
  const removeBoard = useStore((s) => s.removeBoard)
  const askConfirm = useStore((s) => s.askConfirm)
  const [q, setQ] = useState('')

  const groups = boardsByBand(boards, q)
  const shown = groups.reduce((n, g) => n + g.boards.length, 0)
  const lastBoard = boards.length <= 1

  const remove = (board: Board) =>
    askConfirm({
      title: `Delete “${board.name}”?`,
      body: 'Its lanes, cards and placements go with it, and any board that links it is unlinked. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => removeBoard(board.id),
    })

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-slate-200 p-4">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2 rounded-lg border border-slate-300 bg-white px-4 py-3">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-600">
              <Columns3 size={12} /> Boards
            </div>
            <div className="text-[16px] font-semibold text-slate-800">
              {shown} board{shown === 1 ? '' : 's'}
            </div>
            <div className="text-[11px] text-slate-500">Every board in the organisation, grouped by flight level.</div>
          </div>
          <div className="relative ml-auto">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search boards…"
              aria-label="Search boards"
              className="w-56 rounded-md border border-slate-300 py-1 pl-7 pr-2 text-[12px] outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
        </div>

        {groups.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-100 p-8 text-center text-[12px] text-slate-500">
            {boards.length === 0 ? 'No boards yet.' : `No board matches “${q.trim()}”.`}
          </div>
        )}

        <div className="space-y-3">
          {groups.map(({ band, boards: inBand }) => {
            const style = BAND_STYLES[band] ?? BAND_STYLES.team
            return (
              <section key={band}>
                {/* The level is stated once per group rather than on every row inside it. */}
                <div className="mb-1 flex items-center gap-2 px-1">
                  <span className={cn('rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wide', style.chip)}>
                    {style.label}
                  </span>
                  <span className="text-[10px] font-semibold tabular-nums text-slate-400">{inBand.length}</span>
                </div>

                <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
                  {inBand.map((b) => (
                    <div
                      key={b.id}
                      className={cn(
                        'flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-0',
                        b.id === boardId ? 'bg-indigo-50' : 'hover:bg-slate-50',
                      )}
                    >
                      <button
                        onClick={() => selectBoard(b.id)}
                        className="group flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        title={`Open ${b.name}`}
                      >
                        <span className="truncate text-[13px] font-semibold text-slate-800">{b.name}</span>
                        {b.id === boardId && <span className="shrink-0 text-[10px] font-medium text-indigo-600">current</span>}
                        <ExternalLink
                          size={11}
                          className="shrink-0 text-slate-400 transition group-hover:text-indigo-500"
                        />
                      </button>

                      <button
                        onClick={() => remove(b)}
                        disabled={lastBoard}
                        className="shrink-0 rounded p-1 text-slate-300 transition hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-30"
                        title={lastBoard ? 'The last board cannot be deleted' : `Delete ${b.name}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
