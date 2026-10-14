import { Focus, X } from 'lucide-react'
import { useStore } from '@/store'

/**
 * The focus chip, shown while a focus is active.
 *
 * It lives in the TopBar rather than in a strip above the board: a strip that only
 * appears once a focus is on pushes the whole board down, which moves the very button
 * you need to clear it. The TopBar is always there, so the chip costs no layout shift
 * and its clear button never moves.
 *
 * It is also the only flexible thing in the bar. Every other control is `shrink-0` and
 * sits in its own non-shrinking group, and the chip itself has `basis-0` — so its
 * *hypothetical* width is nil and it can never be the item that pushes the row over and
 * makes it wrap. It simply grows into whatever space is left, and truncates when there
 * is none. A bar that wraps is a bar that shoves the whole screen down, which is exactly
 * the bug this avoids.
 */
export function FocusChip() {
  const lensId = useStore((s) => s.lensId)
  const clearLens = useStore((s) => s.clearLens)
  const items = useStore((s) => s.items)

  if (!lensId) return null
  return (
    <span
      className="flex min-w-[2rem] basis-0 grow items-center gap-1 overflow-hidden rounded-md border border-indigo-400/50 bg-indigo-500/30 px-2 py-1 text-[11px] font-medium text-white"
      title="Focus — the board highlights this item's lineage"
    >
      <Focus size={12} className="shrink-0" />
      <span className="min-w-0 truncate">
        <span className="text-indigo-200">Focused:</span> {items.find((i) => i.id === lensId)?.title ?? '—'}
      </span>
      <button onClick={clearLens} className="ml-auto shrink-0 text-indigo-100 hover:text-white" title="Clear focus">
        <X size={11} />
      </button>
    </span>
  )
}
