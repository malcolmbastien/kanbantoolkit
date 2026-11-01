import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The chevron at the left of a workflow's header.
 *
 * A workflow is a whole band — its name, its count and a body of columns. Folding one away keeps
 * the band readable while another gets the room, the same way a management band or a top-level
 * column folds. It is a view action, so it is offered to a viewer too and never waits for edit mode.
 */
export function WorkflowToggle({
  name,
  collapsed,
  onToggle,
  className,
}: {
  /** The workflow's own name — "Cards", "Initiatives workflow", "Boundary — waiting on". */
  name: string
  collapsed: boolean
  onToggle: (button: HTMLButtonElement) => void
  className?: string
}) {
  const verb = collapsed ? 'Expand' : 'Collapse'
  return (
    <button
      type="button"
      onClick={(event) => onToggle(event.currentTarget)}
      aria-expanded={!collapsed}
      aria-label={`${verb} ${name}`}
      title={`${verb} ${name}`}
      className={cn(
        'grid h-5 w-5 shrink-0 place-items-center rounded text-slate-600 transition hover:bg-white/70 hover:text-slate-900',
        className,
      )}
    >
      {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
    </button>
  )
}
