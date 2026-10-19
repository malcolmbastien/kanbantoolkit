import { cn } from '@/lib/utils'

/**
 * The recessed shape a lift leaves behind.
 *
 * Full width, because that is what a card is: a card fills its lane. The gap used to carry the
 * *dragged* card's own width, which was right only while the pointer stayed in the lane it came
 * from — columns are sized by what is in them, so the moment a drag crossed into a narrower or a
 * wider column the shadow was the wrong shape for the place it was offering.
 *
 * The height is still the card's own, and that is the measurement the gap is really about: an
 * initiative carrying a parent chip and a blocked row is taller than a plain card, and a card
 * wearing a checklist is taller still.
 *
 * Both surfaces draw it — the cards workflow's lanes and the initiatives workflow's cells — so
 * there is one answer to what a lift leaves behind, rather than two that can drift apart.
 */
export function DropGap({ height }: { height?: number }) {
  return (
    <div
      data-drop-placeholder
      className={cn(
        'w-full shrink-0 rounded-md bg-slate-900/[0.08] shadow-[inset_0_2px_6px_rgba(15,23,42,0.12)] ring-1 ring-inset ring-slate-900/10',
        // The lift always knows the card's height; this is only so the shape stays sane if a
        // measurement ever goes missing.
        height === undefined && 'min-h-[112px]',
      )}
      style={height === undefined ? undefined : { height }}
    />
  )
}
