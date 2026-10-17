import { memo, useEffect, useRef, useState } from 'react'
import { ArrowUp, Ban, Check, Clock, CornerDownRight, Focus, Layers, Link2, ListChecks, MoreHorizontal, ShieldAlert, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BUCKET_DOT, chipColors, tintOn } from '@/lib/colors'
import { initialsOf } from '@/domain/users'
import { STALE_AFTER_DAYS } from '@/domain/filters'
import type { InitiativeType } from '@/domain/types'
import { PriorityBadge } from './PriorityBadge'
import type { IssueType, Item, Stage, User } from '@/domain/types'

export interface CardSummary {
  childCount: number
  /** Cards that depend on this one (unresolved). */
  dependentsCount: number
  /** Distinct item-to-item links (dependencies + dependents). */
  linksCount: number
  /** How long the card has sat in its lane, when known. Shown only past a threshold. */
  ageDays?: number
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
  /** Every leaf below is done — the card, or the initiative, is finished. See `DoneStamp`. */
  done?: boolean
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
  /**
   * An initiative's kind, already resolved (`initiativeTypeById`), and the board's list to pick
   * from. Given only on the initiatives surface: a card has no kind, and `onSetKind` being absent
   * is what says so — so nothing renders on the cards workflow.
   */
  kind?: InitiativeType
  kinds?: InitiativeType[]
  onSetKind?: (kindId: string | undefined) => void
  /** Lens: 'self' | 'in' (lineage) | 'out' (dimmed). */
  lens?: 'self' | 'in' | 'out'
  onLens?: (id: string) => void
  /** Native HTML5 drag (cards workflow). */
  draggable?: boolean
  /**
   * Notified with the item's id while a native drag is in flight, and `null` when it ends.
   * `dataTransfer` is not readable during `dragover`, so the id has to travel out of band.
   */
  onDragStateChange?: (itemId: string | null) => void
  /**
   * Lift the card with the pointer instead of a native drag, and hand the press to the
   * surface. A native drag is cancelled the moment its source element leaves the document,
   * and taking the card out of its lane is the whole point of the lift.
   */
  onLift?: (e: React.PointerEvent, itemId: string) => void
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

/**
 * A finished thing, stamped.
 *
 * The rule behind it is `rollupOf(...).bucket === 'done'`, which is the same one the board
 * arranges its sections by — so the stamp can never disagree with the column it sits in, and it
 * never claims completion early: a parent with one leaf still open is not done, however much of
 * the rest of it is.
 *
 * One mark, and the card's own surface is left alone. A Done column is already tinted, and
 * re-tinting every card in it would make the most finished part of the board the loudest; a
 * watermark would eat into the legibility the type scale bought.
 */
function DoneStamp() {
  return (
    <span
      className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-500 text-white shadow-sm ring-1 ring-emerald-600/30"
      title="Done — every leaf below this is finished"
    >
      <Check size={11} strokeWidth={3} />
    </span>
  )
}

const barColor = (pct?: number) => (pct === undefined ? '#cbd5e1' : pct >= 100 ? '#10b981' : pct > 0 ? '#6366f1' : '#cbd5e1')

/**
 * The keyboard half of a card.
 *
 * A card is a **group**, not a button: it holds its own controls (the actions menu, the parent
 * chip, the lens), and ARIA forbids interactive children inside a button. So it is a focusable
 * group with a name — Enter or Space opens it, Shift+F10 (or the Menu key) opens its menu, which
 * is exactly what those two gestures do with a mouse.
 */
const cardKeyboard = (
  item: Item,
  locked: boolean | undefined,
  onOpen: (id: string) => void,
  onContextMenu: ((id: string, x: number, y: number) => void) | undefined,
) => ({
  role: 'group' as const,
  'aria-label': item.title,
  tabIndex: locked ? -1 : 0,
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (locked) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(item.id)
    } else if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
      if (!onContextMenu) return
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      onContextMenu(item.id, Math.round(r.left + 24), Math.round(r.top + 24))
    }
  },
})

/** The ring a focused card wears — inside, so the board's geometry does not move. */
const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500'

function CardBase({ item, type, ref_, summary, parent, wide, symbols, kind, kinds, onSetKind, blockedTone = 'detail', lens, onLens, draggable, onDragStateChange, locked, selected, boundary, multi, dimmed, users, onOpen, onMultiSelect, onContextMenu, onLift }: Props) {
  const dragProps =
    draggable && !locked
      ? onLift
        ? {
            // The lift is ours rather than the browser's. A native drag is cancelled the
            // moment its source element leaves the document — and taking the card out of its
            // lane is the whole point — so the press is followed with the pointer instead.
            // See `startLift` in BoardCanvas.
            onPointerDown: (e: React.PointerEvent) => {
              if (e.button !== 0) return
              onLift(e, item.id)
            },
          }
        : {
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
  // (indigo-600) > item selection (indigo-400) > lens.
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
  //
  // A card's *own* blocked state is a full-width bar, not a chip: it is the loudest thing
  // that can be true of a card, and a chip the size of the link count reads as metadata.
  // The rolled-up counts stay chips, because they are metadata.
  const blockedChip = item.blocked ? (
    // A narrow card has no room for anything but the loudest possible statement, so it is
    // a bar across the card. A wide card has the room for a badge, and the initiative's
    // blocked state is what a reader scans for — so it is a solid pill, the same weight of
    // red either way.
    wide ? (
      <span
        className="flex shrink-0 items-center gap-1 rounded bg-rose-600 px-2 py-0.5 text-micro font-bold uppercase tracking-wide text-white"
        title={item.blockedReason ? `Blocked — ${item.blockedReason}` : 'Blocked'}
      >
        <Ban size={11} /> blocked
      </span>
    ) : (
      <span
        className="flex w-full items-center justify-center gap-1 rounded bg-rose-600 px-2 py-0.5 text-micro font-bold uppercase tracking-wide text-white"
        title={item.blockedReason ? `Blocked — ${item.blockedReason}` : 'Blocked'}
      >
        <Ban size={11} /> blocked{item.blockedReason ? ` · ${item.blockedReason}` : ''}
      </span>
    )
  ) : summary.blockedBelow > 0 ? (
    // Rolled up: a solid pill on the initiative, so a blockage anywhere beneath it reads
    // at a glance rather than as another piece of metadata. The aggregate tone stays
    // softer in colour for a top-level initiative, but keeps the same weight of shape.
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-micro font-bold text-white',
        blockedTone === 'aggregate' ? 'bg-amber-500' : 'bg-rose-600',
      )}
      title={
        blockedTone === 'aggregate'
          ? `${summary.blockedBelow} blocked below — rolled up from team cards`
          : `${summary.blockedBelow} blocked below`
      }
    >
      <Ban size={11} /> {summary.blockedBelow} blocked
    </span>
  ) : null

  const lensButton = onLens && !locked ? (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onLens(item.id)
      }}
      className={cn(
        'shrink-0 rounded p-0.5 transition',
        lens ? 'text-indigo-600 opacity-100' : 'text-slate-600 opacity-0 group-hover:opacity-100 hover:text-indigo-600',
      )}
      title="Focus — highlight this initiative's lineage"
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
      return (
      <div
        {...dragProps}
        {...cardKeyboard(item, locked, onOpen, onContextMenu)}
        data-card-id={item.id}
        // The wide card is the initiative, and it never had a context menu — the narrow one has
        // had one all along.
        onContextMenu={(e) => {
          if (locked || !onContextMenu) return
          e.preventDefault()
          e.stopPropagation()
          onContextMenu(item.id, e.clientX, e.clientY)
        }}
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
          FOCUS_RING,
          // On touch: a vertical swipe still scrolls the board (the browser takes it, and the
          // lift aborts on `pointercancel`), while a horizontal swipe is the drag. Both axes
          // ours would make the board unscrollable from a card; both the browser's would make
          // a card undraggable.
          draggable && !locked && 'touch-pan-y',
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
          {/* header row — every card on this surface is an initiative, so the *type* chip is
              redundant; the ref and the rollup % carry the identification. The kind chip is not
              redundant: it is the board's own label for this initiative, and it reads first
              because it is a category. Unset means absent, so nothing renders without one. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {kind && onSetKind && !locked && <KindChip kind={kind} kinds={kinds ?? []} onSet={onSetKind} />}
            <span className="text-micro font-semibold tabular-nums text-slate-600">{ref_}</span>
            {item.size ? <span className="text-micro tabular-nums text-slate-600">· {item.size}</span> : null}
            <span className="ml-auto flex items-center gap-1.5">
              {summary.done && <DoneStamp />}
              <PriorityBadge priority={item.priority} />
              {summary.dependentsCount > 0 && (
                <span className="flex items-center gap-0.5 rounded bg-amber-500 px-1 py-px text-micro font-bold text-white" title={`${summary.dependentsCount} depend on this`}>
                  <ShieldAlert size={9} /> {summary.dependentsCount}
                </span>
              )}
              {pct !== undefined && (
                <span
                  className="text-body font-bold tabular-nums"
                  style={{ color: pct >= 100 ? '#059669' : pct > 0 ? '#4f46e5' : '#94a3b8' }}
                  title="Rollup — share of leaf work done"
                >
                  {pct}%
                </span>
              )}
            </span>
            {lensButton}
          </div>

          <div className="line-clamp-2 break-words text-body font-semibold leading-snug text-slate-900">{item.title}</div>

          {/* Roll-up: a team initiative linked under a top-level initiative. */}
          {parent && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onOpen(parent.id)
              }}
              title={`Rolls up to ${parent.type.name} ${parent.ref_}: ${parent.title} — click to open`}
              className="flex w-fit max-w-full items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-left transition hover:border-indigo-300 hover:bg-indigo-100"
            >
              <ArrowUp size={11} className="shrink-0 text-indigo-400" />
              <span className="hidden shrink-0 text-micro font-bold uppercase tracking-wide text-indigo-500 @[340px]:inline">rolls up to</span>
              <span className="min-w-0 truncate text-micro font-medium text-indigo-700">{parent.title}</span>
            </button>
          )}

          {/* meta row — secondary detail appears only once the column is wide enough to
              hold it (container queries on the card root). Warnings never hide. */}
          <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 text-micro text-slate-600">
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
                {symbols.length > 8 && <span className="font-semibold text-slate-600">+{symbols.length - 8}</span>}
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
              <span className="hidden text-slate-600 @[360px]:inline">{summary.openDescendants} open below</span>
            )}
            <span className="ml-auto flex items-center gap-2">
              {assignees.length > 0 && (
                <span className="flex items-center gap-0.5">
                  {assignees.slice(0, 3).map((u) => (
                    <Avatar key={u.id} user={u} />
                  ))}
                  {assignees.length > 3 && (
                    <span className="text-micro font-semibold text-slate-600" title={assignees.map((u) => u.name).join(', ')}>
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
      {...cardKeyboard(item, locked, onOpen, onContextMenu)}
      data-card-id={item.id}
      style={{
        backgroundColor: tintOn(type.color, 0.1),
        borderLeftColor: type.color,
        // Lifted: out of the lane's flow, so the cards below close up behind it — but still
        // mounted, because `dragend` has to reach a card that is in the document.
        //
        // These two properties and nothing more. A drag source that the browser can no longer
        // hit-test cancels the drag on the spot — `dragstart` is followed immediately by
        // `dragend` and no drop is ever offered. `visibility: hidden`, `pointer-events: none`,
        // a negative `z-index` and a collapsed box all do exactly that; `opacity: 0` does not,
        // because it changes only what is painted. Transparent is not the same as gone.

      }}
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
        'group relative flex min-h-[112px] w-[180px] shrink-0 flex-col overflow-hidden rounded-md border border-t-2 border-slate-300/80 border-l-[4px] text-left shadow-sm transition',
        FOCUS_RING,
        draggable && !locked && 'touch-pan-y',
        locked ? 'cursor-default' : 'cursor-pointer hover:shadow-md hover:border-slate-400',
        lensCls,
        lockCls,
        dimCls,
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col px-1.5 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 whitespace-nowrap rounded px-1 py-px text-micro font-bold uppercase tracking-wide shadow-sm" style={{ ...(() => { const c = chipColors(type.color); return { backgroundColor: c.background, color: c.color } })() }}>
            {type.name}
          </span>
          <span className="shrink-0 whitespace-nowrap text-micro font-semibold tabular-nums text-slate-600">
            {ref_}
            {item.size ? ` · ${item.size}` : ''}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {summary.done && <DoneStamp />}
            {summary.ageDays !== undefined && summary.ageDays >= STALE_AFTER_DAYS && (
              <span
                className="flex shrink-0 items-center gap-0.5 font-semibold text-amber-600"
                title={`${summary.ageDays} days in this lane`}
              >
                <Clock size={11} /> {summary.ageDays}d
              </span>
            )}
            <PriorityBadge priority={item.priority} />
            {summary.rollupPercent !== undefined && (
              <span className="rounded bg-slate-700 px-1 py-px text-micro font-bold text-white" title="Rollup — share of leaf work done">
                {summary.rollupPercent}%
              </span>
            )}
            {summary.dependentsCount > 0 && (
              <span className="flex items-center gap-0.5 rounded bg-amber-500 px-1 py-px text-micro font-bold text-white shadow-sm" title={`${summary.dependentsCount} card${summary.dependentsCount === 1 ? '' : 's'} depend on this`}>
                <ShieldAlert size={9} />
                {summary.dependentsCount}
              </span>
            )}
            {multi && (
              <span
                className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-indigo-600 text-white shadow-sm"
                title="Selected"
              >
                <Check size={10} strokeWidth={3} />
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
                className="shrink-0 rounded text-slate-600 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 hover:text-slate-700 pointer-coarse:-m-1.5 pointer-coarse:p-1.5 pointer-coarse:opacity-100"
                title="More actions"
                aria-label="Card actions"
              >
                <MoreHorizontal size={13} />
              </button>
            )}
          </span>
        </div>
        <div className="mt-1 line-clamp-2 text-meta font-semibold leading-snug text-slate-900">{item.title}</div>
        {parent && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              // Shift+click still selects the card — the chip is part of it.
              if (e.shiftKey && onMultiSelect) onMultiSelect(item.id)
              else onOpen(parent.id)
            }}
            title={`Rolls up to ${parent.type.name} ${parent.ref_}: ${parent.title} — click to open, shift+click to select`}
            className="mt-1 flex w-full items-center gap-1 rounded border border-slate-300/70 bg-white/60 px-1 py-0.5 text-left transition hover:border-slate-400 hover:bg-white"
          >
            {/* The arrow says what the chip is; the title says which initiative. The type, its
                colour dot and the reference all used to sit here too, and between them they
                left the title too little room to be read — so they moved into the tooltip. */}
            <CornerDownRight size={10} className="shrink-0 text-slate-400" />
            <span className="min-w-0 truncate text-micro font-medium text-slate-600">{parent.title}</span>
          </button>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-micro text-slate-600">
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
                <span className="text-micro font-semibold text-slate-600" title={assignees.map((u) => u.name).join(', ')}>
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
      className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-slate-700 text-micro font-bold text-white"
      title={user.name}
    >
      {initialsOf(user.name)}
    </span>
  )
}

/**
 * When a card can be skipped.
 *
 * A board re-renders every card it draws whenever anything about the board changes — a filter, a
 * selection, a lane's WIP — and with two hundred cards on screen that is two hundred React
 * commits, which is where the time goes (measured: React's commit phase, not the derivations).
 * Most of those cards are unchanged, and this says so by comparing everything a card draws.
 *
 * The callbacks are deliberately *not* compared. That is safe because the only ones that could
 * go stale — the drag gesture and where it lands — read the newest state through a ref rather
 * than through their own closure (see `dragRef` in BoardCanvas). Everything else is a store
 * action, which never changes.
 */
export function cardPropsEqual(a: Props, b: Props): boolean {
  // An item is immutable: the store replaces it rather than mutating it, so a new reference is
  // a real change and the same reference is not.
  if (a.item !== b.item || a.type !== b.type || a.users !== b.users) return false
  if (a.ref_ !== b.ref_ || a.wide !== b.wide || a.blockedTone !== b.blockedTone) return false
  if (a.draggable !== b.draggable || a.locked !== b.locked || a.lens !== b.lens) return false
  if (a.selected !== b.selected || a.boundary !== b.boundary || a.multi !== b.multi || a.dimmed !== b.dimmed) return false
  if (a.parent?.id !== b.parent?.id || a.parent?.title !== b.parent?.title || a.parent?.ref_ !== b.parent?.ref_) return false
  // The kind is drawn, so a change to it re-renders. The list is the board's own array, which the
  // store replaces only when it changes — `onSetKind` is ignored like the other callbacks.
  if (a.kind?.id !== b.kind?.id || a.kind?.name !== b.kind?.name || a.kind?.color !== b.kind?.color) return false
  if (a.kinds !== b.kinds) return false
  if (a.symbols?.length !== b.symbols?.length) return false
  if (a.symbols && b.symbols && a.symbols.some((sym, i) => sym.bucket !== b.symbols![i].bucket || sym.title !== b.symbols![i].title)) return false
  return summaryEqual(a.summary, b.summary)
}

const summaryEqual = (a: CardSummary, b: CardSummary) =>
  a.childCount === b.childCount &&
  a.dependentsCount === b.dependentsCount &&
  a.linksCount === b.linksCount &&
  a.blockedBelow === b.blockedBelow &&
  a.openDescendants === b.openDescendants &&
  a.rollupPercent === b.rollupPercent &&
  a.done === b.done &&
  a.ageDays === b.ageDays &&
  a.checklist?.done === b.checklist?.done &&
  a.checklist?.total === b.checklist?.total

/**
 * An initiative's kind, on its face, with the picker behind it.
 *
 * Businessmap changes the type by clicking the icon on the card, and that is the better
 * affordance: the label is where the reading happens, so it is where the changing should happen
 * too — no trip to the panel to change a word. The list is the board's own, plus the kind this
 * initiative already carries if that came from another board, so the control never lies about
 * what the item says.
 */
function KindChip({ kind, kinds, onSet }: { kind: InitiativeType; kinds: InitiativeType[]; onSet: (id: string | undefined) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const options = kinds.some((k) => k.id === kind.id) ? kinds : [...kinds, kind]
  const chip = chipColors(kind.color)
  const choose = (id: string | undefined) => {
    onSet(id)
    setOpen(false)
  }

  return (
    <span ref={ref} className="relative shrink-0">
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        style={{ backgroundColor: chip.background, color: chip.color }}
        className="rounded px-1 py-px text-micro font-bold uppercase tracking-wide shadow-sm transition hover:brightness-95"
        title={`Kind: ${kind.name} — click to change it`}
        aria-label={`Kind: ${kind.name}`}
      >
        {kind.name}
      </button>
      {open && (
        <span className="absolute left-0 top-full z-30 mt-1 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-0.5 shadow-lg">
          {[undefined, ...options.map((k) => k.id)].map((id) => {
            const option = id === undefined ? undefined : options.find((k) => k.id === id)
            const on = id === undefined ? false : id === kind.id
            return (
              <button
                key={id ?? 'none'}
                onClick={(e) => {
                  e.stopPropagation()
                  choose(id)
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-meta transition hover:bg-slate-50',
                  on ? 'font-semibold text-indigo-700' : 'text-slate-700',
                )}
              >
                {option && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: chipColors(option.color).background }} />}
                <span className="min-w-0 flex-1 truncate">{option?.name ?? 'None'}</span>
                {on && <Check size={11} className="shrink-0" />}
              </button>
            )
          })}
        </span>
      )}
    </span>
  )
}

/** A card that does not re-render when nothing about it changed. See `cardPropsEqual`. */
export const Card = memo(CardBase, cardPropsEqual)
