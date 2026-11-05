import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { boundaryEntries } from '@/domain/boundary'
import { isOpen } from '@/domain/derive'
import { useStore } from '@/store'

/**
 * The red strings between the boundary workflow and the cards that wait on it.
 *
 * A boundary dependency is not a placement on this board: it lives somewhere else, and the band
 * below the cards is a lens on it. The words already say which cards wait (the boundary card lists
 * them, and each dependent wears a "Waiting on" chip), but the relationship is spatial and a reader
 * should be able to follow it without matching two lists. This draws one curved red line per open
 * link, from the boundary card to the card on this board that waits on it.
 *
 * It is an SVG over the board's **content**, not over the viewport: the board scrolls, and the
 * content's own coordinates are stable under scrolling. The overlay is pointer-events-none and
 * aria-hidden — it is a drawing, and the two ends already carry the relationship in words.
 *
 * Nothing is drawn at rest. The strings belong to the **selected** boundary card — the one wearing
 * the "linked" badge — because that is the reader asking to see exactly that edge. Only its open
 * links are drawn: a satisfied or closed dependency is history, not a string still pulling on the
 * work, and a red line would say "waiting" about something that is no longer waited on.
 */
export function BoundaryLinks({
  contentRef,
  boardId,
}: {
  contentRef: RefObject<HTMLDivElement | null>
  boardId: string
}) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const boundaryId = useStore((s) => s.boundaryId)
  const boardDetail = useStore((s) => s.boardDetail)
  const filters = useStore((s) => s.filters)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [lines, setLines] = useState<
    Array<{ key: string; path: string; x1: number; y1: number; x2: number; y2: number; active: boolean }>
  >([])
  const [reflow, setReflow] = useState(0)

  // The content's height and width change when a flow folds, a band opens, a card's detail changes
  // or the drawer takes width. A ResizeObserver catches all of those; data changes arrive through
  // the store selectors above and run the layout effect on their own.
  useEffect(() => {
    const el = contentRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setReflow((n) => n + 1))
    observer.observe(el)
    return () => observer.disconnect()
  }, [contentRef])

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) {
      setLines([])
      return
    }
    const bounds = content.getBoundingClientRect()
    const next: Array<{ key: string; path: string; x1: number; y1: number; x2: number; y2: number; active: boolean }> = []
    const entries = boundaryEntries({ items, edges, links, placements, lanes }, boardId)

    for (const entry of entries) {
      // The strings are the selected card's, not the whole board's: at rest the boundary is a
      // list, and selecting an entry is what asks for the connection to be drawn.
      if (!boundaryId || boundaryId !== entry.dependency.id || !isOpen(entry.state)) continue
      const source = content.querySelector<HTMLElement>(`[data-boundary-card="${CSS.escape(entry.dependency.id)}"]`)
      if (!source) continue
      const sourceRect = source.getBoundingClientRect()
      const center = sourceRect.left - bounds.left + sourceRect.width / 2
      const y1 = sourceRect.top - bounds.top
      const spread = Math.min(10, sourceRect.width / Math.max(2, entry.dependents.length + 1))
      entry.dependents.forEach((dependent, index) => {
        const target = content.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(dependent.id)}"]`)
        if (!target) return
        const targetRect = target.getBoundingClientRect()
        const x2 = targetRect.left - bounds.left + targetRect.width / 2
        const y2 = targetRect.bottom - bounds.top
        const x1 = center + (index - (entry.dependents.length - 1) / 2) * spread
        const middle = (y1 + y2) / 2
        next.push({
          key: `${entry.dependency.id}:${dependent.id}`,
          path: `M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`,
          x1,
          y1,
          x2,
          y2,
          active: boundaryId === entry.dependency.id,
        })
      })
    }

    setSize({ width: content.offsetWidth, height: content.offsetHeight })
    setLines(next)
  }, [boardId, boundaryId, boardDetail, edges, filters, items, lanes, links, placements, reflow])

  if (lines.length === 0 || size.width === 0 || size.height === 0) return null

  return (
    <svg
      aria-hidden="true"
      data-boundary-links
      className="pointer-events-none absolute inset-0 z-30 overflow-visible print:hidden"
      width={size.width}
      height={size.height}
    >
      {lines.map((line) => (
        <g key={line.key} data-boundary-link={line.key} data-boundary-link-active={line.active ? '' : undefined}>
          <path
            d={line.path}
            fill="none"
            stroke={line.active ? '#b91c1c' : '#dc2626'}
            strokeWidth={line.active ? 5 : 3}
            strokeOpacity={line.active ? 0.95 : 0.45}
            strokeLinecap="round"
          />
          <circle cx={line.x1} cy={line.y1} r={line.active ? 4.5 : 3} fill="#dc2626" fillOpacity={line.active ? 0.95 : 0.55} />
          <circle cx={line.x2} cy={line.y2} r={line.active ? 4.5 : 3} fill="#dc2626" fillOpacity={line.active ? 0.95 : 0.55} />
        </g>
      ))}
    </svg>
  )
}
