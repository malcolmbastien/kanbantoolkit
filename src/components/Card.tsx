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
}

export interface CardParent {
  id: string
  ref_: string
  title: string
  type: IssueType
}

interface Props {
  item: Item
  type: IssueType
  ref_: string
  depth: number
  summary: CardSummary
  parent?: CardParent
  selected?: boolean
  onOpen: (id: string) => void
}

export function Card({ item, type, ref_, depth, summary, parent, selected, onOpen }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    data: { itemId: item.id },
  })

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
        'group relative cursor-pointer overflow-hidden rounded-md border border-t-2 border-slate-300/80 border-l-[4px] text-left shadow-sm transition',
        'hover:shadow-md hover:border-slate-400',
        selected && 'ring-2 ring-indigo-400',
        isDragging && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-1 px-1.5 py-1.5">
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
            <span
              className="rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide shadow-sm"
              style={{ backgroundColor: type.color, color: readableOn(type.color) }}
            >
              {type.name}
            </span>
            <span className="text-[10px] font-semibold tabular-nums text-slate-500">
              {ref_}
              {item.size ? ` · ${item.size}` : ''}
            </span>
            <span
              className="text-[9px] font-bold text-slate-400"
              title={`Structural depth ${depth} (derived from parent/child)`}
            >
              d{depth}
            </span>
            {summary.blocksCount > 0 && (
              <span
                className="ml-auto flex items-center gap-0.5 rounded bg-amber-500 px-1 py-px text-[9px] font-bold text-white shadow-sm"
                title={`Blocks ${summary.blocksCount} items`}
              >
                <ShieldAlert size={9} />
                {summary.blocksCount}
              </span>
            )}
          </div>
          <div className="mt-1 line-clamp-2 text-[12px] font-semibold leading-snug text-slate-900">
            {item.title}
          </div>
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
              <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                {parent.type.name}
              </span>
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
              <span className="ml-auto grid h-4 w-4 place-items-center rounded-full bg-slate-700 text-[8px] font-bold text-white">
                {item.assignee}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
