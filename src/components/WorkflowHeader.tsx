import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { WorkflowToggle } from './WorkflowToggle'

/**
 * The header of a workflow band — the shelf that names a flow, folds it away and carries its
 * count and design controls.
 *
 * One component for every flow on every board type. A team board's initiatives and cards flows, a
 * coordination board's own initiatives, each linked board's band, and the boundary workflow are
 * all the same thing to a reader: a named flow with a body beneath it. They used to be drawn in
 * several places, and drifted — a program board's headers were a rule rather than a shelf, so the
 * same workflow looked like a different kind of object depending on which board carried it. The
 * chrome lives here once; only the dot's colour (the band) and the slots change.
 *
 * The header is sticky by default: a flow can be taller than the board, and its name has to stay
 * in view while its columns scroll under it.
 */
export function WorkflowHeader({
  name,
  collapsed,
  onToggle,
  dot,
  title,
  description,
  right,
  titleId,
  sticky = true,
}: {
  /** The workflow's own name, used for the fold control's accessible label. */
  name: string
  collapsed?: boolean
  onToggle?: (button: HTMLButtonElement) => void
  /** The dot's colour class — the band a board belongs to, or the flow's own accent. */
  dot: string
  /** The heading itself. A ReactNode because a cards flow's name is edited in place. */
  title: ReactNode
  /** An optional line beside the name: what this flow is for, or which reading it is. */
  description?: ReactNode
  /** Counts and design controls, pinned right. */
  right?: ReactNode
  titleId?: string
  sticky?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg border border-slate-200/70 bg-white/80 px-3 py-1.5 backdrop-blur-sm',
        sticky && 'sticky top-0 z-20',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {onToggle && <WorkflowToggle name={name} collapsed={collapsed ?? false} onToggle={onToggle} />}
        <span className={cn('h-2 w-2 shrink-0 rounded-full', dot)} />
        <h2
          id={titleId}
          className="flex shrink-0 items-center text-body font-semibold uppercase tracking-wide text-slate-700"
        >
          {title}
        </h2>
        {description !== undefined && description !== null && (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {typeof description === 'string' ? (
              <span className="min-w-0 truncate text-meta text-slate-600">{description}</span>
            ) : (
              description
            )}
          </div>
        )}
      </div>
      {right && <div className="flex shrink-0 items-center gap-1">{right}</div>}
    </div>
  )
}
