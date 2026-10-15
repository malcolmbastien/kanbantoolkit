import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Columns3 } from 'lucide-react'
import { BAND_STYLES } from './BandBadge'
import { activeBoards } from '@/domain/board'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Board, BoardBand } from '@/domain/types'

const BAND_ORDER: BoardBand[] = ['portfolio', 'program', 'team']

interface Props {
  boards: Board[]
  boardId: string
  onSelect: (id: string) => void
}

/**
 * The board switcher. Native selects can't show a hierarchy, so this lists every
 * board grouped by flight-level band and names the boards each one rolls up under
 * — which is honest even where a board is linked by more than one parent.
 */
export function BoardPicker({ boards, boardId, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const setBoards = useStore((s) => s.setBoards)

  const sorted = useMemo(
    () =>
      // A retired board is not something you switch to; it stays reachable by deep link.
      activeBoards(boards).sort(
        (a, b) => BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band) || a.name.localeCompare(b.name),
      ),
    [boards],
  )
  const current = boards.find((b) => b.id === boardId)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    if (open) setActive(Math.max(0, sorted.findIndex((b) => b.id === boardId)))
  }, [open, sorted, boardId])

  const choose = (id: string) => {
    onSelect(id)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, sorted.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && sorted[active]) choose(sorted[active].id)
      else setOpen(true)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-meta font-medium text-slate-800 outline-none transition hover:border-slate-300 focus:ring-2 focus:ring-indigo-400"
        title="Switch board"
      >
        {current && (
          <span
            className={cn(
              'w-[72px] shrink-0 rounded py-px text-center text-micro font-bold uppercase tracking-wide',
              (BAND_STYLES[current.band] ?? BAND_STYLES.team).chip,
            )}
          >
            {(BAND_STYLES[current.band] ?? BAND_STYLES.team).label}
          </span>
        )}
        <span className="max-w-[150px] truncate">{current?.name ?? 'Board'}</span>
        <ChevronDown size={13} className={cn('shrink-0 text-slate-400 transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Boards"
          className="absolute left-0 z-50 mt-1 max-h-[70vh] w-72 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-xl"
        >
          {sorted.map((b, i) => {
            const style = BAND_STYLES[b.band] ?? BAND_STYLES.team
            return (
              <button
                key={b.id}
                type="button"
                role="option"
                aria-selected={b.id === boardId}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(b.id)}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition',
                  i === active ? 'bg-indigo-50' : 'hover:bg-slate-100',
                )}
              >
                <span className={cn('w-[72px] shrink-0 rounded py-px text-center text-micro font-bold uppercase tracking-wide', style.chip)}>
                  {style.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-meta text-slate-800">{b.name}</span>
                {b.id === boardId && <Check size={12} className="shrink-0 text-indigo-600" />}
              </button>
            )
          })}

          {/* The switcher leads somewhere: the workspace is where you browse and manage. */}
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setBoards(true)
            }}
            className="mt-1 flex w-full items-center gap-2 border-t border-slate-200 px-2.5 py-2 text-left text-meta font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <Columns3 size={12} className="shrink-0 text-slate-400" /> Manage boards…
          </button>
        </div>
      )}
    </div>
  )
}
