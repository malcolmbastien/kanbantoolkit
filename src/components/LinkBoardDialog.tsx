import { useRef, useState } from 'react'
import { Link2, Plus, Search, X } from 'lucide-react'
import { BandBadge, BAND_STYLES } from './BandBadge'
import { cn } from '@/lib/utils'
import { useDialogFocus } from '@/lib/useDialogFocus'
import type { Board, BoardBand } from '@/domain/types'

/** Team first, then the coordination boards — the work a programme is usually built over. */
const BAND_ORDER: BoardBand[] = ['team', 'program', 'portfolio']

interface Props {
  /** The boards that may be linked: acyclic, active and not already here. */
  candidates: Board[]
  /** The board being linked into, so the dialog can say what the link will do. */
  hostName: string
  onLink: (boardId: string) => void
  onClose: () => void
}

/**
 * The way a programme board gains a linked board.
 *
 * A link is a design decision, so the control lives in Edit board with the other design actions,
 * at the foot of the board where a team adds a cards flow. Choosing one is worth more than a
 * native select of bare names: each row carries the board's own type — its colour and its icon —
 * so the menu says whether the thing being linked is a team's work or another aggregation of it.
 */
export function LinkBoardDialog({ candidates, hostName, onLink, onClose }: Props) {
  const [query, setQuery] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  // The search field takes the caret first, so a long list is narrowed by typing rather than scanned.
  useDialogFocus(dialogRef, onClose, true, 'input')

  const needle = query.trim().toLowerCase()
  const rows = candidates
    .filter((board) => !needle || board.name.toLowerCase().includes(needle))
    .sort(
      (a, b) =>
        BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band) || a.name.localeCompare(b.name),
    )

  return (
    <div
      data-link-board-dialog
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-board-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sky-100 text-sky-700">
            <Link2 size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="link-board-title" className="text-title font-semibold text-slate-800">
              Link a board
            </h2>
            <p className="mt-0.5 text-meta leading-relaxed text-slate-600">
              Choose a team or coordination board to roll its initiatives up into{' '}
              <span className="font-semibold text-slate-700">{hostName}</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-slate-100 px-5 py-2.5">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-indigo-300">
            <Search size={13} className="shrink-0 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a board…"
              aria-label="Find a board"
              className="min-w-0 flex-1 bg-transparent text-meta text-slate-700 placeholder:text-slate-400 outline-none"
            />
          </div>
        </div>

        <div role="menu" aria-label="Boards you can link" className="max-h-80 overflow-y-auto p-1.5">
          {rows.length === 0 && (
            <p className="px-3 py-4 text-meta text-slate-600">
              {needle
                ? `No board matches “${query.trim()}”.`
                : 'Every board is already linked, or linking one would make a loop.'}
            </p>
          )}
          {rows.map((board) => {
            const style = BAND_STYLES[board.band] ?? BAND_STYLES.team
            const Icon = style.icon
            return (
              <button
                key={board.id}
                type="button"
                role="menuitem"
                data-link-board={board.id}
                onClick={() => onLink(board.id)}
                className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
              >
                <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', style.chip)}>
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold text-slate-900">
                    {board.name}
                  </span>
                  {board.archived && (
                    <span className="mt-0.5 inline-block rounded bg-slate-200 px-1 py-px text-micro font-semibold uppercase tracking-wide text-slate-600">
                      archived
                    </span>
                  )}
                </span>
                <BandBadge band={board.band} />
                <Plus
                  size={14}
                  aria-hidden
                  className="shrink-0 text-slate-300 transition group-hover:text-sky-600"
                />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
