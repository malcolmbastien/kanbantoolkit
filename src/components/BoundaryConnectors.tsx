import { useEffect, useState, type RefObject } from 'react'

interface Props {
  /** The positioned container the SVG overlay covers. */
  containerRef: RefObject<HTMLDivElement | null>
  /** The external dependency currently in focus (null = draw nothing). */
  boundaryId: string | null
  /** Local cards that wait on it. */
  cardIds: string[]
}

interface Wire {
  id: string
  d: string
  endX: number
  endY: number
}

/**
 * Curved connectors from the focused boundary pin to each local card that waits
 * on it. Positions are measured from the DOM, so the wires re-run on scroll,
 * resize and container reflow (e.g. opening the item panel).
 *
 * Uses `useEffect` (not layout) because the parent row's ref is only attached
 * once effects run.
 */
export function BoundaryConnectors({ containerRef, boundaryId, cardIds }: Props) {
  const [wires, setWires] = useState<Wire[]>([])
  const key = cardIds.join(',')

  useEffect(() => {
    const container = containerRef.current
    if (!container || !boundaryId) {
      setWires([])
      return
    }

    const measure = () => {
      const base = container.getBoundingClientRect()
      const pin = container.querySelector<HTMLElement>(`[data-boundary-pin="${boundaryId}"]`)
      if (!pin) {
        setWires([])
        return
      }
      const pr = pin.getBoundingClientRect()
      const startX = pr.left - base.left
      const startY = pr.top - base.top + pr.height / 2
      const next: Wire[] = []
      for (const id of cardIds) {
        const card = container.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
        if (!card) continue
        const cr = card.getBoundingClientRect()
        const endX = cr.right - base.left
        const endY = cr.top - base.top + cr.height / 2
        const midX = (startX + endX) / 2
        next.push({ id, endX, endY, d: `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}` })
      }
      setWires(next)
    }

    measure()
    // Capture-phase scroll catches nested scrollers (the board area) too.
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
      ro.disconnect()
    }
    // `key` is the stable identity of `cardIds`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, boundaryId, key])

  if (!boundaryId || wires.length === 0) return null

  return (
    <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full" aria-hidden>
      {wires.map((w) => (
        <g key={w.id}>
          <path
            d={w.d}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            strokeLinecap="round"
            opacity={0.85}
          />
          <circle cx={w.endX} cy={w.endY} r={3} fill="#f59e0b" opacity={0.9} />
        </g>
      ))}
    </svg>
  )
}
