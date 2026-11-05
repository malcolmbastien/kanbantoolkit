import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import {
  BOARD_DETAIL_HINT,
  BOARD_DETAIL_LABEL,
  BOARD_DETAIL_LEVELS,
  detailFor,
  nextDetail,
  type BoardDetail,
} from '@/domain/boardDetail'

/**
 * The board's Detail dial: Mini → Summary → Full.
 *
 * It sits in the board's secondary bar with the other board-scoped controls, not in the global
 * top bar: it commands the surface underneath it. Design mode draws Full and disables the dial;
 * the stored choice is untouched and returns when design mode ends.
 */
export function DetailDial({
  boardId,
  editMode,
  className,
}: {
  boardId: string
  editMode: boolean
  className?: string
}) {
  const boardDetail = useStore((s) => s.boardDetail)
  const setBoardDetail = useStore((s) => s.setBoardDetail)
  // Design mode draws Full whatever the choice: a Mini tile has no fields to compare across a
  // split. The stored choice comes back when design mode ends.
  const detail: BoardDetail = editMode ? 'full' : detailFor(boardDetail, boardId)
  const ref = useRef<HTMLDivElement>(null)

  /**
   * A radio group is one stop, and the arrows move the choice inside it; focus follows the choice
   * so a screen reader hears what changed rather than staying on a word no longer selected.
   */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editMode) return
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = nextDetail(detail, step)
    setBoardDetail(boardId, next)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-detail="${next}"]`)?.focus())
  }

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label="Level of detail"
      aria-disabled={editMode || undefined}
      onKeyDown={onKeyDown}
      className={cn('flex shrink-0 items-center gap-1.5', className)}
    >
      <span className="text-micro font-semibold uppercase tracking-wide text-slate-600">Detail</span>
      <div className="flex overflow-hidden rounded-md border border-slate-200 bg-white">
        {BOARD_DETAIL_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={detail === level}
            data-detail={level}
            disabled={editMode}
            tabIndex={detail === level ? 0 : -1}
            title={editMode ? 'Finish editing to change the level' : BOARD_DETAIL_HINT[level]}
            onClick={() => setBoardDetail(boardId, level)}
            className={cn(
              'border-r border-slate-200 px-2 py-0.5 text-meta font-medium last:border-r-0',
              detail === level ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
              editMode && 'cursor-not-allowed opacity-60',
            )}
          >
            {BOARD_DETAIL_LABEL[level]}
          </button>
        ))}
      </div>
    </div>
  )
}
