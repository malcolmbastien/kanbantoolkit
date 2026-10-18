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
 * Restraint matters here, and the shape carries it: the mark is the icon and its tone, and
 * nothing else. A chip around it put a judgement *about* the work at the weight of the facts
 * about it — the type, a blockage — which are what a reader scans a card for.
 */
export const PRIORITY_META: Record<Priority, { label: string; icon: typeof ChevronUp; dot: string }> = {
  urgent: { label: 'Urgent', icon: ChevronsUp, dot: 'text-rose-600' },
  high: { label: 'High', icon: ChevronUp, dot: 'text-amber-600' },
  medium: { label: 'Medium', icon: Minus, dot: 'text-sky-600' },
  low: { label: 'Low', icon: ChevronDown, dot: 'text-slate-600' },
}

/** The order the ramp is offered in — loudest first. */
export const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'medium', 'low']

/**
 * A card's priority, as its own mark. Renders nothing when the card has none.
 *
 * The icon is the whole mark, at the size the eye finds without looking for it, and it is
 * labelled for a reader who cannot see it — the shape says which way the ramp points, the tone
 * says how far up it is.
 */
export function PriorityBadge({ priority }: { priority?: Priority }) {
  if (!priority) return null
  const { label, icon: Icon, dot } = PRIORITY_META[priority]
  return (
    <span
      role="img"
      aria-label={`Priority: ${label}`}
      title={`Priority — ${label.toLowerCase()}`}
      className="flex shrink-0 items-center"
    >
      <Icon size={14} className={cn('shrink-0', dot)} />
    </span>
  )
}
