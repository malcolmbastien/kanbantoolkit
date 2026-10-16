import { Fragment } from 'react'

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
 * The initiatives workflow drops into a *cell* rather than at a position: its cells have no
 * order, so a card at a position would be meaningless there. The gesture is shared — `useCardLift`
 * — and only where the card lands differs.
 */
export function DropColumn({
  laneId,
  items,
  draggingId,
  at,
  footer,
}: {
  laneId: string
  /** The cards in this lane, in order. */
  items: Array<{ id: string; node: React.ReactNode }>
  /** The card in the air, if any — lifted out, so the lane previews where the drop lands. */
  draggingId?: string | null
  /** The gap currently shown in this lane, if any. */
  at?: number | null
  footer?: React.ReactNode
}) {
  // The lifted card has left the lane — it is drawn in the air by DragLayer — so the gap is
  // counted among the cards that are left, which is the list a drop lands in.
  const remaining = draggingId ? items.filter((i) => i.id !== draggingId) : items

  // A shadow, not a box: the lifted card is the thing you are holding, so what it leaves
  // behind is the shape it will occupy — recessed, the way a shadow is.
  const placeholder = (
    <div
      data-drop-placeholder
      className="min-h-[112px] w-[180px] shrink-0 rounded-md bg-slate-900/[0.08] shadow-[inset_0_2px_6px_rgba(15,23,42,0.12)] ring-1 ring-inset ring-slate-900/10"
    />
  )

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
