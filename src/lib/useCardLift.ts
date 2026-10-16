import { useRef, useState } from 'react'

/**
 * The card in the air. Carried in state rather than in a `dataTransfer`, because the surface
 * draws the lifted card itself and a pointer drag has no `dataTransfer` to read from.
 */
export interface CardDrag {
  itemId: string
  /** The card's markup, captured at the moment of the lift. */
  html: string
  width: number
  height: number
  /** Where inside the card it was grabbed, so the lifted card does not jump to the cursor. */
  grabX: number
  grabY: number
  /** The pointer, kept up to date as the drag moves. */
  x: number
  y: number
}

/**
 * Lifting a card with the pointer, for any surface that draws one.
 *
 * With the pointer rather than the browser's drag-and-drop, because a native drag is cancelled
 * the moment its source element leaves the document — and taking the card out of its lane is the
 * whole point of the lift. One implementation, so a card on either surface behaves the same way:
 * it is a press that has moved, so a press that stays put is still a click, and the click that
 * follows a drag is swallowed rather than opening the thing you just put down.
 *
 * The hook owns the lift and the gesture. Where the card *lands* is the caller's, because that
 * is the one thing the two surfaces do not agree about — a card drops at a position in a lane, an
 * initiative into a cell of its own section.
 */
export function useCardLift({
  onMove,
  onDrop,
}: {
  /** The pointer, while a card is in the air — the caller resolves what is under it. */
  onMove?: (x: number, y: number) => void
  onDrop: (itemId: string, x: number, y: number) => void
}) {
  const [lift, setLift] = useState<CardDrag | null>(null)
  // A press that became a drag must not also be a click, or the card would open its panel the
  // moment it was put down.
  const justDragged = useRef(false)

  const start = (e: React.PointerEvent, itemId: string) => {
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    const grabX = e.clientX - rect.left
    const grabY = e.clientY - rect.top
    const origin = { x: e.clientX, y: e.clientY }
    let dragging = false

    const move = (ev: PointerEvent) => {
      if (!dragging) {
        // A press is not a drag until it has moved.
        if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < 5) return
        dragging = true
        setLift({
          itemId,
          // A snapshot, so the card in the air is the card rather than an impression of it.
          html: el.outerHTML,
          width: rect.width,
          height: rect.height,
          grabX,
          grabY,
          x: ev.clientX,
          y: ev.clientY,
        })
      }
      setLift((d) => (d ? { ...d, x: ev.clientX, y: ev.clientY } : d))
      onMove?.(ev.clientX, ev.clientY)
    }

    const finish = (ev: PointerEvent, put: boolean) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      if (!dragging) return
      if (put) onDrop(itemId, ev.clientX, ev.clientY)
      setLift(null)
      justDragged.current = true
      // The click that follows this press arrives in the same turn.
      setTimeout(() => {
        justDragged.current = false
      }, 0)
    }
    const up = (ev: PointerEvent) => finish(ev, true)
    const cancel = (ev: PointerEvent) => finish(ev, false)

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  return { lift, start, justDragged }
}
