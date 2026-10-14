import { Focus, X } from 'lucide-react'
import { useStore } from '@/store'

/**
 * The focus chip, shown while a focus is active.
 *
 * It is deliberately **not** in the TopBar. The bar is a wrapping flex row, so anything
 * added to it competes for the same line: turning a focus on could push the row over,
 * wrap the bar onto a second line and shove the entire board down — moving the very
 * button you need to clear the focus. Even with a nil flex basis the chip still occupied
 * the line, and its growth squeezed everything after it onto a new row.
 *
 * So it floats instead, out of flow, where it costs no layout shift at all. It sits
 * bottom-left, clear of the bulk-actions bar (bottom centre) and the item panel (right),
 * matching the app's existing floating-bar pattern.
 */
export function FocusChip() {
  const lensId = useStore((s) => s.lensId)
  const clearLens = useStore((s) => s.clearLens)
  const items = useStore((s) => s.items)

  if (!lensId) return null
  return (
    <div
      data-focus-chip
      className="fixed bottom-4 left-4 z-40 flex max-w-[min(24rem,80vw)] items-center gap-2 rounded-lg border border-indigo-400/60 bg-indigo-600 px-3 py-2 text-[11px] font-medium text-white shadow-2xl"
      title="Focus — the board highlights this item's lineage"
    >
      <Focus size={13} className="shrink-0" />
      <span className="min-w-0 truncate">
        <span className="text-indigo-200">Focused:</span> {items.find((i) => i.id === lensId)?.title ?? '—'}
      </span>
      <button
        onClick={clearLens}
        className="shrink-0 rounded p-0.5 text-indigo-100 transition hover:bg-white/15 hover:text-white"
        title="Clear focus"
      >
        <X size={12} />
      </button>
    </div>
  )
}
