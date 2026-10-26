import { useEffect, useRef, type RefObject } from 'react'

/**
 * A deliberate scroll is in flight, so the keeper stands down.
 *
 * A smooth scroll — the pip's reveal is one — is many scroll events over a few hundred milliseconds,
 * and a resize that lands in the middle of it would compute its delta from a half-finished animation
 * and drag the page back to where the scroll started. The app says when it is moving the view; the
 * keeper takes no view of its own until it has landed.
 */
let standDownUntil = 0
export function stillScrolling(ms = 800): void {
  standDownUntil = performance.now() + ms
}

/**
 * Keep what the reader is looking at still when the page's height changes under them.
 *
 * A board's height is its tallest column, so a card moving between two columns — or the drawer
 * opening and narrowing every column — can make the page shorter or taller while nothing the reader
 * did asked the view to move. Browsers' own scroll anchoring tries to hold the content still, but it
 * is not universal, it picks its own anchor, and on this page it was the browser deciding what the
 * reader was reading. The board turns it off (`overflow-anchor: none`, applied by the caller) and
 * keeps its own.
 *
 * The anchor is the first card wholly at the top of the viewport — held with its distance from the
 * scroller's top edge and the scroll position it was taken at. When the content resizes and nobody
 * has scrolled since, the view moves by exactly the distance that card moved, so it stays where the
 * reader had it:
 *
 * - content growing above the viewport scrolls the view down by the same amount;
 * - content shrinking above it scrolls the view up — and at the bottom, where the browser clamps the
 *   scroll to the new end, the clamp is the same answer;
 * - content changing *inside* the viewport moves the things below it, and the anchor above them is
 *   what is held, so the page does not jump under the pointer.
 *
 * A scroll means somebody moved on purpose — the reader, or the app revealing a card — and the
 * anchor is taken again rather than compensated for: the page must not drag itself back to where it
 * was before the reader (or `revealCard`) arrived.
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
  // The anchor: a node, where its top edge sat, and the scroll position that was true of it.
  const anchor = useRef<{ node: HTMLElement; top: number; scrollTop: number } | null>(null)

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
        return chosen ? { node: chosen.node, top: chosen.rect.top, scrollTop: box.scrollTop } : null
      }
      // Cards first — they are what moves when the page's height changes. A lane is the fallback
      // for a board with no cards in view (an empty column, a collapsed board).
      anchor.current =
        pick([...area.querySelectorAll<HTMLElement>('[data-card-id], [data-boundary-card]')]) ??
        pick([...area.querySelectorAll<HTMLElement>(selector)])
    }

    // A scroll is the reader moving, and it is recorded on the next frame rather than in the handler
    // (the position they stopped at is the one to hold). The moment of the last scroll is kept too:
    // a smooth scroll — the pip's reveal is one — is many scroll events over a few hundred
    // milliseconds, and a resize that lands in the middle of it would compute a delta from a
    // half-finished animation and drag the page back to where the scroll started.
    let queued = false
    const onScroll = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        record()
      })
    }



    const settle = () => {
      const current = anchor.current
      if (!current || !current.node.isConnected) {
        record()
        return
      }
      // Somebody moved since the anchor was taken — a scroll, or the app revealing a card. Their
      // place wins; take the anchor again rather than pulling the page back.
      if (box.scrollTop !== current.scrollTop || performance.now() < standDownUntil) {
        record()
        return
      }
      const delta = current.node.getBoundingClientRect().top - current.top
      if (Math.abs(delta) >= 1) box.scrollTop += delta
      current.top = current.node.getBoundingClientRect().top
      current.scrollTop = box.scrollTop
    }

    record()
    box.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(settle)
    observer.observe(area)
    // A viewport change reflows the board (the same cards, different widths), so the anchor is taken
    // again rather than compensated for: at a new viewport the reader's place is the old content,
    // and the browser's own resize handling should decide it.
    const onResize = () => record()
    window.addEventListener('resize', onResize)

    return () => {
      box.removeEventListener('scroll', onScroll)
      observer.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [scroller, content, selector, key])
}
