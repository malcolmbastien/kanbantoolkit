import { ArrowUpRight } from 'lucide-react'
import { chipColors, DEP_STATE_STYLES, statusDot } from '@/lib/colors'
import { STAGE_LABELS } from '@/domain/lanes'
import { cn } from '@/lib/utils'
import type { DependencyInfo } from '@/domain/derive'
import type { IssueType, Stage } from '@/domain/types'

interface Props {
  dep: DependencyInfo
  dependencyType: IssueType
  boardName: string
  /** The dependency's own stage, the same rollup a card is chipped with. */
  stage: Stage
  /** …and whether it has started or finished, for the dot beside that stage. */
  status: { resolved: boolean; started: boolean }
  /** This pin's dependency is the one being inspected. */
  selected: boolean
  /** How many local cards wait on this dependency (the pin names the first). */
  dependentCount: number
  /** Select/clear this dependency, highlighting the local cards that wait on it. */
  onSelect: (dependencyId: string) => void
  onOpen: (id: string) => void
}

/** The tone of the link, as the pin's left edge — the one mark read before any words are. */
const STATE_EDGE: Record<string, string> = {
  Closed: 'border-l-slate-300',
  Satisfied: 'border-l-emerald-400',
  OpenPlanningRisk: 'border-l-amber-400',
  OpenLiveBlockage: 'border-l-rose-500',
}

/**
 * A card shown where it does not belong: no column, no WIP count.
 *
 * It reads in the same order a card does, because it is answering the same questions — what is
 * this, how far along is it, and what is it saying — with one of its own on top: *which of my
 * cards is waiting for it*. So: the type at the top left, the name at the size a name is read at,
 * the state of the link and the local card that waits on it above the rule, and the dependency's
 * own status and home below it. The lane already says "waiting on"; a pin saying it again, in a
 * heading, in the middle of its own name, was three labels for one fact.
 *
 * The left edge carries the link's tone, so a live blockage is visible at the rail's edge before
 * the card is read, and the card itself stays white — one accent, not a coloured block.
 */
export function BoundaryPin({
  dep,
  dependencyType,
  boardName,
  stage,
  status,
  selected,
  dependentCount,
  onSelect,
  onOpen,
}: Props) {
  const state = DEP_STATE_STYLES[dep.state]
  const type = chipColors(dependencyType.color)
  return (
    <div
      role="button"
      tabIndex={0}
      data-boundary-pin={dep.dependency.id}
      onClick={() => onSelect(dep.dependency.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(dep.dependency.id)
        }
      }}
      title={selected ? 'Clear highlight' : 'Highlight the cards on this board that wait on this'}
      className={cn(
        'w-full cursor-pointer rounded-xl border border-l-[3px] border-slate-200 bg-white px-2.5 py-2 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md',
        STATE_EDGE[dep.state] ?? 'border-l-slate-300',
        selected && 'border-amber-300 bg-amber-50/70 ring-2 ring-amber-300',
      )}
    >
      {/* What it is, and the way to it. */}
      <div className="flex items-center gap-1.5">
        <span
          className="shrink-0 rounded px-1.5 py-px text-micro font-bold uppercase tracking-wide"
          style={{ backgroundColor: type.background, color: type.color }}
        >
          {dependencyType.name}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onOpen(dep.dependency.id)
          }}
          className="ml-auto flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-micro font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          title="Open this dependency"
        >
          Open <ArrowUpRight size={11} className="shrink-0" />
        </button>
      </div>

      {/* The name, at the size a name is read at. */}
      <div className="mt-1 line-clamp-2 text-meta font-semibold leading-snug text-slate-900">{dep.dependency.title}</div>

      {/* What the link is doing, and which of this board's cards is waiting for it. The name
          wraps to its own line rather than being cut: it is the one thing this row is for. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className={cn('shrink-0 rounded px-1.5 py-px text-micro font-semibold ring-1', state.className)}>{state.label}</span>
        <span className="min-w-0 text-micro text-slate-600" title={`${dep.dependent.title} waits on it`}>
          {dep.dependent.title} waits on it{dependentCount > 1 ? ` · +${dependentCount - 1} more` : ''}
        </span>
      </div>

      {/* Under the rule, what a card puts under its rule: where it has got to, and where it lives. */}
      <div className="mt-1.5 flex items-center gap-1.5 border-t border-slate-200 pt-1.5 text-micro text-slate-600">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot(status))} />
        <span className="shrink-0 font-semibold text-slate-700">{STAGE_LABELS[stage]}</span>
        <span className="ml-auto min-w-0 truncate rounded-full bg-slate-100 px-2 py-0.5 font-medium" title={`This dependency sits on ${boardName}`}>
          {boardName}
        </span>
      </div>
    </div>
  )
}
