import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/**
 * The richer reading behind a Mini tile.
 *
 * A Mini card carries no text on purpose, so its information is a hover/focus layer: what the
 * card is, who has it, and why it wears a red or amber marker. The layer is rendered through a
 * portal at viewport coordinates, so a board scroller cannot clip it and it never changes the
 * card's layout. It is `pointer-events-none` — a reader can move straight through it to the tile —
 * and the tile's own `aria-label` carries the same facts for a screen reader, so the layer is
 * `aria-hidden` rather than a second announcement.
 *
 * It closes on scroll or resize because its coordinates are viewport-relative; a pointer that has
 * moved the board is no longer pointing at the same tile.
 */
export function MiniHoverCard({
  open,
  anchor,
  onClose,
  children,
  className,
}: {
  open: boolean
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const close = () => onClose()
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, onClose])

  useLayoutEffect(() => {
    if (!open) return
    const tile = anchor.current
    const card = ref.current
    if (!tile || !card) return
    const rect = tile.getBoundingClientRect()
    const box = card.getBoundingClientRect()
    const gap = 8
    const margin = 8
    // Prefer the right of the tile; flip left when the card would run off the viewport. Vertically
    // centre on the tile, then clamp so the card is never half off-screen.
    const left =
      rect.right + gap + box.width <= window.innerWidth - margin
        ? rect.right + gap
        : Math.max(margin, rect.left - box.width - gap)
    const top = Math.max(
      margin,
      Math.min(rect.top + rect.height / 2 - box.height / 2, window.innerHeight - box.height - margin),
    )
    setPos({ left, top })
  }, [anchor, open, children])

  if (!open) return null
  return createPortal(
    <div
      ref={ref}
      aria-hidden="true"
      data-mini-hover-card
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className={cn(
        'pointer-events-none fixed z-[70] w-72 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-2xl ring-1 ring-slate-900/5',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  )
}
