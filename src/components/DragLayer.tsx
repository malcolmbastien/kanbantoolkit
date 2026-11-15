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
  count = 1,
}: {
  html: string
  x: number
  y: number
  grabX: number
  grabY: number
  width: number
  height: number
  /** How many cards the gesture is carrying. More than one shows a stack and a count. */
  count?: number
}) {
  const group = count > 1
  return createPortal(
    <div
      data-drag-layer
      className="pointer-events-none fixed z-[100]"
      style={{ left: x - grabX, top: y - grabY, width, height }}
    >
      {/* Two quiet cards behind the one in hand: the gesture is carrying a group, not a card. */}
      {group && (
        <>
          <span
            aria-hidden
            className="absolute inset-0 rounded-md border border-indigo-200 bg-white shadow-lg"
            style={{ transform: 'translate(8px, 8px) rotate(4deg)' }}
          />
          <span
            aria-hidden
            className="absolute inset-0 rounded-md border border-indigo-200 bg-white shadow-md"
            style={{ transform: 'translate(4px, 4px) rotate(3deg)' }}
          />
        </>
      )}
      <div
        className="relative origin-top-left rotate-2 rounded-md drop-shadow-2xl"
        style={{ width, height }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {group && (
        <span
          data-drag-count
          aria-hidden
          className="absolute -right-2 -top-2 grid h-6 min-w-6 place-items-center rounded-full bg-indigo-600 px-1.5 text-micro font-bold tabular-nums text-white shadow-md ring-2 ring-white"
        >
          {count}
        </span>
      )}
    </div>,
    document.body,
  )
}
