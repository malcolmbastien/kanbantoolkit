import { useEffect, useId, useLayoutEffect, useState, type RefObject } from 'react'
import { boundaryEntries } from '@/domain/boundary'
import { boardConnections, type ConnectionEdge } from '@/domain/connections'
import { isOpen } from '@/domain/derive'
import { useStore } from '@/store'

interface Line extends ConnectionEdge {
  d: string
  x1: number
  y1: number
  x2: number
  y2: number
}

/** An edge whose two ends are both in the DOM, with the boxes the drawing has to work from. */
interface DrawnEdge {
  edge: ConnectionEdge
  /** Where the circle sits: the parent of a hierarchy, the waiting item of a dependency. */
  sourceId: string
  /** Where the arrow lands: the child of a hierarchy, the blocker of a dependency. */
  targetId: string
  source: DOMRect
  target: DOMRect
}

type ConnectionSide = 'top' | 'bottom' | 'left' | 'right'

/**
 * The connections overlay: one string per hierarchy or dependency edge the board renders.
 *
 * An absolutely positioned SVG inside the board's content, measured from the cards on screen — so
 * it is a second reading rather than a second layout. Hierarchy is a blue solid string and
 * dependency a red solid string; both wear a circle where they leave the source and an arrow where
 * they enter the target. A dependency is drawn from the waiting item to the blocker it waits on, so
 * the circle and arrow read as "this waits on that". The legend in the toggle names both, so the
 * colours are not the only reading.
 *
 * The boundary band is the edge of the same graph, so its strings are the same strings: selecting a
 * boundary card scopes this overlay to the dependency edges that touch it, and they are drawn
 * exactly as the toggle draws them — one definition of a connector, whichever way it is asked for.
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
  const connectionScopeId = useStore((s) => s.connectionScopeId)
  // The boundary card the reader selected — the one wearing the "linked" badge. It is a scope of
  // this same lens: selecting it asks for the dependency strings that touch it.
  const boundaryId = useStore((s) => s.boundaryId)
  const active = on || Boolean(connectionScopeId) || Boolean(boundaryId)
  const arrowId = `connection-arrow-${useId().replace(/:/g, '')}`
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
    if (!active) {
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
    // What the surface actually drew. A portfolio's strategy map and a programme's bands show
    // initiatives that are placed on other boards, so placement is not the population here.
    const rendered = new Set<string>()
    for (const card of content.querySelectorAll<HTMLElement>('[data-card-id]')) {
      const id = card.dataset.cardId
      if (id) rendered.add(id)
    }
    // A boundary edge has one end in the bottom band rather than a card on this board; both
    // selectors are tried because either end may be the external item.
    const element = (id: string) =>
      content.querySelector<HTMLElement>(
        `[data-card-id="${CSS.escape(id)}"], [data-boundary-card="${CSS.escape(id)}"]`,
      )
    const drawn: DrawnEdge[] = []
    const edgesOnBoard = boardConnections({ items, edges, links, placements, lanes }, boardId, rendered)
    // A drawer can narrow the same lens to one card: only the strings that touch it are drawn.
    // A selected boundary card is the same reading at the edge of the board, and only its **open**
    // links: a satisfied or closed dependency is history, and a red string would say "waiting"
    // about work that is no longer waited on. With the board-wide lens on, its strings are already
    // part of that reading, so the selection adds no second set.
    const openBoundary = boundaryId && !on
      ? new Set(
          boundaryEntries({ items, edges, links, placements, lanes }, boardId)
            .filter((entry) => entry.dependency.id === boundaryId && isOpen(entry.state))
            .flatMap((entry) =>
              entry.dependents.map((dependent) => `boundary:${entry.dependency.id}:${dependent.id}`),
            ),
        )
      : null
    const scoped = connectionScopeId
      ? edgesOnBoard.filter((edge) => edge.from === connectionScopeId || edge.to === connectionScopeId)
      : openBoundary
        ? edgesOnBoard.filter((edge) => openBoundary.has(edge.id))
        : edgesOnBoard
    for (const edge of scoped) {
      // A dependency is stored blocker → dependent; the lens reads it the other way round, so the
      // circle sits on the item that waits and the arrow points at what it waits for.
      const [sourceId, targetId] = edge.kind === 'dependency' ? [edge.to, edge.from] : [edge.from, edge.to]
      const source = element(sourceId)
      const target = element(targetId)
      if (!source || !target) continue
      drawn.push({
        edge,
        sourceId,
        targetId,
        source: source.getBoundingClientRect(),
        target: target.getBoundingClientRect(),
      })
    }

    // Every string leaves its card from the same place, so it needs the edges around it to fan
    // out: one card may have several children, and one waiting item may have several blockers.
    // Several strings may also arrive at one target. Collect those groups before drawing so no
    // two strings share a path.
    const outgoing = new Map<string, string[]>()
    const incoming = new Map<string, string[]>()
    const sides = new Map<string, ConnectionSide>()
    for (const item of drawn) {
      const side = dependentSide(item.source, item.target)
      sides.set(item.edge.id, side)
      const out = outgoing.get(item.sourceId) ?? []
      out.push(item.edge.id)
      outgoing.set(item.sourceId, out)
      const key = `${item.targetId}:${side}`
      const into = incoming.get(key) ?? []
      into.push(item.edge.id)
      incoming.set(key, into)
    }

    for (const item of drawn) {
      const side = sides.get(item.edge.id)!
      const out = outgoing.get(item.sourceId)!
      const into = incoming.get(`${item.targetId}:${side}`)!
      const curve = connectionCurve(
        item.source,
        item.target,
        bounds,
        side,
        out.indexOf(item.edge.id),
        out.length,
        into.indexOf(item.edge.id),
        into.length,
      )
      next.push({ ...item.edge, ...curve })
    }
    setSize({ width: content.offsetWidth, height: content.offsetHeight })
    setLines(next)
  }, [active, boardId, boardDetail, boundaryId, connectionScopeId, edges, filters, items, lanes, links, placements, reflow, contentRef])

  if (!active || lines.length === 0 || size.width === 0 || size.height === 0) return null

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
          id={`${arrowId}-hierarchy`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={HIERARCHY_COLOR} />
        </marker>
        <marker
          id={`${arrowId}-dependency`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={DEPENDENCY_COLOR} />
        </marker>
      </defs>
      {lines.map((line) => (
        <g
          key={`${line.kind}:${line.id}`}
          data-connection-link={line.id}
          data-connection-kind={line.kind}
          data-connection-from={line.from}
          data-connection-to={line.to}
        >
          <path
            d={line.d}
            fill="none"
            stroke={line.kind === 'hierarchy' ? HIERARCHY_COLOR : DEPENDENCY_COLOR}
            strokeWidth={line.kind === 'hierarchy' ? 2 : 2.5}
            strokeOpacity={line.kind === 'hierarchy' ? 0.75 : 0.9}
            strokeLinecap="round"
            markerEnd={`url(#${arrowId}-${line.kind})`}
          />
          {/* The circle says "this is where the string leaves the card". */}
          <circle
            data-connection-start={line.id}
            cx={line.x1}
            cy={line.y1}
            r={CONNECTION_START_RADIUS}
            fill="#ffffff"
            stroke={line.kind === 'hierarchy' ? HIERARCHY_COLOR : DEPENDENCY_COLOR}
            strokeWidth={2}
          />
        </g>
      ))}
    </svg>
  )
}

/** How far inside the target's edge a string lands, and how far apart two arrivals are spread. */
const CONNECTION_INSET = 14
const CONNECTION_SPREAD = 20
/** The start of a dependency sits on the card, not on its edge; the end overlaps the target edge. */
const CONNECTION_START_INSET = 12
const CONNECTION_END_INSET = 4
const CONNECTION_START_RADIUS = 4
/** Blue is structure, red is a blocker: two readings, not two shades of one. */
const HIERARCHY_COLOR = '#2563eb'
const DEPENDENCY_COLOR = '#dc2626'

/**
 * The side of the target a connection naturally arrives at.
 *
 * Every string leaves its card from its bottom-left. A target below is entered through its top
 * edge, one above through its bottom edge, and one beside it through the side that faces it. The
 * dominant axis decides, which keeps the line from crossing the card to reach a farther edge.
 */
function dependentSide(source: DOMRect, target: DOMRect): ConnectionSide {
  const dx = target.left + target.width / 2 - (source.left + source.width / 2)
  const dy = target.top + target.height / 2 - (source.top + source.height / 2)
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? 'top' : 'bottom'
  return dx >= 0 ? 'left' : 'right'
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * A connection string: out of the source's **bottom-left**, into the near edge of the target.
 *
 * The start sits a little inside the card rather than on its corner, so the line reads as starting
 * from the work; the circle there says so. The end sits a little inside the target's edge too, so
 * the arrowhead overlaps the card rather than stopping at its border.
 *
 * Every string on a card starts at the same point, which is what makes the graph readable at a
 * glance — the eye can find where a card's strings leave. A source with several children or
 * blockers fans its control point so the strings separate immediately; a target with several
 * arrivals spreads them along the edge, so two strings never land on the same spot. Both ends stay
 * cubic and leave/enter along the card's edge rather than at an arbitrary angle.
 */
function connectionCurve(
  source: DOMRect,
  target: DOMRect,
  bounds: DOMRect,
  side: ConnectionSide,
  outIndex: number,
  outCount: number,
  inIndex: number,
  inCount: number,
) {
  const sx = source.left - bounds.left
  const sy = source.top - bounds.top
  const tx = target.left - bounds.left
  const ty = target.top - bounds.top

  const startInset = Math.min(CONNECTION_START_INSET, source.width / 3, source.height / 3)
  const startX = sx + startInset
  const startY = sy + source.height - startInset
  const spread = inCount > 1 ? (inIndex - (inCount - 1) / 2) * CONNECTION_SPREAD : 0

  // The arrival stays near the source's own x (or y), clamped inside the target's edge. A card
  // directly below receives the line near its top-left rather than through its middle, and several
  // arrivals are separated along the same edge.
  let endX = tx + target.width / 2
  let endY = ty + target.height / 2
  if (side === 'top' || side === 'bottom') {
    endX = clamp(startX + spread, tx + CONNECTION_INSET, tx + target.width - CONNECTION_INSET)
    endY = side === 'top' ? ty : ty + target.height
  } else {
    endY = clamp(startY + spread, ty + CONNECTION_INSET, ty + target.height - CONNECTION_INSET)
    endX = side === 'left' ? tx : tx + target.width
  }

  // The arrow lands a little inside the target, so the point reads as belonging to the card
  // rather than stopping at its border.
  const endInset = Math.min(CONNECTION_END_INSET, target.width / 4, target.height / 4)
  if (side === 'top') endY += endInset
  else if (side === 'bottom') endY -= endInset
  else if (side === 'left') endX += endInset
  else endX -= endInset

  const dx = endX - startX
  const dy = endY - startY
  const span = Math.hypot(dx, dy)
  const bend = clamp(span * 0.3, 28, 96)
  const fan = outCount > 1 ? (outIndex - (outCount - 1) / 2) * CONNECTION_SPREAD : 0
  const c1x = startX + fan
  const c1y = startY + bend
  const approach = clamp(span * 0.16, 18, 56)
  const c2x =
    side === 'left' ? endX - approach : side === 'right' ? endX + approach : endX
  const c2y =
    side === 'top' ? endY - approach : side === 'bottom' ? endY + approach : endY

  return {
    x1: startX,
    y1: startY,
    x2: endX,
    y2: endY,
    d: `M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${endX} ${endY}`,
  }
}
