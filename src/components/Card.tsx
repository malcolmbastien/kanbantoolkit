import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Ban, CornerDownRight, GripVertical, Layers, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { hexToRgba, readableOn } from '@/lib/colors'
import type { IssueType, Item } from '@/domain/types'

export interface CardSummary {
  childCount: number
  blockedCount: number
  blocksCount: number
  openDescendants: number
  /** For parents: % of leaf descendants done (derived rollup). */
  rollupPercent?: number
}

/** The decomposition parent of a card, for the on-card lineage label. */
export interface CardParent {
  id: string
  ref_: string
  title: string
  type: IssueType
}

export interface CardSymbol {
  bucket: 'notStarted' | 'inProgress' | 'done'
  title: string
}

interface Props {
  item: Item
  type: IssueType
  ref_: string
  depth: number
  summary: CardSummary
  parent?: CardParent
  /** Wide "summary" card for management/initiative boards: progress bar + symbols. */
  wide?: boolean
  symbols?: CardSymbol[]
  selected?: boolean
  onOpen: (id: string) => void
}

const BUCKET_DOT: Record<CardSymbol['bucket'], string> = {
  notStarted: 'bg-slate-300',
  inProgress: 'bg-indigo-400',
  done: 'bg-emerald-500',
}

const barColor = (pct?: number) => (pct === undefined ? '#cbd5e1' : pct >= 100 ? '#10b981' : pct > 0 ? '#6366f1' : '#cbd5e1')

export function Card({ item, type, ref_, depth, summary, parent, wide, symbols, selected, onOpen }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    data: { itemId: item.id },
  })

  if (wide) {
    return (
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Translate.toString(transform) }}
        onClick={(e) => {
          e.stopPropagation()
          onOpen(item.id)
        }}
        className={cn(
          'group relative flex w-[300px] shrink-0 cursor-pointer flex-col overflow-hidden rounded-md border border-slate-300 bg-white text-left shadow-sm transition',
          'hover:shadow-md hover:border-slate-400',
          selected && 'ring-2 ring-indigo-400',
          isDragging && 'opacity-40',
        )}
      >
        {/* progress bar */}
        <div className="h-1.5 w-full bg-slate-200">
          <div className="h-full transition-all" style={{ width: `${summary.rollupPercent ?? 0}%`, backgroundColor: barColor(summary.rollupPercent) }} />
        </div>
        <div className="p-2">
          <div className="flex items-center gap-1.5">
            <span
              className="rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide"
              style={{ backgroundColor: type.color, color: readableOn(type.color) }}
            >
              {type.name}
            </span>
            <span className="text-[10px] font-semibold tabular-nums text-slate-400">{ref_}</span>
            {summary.rollupPercent !== undefined && (
              <span className="ml-auto text-[11px] font-bold" style={{ color: summary.rollupPercent >= 100 ? '#059669' : summary.rollupPercent > 0 ? '#4f46e5' : '#94a3b8' }}>
                {summary.rollupPercent}%
              </span>
            )}
          </div>
          <div className="mt-1 line-clamp-2 text-[13px] font-semibold leading-snug text-slate-900">{item.title}</div>

          {/* linked-initiative symbols */}
          {symbols && symbols.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1" title={`${symbols.length} linked team initiatives`}>
              {symbols.slice(0, 14).map((s, i) => (
                <span key={i} className={cn('h-2.5 w-2.5 rounded-sm', BUCKET_DOT[s.bucket])} title={s.title} />
              ))}
              {symbols.length > 14 && <span className="text-[9px] font-semibold text-slate-400">+{symbols.length - 14}</span>}
            </div>
          )}

          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-500">
            {summary.childCount > 0 && (
              <span className="flex items-center gap-0.5" title={`${summary.childCount} linked initiatives`}>
                <Layers size={11} />
                {summary.childCount}
              </span>
            )}
            {summary.blockedCount > 0 && (
              <span className="flex items-center gap-0.5 font-bold text-rose-600"><Ban size={11} />blocked</span>
            )}
            {item.assignee && (
              <span className="ml-auto grid h-4 w-4 place-items-center rounded-full bg-slate-700 text-[8px] font-bold text-white">{item.assignee}</span>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        backgroundColor: hexToRgba(type.color, 0.1),
        borderLeftColor: type.color,
      }}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(item.id)
      }}
      className={cn(
        'group relative flex h-[112px] w-[180px] shrink-0 cursor-pointer flex-col overflow-hidden rounded-md border border-t-2 border-slate-300/80 border-l-[4px] text-left shadow-sm transition',
        'hover:shadow-md hover:border-slate-400',
        selected && 'ring-2 ring-indigo-400',
        isDragging && 'opacity-40',
      )}
    >
      <div className="flex h-full items-start gap-1 px-1.5 py-1.5">
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 cursor-grab text-slate-400/70 opacity-0 transition group-hover:opacity-100 active:cursor-grabbing"
          aria-label="Drag card"
        >
          <GripVertical size={12} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide shadow-sm" style={{ backgroundColor: type.color, color: readableOn(type.color) }}>
              {type.name}
            </span>
            <span className="text-[10px] font-semibold tabular-nums text-slate-500">
              {ref_}
              {item.size ? ` · ${item.size}` : ''}
            </span>
            <span className="text-[9px] font-bold text-slate-400" title={`Structural depth ${depth} (derived from parent/child)`}>
              d{depth}
            </span>
            {summary.rollupPercent !== undefined && (
              <span className="rounded bg-slate-700 px-1 py-px text-[9px] font-bold text-white" title="Rollup — share of leaf work done">
                {summary.rollupPercent}%
              </span>
            )}
            {summary.blocksCount > 0 && (
              <span className="ml-auto flex items-center gap-0.5 rounded bg-amber-500 px-1 py-px text-[9px] font-bold text-white shadow-sm" title={`Blocks ${summary.blocksCount} items`}>
                <ShieldAlert size={9} />
                {summary.blocksCount}
              </span>
            )}
          </div>
          <div className="mt-1 line-clamp-2 text-[12px] font-semibold leading-snug text-slate-900">{item.title}</div>
          {parent && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onOpen(parent.id)
              }}
              title={`Parent ${parent.type.name}: ${parent.title}`}
              className="mt-1 flex w-full items-center gap-1 rounded border border-slate-300/70 bg-white/60 px-1 py-0.5 text-left transition hover:border-slate-400 hover:bg-white"
            >
              <CornerDownRight size={10} className="shrink-0 text-slate-400" />
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: parent.type.color }} aria-hidden />
              <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-500">{parent.type.name}</span>
              <span className="min-w-0 truncate text-[10px] font-medium text-slate-600">
                <span className="tabular-nums text-slate-400">{parent.ref_}</span> {parent.title}
              </span>
            </button>
          )}
          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
            {summary.childCount > 0 && (
              <span className="flex items-center gap-0.5" title={`${summary.childCount} children`}>
                <Layers size={11} />
                {summary.childCount}
              </span>
            )}
            {summary.blockedCount > 0 && (
              <span className="flex items-center gap-0.5 font-bold text-rose-600" title={`Blocked by ${summary.blockedCount}`}>
                <Ban size={11} />
                blocked
              </span>
            )}
            {summary.openDescendants > 0 && summary.childCount > 0 && (
              <span className="text-slate-500" title="Open descendants (composition pressure)">
                {summary.openDescendants} open below
              </span>
            )}
            {item.assignee && (
              <span className="ml-auto grid h-4 w-4 place-items-center rounded-full bg-slate-700 text-[8px] font-bold text-white">{item.assignee}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
