import { CornerDownRight, Link2 } from 'lucide-react'
import { DEP_STATE_STYLES } from '@/lib/colors'
import { cn } from '@/lib/utils'
import type { DependencyInfo } from '@/domain/derive'
import type { Item, Scope } from '@/domain/types'

interface Props {
  dep: DependencyInfo
  pin?: Item
  scopes: Scope[]
  onOpen: (id: string) => void
}

/**
 * A card shown where it does not belong: no type pill, no column, no WIP count.
 * Dashed left border; opens the item in the side panel scoped to its own board.
 */
export function BoundaryPin({ dep, pin, scopes, onOpen }: Props) {
  const stream = scopes.find((s) => s.id === dep.blocker.valueStreamId)?.name ?? '—'
  const state = DEP_STATE_STYLES[dep.state]

  return (
    <button
      onClick={() => onOpen(dep.blocker.id)}
      className={cn(
        'w-full rounded-md border border-dashed border-slate-300 bg-slate-50/70 px-2 py-1.5 text-left transition',
        'hover:border-slate-400 hover:bg-white',
      )}
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        <Link2 size={10} />
        waiting on
      </div>
      <div className="mt-0.5 text-[12px] font-medium leading-snug text-slate-700">
        {dep.blocker.title}
      </div>
      <div className="text-[10px] text-slate-400">
        {stream} · {dep.blocker.type}
      </div>
      {pin && (
        <div className="mt-1 flex items-center gap-1 rounded bg-white px-1 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200">
          <CornerDownRight size={10} />
          pin: {pin.title}
        </div>
      )}
      <div className="mt-1 flex items-center gap-1">
        <span className={cn('rounded px-1 py-px text-[9px] font-semibold ring-1', state.className)}>
          {state.label}
        </span>
        <span className="text-[9px] text-slate-400">for {dep.dependent.title}</span>
      </div>
    </button>
  )
}
