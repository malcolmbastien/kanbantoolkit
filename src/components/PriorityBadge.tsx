import { ChevronDown, ChevronUp, ChevronsUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Item } from '@/domain/types'

export type Priority = NonNullable<Item['priority']>

/**
 * Priority is one of the few stored fields, and the only judgement field — so it needs a
 * shape you can read at a glance rather than a word you have to parse. The ramp is the
 * conventional one: two chevrons up for urgent, one for high, a dash for medium, one down
 * for low.
 *
 * Restraint matters here. Blocked is the one alarm on a card; priority should be legible
 * without competing with it, so only *urgent* carries a saturated fill and the rest are
 * tinted chips.
 */
export const PRIORITY_META: Record<Priority, { label: string; icon: typeof ChevronUp; chip: string; dot: string }> = {
  urgent: { label: 'Urgent', icon: ChevronsUp, chip: 'bg-rose-600 text-white', dot: 'text-rose-600' },
  high: { label: 'High', icon: ChevronUp, chip: 'bg-amber-100 text-amber-800 ring-1 ring-amber-300', dot: 'text-amber-600' },
  medium: { label: 'Medium', icon: Minus, chip: 'bg-sky-100 text-sky-800 ring-1 ring-sky-300', dot: 'text-sky-600' },
  low: { label: 'Low', icon: ChevronDown, chip: 'bg-slate-100 text-slate-600 ring-1 ring-slate-300', dot: 'text-slate-600' },
}

/** The order the ramp is offered in — loudest first. */
export const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'medium', 'low']

/** A card's priority, as a badge. Renders nothing when the card has none. */
export function PriorityBadge({ priority, showLabel = false }: { priority?: Priority; showLabel?: boolean }) {
  if (!priority) return null
  const { label, icon: Icon, chip } = PRIORITY_META[priority]
  return (
    <span
      className={cn('flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-micro font-bold uppercase tracking-wide', chip)}
      title={`Priority — ${label.toLowerCase()}`}
    >
      <Icon size={10} />
      {showLabel && label}
    </span>
  )
}
