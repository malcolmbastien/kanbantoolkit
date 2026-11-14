import { ArrowLeftRight } from 'lucide-react'
import { announce } from '@/lib/announce'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

/**
 * The Connections lens: every hierarchy and dependency edge on one board, drawn over the work.
 *
 * It is a two-state reading, not a detail level: the board underneath keeps its counts, cards and
 * interactions, and turning the lens off leaves it exactly as it was. The choice is per person and
 * per board, remembered by this browser; the legend names the two line kinds while it is on.
 */
/**
 * The legend that names the two strings while the lens is on.
 *
 * It is a sibling rather than part of the button: the board's right-hand controls are anchored to
 * the bar's right edge, so anything rendered *inside* that group after the legend's slot would
 * shift when it appeared. Placed at the group's far left, it grows into the existing empty space
 * and leaves Detail, Connections and everything to their right exactly where they were.
 */
export function ConnectionsLegend({ boardId }: { boardId: string }) {
  const on = useStore((s) => s.connectionsOn[boardId] === true)
  const scope = useStore((s) => s.connectionScopeId)
  if (!on && !scope) return null
  return (
    <span data-connection-legend className="hidden items-center gap-2 text-micro text-slate-600 xl:inline-flex">
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className="flex items-center">
          <span className="h-1.5 w-1.5 rounded-full border border-blue-600 bg-white" />
          <span className="w-2.5 border-t-2 border-blue-600" />
        </span>
        Hierarchy
      </span>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className="flex items-center">
          <span className="h-1.5 w-1.5 rounded-full border border-rose-600 bg-white" />
          <span className="w-2.5 border-t-2 border-rose-600" />
        </span>
        Dependency
      </span>
    </span>
  )
}

export function ConnectionsToggle({ boardId }: { boardId: string }) {
  const on = useStore((s) => s.connectionsOn[boardId] === true)
  const scope = useStore((s) => s.connectionScopeId)
  const setBoardConnections = useStore((s) => s.setBoardConnections)
  const setConnectionScope = useStore((s) => s.setConnectionScope)
  const active = on || Boolean(scope)

  const toggle = () => {
    setConnectionScope(null)
    setBoardConnections(boardId, !active)
    announce(active ? 'Connections hidden.' : 'Connections shown.')
  }

  return (
    <button
      type="button"
      data-connections-toggle
      aria-pressed={active}
      onClick={toggle}
      title={active ? 'Hide the hierarchy and dependency strings' : 'Show every hierarchy and dependency edge on this board'}
      className={cn(
        'flex shrink-0 items-center gap-1 rounded border px-2 py-0.5 text-meta font-medium transition',
        active
          ? 'border-rose-300 bg-rose-50 text-rose-700'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
      )}
    >
      <ArrowLeftRight size={11} aria-hidden /> Connections
    </button>
  )
}
