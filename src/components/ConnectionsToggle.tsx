import { Waypoints } from 'lucide-react'
import { announce } from '@/lib/announce'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

/**
 * The Connections lens: every hierarchy and dependency edge on one board, drawn as a red string.
 *
 * It is a two-state reading, not a detail level: the board underneath keeps its counts, cards and
 * interactions, and turning the lens off leaves it exactly as it was. The choice is per person and
 * per board, remembered by this browser; the legend names the two line kinds while it is on.
 */
export function ConnectionsToggle({ boardId }: { boardId: string }) {
  const on = useStore((s) => s.connectionsOn[boardId] === true)
  const setBoardConnections = useStore((s) => s.setBoardConnections)

  const toggle = () => {
    setBoardConnections(boardId, !on)
    announce(on ? 'Connections hidden.' : 'Connections shown.')
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        data-connections-toggle
        aria-pressed={on}
        onClick={toggle}
        title={on ? 'Hide the hierarchy and dependency strings' : 'Show every hierarchy and dependency edge on this board'}
        className={cn(
          'flex items-center gap-1 rounded border px-2 py-0.5 text-meta font-medium transition',
          on
            ? 'border-rose-300 bg-rose-50 text-rose-700'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
        )}
      >
        <Waypoints size={11} aria-hidden /> Connections
      </button>

      {on && (
        <span data-connection-legend className="hidden items-center gap-2 text-micro text-slate-600 lg:inline-flex">
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="w-4 border-t-2 border-dashed border-rose-600" />
            Hierarchy
          </span>
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="w-4 border-t-2 border-rose-600" />
            Dependency
          </span>
        </span>
      )}
    </div>
  )
}
