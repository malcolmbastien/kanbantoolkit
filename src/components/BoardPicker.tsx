import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { BAND_STYLES } from './BandBadge'
import { activeBoards } from '@/domain/board'
import { cn } from '@/lib/utils'
import type { Board, BoardBand } from '@/domain/types'

const BAND_ORDER: BoardBand[] = ['portfolio', 'program', 'team']

interface Props {
  boards: Board[]
  boardId: string
  onSelect: (id: string) => void
  /** A board design is open; another board cannot be opened until it is saved or cancelled. */
  disabled?: boolean
}

/**
 * The board switcher. Native selects can't show a hierarchy, so this lists every
 * board grouped by board type and names the boards each one rolls up under
 * — which is honest even where a board is linked by more than one parent.
 */
export function BoardPicker({ boards, boardId, onSelect, disabled = false }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

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

  // The menu is placed against the window, not against the bar.
  //
  // The navigation is a horizontal scroller — a row that never wraps — so an absolutely
  // positioned menu inside it is clipped to the bar's own height and a reader sees nothing when
  // they click. A fixed menu escapes that clip while staying in this component's DOM, which is
  // what keeps the outside-click test below working without a second ref.
  useEffect(() => {
    if (!open) return
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = 288
      setAt({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: rect.bottom + 4,
      })
    }
    place()
    window.addEventListener('resize', place)
    // The bar's own navigation scrolls sideways; the menu belongs to the button that opened it.
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

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
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-meta font-medium text-slate-800 outline-none transition hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {current && (
          <span
            className={cn(
              'hidden w-[72px] shrink-0 rounded py-px text-center text-micro font-bold uppercase tracking-wide lg:block',
              (BAND_STYLES[current.band] ?? BAND_STYLES.team).chip,
            )}
          >
            {(BAND_STYLES[current.band] ?? BAND_STYLES.team).label}
          </span>
        )}
        <span className="max-w-[96px] truncate sm:max-w-[120px]">{current?.name ?? 'Board'}</span>
        <ChevronDown size={13} className={cn('shrink-0 text-slate-400 transition', open && 'rotate-180')} />
      </button>

      {open && at && (
        <div
          role="listbox"
          aria-label="Boards"
          style={{ left: at.left, top: at.top }}
          className="fixed z-50 max-h-[70vh] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-xl"
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

        </div>
      )}
    </div>
  )
}
