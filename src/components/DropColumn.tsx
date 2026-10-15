import { Fragment, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * A lane's cards, as one drop target.
 *
 * There is a single insertion point, not a target per card. Hovering anywhere in the lane
 * resolves to the *gap* the card would land in, and that gap is shown as a placeholder — so
 * "below A" and "above B" are one place and look like one place, and the lane itself never
 * lights up as a second, competing target.
 *
 * The card in the air is lifted out of the flow while it is being dragged, so the lane shows
 * the result of the drop before it happens rather than after.
 *
 * The initiatives workflow keeps `DroppableCell` instead: its cells have no order, so a card
 * at a position would be meaningless there.
 */
export function DropColumn({
  laneId,
  enabled,
  items,
  draggingId,
  at,
  footer,
  onIndex,
  onLeave,
  onDrop,
}: {
  laneId: string
  enabled: boolean
  /** The cards in this lane, in order. */
  items: Array<{ id: string; node: React.ReactNode }>
  /** The card in the air, if any — lifted out so the lane previews where the drop lands. */
  draggingId?: string | null
  /** The gap currently shown in this lane, if any. */
  at?: number | null
  footer?: React.ReactNode
  onIndex: (laneId: string, index: number) => void
  onLeave: (laneId: string) => void
  onDrop: (itemId: string, laneId: string, index: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // The lifted card is still rendered — it is only out of the flow — so the gap is counted
  // among the cards that are left, which is the list a drop lands in.
  const remaining = draggingId ? items.filter((i) => i.id !== draggingId) : items
  const positionOf = new Map(remaining.map((item, i) => [item.id, i]))

  /**
   * Which gap the pointer is nearest, among the cards that would remain. The placeholder is
   * deliberately not one of them: it is the answer, not an input.
   */
  const indexAt = (clientY: number) => {
    const els = [...(ref.current?.querySelectorAll<HTMLElement>('[data-card-id]:not([data-lifted])') ?? [])]
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect()
      if (clientY < r.top + r.height / 2) return i
    }
    return els.length
  }

  // A shadow, not a box: the lifted card is the thing you are holding, so what it leaves
  // behind is the shape it will occupy — recessed, the way a shadow is.
  const placeholder = (
    <div
      data-drop-placeholder
      className="min-h-[112px] w-[180px] shrink-0 rounded-md bg-slate-900/[0.08] shadow-[inset_0_2px_6px_rgba(15,23,42,0.12)] ring-1 ring-inset ring-slate-900/10"
    />
  )

  return (
    <div
      ref={ref}
      data-lane-id={laneId}
      onDragOver={(e) => {
        if (!enabled) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const i = indexAt(e.clientY)
        if (at !== i) onIndex(laneId, i)
      }}
      onDragLeave={(e) => {
        // dragleave fires when the pointer crosses a child; only a real exit clears it.
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        onLeave(laneId)
      }}
      onDrop={(e) => {
        if (!enabled) return
        e.preventDefault()
        // Read the position from the drop itself, never from state that may not have
        // committed — a drop must not depend on a re-render having happened.
        const index = indexAt(e.clientY)
        const id = e.dataTransfer.getData('text/plain')
        onLeave(laneId)
        if (id) onDrop(id, laneId, index)
      }}
      className={cn('flex min-h-[96px] flex-1 flex-col gap-1 p-1 transition')}
    >
      {items.map((item) => {
        const pos = positionOf.get(item.id)
        return (
          <Fragment key={item.id}>
            {at === pos ? placeholder : null}
            {item.node}
          </Fragment>
        )
      })}
      {typeof at === 'number' && at >= remaining.length ? placeholder : null}
      {footer}
    </div>
  )
}
