import { memo, useEffect, useRef, useState } from 'react'
import { Ban, Check, ChevronDown, Clock, CornerDownRight, Focus, Link2, ListChecks, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BUCKET_DOT, chipColors, FLAG_BADGE, FLAG_BADGE_SHAPE, softChipColors, tintOn } from '@/lib/colors'
import { STAGE_LABELS } from '@/domain/lanes'
import { initialsOf } from '@/domain/users'
import { STALE_AFTER_DAYS } from '@/domain/filters'
import type { HealthFlagInfo } from '@/domain/health'
import type { InitiativeType, Tag } from '@/domain/types'
import { PriorityBadge } from './PriorityBadge'
import type { IssueType, Item, Stage, User } from '@/domain/types'

export interface CardSummary {
  childCount: number
  /** Cards that depend on this one (unresolved). */
  dependentsCount: number
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
  title: string
  type: IssueType
}

export interface CardSymbol {
  /** The child this pip stands for — a pip is a way in to it, not only a status. */
  id: string
  bucket: Stage
  title: string
}

interface Props {
  item: Item
  type: IssueType
  summary: CardSummary
  /** The people directory, to resolve `item.assignees` ids to names / initials. */
  users?: User[]
  parent?: CardParent
  /** Wide "summary" card for management/initiative boards: progress bar + symbols. */
  wide?: boolean
  symbols?: CardSymbol[]
  /**
   * The initiative's health flags, as `initiativeHealth` finds them — the same rules, the same
   * words and the same tones the dashboard's Health column reads. Given only on the initiatives
   * surface: a card has no rollup, and the flags are all about what is below it.
   */
  flags?: HealthFlagInfo[]
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
  /** This item's tags, already resolved. A set, so the footer shows a few and counts the rest. */
  tags?: Tag[]
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
  /**
   * The initiative a card in the air would become a child of. Drawn as a ring, and drawn *over*
   * every other highlight: it is the thing about to happen, not the state the card is in.
   */
  dropTarget?: boolean
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
 * The badge a warning wears — the same shape and the same two weights the drawer's warnings
 * section uses, so the row on the card and the section in the drawer are visibly one set. The
 * words are `initiativeHealth`'s, and so is the title: a badge is never asked to explain itself in
 * its own vocabulary.
 */

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

function CardBase({ item, type, summary, parent, wide, symbols, flags, kind, kinds, onSetKind, tags, dropTarget, blockedTone = 'detail', lens, onLens, draggable, onDragStateChange, locked, selected, boundary, multi, dimmed, users, onOpen, onMultiSelect, onContextMenu, onLift }: Props) {
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

  // How long it has sat where it is, when that is long enough to be worth saying. Shown on the
  // card's own values line, beside the size and the people.
  const aged = summary.ageDays !== undefined && summary.ageDays >= STALE_AFTER_DAYS
  const checklist = summary.checklist
  const hasChecklist = Boolean(checklist && checklist.total > 0)
  const checklistDone = checklist?.done ?? 0
  const checklistTotal = checklist?.total ?? 0
  const checklistPct = checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : 0

  if (wide) {
    const pct = summary.rollupPercent
    // The children's own stages, in the columns' order — so the pips read left to right the way
    // the board does, and "how much green" is a glance rather than a count.
    const stageOrder: Stage[] = ['backlog', 'notStarted', 'inProgress', 'done']
    const pips = [...(symbols ?? [])].sort((a, b) => stageOrder.indexOf(a.bucket) - stageOrder.indexOf(b.bucket))
    const spread = stageOrder
      .map((stage) => ({ stage, n: pips.filter((p) => p.bucket === stage).length }))
      .filter((s) => s.n > 0)
      .map((s) => `${s.n} ${STAGE_LABELS[s.stage].toLowerCase()}`)
      .join(', ')
    const MAX_PIPS = 12
    // One set, one place. The health rules are the source — the same words and tones the
    // dashboard reads — with the two exceptions the card is responsible for: "nothing below" is
    // already said where the pips would be, and a blockage rolled up from team cards keeps the
    // softer tone the card has always given it, so a programme reader is not shouted at with a
    // fact three levels down. "Waiting on" joins them: it is the one warning the health rules do
    // not own, because it is about the item itself rather than the work below it.
    const badges: { key: string; label: string; why: string; tone: 'risk' | 'watch' }[] = [
      ...(flags ?? [])
        .filter((f) => f.flag !== 'unplanned')
        .map((f) => {
          const soft = f.flag === 'blocked' && blockedTone === 'aggregate'
          return {
            key: f.flag,
            label: soft ? `${summary.blockedBelow} blocked below` : f.label,
            why: soft ? `${summary.blockedBelow} blocked below — rolled up from team cards` : f.why,
            tone: soft ? ('watch' as const) : f.tone,
          }
        }),
      ...(summary.dependentsCount > 0
        ? [
            {
              key: 'dependents',
              label: `${summary.dependentsCount} ${summary.dependentsCount === 1 ? 'depends' : 'depend'} on it`,
              why: `${summary.dependentsCount} item${summary.dependentsCount === 1 ? '' : 's'} depend on this — if it slips, they are blocked`,
              tone: 'watch' as const,
            },
          ]
        : []),
      ...(boundary
        ? [
            {
              key: 'boundary',
              label: 'waiting on',
              why: 'Waiting on an external dependency — see the boundary lane',
              tone: 'watch' as const,
            },
          ]
        : []),
    ]

    return (
      <div
        {...dragProps}
        {...cardKeyboard(item, locked, onOpen, onContextMenu)}
        data-card-id={item.id}
        // The wide card is the initiative, and an initiative is what a card can roll up to — so
        // the marker is how a drop finds the cards that could be its target. A card is not one.
        data-card-initiative=""
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
          // `@container` lets the card shed detail as its column narrows (see the `@[Npx]:`
          // variants below) instead of overflowing a customised flow.
          '@container group relative flex w-full flex-col overflow-hidden rounded-lg border border-slate-300 bg-white text-left transition',
          FOCUS_RING,
          // On touch: a vertical swipe still scrolls the board (the browser takes it, and the
          // lift aborts on `pointercancel`), while a horizontal swipe is the drag. Both axes ours
          // would make the board unscrollable from a card; both the browser's would make a card
          // undraggable.
          draggable && !locked && 'touch-pan-y',
          locked ? 'cursor-default' : 'cursor-pointer hover:border-slate-400',
          lensCls,
          lockCls,
          dimCls,
          // Last, so it wins: `cn` keeps the last ring of the group, and the target is what the
          // gesture is about to do rather than what the card is.
          dropTarget && 'ring-2 ring-indigo-500',
        )}
      >
        {/* The kind, as a band across the top — the initiative's identity, and the one thing a
            card never has. */}
        {kind && <KindBand kind={kind} kinds={kinds ?? []} onSet={onSetKind} locked={locked} />}

        <div className="flex flex-1 flex-col gap-2 p-2.5">
          {/* What it rolls up to, above the title — the same place a card puts it. */}
          {parent && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onOpen(parent.id)
              }}
              title={`Rolls up to ${parent.type.name}: ${parent.title} — click to open`}
              className="flex min-w-0 items-center gap-1 text-left text-micro font-medium text-indigo-600 transition hover:text-indigo-700"
            >
              <CornerDownRight size={11} className="shrink-0 text-indigo-400" />
              <span className="min-w-0 truncate">{parent.title}</span>
            </button>
          )}

          {/* The title, at the size the reading happens at. Beside it the one small judgement it
              carries: priority. */}
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 line-clamp-3 break-words text-title font-semibold leading-snug text-slate-900">
              {item.title}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 pt-1">
              <PriorityBadge priority={item.priority} />
            </span>
          </div>

          {/* What is below it, and how far along: the children's own stages as pips, then the
              rollup. The bar underneath is the same number, wider. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-slate-600">
            {pips.length > 0 ? (
              <span className="flex items-center gap-1" title={`${pips.length} directly below: ${spread}`}>
                {pips.slice(0, MAX_PIPS).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    // A board carries one pip for every child of every initiative on it, so a tab
                    // stop each would put hundreds of stops between the top of a board and the
                    // cards below. The pip is a pointer shortcut; the keyboard path to a child is
                    // the card's own panel, which already lists them.
                    tabIndex={-1}
                    aria-label={`${p.title} — ${STAGE_LABELS[p.bucket]}`}
                    title={`${p.title} — ${STAGE_LABELS[p.bucket]}`}
                    onClick={(e) => {
                      // The pip is not the card: opening the child must not also open the
                      // initiative whose face the pip sits on.
                      e.stopPropagation()
                      onOpen(p.id)
                    }}
                    className={cn(
                      'h-4 w-4 shrink-0 rounded transition hover:brightness-90',
                      // A finger needs a bigger square than a pointer does, and the square is the
                      // hit area — so it grows, and the touch target is what you can see.
                      'pointer-coarse:h-6 pointer-coarse:w-6',
                      BUCKET_DOT[p.bucket],
                    )}
                  />
                ))}
                {pips.length > MAX_PIPS && <span className="font-semibold text-slate-600">+{pips.length - MAX_PIPS}</span>}
              </span>
            ) : (
              <span title="Nothing is broken down under this initiative yet">nothing below</span>
            )}
            {summary.childCount > 0 && (
              <span title={`${summary.childCount} item${summary.childCount === 1 ? '' : 's'} directly below`}>
                {summary.childCount} below
              </span>
            )}
            {summary.openDescendants > 0 && (
              <span title={`${summary.openDescendants} of the work below is still open — filed-away items aside`}>
                {summary.openDescendants} open
              </span>
            )}
            <span className="ml-auto flex items-center gap-1.5">
              {summary.done && <DoneStamp />}
              {pct !== undefined && (
                <span
                  className="text-body font-bold tabular-nums"
                  style={{ color: pct >= 100 ? '#059669' : pct > 0 ? '#4f46e5' : '#94a3b8' }}
                  title="Rollup — the share of leaf work done, weighted by size"
                >
                  {pct}%
                </span>
              )}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div className="h-full transition-all" style={{ width: `${pct ?? 0}%`, backgroundColor: barColor(pct) }} />
          </div>

          {/* The warnings, as one set of badges in one place — always here, between the work and
              the quiet footer, so a reader scanning a column knows where to look. Never hidden,
              and never softened into the metadata around them. */}
          {badges.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {badges.map((b) => (
                <span key={b.key} className={cn(FLAG_BADGE_SHAPE, FLAG_BADGE[b.tone])} title={b.why}>
                  {b.label}
                </span>
              ))}
            </div>
          )}

          {/* Everything else, quiet: tags, links, the checklist, the people. */}
          <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 text-micro text-slate-600">
            <TagChips tags={tags} />
            {summary.checklist && summary.checklist.total > 0 && (
              <span className="flex items-center gap-1.5" title={`Checklist — ${summary.checklist.done} of ${summary.checklist.total} sub-tasks done`}>
                <ListChecks size={11} />
                {summary.checklist.done} / {summary.checklist.total} sub-tasks
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                  <span
                    className="block h-full transition-all"
                    style={{
                      width: `${Math.round((summary.checklist.done / summary.checklist.total) * 100)}%`,
                      backgroundColor: summary.checklist.done === summary.checklist.total ? '#10b981' : '#6366f1',
                    }}
                  />
                </span>
              </span>
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
              {lensButton}
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
        // A whisper of the type, rather than a wash of it: the card's ground has to stand off a
        // lane that is tinted too, and half the types are neutrals — a 10% tint of slate on
        // slate-100 was a grey box on a grey ground.
        backgroundColor: tintOn(type.color, 0.06),
        // The outline is the type's own colour. A neutral hairline vanished into the neutral
        // lanes; this says which card is which before anything on it is read.
        borderColor: tintOn(type.color, 0.45),
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
        // Flat and quiet: a hairline border, the type as a rail down the left, and no shadow to
        // compete with the lane's own tint. What is loud on a card is its warnings, not its box.
        'group relative flex min-h-[104px] w-full flex-col overflow-hidden rounded-lg border border-l-[4px] text-left transition',
        FOCUS_RING,
        draggable && !locked && 'touch-pan-y',
        locked ? 'cursor-default' : 'cursor-pointer hover:shadow-sm',
        lensCls,
        lockCls,
        dimCls,
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 px-2 py-1.5">
        {/* What it belongs to, and what it is. The lineage reads first and the type sits at the
            edge — the two facts a card is placed by before it is read. */}
        <div className="flex items-center gap-1.5">
          {parent ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                // Shift+click still selects the card — the lineage is part of it.
                if (e.shiftKey && onMultiSelect) onMultiSelect(item.id)
                else onOpen(parent.id)
              }}
              title={`Rolls up to ${parent.type.name}: ${parent.title} — click to open, shift+click to select`}
              className="flex min-w-0 flex-1 items-center gap-1 text-left text-micro font-medium text-indigo-600 transition hover:text-indigo-700"
            >
              <CornerDownRight size={11} className="shrink-0 text-indigo-400" />
              <span className="min-w-0 truncate">{parent.title}</span>
            </button>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          <span
            className="shrink-0 whitespace-nowrap rounded px-1.5 py-px text-micro font-bold uppercase tracking-wide"
            style={{ ...(() => { const c = chipColors(type.color); return { backgroundColor: c.background, color: c.color } })() }}
          >
            {type.name}
          </span>
          <PriorityBadge priority={item.priority} />
        </div>

        {/* The title, at the size the reading happens at. */}
        <div className="line-clamp-2 text-meta font-semibold leading-snug text-slate-900">{item.title}</div>

        {/* How far along the checklist is: the count, then the bar the rest of the row. */}
        {hasChecklist && (
          <div className="flex items-center gap-2">
            <span
              className="flex shrink-0 items-center gap-1 text-meta font-semibold text-slate-700"
              title={`Checklist — ${checklistDone} of ${checklistTotal} sub-tasks done`}
            >
              <ListChecks size={13} className="shrink-0 text-slate-600" />
              {checklistDone} / {checklistTotal} sub-tasks
            </span>
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200" title={`${checklistPct}% of the checklist done`}>
              <span
                className="block h-full transition-all"
                style={{ width: `${checklistPct}%`, backgroundColor: checklistDone === checklistTotal ? '#10b981' : '#6366f1' }}
              />
            </span>
          </div>
        )}

        {/* The card's own values, on one line at the foot of it, in the order they are read: how
            long it has been sitting, what it is worth, the board's words for it, and who has it.
            Nothing here is a warning — those are above, where they cannot be mistaken for this. */}
        {(aged || Boolean(tags?.length) || item.size || assignees.length > 0) && (
          <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-200 pt-1.5 text-micro text-slate-600">
            {/* Both of these are outlined rather than filled: a light ground with the tone in the
                border keeps the row quiet while still saying which chip is which — a filled chip
                is what a *type* wears, and these are not the type. */}
            {aged && (
              <span
                className="flex shrink-0 items-center gap-1 rounded border border-amber-400 bg-amber-50 px-1.5 py-px font-semibold text-amber-800"
                title={`${summary.ageDays} days in this lane`}
              >
                <Clock size={11} /> {summary.ageDays}d
              </span>
            )}
            {item.size ? (
              <span
                className="shrink-0 rounded border bg-white px-1.5 py-px text-micro font-semibold tabular-nums text-slate-700"
                style={{ borderColor: tintOn(type.color, 0.6) }}
                title={`Estimate — ${item.size} point${item.size === 1 ? '' : 's'}`}
              >
                {item.size} pts
              </span>
            ) : null}
            <TagChips tags={tags} />
            <span className="ml-auto flex shrink-0 items-center gap-0.5">
              {assignees.slice(0, 3).map((u) => (
                <Avatar key={u.id} user={u} />
              ))}
              {assignees.length > 3 && (
                <span className="text-micro font-medium text-slate-600" title={assignees.map((u) => u.name).join(', ')}>
                  +{assignees.length - 3}
                </span>
              )}
              {lensButton}
            </span>
          </div>
        )}

        {/* The loud facts, together and above the quiet ones: a blockage, and the work that is
            waiting on this card. */}
        {blockedChip}
        {summary.dependentsCount > 0 && (
          <span
            className="flex w-fit items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-micro font-semibold text-amber-800 ring-1 ring-amber-300"
            title={`${summary.dependentsCount} card${summary.dependentsCount === 1 ? '' : 's'} depend on this`}
          >
            <ShieldAlert size={11} /> {summary.dependentsCount} depend on it
          </span>
        )}

        {/* Below the values, the two marks that are not values: a card waiting on something
            outside the board, and one that is finished. */}
        {(boundary || summary.done) && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-slate-600">
            {boundary && (
              <span className="flex shrink-0 items-center gap-0.5 font-semibold text-amber-600" title="Waiting on an external dependency — see the boundary lane">
                <Link2 size={11} /> waiting on
              </span>
            )}
            {summary.done && <DoneStamp />}
          </div>
        )}
      </div>
      {multi && <span className="pointer-events-none absolute inset-0 bg-indigo-500/15" aria-hidden />}
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
  if (a.wide !== b.wide || a.blockedTone !== b.blockedTone) return false
  if (a.draggable !== b.draggable || a.locked !== b.locked || a.lens !== b.lens) return false
  if (a.selected !== b.selected || a.boundary !== b.boundary || a.multi !== b.multi || a.dimmed !== b.dimmed) return false
  if (a.dropTarget !== b.dropTarget) return false
  if (a.parent?.id !== b.parent?.id || a.parent?.title !== b.parent?.title) return false
  // The kind is drawn, so a change to it re-renders. The list is the board's own array, which the
  // store replaces only when it changes — `onSetKind` is ignored like the other callbacks.
  if (a.kind?.id !== b.kind?.id || a.kind?.name !== b.kind?.name || a.kind?.color !== b.kind?.color) return false
  if (a.kinds !== b.kinds) return false
  if (a.tags?.length !== b.tags?.length) return false
  if (a.tags && b.tags && a.tags.some((t, i) => t.id !== b.tags![i].id || t.name !== b.tags![i].name || t.color !== b.tags![i].color)) return false
  if (a.symbols?.length !== b.symbols?.length) return false
  if (a.symbols && b.symbols && a.symbols.some((sym, i) => sym.id !== b.symbols![i].id || sym.bucket !== b.symbols![i].bucket || sym.title !== b.symbols![i].title)) return false
  if (a.flags?.length !== b.flags?.length) return false
  if (a.flags && b.flags && a.flags.some((f, i) => f.flag !== b.flags![i].flag || f.label !== b.flags![i].label || f.tone !== b.flags![i].tone)) return false
  return summaryEqual(a.summary, b.summary)
}

const summaryEqual = (a: CardSummary, b: CardSummary) =>
  a.childCount === b.childCount &&
  a.dependentsCount === b.dependentsCount &&
  a.blockedBelow === b.blockedBelow &&
  a.openDescendants === b.openDescendants &&
  a.rollupPercent === b.rollupPercent &&
  a.done === b.done &&
  a.ageDays === b.ageDays &&
  a.checklist?.done === b.checklist?.done &&
  a.checklist?.total === b.checklist?.total

/**
 * An initiative's kind, as a band across the top of its card.
 *
 * A kind is the board's own label for an outcome — a bet, a programme, an experiment — and it is
 * the one thing a card never has. So it is drawn as the one thing a card never is: a band across
 * the top, in the kind's own colour. A card is tinted by its type and railed down the left; an
 * initiative wears its kind as a band. The two shapes are told apart before either is read.
 *
 * The band is also where the kind is *changed* — Businessmap's affordance, and the better one: the
 * label is where the reading happens, so it is where the changing should happen too, with no trip
 * to the panel to change a word. The list is the board's own, plus the kind this initiative
 * already carries if that came from another board, so the control never lies about what the item
 * says.
 *
 * **A header is drawn only when there is something to put in it.** An initiative wearing no kind
 * has no band — not a band saying "No kind" — because a header for an absence is a header for
 * nothing, and the app says the same thing everywhere else about a label nobody set. Setting one
 * has two homes already, both the app's normal ones: the drawer's Kind field and the card menu.
 */
function KindBand({
  kind,
  kinds,
  onSet,
  locked,
}: {
  /** The kind it wears. A card without one does not render this at all. */
  kind: InitiativeType
  kinds: InitiativeType[]
  /** Absent on a surface that does not own the vocabulary — a Linked boards band. */
  onSet?: (kindId: string | undefined) => void
  /** Board-design mode: the band still says what it is, but it is not a control. */
  locked?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // A locked band is not a disabled button: a disabled button shows no tooltip, and this one has
  // something to say.
  const canSet = Boolean(onSet) && !locked
  // The board's own list, plus the kind this initiative already carries if that came from another
  // board — so the control never lies about what the item says.
  const options = kinds.some((k) => k.id === kind.id) ? kinds : [...kinds, kind]
  const chip = chipColors(kind.color)
  const choose = (id: string | undefined) => {
    onSet?.(id)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => {
          // A band that is not a control lets the click through: on a surface that only reads
          // another board's flow the band still says what the kind is, and clicking the card
          // should open the card.
          if (!canSet) return
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        onKeyDown={(e) => {
          // The list is the topmost layer, so Escape closes it rather than the panel or the board
          // behind it — the same rule the tag field and the card menu keep.
          if (e.key !== 'Escape' || !open) return
          e.preventDefault()
          e.stopPropagation()
          setOpen(false)
        }}
        style={{ backgroundColor: chip.background, color: chip.color }}
        className={cn(
          'flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-micro font-bold uppercase tracking-wide transition hover:brightness-95',
          !canSet && 'cursor-default',
        )}
        title={`Kind: ${kind.name}${canSet ? ' — click to change it' : ''}`}
        aria-label={`Kind: ${kind.name}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 truncate">{kind.name}</span>
        {canSet && <ChevronDown size={11} className="shrink-0 opacity-70" />}
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-0.5 overflow-hidden rounded-lg border border-slate-200 bg-white py-0.5 shadow-lg">
          {[undefined, ...options.map((k) => k.id)].map((id) => {
            const option = id === undefined ? undefined : options.find((k) => k.id === id)
            const on = id === kind?.id
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
        </div>
      )}
    </div>
  )
}

/**
 * An item's tags, on the card face.
 *
 * Quieter than everything else a card says, on purpose. A tag is the board's own vocabulary rather
 * than a fact about the work: it is not the type — the solid chip that says what this is — and it
 * is never a blockage, so it wears the soft chip and sentence case, and gives the loud chip to the
 * two things that have earned it.
 *
 * A set, not a choice, so it is capped: three chips and a count of the rest, with the whole list
 * in the title. A card wearing eight tags is a card with nothing readable on it.
 */
function TagChips({ tags }: { tags?: Tag[] }) {
  if (!tags || tags.length === 0) return null
  const shown = tags.slice(0, 3)
  const rest = tags.length - shown.length
  return (
    <>
      {shown.map((t) => {
        const chip = softChipColors(t.color)
        return (
          <span
            key={t.id}
            className="shrink-0 rounded px-1.5 py-px text-micro font-medium"
            style={{ backgroundColor: chip.background, color: chip.color }}
            title={`Tag: ${t.name}`}
          >
            {t.name}
          </span>
        )
      })}
      {rest > 0 && (
        <span className="shrink-0 text-micro font-medium text-slate-600" title={tags.map((t) => t.name).join(', ')}>
          +{rest}
        </span>
      )}
    </>
  )
}

/** A card that does not re-render when nothing about it changed. See `cardPropsEqual`. */
export const Card = memo(CardBase, cardPropsEqual)
