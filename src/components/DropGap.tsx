import { cn } from '@/lib/utils'

/**
 * The recessed shape a lift leaves behind.
 *
 * It is the card's own outline: the placeholder is where the card *will be*, so it takes the
 * lifted card's measurements rather than a guess at a typical card. A fixed height reads as a
 * shadow that does not fit the card above it — an initiative carrying a parent chip and a
 * blocked row is taller than a plain card, and a card wearing a checklist is taller still, so
 * the guess was wrong on both surfaces the moment they drew anything but a plain card.
 *
 * Both surfaces draw it — the cards workflow's lanes and the initiatives workflow's cells — so
 * there is one answer to what a lift leaves behind, rather than two that can drift apart.
 */
export function DropGap({ width, height, full = false }: { width?: number; height?: number; full?: boolean }) {
  return (
    <div
      data-drop-placeholder
      className={cn(
        'shrink-0 rounded-md bg-slate-900/[0.08] shadow-[inset_0_2px_6px_rgba(15,23,42,0.12)] ring-1 ring-inset ring-slate-900/10',
        full ? 'w-full' : 'w-[180px]',
        // The lift always knows the card's size; these are only so the shape stays sane if a
        // measurement ever goes missing.
        height === undefined && 'min-h-[112px]',
      )}
      style={{
        ...(height === undefined ? {} : { height }),
        ...(!full && width !== undefined ? { width } : {}),
      }}
    />
  )
}
