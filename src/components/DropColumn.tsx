import { Fragment } from 'react'
import { DropGap } from './DropGap'

/**
 * A lane's cards, and the gap a lifted card would land in.
 *
 * There is a single insertion point, not a target per card. The pointer resolves to the *gap*
 * the card would land in, and that gap is shown as a placeholder — so "below A" and "above B"
 * are one place and look like one place, and the lane itself never lights up as a second,
 * competing target.
 *
 * The lane is not a drop target of its own: the board owns the drag, and finds the lane by its
 * `data-lane-id`. This only draws what the board decides.
 *
 * The initiatives workflow drops into a cell of its own section, and a cell's initiatives are
 * a rank a person orders — so its drag shows this same gap, and the drop writes the position.
 * The gesture is shared — `useCardLift` — and only where the card lands differs.
 */
export function DropColumn({
  laneId,
  items,
  draggingId,
  draggingSize,
  at,
  footer,
}: {
  laneId: string
  /** The cards in this lane, in order. */
  items: Array<{ id: string; node: React.ReactNode }>
  /** The card in the air, if any — lifted out, so the lane previews where the drop lands. */
  draggingId?: string | null
  /** The lifted card's measurements, so the gap is its shape rather than a guess at one. */
  draggingSize?: { width: number; height: number } | null
  /** The gap currently shown in this lane, if any. */
  at?: number | null
  footer?: React.ReactNode
}) {
  // The lifted card has left the lane — it is drawn in the air by DragLayer — so the gap is
  // counted among the cards that are left, which is the list a drop lands in.
  const remaining = draggingId ? items.filter((i) => i.id !== draggingId) : items

  // A shadow, not a box: the lifted card is the thing you are holding, so what it leaves
  // behind is the shape it will occupy — recessed, the way a shadow is, and the card's own
  // size, so a tall card does not leave a short shadow.
  const placeholder = <DropGap width={draggingSize?.width} height={draggingSize?.height} />

  return (
    <div data-lane-id={laneId} className="flex min-h-[96px] flex-1 flex-col gap-1 p-1 transition">
      {remaining.map((item, i) => (
        <Fragment key={item.id}>
          {at === i ? placeholder : null}
          {item.node}
        </Fragment>
      ))}
      {typeof at === 'number' && at >= remaining.length ? placeholder : null}
      {footer}
    </div>
  )
}
