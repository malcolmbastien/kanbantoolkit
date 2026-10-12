import { ArrowUp, Ban, Check, Clock, CornerDownRight, Focus, Layers, Link2, ListChecks, MoreHorizontal, ShieldAlert, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BUCKET_DOT, hexToRgba, readableOn } from '@/lib/colors'
import { initialsOf } from '@/domain/users'
import type { IssueType, Item, Stage, User } from '@/domain/types'

export interface CardSummary {
  childCount: number
  /** Cards that depend on this one (unresolved). */
  dependentsCount: number
  /** Distinct item-to-item links (dependencies + dependents). */
  linksCount: number
  /** Descendants (any depth) explicitly blocked and still open — rolled up. */
  blockedBelow: number
  /**
   * Committed, but leaves below it are still in Backlog. A warning to raise, never a
   * block — see `uncommittedBelow` in the domain.
   */
  uncommittedBelow?: number
  openDescendants: number
  /** For parents: % of leaf descendants done (derived rollup). */
  rollupPercent?: number
  /** Checklist progress inside the card (sub-tasks). */
  checklist?: { done: number; total: number }
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
  /** The people directory, to resolve `item.assignees` ids to names / initials. */
  users?: User[]
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
  /**
   * Highlighted as part of the focused initiative's work. Softer than the selection ring,
   * so a filtered board reads as "these are the cards in scope" rather than "selected".
   */
  focused?: boolean
  /**
   * Notified with the item's id while a native drag is in flight, and `null` when it
   * ends. A surface needs this to know *what* is being dragged — `dataTransfer` is not
   * readable during `dragover` — so it can mark only the valid drop targets.
   */
  onDragStateChange?: (itemId: string | null) => void
  /** Locked (edit mode): no drag, no click-to-open, no lens. */
  locked?: boolean
  selected?: boolean
  /** Highlighted because it waits on the selected boundary-lane dependency. */
  boundary?: boolean
  /** Part of the multi-select group (shift+click). */
  multi?: boolean
  /** Dimmed because another card is part of the active multi-select group. */
  dimmed?: boolean
  onOpen: (id: string) => void
  /** Shift+click — start/extend the multi-select group. */
  onMultiSelect?: (id: string) => void
  /** Right-click (or the ⋯ button) — open the card context menu at (x, y). */
  onContextMenu?: (id: string, x: number, y: number) => void
}

const barColor = (pct?: number) => (pct === undefined ? '#cbd5e1' : pct >= 100 ? '#10b981' : pct > 0 ? '#6366f1' : '#cbd5e1')

export function Card({ item, type, ref_, depth, summary, parent, wide, symbols, blockedTone = 'detail', lens, onLens, draggable, onDragStateChange, focused, locked, selected, boundary, multi, dimmed, users, onOpen, onMultiSelect, onContextMenu }: Props) {
  const dragProps =
    draggable && !locked
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData('text/plain', item.id)
            e.dataTransfer.effectAllowed = 'move'
            onDragStateChange?.(item.id)
          },
          onDragEnd: () => onDragStateChange?.(null),
        }
      : {}

  // Highlight priority: a selected boundary dependency (amber) > multi-select
  // (indigo-600) > item selection (indigo-400) > lens > focus.
  const lensCls = cn(
    lens === 'out' ? 'opacity-40 saturate-50' : '',
    boundary
      ? 'ring-2 ring-amber-400'
      : multi
        ? 'ring-2 ring-indigo-600'
        : selected
          ? 'ring-2 ring-indigo-400'
          : lens === 'in'
            ? 'ring-2 ring-indigo-400'
            : lens === 'self'
              ? 'ring-2 ring-indigo-600'
              : focused
                ? 'ring-2 ring-indigo-300'
                : '',
  )
  const lockCls = locked ? 'opacity-50 saturate-75' : ''
  // While a multi-select group is active, the cards outside it recede.
  const dimCls = dimmed ? 'opacity-40 saturate-50' : ''
  const assignees = (item.assignees ?? [])
    .map((id) => users?.find((u) => u.id === id))
    .filter((u): u is User => Boolean(u))

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
      title="Focus — narrow the board to this initiative's cards"
    >
      <Focus size={11} />
    </button>
  ) : null

  const checklist = summary.checklist
  const hasChecklist = Boolean(checklist && checklist.total > 0)
  const checklistDone = checklist?.done ?? 0
  const checklistTotal = checklist?.total ?? 0
  const checklistPct = checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : 0

  if (wide) {
    const pct = summary.rollupPercent
    const days = Math.max(0, Math.floor((Date.now() - item.createdAt) / 86_400_000))
    return (
      <div
        {...dragProps}
        data-card-id={item.id}
        onClick={(e) => {
          e.stopPropagation()
          if (locked) return
          if (e.shiftKey && onMultiSelect) onMultiSelect(item.id)
          else onOpen(item.id)
        }}
        className={cn(
          // `@container` lets the card shed detail as its column narrows (see the
          // `@[Npx]:` variants below) instead of overflowing a customised flow.
          '@container group relative flex w-full flex-col overflow-hidden rounded-md border border-slate-300 bg-white text-left shadow-sm transition',
          locked ? 'cursor-default' : 'cursor-pointer hover:shadow-md hover:border-slate-400',
          lensCls,
          lockCls,
          dimCls,
        )}
      >
        {/* progress bar */}
        <div className="h-1.5 w-full bg-slate-200">
          <div className="h-full transition-all" style={{ width: `${pct ?? 0}%`, backgroundColor: barColor(pct) }} />
        </div>

        <div className="flex flex-1 flex-col gap-1.5 p-2.5">
          {/* header row — every card on this surface is an initiative, so the type chip
              is redundant; the ref and the rollup % carry the identification. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10px] font-semibold tabular-nums text-slate-400">{ref_}</span>
            {item.size ? <span className="text-[10px] tabular-nums text-slate-400">· {item.size}</span> : null}
            <span className="ml-auto flex items-center gap-1.5">
              {summary.dependentsCount > 0 && (
                <span className="flex items-center gap-0.5 rounded bg-amber-500 px-1 py-px text-[9px] font-bold text-white" title={`${summary.dependentsCount} depend on this`}>
                  <ShieldAlert size={9} /> {summary.dependentsCount}
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

          <div className="line-clamp-2 break-words text-[13px] font-semibold leading-snug text-slate-900">{item.title}</div>

          {/* Roll-up: a team initiative linked under a top-level initiative. */}
          {parent && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onOpen(parent.id)
              }}
              title={`Rolls up to ${parent.type.name}: ${parent.title}`}
              className="flex w-fit max-w-full items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-left transition hover:border-indigo-300 hover:bg-indigo-100"
            >
              <ArrowUp size={11} className="shrink-0 text-indigo-400" />
              <span className="hidden shrink-0 text-[9px] font-bold uppercase tracking-wide text-indigo-500 @[340px]:inline">rolls up to</span>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: parent.type.color }} aria-hidden />
              <span className="min-w-0 truncate text-[10px] font-medium text-indigo-700">
                <span className="tabular-nums text-indigo-400">{parent.ref_}</span> {parent.title}
              </span>
            </button>
          )}

          {/* meta row — secondary detail appears only once the column is wide enough to
              hold it (container queries on the card root). Warnings never hide. */}
          <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-slate-500">
            {boundary && (
              <span
                className="flex items-center gap-0.5 font-semibold text-amber-600"
                title="Waiting on an external dependency — see the boundary lane"
              >
                <Link2 size={11} /> waiting on
              </span>
            )}
            {symbols && symbols.length > 0 && (
              <span className="hidden items-center gap-1 @[260px]:flex" title={`${symbols.length} linked items`}>
                {symbols.slice(0, 8).map((s, i) => (
                  <span key={i} className={cn('h-2.5 w-2.5 rounded-sm', BUCKET_DOT[s.bucket])} title={s.title} />
                ))}
                {symbols.length > 8 && <span className="font-semibold text-slate-400">+{symbols.length - 8}</span>}
              </span>
            )}
            {summary.childCount > 0 && (
              <span className="hidden items-center gap-0.5 @[320px]:flex" title={`${summary.childCount} linked items`}>
                <Layers size={11} /> {summary.childCount}
              </span>
            )}
            {summary.linksCount > 0 && (
              <span className="hidden items-center gap-0.5 @[320px]:flex" title={`${summary.linksCount} linked item${summary.linksCount > 1 ? 's' : ''}`}>
                <Link2 size={11} /> {summary.linksCount}
              </span>
            )}
            {summary.checklist && summary.checklist.total > 0 && (
              <span
                className={cn('hidden items-center gap-0.5 @[300px]:flex', summary.checklist.done === summary.checklist.total && 'font-semibold text-emerald-600')}
                title={`Checklist — ${summary.checklist.done} of ${summary.checklist.total} done`}
              >
                <ListChecks size={11} /> {summary.checklist.done}/{summary.checklist.total}
              </span>
            )}
            {blockedChip}
            {(summary.uncommittedBelow ?? 0) > 0 && (
              <span
                className="flex items-center gap-0.5 rounded bg-amber-100 px-1 py-px font-semibold text-amber-800 ring-1 ring-amber-300"
                title={`${summary.uncommittedBelow} card${summary.uncommittedBelow === 1 ? '' : 's'} below are still in Backlog — this initiative is committed, so its work should be too`}
              >
                <TriangleAlert size={11} /> {summary.uncommittedBelow}
                <span className="hidden @[300px]:inline">uncommitted below</span>
              </span>
            )}
            {summary.openDescendants > 0 && summary.childCount > 0 && (
              <span className="hidden text-slate-400 @[360px]:inline">{summary.openDescendants} open below</span>
            )}
            <span className="ml-auto flex items-center gap-2">
              <span className="hidden items-center gap-0.5 @[300px]:flex" title="Time since created">
                <Clock size={11} /> {days}d
              </span>
              {assignees.length > 0 && (
                <span className="flex items-center gap-0.5">
                  {assignees.slice(0, 3).map((u) => (
                    <Avatar key={u.id} user={u} />
                  ))}
                  {assignees.length > 3 && (
                    <span className="text-[9px] font-semibold text-slate-400" title={assignees.map((u) => u.name).join(', ')}>
                      +{assignees.length - 3}
                    </span>
                  )}
                </span>
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
      data-card-id={item.id}
      style={{ backgroundColor: hexToRgba(type.color, 0.1), borderLeftColor: type.color }}
      onClick={(e) => {
        e.stopPropagation()
        if (locked) return
        if (e.shiftKey && onMultiSelect) onMultiSelect(item.id)
        else onOpen(item.id)
      }}
      onContextMenu={(e) => {
        if (locked || !onContextMenu) return
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(item.id, e.clientX, e.clientY)
      }}
      className={cn(
        'group relative flex h-[112px] w-[180px] shrink-0 flex-col overflow-hidden rounded-md border border-t-2 border-slate-300/80 border-l-[4px] text-left shadow-sm transition',
        locked ? 'cursor-default' : 'cursor-pointer hover:shadow-md hover:border-slate-400',
        lensCls,
        lockCls,
        dimCls,
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col px-1.5 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 whitespace-nowrap rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide shadow-sm" style={{ backgroundColor: type.color, color: readableOn(type.color) }}>
            {type.name}
          </span>
          <span className="shrink-0 whitespace-nowrap text-[10px] font-semibold tabular-nums text-slate-500">
            {ref_}
            {item.size ? ` · ${item.size}` : ''}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {summary.rollupPercent !== undefined && (
              <span className="rounded bg-slate-700 px-1 py-px text-[9px] font-bold text-white" title="Rollup — share of leaf work done">
                {summary.rollupPercent}%
              </span>
            )}
            {summary.dependentsCount > 0 && (
              <span className="flex items-center gap-0.5 rounded bg-amber-500 px-1 py-px text-[9px] font-bold text-white shadow-sm" title={`${summary.dependentsCount} card${summary.dependentsCount === 1 ? '' : 's'} depend on this`}>
                <ShieldAlert size={9} />
                {summary.dependentsCount}
              </span>
            )}
            {multi ? (
              <span
                className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-indigo-600 text-white shadow-sm"
                title="Selected"
              >
                <Check size={10} strokeWidth={3} />
              </span>
            ) : (
              <span className="text-[9px] font-bold text-slate-400" title={`Structural depth ${depth} (derived from parent/child)`}>
                d{depth}
              </span>
            )}
            {lensButton}
            {onContextMenu && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  const r = e.currentTarget.getBoundingClientRect()
                  onContextMenu(item.id, r.right - 4, r.bottom + 4)
                }}
                className="shrink-0 rounded text-slate-400 opacity-0 transition group-hover:opacity-100 hover:text-slate-700"
                title="More actions"
                aria-label="Card actions"
              >
                <MoreHorizontal size={13} />
              </button>
            )}
          </span>
        </div>
        <div className="mt-1 line-clamp-2 text-[12px] font-semibold leading-snug text-slate-900">{item.title}</div>
        {parent && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              // Shift+click still selects the card — the chip is part of it.
              if (e.shiftKey && onMultiSelect) onMultiSelect(item.id)
              else onOpen(parent.id)
            }}
            title={`Parent ${parent.type.name}: ${parent.title} — click to open, shift+click to select`}
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
        <div className="mt-auto flex items-center gap-2 pt-1 text-[10px] text-slate-500">
          {boundary && (
            <span
              className="flex shrink-0 items-center gap-0.5 font-semibold text-amber-600"
              title="Waiting on an external dependency — see the boundary lane"
            >
              <Link2 size={11} /> waiting on
            </span>
          )}
          {hasChecklist && (
            <span
              className={cn('flex shrink-0 items-center gap-0.5', checklistDone === checklistTotal && 'font-semibold text-emerald-600')}
              title={`Checklist — ${checklistDone} of ${checklistTotal} done`}
            >
              <ListChecks size={11} />
              {checklistDone}/{checklistTotal}
            </span>
          )}
          {summary.linksCount > 0 && (
            <span className="flex shrink-0 items-center gap-0.5" title={`${summary.linksCount} linked item${summary.linksCount > 1 ? 's' : ''}`}>
              <Link2 size={11} />
              {summary.linksCount}
            </span>
          )}
          {summary.childCount > 0 && (
            <span
              className="flex shrink-0 items-center gap-0.5"
              title={`${summary.childCount} children${summary.openDescendants > 0 ? ` · ${summary.openDescendants} open` : ''}`}
            >
              <Layers size={11} />
              {summary.childCount}
            </span>
          )}
          {blockedChip}
          {assignees.length > 0 && (
            <span className="ml-auto flex shrink-0 items-center gap-0.5">
              {assignees.slice(0, 3).map((u) => (
                <Avatar key={u.id} user={u} />
              ))}
              {assignees.length > 3 && (
                <span className="text-[9px] font-semibold text-slate-500" title={assignees.map((u) => u.name).join(', ')}>
                  +{assignees.length - 3}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
      {multi && <span className="pointer-events-none absolute inset-0 bg-indigo-500/15" aria-hidden />}
      {hasChecklist && (
        <div className="h-[3px] w-full shrink-0 bg-slate-200" title={`Checklist ${checklistDone}/${checklistTotal}`}>
          <div
            className="h-full transition-all"
            style={{ width: `${checklistPct}%`, backgroundColor: checklistDone === checklistTotal ? '#10b981' : '#6366f1' }}
          />
        </div>
      )}
    </div>
  )
}

/** A user's avatar: their profile photo, or their initials when there is none. */
function Avatar({ user }: { user: User }) {
  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt={user.name} title={user.name} className="h-4 w-4 shrink-0 rounded-full object-cover" />
  }
  return (
    <span
      className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-slate-700 text-[8px] font-bold text-white"
      title={user.name}
    >
      {initialsOf(user.name)}
    </span>
  )
}
