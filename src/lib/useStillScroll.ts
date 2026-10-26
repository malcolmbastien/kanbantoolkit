import { useEffect, useRef, type RefObject } from 'react'

/**
 * Keep what the reader is looking at still when the page's height changes under them.
 *
 * A board's height is its tallest column, so a card moving between two columns can make the page
 * shorter or taller while nothing the reader did asked the view to move. Browsers' own scroll
 * anchoring tries to hold the content still, but it is not universal, it picks its own anchor, and
 * the board would rather have one mechanism it can reason about: this hook turns the browser's off
 * (`overflow-anchor: none`, applied by the caller) and keeps its own.
 *
 * The anchor is the first thing at the top of the viewport — a card, a boundary card, a lane — held
 * with its distance from the scroller's top edge. When the content resizes, the scroll moves by
 * exactly the distance that thing moved, so it stays where the reader had it:
 *
 * - content growing above the viewport scrolls the view down by the same amount;
 * - content shrinking above it scrolls the view up — and at the bottom, where the browser clamps the
 *   scroll to the new end, the clamp is the same answer;
 * - content changing *inside* the viewport moves the things below it, and the anchor above them is
 *   what is held, so the page does not jump under the pointer.
 *
 * A scroll always re-anchors rather than compensates: the reader moved on purpose, and a resize
 * arriving after their scroll must not fight it.
 */
export function useStillScroll(
  scroller: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  /**
   * What a reader reads. Cards are asked first and separately: a lane or a section can straddle the
   * whole viewport and would win by document order, and holding a container whose top is far above
   * the fold would compensate for nothing.
   */
  selector = '[data-card-id], [data-boundary-card], [data-lane-cell]',
  /**
   * Re-anchor when this changes — the board, in practice. The first render can happen before the
   * board exists (the store hydrates, the demo seeds), when there is no scroller to attach to yet;
   * the refs are stable objects, so without a key the effect would never run a second time.
   */
  key?: unknown,
): void {
  // The anchor: a node and where its top edge sat, relative to the scroller's viewport.
  const anchor = useRef<{ node: HTMLElement; top: number } | null>(null)

  useEffect(() => {
    const box = scroller.current
    const area = content.current
    if (!box || !area) return

    const record = () => {
      const bounds = box.getBoundingClientRect()
      /**
       * The first thing wholly below the viewport's top edge, and failing that the one it cuts.
       *
       * Whole first, because a card the reader's edge cuts through can grow below its own top: hold
       * that one and nothing moves, while everything under it slides. The card *below* the fold is
       * the one that moves when anything above it grows, so it is the one to hold.
       */
      const pick = (nodes: HTMLElement[]) => {
        const measured = nodes.map((node) => ({ node, rect: node.getBoundingClientRect() }))
        const chosen =
          measured.find(({ rect }) => rect.top >= bounds.top - 1 && rect.top < bounds.bottom) ??
          measured.find(({ rect }) => rect.bottom > bounds.top + 4 && rect.top < bounds.bottom)
        return chosen ? { node: chosen.node, top: chosen.rect.top } : null
      }
      // Cards first — they are what moves when the page's height changes. A lane is the fallback
      // for a board with no cards in view (an empty column, a collapsed board).
      anchor.current = pick([...area.querySelectorAll<HTMLElement>('[data-card-id], [data-boundary-card]')]) ?? pick([...area.querySelectorAll<HTMLElement>(selector)])
    }

    // A scroll is the reader moving, and it is recorded on the next frame rather than in the
    // handler: the position they stopped at is the one to hold. A resize that arrives *before* that
    // frame is part of the same movement, so it re-anchors instead of compensating — but a flag that
    // waits for the next resize would go stale (a scrolled-to place, then a card opened a minute
    // later, would look like one gesture), which is why it is cleared by the frame and not by the
    // next resize.
    let pending = false
    const onScroll = () => {
      if (pending) return
      pending = true
      requestAnimationFrame(() => {
        pending = false
        record()
      })
    }

    const settle = () => {
      const current = anchor.current
      if (pending || !current) {
        pending = false
        record()
        return
      }
      // The anchor was the card that moved out of the board: there is nothing to hold, so start
      // again from what is on screen now.
      if (!current.node.isConnected) {
        record()
        return
      }
      const top = current.node.getBoundingClientRect().top
      const delta = top - current.top
      if (Math.abs(delta) >= 1) box.scrollTop += delta
      current.top = current.node.getBoundingClientRect().top
    }

    record()
    box.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(settle)
    observer.observe(area)
    // A viewport change reflows the board (the same cards, different widths), so the anchor has to
    // be taken again rather than compensated for: at a new viewport the reader's place is the old
    // content, and the browser's own resize handling should decide it.
    const onResize = () => record()
    window.addEventListener('resize', onResize)

    return () => {
      box.removeEventListener('scroll', onScroll)
      observer.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [scroller, content, selector, key])
}
