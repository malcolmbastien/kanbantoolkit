import { useEffect, type RefObject } from 'react'
import { useStore } from '@/store'
import { stillScrolling } from './useStillScroll'

/** How much of the card must be inside the scroller before it counts as already in view. */
const MARGIN = 16

/**
 * Bring the open card into view.
 *
 * Selecting a card is also a request to see it in its place: the drawer opens beside the board,
 * the board gives up width, and a card reached from search, a pip, the dashboard or a deep link
 * can be in a column the reader cannot see. This centres it in the board's own scroller — both
 * axes, because a flow can scroll sideways and a board vertically — after one frame, when the
 * drawer has taken its room and the card's final place is known.
 *
 * A card that is already comfortably in view is left alone. A card is usually selected by
 * clicking it, and centring that card on every click would move the board under the pointer for
 * no reason; the journey is only worth making when the card is out of sight or under an edge.
 *
 * The board's scroll keeper is told the view is moving on purpose, so it does not treat the
 * smooth scroll as a resize to compensate for.
 */
export function useRevealSelection(scroller: RefObject<HTMLElement | null>): void {
  const selectedItemId = useStore((state) => state.selectedItemId)

  useEffect(() => {
    if (!selectedItemId) return
    let frame = 0
    // A deep link can select a card before its board has rendered — the selection is applied
    // first. Ask for a few frames rather than once, so the card is there when the scroll runs.
    let tries = 0
    const reveal = () => {
      const box = scroller.current
      const card = box?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(selectedItemId)}"]`)
      if (!box || !card) {
        if (tries++ < 10) frame = requestAnimationFrame(reveal)
        return
      }
      const view = box.getBoundingClientRect()
      const rect = card.getBoundingClientRect()
      const visible =
        rect.top >= view.top + MARGIN &&
        rect.bottom <= view.bottom - MARGIN &&
        rect.left >= view.left + MARGIN &&
        rect.right <= view.right - MARGIN
      if (visible) return
      stillScrolling()
      card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    }
    frame = requestAnimationFrame(reveal)
    return () => cancelAnimationFrame(frame)
  }, [selectedItemId, scroller])
}
