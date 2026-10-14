import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * Anything that owns its own press: a control, or something already draggable. A press
 * that starts on one of these is never a pan.
 */
const INTERACTIVE = 'button, a, input, select, textarea, [data-card-id], [draggable="true"]'

/** How far the pointer must travel before a press becomes a pan rather than a click. */
const THRESHOLD = 4

/**
 * Pan a scroll container by dragging its empty space.
 *
 * A workflow wider than the screen is otherwise reachable only through the scrollbar, and a
 * drag on empty board surface starts a text selection — which is the opposite of what it
 * looks like it should do. This makes the surface itself draggable.
 *
 * Two rules keep it out of the way. It never starts on something that owns its own press,
 * so cards, initiatives, lanes and edit-mode controls keep their behaviour. And it waits
 * for the pointer to travel a few pixels, so a press that does not move is still a click —
 * deselecting a card, closing the panel or clearing a focus all keep working.
 */
export function usePanScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number; active: boolean } | null>(null)
  const [panning, setPanning] = useState(false)

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return
    const el = ref.current
    if (!el) return
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return
    // Capture the pointer, so a fast drag that leaves the container keeps panning instead
    // of being cancelled by pointerleave.
    el.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, active: false }
  }, [])

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    const d = drag.current
    const el = ref.current
    if (!d || !el) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.active) {
      if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return
      d.active = true
      setPanning(true)
    }
    el.scrollLeft = d.left - dx
    el.scrollTop = d.top - dy
  }, [])

  const end = useCallback((e: ReactPointerEvent) => {
    if (ref.current?.hasPointerCapture(e.pointerId)) ref.current.releasePointerCapture(e.pointerId)
    drag.current = null
    setPanning(false)
  }, [])

  return {
    ref,
    panning,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      onPointerLeave: end,
    },
  }
}
