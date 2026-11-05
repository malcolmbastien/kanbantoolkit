import { useEffect, useId, useLayoutEffect, useState, type RefObject } from 'react'
import { boardConnections, type ConnectionEdge } from '@/domain/connections'
import { useStore } from '@/store'

interface Line extends ConnectionEdge {
  d: string
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * The connections overlay: one red string per hierarchy or dependency edge the board renders.
 *
 * It is the same drawing idea as `BoundaryLinks` — an absolutely positioned SVG inside the board's
 * content, measured from the cards on screen — but it is a second reading rather than a second
 * layout. Hierarchy edges are dashed and dependency edges are solid with an arrow at the dependent
 * end, so two relationships do not become one red knot. The legend in the toggle names both.
 *
 * An edge is drawn only when the DOM has a card at both ends. A filtered, folded or archived item
 * has no element, and a line to nowhere would be a claim the board cannot support.
 */
export function ConnectionsLinks({
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
  const boardDetail = useStore((s) => s.boardDetail)
  const filters = useStore((s) => s.filters)
  const on = useStore((s) => s.connectionsOn[boardId] === true)
  const markerId = `connection-arrow-${useId().replace(/:/g, '')}`
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [lines, setLines] = useState<Line[]>([])
  const [reflow, setReflow] = useState(0)

  useEffect(() => {
    const el = contentRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setReflow((n) => n + 1))
    observer.observe(el)
    return () => observer.disconnect()
  }, [contentRef])

  useLayoutEffect(() => {
    if (!on) {
      setLines([])
      return
    }
    const content = contentRef.current
    if (!content) {
      setLines([])
      return
    }
    const bounds = content.getBoundingClientRect()
    const next: Line[] = []
    for (const edge of boardConnections({ items, edges, links, placements, lanes }, boardId)) {
      const source = content.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(edge.from)}"]`)
      const target = content.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(edge.to)}"]`)
      if (!source || !target) continue
      const curve = edgeCurve(source.getBoundingClientRect(), target.getBoundingClientRect(), bounds)
      next.push({ ...edge, ...curve })
    }
    setSize({ width: content.offsetWidth, height: content.offsetHeight })
    setLines(next)
  }, [boardId, boardDetail, edges, filters, items, lanes, links, on, placements, reflow, contentRef])

  if (!on || lines.length === 0 || size.width === 0 || size.height === 0) return null

  return (
    <svg
      aria-hidden="true"
      data-connection-links
      className="pointer-events-none absolute inset-0 z-30 overflow-visible print:hidden"
      width={size.width}
      height={size.height}
    >
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#b91c1c" />
        </marker>
      </defs>
      {lines.map((line) => (
        <g key={`${line.kind}:${line.id}`} data-connection-link={line.id} data-connection-kind={line.kind}>
          <path
            d={line.d}
            fill="none"
            stroke={line.kind === 'hierarchy' ? '#dc2626' : '#b91c1c'}
            strokeWidth={line.kind === 'hierarchy' ? 2 : 2.5}
            strokeOpacity={line.kind === 'hierarchy' ? 0.65 : 0.9}
            strokeLinecap="round"
            strokeDasharray={line.kind === 'hierarchy' ? '6 4' : undefined}
            markerEnd={line.kind === 'dependency' ? `url(#${markerId})` : undefined}
          />
        </g>
      ))}
    </svg>
  )
}

/**
 * Where one curve leaves and arrives.
 *
 * The cards are laid out in two dimensions, so a fixed "top to bottom" would send a line through a
 * card that sits beside its parent. Use the nearest edges: vertical when one card is clearly above
 * the other, horizontal when they are side by side.
 */
function edgeCurve(source: DOMRect, target: DOMRect, bounds: DOMRect) {
  const sx = source.left - bounds.left
  const sy = source.top - bounds.top
  const tx = target.left - bounds.left
  const ty = target.top - bounds.top
  const scx = sx + source.width / 2
  const scy = sy + source.height / 2
  const tcx = tx + target.width / 2
  const tcy = ty + target.height / 2

  if (Math.abs(tcy - scy) >= (source.height + target.height) / 2) {
    const down = tcy > scy
    const x1 = scx
    const y1 = down ? sy + source.height : sy
    const x2 = tcx
    const y2 = down ? ty : ty + target.height
    const middle = (y1 + y2) / 2
    return {
      x1,
      y1,
      x2,
      y2,
      d: `M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`,
    }
  }

  const rightward = tcx > scx
  const x1 = rightward ? sx + source.width : sx
  const x2 = rightward ? tx : tx + target.width
  const y1 = scy
  const y2 = tcy
  const middle = (x1 + x2) / 2
  return {
    x1,
    y1,
    x2,
    y2,
    d: `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`,
  }
}
