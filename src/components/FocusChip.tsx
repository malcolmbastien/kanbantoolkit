import { Focus, X } from 'lucide-react'
import { useStore } from '@/store'

/**
 * The focus chip, shown while a focus is active.
 *
 * It lives in the TopBar rather than in a strip above the board: a strip that only
 * appears once a focus is on pushes the whole board down, which moves the very button
 * you need to clear it. The TopBar is always there, so the chip costs no layout shift
 * and its clear button never moves.
 */
export function FocusChip() {
  const lensId = useStore((s) => s.lensId)
  const clearLens = useStore((s) => s.clearLens)
  const items = useStore((s) => s.items)

  if (!lensId) return null
  return (
    <span
      className="flex items-center gap-1 rounded-md border border-indigo-400/50 bg-indigo-500/30 px-2 py-1 text-[11px] font-medium text-white"
      title="Focus — the board highlights this item's lineage"
    >
      <Focus size={12} className="shrink-0" />
      <span className="max-w-[180px] truncate">Focused: {items.find((i) => i.id === lensId)?.title ?? '—'}</span>
      <button onClick={clearLens} className="shrink-0 text-indigo-100 hover:text-white" title="Clear focus">
        <X size={11} />
      </button>
    </span>
  )
}
