import { Link2 } from 'lucide-react'
import { DEP_STATE_STYLES } from '@/lib/colors'
import { cn } from '@/lib/utils'
import type { DependencyInfo } from '@/domain/derive'
import type { IssueType } from '@/domain/types'

interface Props {
  dep: DependencyInfo
  dependencyType: IssueType
  boardName: string
  /** This pin's dependency is the one being inspected. */
  selected: boolean
  /** How many local cards wait on this dependency (the pin names the first). */
  dependentCount: number
  /** Select/clear this dependency, highlighting the local cards that wait on it. */
  onSelect: (dependencyId: string) => void
  onOpen: (id: string) => void
}

/** A card shown where it does not belong: no column, no WIP count, dashed. */
export function BoundaryPin({ dep, dependencyType, boardName, selected, dependentCount, onSelect, onOpen }: Props) {
  const state = DEP_STATE_STYLES[dep.state]
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(dep.dependency.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(dep.dependency.id)
        }
      }}
      title={selected ? 'Clear highlight' : 'Highlight the cards on this board that wait on this'}
      className={cn(
        'w-full cursor-pointer rounded-md border border-dashed border-slate-400 bg-white px-2 py-1.5 text-left shadow-sm transition hover:border-slate-500 hover:shadow-md',
        selected && 'border-solid border-amber-400 bg-amber-50 ring-2 ring-amber-300',
      )}
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        <Link2 size={10} /> waiting on
        <button
          onClick={(e) => {
            e.stopPropagation()
            onOpen(dep.dependency.id)
          }}
          className="ml-auto rounded px-1 text-[9px] font-semibold normal-case text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
          title="Open this dependency"
        >
          open ↗
        </button>
      </div>
      <div className="mt-0.5 text-[12px] font-medium leading-snug text-slate-700">{dep.dependency.title}</div>
      <div className="text-[10px] text-slate-400">
        {dependencyType.name} · {boardName}
      </div>
      <div className="mt-1 flex items-center gap-1">
        <span className={cn('rounded px-1 py-px text-[9px] font-semibold ring-1', state.className)}>
          {state.label}
        </span>
        <span className="text-[9px] text-slate-400">
          for {dep.dependent.title}
          {dependentCount > 1 ? ` +${dependentCount - 1} more` : ''}
        </span>
      </div>
    </div>
  )
}
