import { Link2 } from 'lucide-react'
import { DEP_STATE_STYLES } from '@/lib/colors'
import { cn } from '@/lib/utils'
import type { DependencyInfo } from '@/domain/derive'
import type { IssueType } from '@/domain/types'

interface Props {
  dep: DependencyInfo
  dependencyType: IssueType
  boardName: string
  onOpen: (id: string) => void
}

/** A card shown where it does not belong: no column, no WIP count, dashed. */
export function BoundaryPin({ dep, dependencyType, boardName, onOpen }: Props) {
  const state = DEP_STATE_STYLES[dep.state]
  return (
    <button
      onClick={() => onOpen(dep.dependency.id)}
      className="w-full rounded-md border border-dashed border-slate-400 bg-white px-2 py-1.5 text-left shadow-sm transition hover:border-slate-500 hover:shadow-md"
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        <Link2 size={10} /> waiting on
      </div>
      <div className="mt-0.5 text-[12px] font-medium leading-snug text-slate-700">{dep.dependency.title}</div>
      <div className="text-[10px] text-slate-400">
        {dependencyType.name} · {boardName}
      </div>
      <div className="mt-1 flex items-center gap-1">
        <span className={cn('rounded px-1 py-px text-[9px] font-semibold ring-1', state.className)}>
          {state.label}
        </span>
        <span className="text-[9px] text-slate-400">for {dep.dependent.title}</span>
      </div>
    </button>
  )
}
