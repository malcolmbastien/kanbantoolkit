import { useState } from 'react'
import { Archive, ArchiveRestore, Columns3, ExternalLink, Plus, Search, Trash2 } from 'lucide-react'
import { BAND_STYLES, BOARD_BANDS } from './BandBadge'
import { boardsByBand } from '@/domain/board'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Board, BoardBand } from '@/domain/types'

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
  const addBoard = useStore((s) => s.addBoard)
  const archiveBoard = useStore((s) => s.archiveBoard)
  const unarchiveBoard = useStore((s) => s.unarchiveBoard)
  const askConfirm = useStore((s) => s.askConfirm)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [band, setBand] = useState<BoardBand>('team')
  const [showArchived, setShowArchived] = useState(false)

  const groups = boardsByBand(boards, q, showArchived)
  const shown = groups.reduce((n, g) => n + g.boards.length, 0)
  const archivedCount = boards.filter((b) => b.archived).length
  const lastBoard = boards.length <= 1

  const create = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    // `open: false` — creating here is browsing, so the board lands in the list rather
    // than switching to it in edit mode the way the TopBar's create does.
    addBoard(trimmed, band, false)
    setName('')
    setBand('team')
    setCreating(false)
    setQ('')
  }

  const cancelCreate = () => {
    setName('')
    setBand('team')
    setCreating(false)
  }

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
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => (creating ? cancelCreate() : setCreating(true))}
              className={cn(
                'flex items-center gap-1 rounded-md border px-2.5 py-1 text-[12px] font-medium transition',
                creating
                  ? 'border-indigo-400/60 bg-indigo-50 text-indigo-700'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-700',
              )}
              title="Create a board in this organisation"
            >
              <Plus size={13} /> New board
            </button>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search boards…"
                aria-label="Search boards"
                className="w-56 rounded-md border border-slate-300 py-1 pl-7 pr-2 text-[12px] outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            {archivedCount > 0 && (
              <button
                onClick={() => setShowArchived((v) => !v)}
                className={cn(
                  'flex items-center gap-1 rounded-md border px-2.5 py-1 text-[12px] font-medium transition',
                  showArchived
                    ? 'border-slate-400 bg-slate-200 text-slate-700'
                    : 'border-slate-300 bg-white text-slate-500 hover:text-slate-700',
                )}
                title={showArchived ? 'Hide retired boards' : 'Show retired boards'}
              >
                <Archive size={13} /> {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
              </button>
            )}
          </div>

          {creating && (
            <div className="flex w-full flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') create()
                  else if (e.key === 'Escape') cancelCreate()
                }}
                placeholder="Board name…"
                aria-label="New board name"
                className="w-56 rounded-md border border-slate-300 px-2 py-1 text-[12px] outline-none focus:ring-2 focus:ring-indigo-300"
              />
              <select
                value={band}
                onChange={(e) => setBand(e.target.value as BoardBand)}
                aria-label="New board flight level"
                className="rounded-md border border-slate-300 px-1.5 py-1 text-[12px] outline-none focus:ring-2 focus:ring-indigo-300"
              >
                {BOARD_BANDS.map((b) => (
                  <option key={b} value={b}>
                    {BAND_STYLES[b].label}
                  </option>
                ))}
              </select>
              <button
                onClick={create}
                disabled={!name.trim()}
                className="rounded-md bg-indigo-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
              >
                Create
              </button>
              <button
                onClick={cancelCreate}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-[12px] font-medium text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
              <span className="text-[11px] text-slate-400">Starts as the standard Backlog → Done columns; shape it after.</span>
            </div>
          )}
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
                        b.archived && 'opacity-60',
                      )}
                    >
                      <button
                        onClick={() => selectBoard(b.id)}
                        className="group flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        title={`Open ${b.name}`}
                      >
                        <span className={cn('truncate text-[13px] font-semibold', b.archived ? 'text-slate-500' : 'text-slate-800')}>
                          {b.name}
                        </span>
                        {b.archived && (
                          <span className="shrink-0 rounded bg-slate-200 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                            archived
                          </span>
                        )}
                        {b.id === boardId && <span className="shrink-0 text-[10px] font-medium text-indigo-600">current</span>}
                        <ExternalLink
                          size={11}
                          className="shrink-0 text-slate-400 transition group-hover:text-indigo-500"
                        />
                      </button>

                      <button
                        onClick={() => (b.archived ? unarchiveBoard(b.id) : archiveBoard(b.id))}
                        className="shrink-0 rounded p-1 text-slate-400 transition hover:text-slate-700"
                        title={b.archived ? `Restore ${b.name}` : `Archive ${b.name}`}
                      >
                        {b.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
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
