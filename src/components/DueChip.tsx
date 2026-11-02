import { CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dueLabel, dueState, dueWhy } from '@/domain/due'
import type { Item } from '@/domain/types'

/**
 * The tones a due date speaks in, and nothing more: rose when the day has passed, amber within the
 * week the board's own "due soon" filter names, and quiet otherwise. A chip rather than a band —
 * a date is a fact about the work, and the loudest thing on a card is still its blockage.
 */
const TONE: Record<'overdue' | 'soon' | 'later', string> = {
  overdue: 'bg-rose-50 font-semibold text-rose-700 ring-rose-200',
  soon: 'bg-amber-50 font-semibold text-amber-800 ring-amber-200',
  later: 'bg-white font-medium text-slate-600 ring-slate-200',
}

/**
 * An item's due date, as one chip: the day, and how near it is.
 *
 * Renders nothing when the item has no due date, so every surface that shows it can place the chip
 * unconditionally rather than ask the same question twice. `complete` is the item's own finished
 * state — a finished item keeps its date but stops speaking in rose, because a passed day on work
 * that is done is a fact and no longer a risk.
 */
export function DueChip({
  item,
  complete = false,
  className,
}: {
  item: Pick<Item, 'dueDate'>
  complete?: boolean
  className?: string
}) {
  const due = dueState(item.dueDate, complete)
  if (!due) return null
  return (
    <span
      data-due={due.tone}
      data-due-date={due.date}
      title={dueWhy(due)}
      className={cn('flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-micro ring-1', TONE[due.tone], className)}
    >
      <CalendarClock size={11} className="shrink-0" aria-hidden />
      {dueLabel(due)}
    </span>
  )
}
