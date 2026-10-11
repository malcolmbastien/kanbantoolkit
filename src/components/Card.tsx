import { Ban, Clock, CornerDownRight, Crosshair, GripVertical, Layers, Link2, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BUCKET_DOT, hexToRgba, readableOn } from '@/lib/colors'
import type { IssueType, Item, Stage } from '@/domain/types'

export interface CardSummary {
  childCount: number
  blocksCount: number
  /** Distinct item-to-item links (incoming + outgoing). */
  linksCount: number
  /** Descendants (any depth) explicitly blocked and still open — rolled up. */
  blockedBelow: number
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
  bucket: Stage
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
  /**
   * How blocked descendants roll up onto this card:
   * - `detail`   — precise, red (team initiative: "N blocked")
   * - `aggregate` — softened, amber (top-level: "N blocked below")
   */
  blockedTone?: 'detail' | 'aggregate'
  /** Lens: 'self' | 'in' (lineage) | 'out' (dimmed). */
  lens?: 'self' | 'in' | 'out'
  onLens?: (id: string) => void
  /** Native HTML5 drag (cards workflow). */
  draggable?: boolean
  /** Locked (edit mode): no drag, no click-to-open, no lens. */
  locked?: boolean
  selected?: boolean
  onOpen: (id: string) => void
}

const barColor = (pct?: number) => (pct === undefined ? '#cbd5e1' : pct >= 100 ? '#10b981' : pct > 0 ? '#6366f1' : '#cbd5e1')

export function Card({ item, type, ref_, depth, summary, parent, wide, symbols, blockedTone = 'detail', lens, onLens, draggable, locked, selected, onOpen }: Props) {
  const dragProps =
    draggable && !locked
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData('text/plain', item.id)
            e.dataTransfer.effectAllowed = 'move'
          },
        }
      : {}

  const lensCls =
    lens === 'out' ? 'opacity-40 saturate-50' : lens === 'in' ? 'ring-2 ring-indigo-400' : lens === 'self' ? 'ring-2 ring-indigo-600' : ''
  const lockCls = locked ? 'opacity-50 saturate-75' : ''

  // Blocked rolls up: the item's own status is precise; a count of blocked
  // descendants is what lets a team blockage surface on its initiative.
  const blockedChip = item.blocked ? (
    <span
      className="flex items-center gap-0.5 font-bold text-rose-600"
      title={item.blockedReason ? `Blocked — ${item.blockedReason}` : 'Blocked'}
    >
      <Ban size={11} /> blocked
    </span>
  ) : summary.blockedBelow > 0 ? (
    blockedTone === 'aggregate' ? (
      <span
        className="flex items-center gap-0.5 font-semibold text-amber-600"
        title={`${summary.blockedBelow} blocked below — rolled up from team cards`}
      >
        <Ban size={11} /> {summary.blockedBelow} blocked below
      </span>
    ) : (
      <span className="flex items-center gap-0.5 font-bold text-rose-600" title={`${summary.blockedBelow} blocked below`}>
        <Ban size={11} /> {summary.blockedBelow} blocked
      </span>
    )
  ) : null

  const lensButton = onLens && !locked ? (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onLens(item.id)
      }}
      className={cn(
        'shrink-0 rounded p-0.5 transition',
        lens ? 'text-indigo-600 opacity-100' : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-indigo-600',
      )}
      title="Focus lens — highlight this item's lineage"
    >
      <Crosshair size={11} />
    </button>
  ) : null

  if (wide) {
    const pct = summary.rollupPercent
    const days = Math.max(0, Math.floor((Date.now() - item.createdAt) / 86_400_000))
    return (
      <div
        {...dragProps}
        onClick={(e) => {
          e.stopPropagation()
          if (!locked) onOpen(item.id)
        }}
        className={cn(
          'group relative flex w-full flex-col overflow-hidden rounded-md border border-slate-300 bg-white text-left shadow-sm transition',
          locked ? 'cursor-default' : 'cursor-pointer hover:shadow-md hover:border-slate-400',
          selected && 'ring-2 ring-indigo-400',
          lensCls,
          lockCls,
        )}
      >
        {/* progress bar */}
        <div className="h-1.5 w-full bg-slate-200">
          <div className="h-full transition-all" style={{ width: `${pct ?? 0}%`, backgroundColor: barColor(pct) }} />
        </div>

        <div className="flex flex-1 flex-col gap-1.5 p-2.5">
          {/* header row */}
          <div className="flex items-center gap-2">
            <span className="rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide" style={{ backgroundColor: type.color, color: readableOn(type.color) }}>
              {type.name}
            </span>
            <span className="text-[10px] font-semibold tabular-nums text-slate-400">{ref_}</span>
            {item.size ? <span className="text-[10px] tabular-nums text-slate-400">· {item.size}</span> : null}
            <span className="ml-auto flex items-center gap-1.5">
              {summary.blocksCount > 0 && (
                <span className="flex items-center gap-0.5 rounded bg-amber-500 px-1 py-px text-[9px] font-bold text-white" title={`Blocks ${summary.blocksCount}`}>
                  <ShieldAlert size={9} /> {summary.blocksCount}
                </span>
              )}
              {pct !== undefined && (
                <span
                  className="text-[13px] font-bold tabular-nums"
                  style={{ color: pct >= 100 ? '#059669' : pct > 0 ? '#4f46e5' : '#94a3b8' }}
                  title="Rollup — share of leaf work done"
                >
                  {pct}%
                </span>
              )}
            </span>
            {lensButton}
          </div>

          <div className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-900">{item.title}</div>

          {/* meta row */}
          <div className="mt-auto flex items-center gap-3 text-[10px] text-slate-500">
            {symbols && symbols.length > 0 && (
              <span className="flex items-center gap-1" title={`${symbols.length} linked items`}>
                {symbols.slice(0, 16).map((s, i) => (
                  <span key={i} className={cn('h-2.5 w-2.5 rounded-sm', BUCKET_DOT[s.bucket])} title={s.title} />
                ))}
                {symbols.length > 16 && <span className="font-semibold text-slate-400">+{symbols.length - 16}</span>}
              </span>
            )}
            {summary.childCount > 0 && (
              <span className="flex items-center gap-0.5" title={`${summary.childCount} linked items`}>
                <Layers size={11} /> {summary.childCount}
              </span>
            )}
            {summary.linksCount > 0 && (
              <span className="flex items-center gap-0.5" title={`${summary.linksCount} linked item${summary.linksCount > 1 ? 's' : ''}`}>
                <Link2 size={11} /> {summary.linksCount}
              </span>
            )}
            {blockedChip}
            {summary.openDescendants > 0 && summary.childCount > 0 && (
              <span className="text-slate-400">{summary.openDescendants} open below</span>
            )}
            <span className="ml-auto flex items-center gap-2">
              <span className="flex items-center gap-0.5" title="Time since created">
                <Clock size={11} /> {days}d
              </span>
              {item.assignee && (
                <span className="grid h-4 w-4 place-items-center rounded-full bg-slate-700 text-[8px] font-bold text-white">{item.assignee}</span>
              )}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      {...dragProps}
      style={{ backgroundColor: hexToRgba(type.color, 0.1), borderLeftColor: type.color }}
      onClick={(e) => {
        e.stopPropagation()
        if (!locked) onOpen(item.id)
      }}
      className={cn(
        'group relative flex h-[112px] w-[180px] shrink-0 flex-col overflow-hidden rounded-md border border-t-2 border-slate-300/80 border-l-[4px] text-left shadow-sm transition',
        locked ? 'cursor-default' : 'cursor-pointer hover:shadow-md hover:border-slate-400',
        selected && 'ring-2 ring-indigo-400',
        lensCls,
        lockCls,
      )}
    >
      <div className="flex h-full items-start gap-1 px-1.5 py-1.5">
        {draggable && !locked && (
          <span
            className="mt-0.5 cursor-grab text-slate-300 opacity-0 transition group-hover:opacity-100"
            title="Drag to another lane"
            aria-hidden
          >
            <GripVertical size={12} />
          </span>
        )}
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
            {lensButton}
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
            {summary.linksCount > 0 && (
              <span className="flex items-center gap-0.5 text-slate-500" title={`${summary.linksCount} linked item${summary.linksCount > 1 ? 's' : ''}`}>
                <Link2 size={11} />
                {summary.linksCount}
              </span>
            )}
            {blockedChip}
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
