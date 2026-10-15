import { createPortal } from 'react-dom'

/**
 * The card in the air.
 *
 * Rendered into the document body rather than into the lane, so it is never clipped by the
 * board's scrolling or rounded corners and always sits above everything. It is the card's own
 * markup, captured when it was lifted, so what you drag is what you were holding.
 *
 * The lift is what tells you the card has left the board: it sits slightly turned and casts a
 * real shadow, and the lane it came from has already closed up behind it.
 */
export function DragLayer({
  html,
  x,
  y,
  grabX,
  grabY,
  width,
  height,
}: {
  html: string
  x: number
  y: number
  grabX: number
  grabY: number
  width: number
  height: number
}) {
  return createPortal(
    <div
      data-drag-layer
      // The card's face is a 10% tint, which reads as a tint only over the white it usually
      // sits on. On its own it would be see-through, so the lift carries that white with it.
      className="pointer-events-none fixed z-[100] origin-top-left rotate-2 rounded-md bg-white drop-shadow-2xl"
      style={{ left: x - grabX, top: y - grabY, width, height }}
      dangerouslySetInnerHTML={{ __html: html }}
    />,
    document.body,
  )
}
