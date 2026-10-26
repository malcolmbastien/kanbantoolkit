import { memo, useEffect, useRef, useState } from 'react'
import { Ban, Check, ChevronDown, Clock, CornerDownRight, Link2, ListChecks, Lock, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BUCKET_DOT, chipColors, FLAG_BADGE, FLAG_BADGE_SHAPE, softChipColors, STAGE_COLOR, tintOn } from '@/lib/colors'
import { STAGE_LABELS } from '@/domain/lanes'
import { FORMER_MEMBER, initialsOf } from '@/domain/users'
import { STALE_AFTER_DAYS } from '@/domain/filters'
import type { HealthFlagInfo } from '@/domain/health'
import type { InitiativeType, Tag } from '@/domain/types'
import { PriorityBadge } from './PriorityBadge'
import { heldByOther, usePresence } from '@/lib/presence'
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
  /**
   * For parents: the size of the work below, in points — what an initiative has instead of an
   * estimate of its own. Never entered; the same number the panel's "Size below" reads.
   */
  sizeBelow?: number
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

/**
 * What the card rolls up to, as a line under its title.
 *
 * A decoration, not a door. It says what frames the card the reader is looking at, and it is part
 * of reading that card — so it is plain text, with no hover, no cursor and nothing to click. When
 * it was a control, pressing a card's face here opened a *different* card in the drawer, which is
 * the one thing a card's face must never do. The parent is still reachable, from the card's own
 * panel and from its menu.
 */
function RollupLine({ parent }: { parent: CardParent }) {
  return (
    <span
      className="flex min-w-0 items-center gap-1 text-micro font-medium text-slate-500"
      title={`Rolls up to ${parent.type.name}: ${parent.title}`}
    >
      <CornerDownRight size={11} className="shrink-0 text-slate-400" aria-hidden />
      <span className="sr-only">Rolls up to </span>
      <span className="min-w-0 truncate">{parent.title}</span>
    </span>
  )
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
  /** Highlighted because it waits on the selected boundary card. */
  boundary?: boolean
  /**
   * The external work this card is still waiting on, named. Always drawn — the relationship is a
   * fact about the card, not something a reader has to select a pin to discover — and each chip is
   * the way to the boundary card at the other end.
   */
  waitingOn?: Wait[]
  /** Select a boundary card from this end of the relationship. */
  onBoundary?: (dependencyId: string, title: string) => void
  /** Part of the multi-select group (shift+click). */
  multi?: boolean
  /**
   * The initiative a card in the air would become a child of. Drawn as a ring, and drawn *over*
   * every other highlight: it is the thing about to happen, not the state the card is in.
   */
  dropTarget?: boolean
  /** Dimmed because another card is part of the active multi-select group. */
  dimmed?: boolean
  /**
   * Open an item. `reveal` asks the surface to bring the item's card into view as well — the
   * pip on an initiative is a way to a child that may be in the other workflow, or below the
   * fold, so selecting it is not enough if the reader cannot see where it landed.
   */
  onOpen: (id: string, opts?: { reveal?: boolean }) => void
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
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-micro font-bold text-emerald-800 ring-1 ring-emerald-200"
      title="Done — every leaf below this is finished"
    >
      <Check size={11} strokeWidth={3} /> Done
    </span>
  )
}

const barColor = (pct?: number) => (pct === undefined ? '#cbd5e1' : pct >= 100 ? STAGE_COLOR.done : pct > 0 ? STAGE_COLOR.inProgress : '#cbd5e1')

/**
 * The badge a warning wears — the same shape and the same two weights the drawer's warnings
 * section uses, so the row on the card and the section in the drawer are visibly one set. The
 * words are `initiativeHealth`'s, and so is the title: a badge is never asked to explain itself in
 * its own vocabulary.
 */

/**
 * The keyboard half of a card.
 *
 * A card is a **group**, not a button: it holds its own controls (the actions menu, the child
 * pips), and ARIA forbids interactive children inside a button. So it is a focusable
 * group with a name — Enter or Space opens it, Shift+F10 (or the Menu key) opens its menu, which
 * is exactly what those two gestures do with a mouse.
 */
const cardKeyboard = (
  item: Item,
  locked: boolean | undefined,
  onOpen: (id: string, opts?: { reveal?: boolean }) => void,
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

export interface Wait {
  /** The external dependency. */
  id: string
  title: string
}

/**
 * "Waiting on …", named and always there.
 *
 * A card that waits on work outside the board says so on its face, and the chip is the way to the
 * boundary card at the other end: the boundary workflow is below the cards, so without this the
 * relationship is only visible from one direction.
 */
function WaitChips({ waits, onBoundary }: { waits?: Wait[]; onBoundary?: (dependencyId: string, title: string) => void }) {
  if (!waits?.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1" data-waiting-on>
      {waits.map((wait) => (
        <button
          key={wait.id}
          onClick={(event) => {
            // The chip is a link, not "open this card".
            event.stopPropagation()
            onBoundary?.(wait.id, wait.title)
          }}
          onKeyDown={(event) => event.stopPropagation()}
          title={`Waiting on “${wait.title}” — outside this board. Select it in the boundary workflow below.`}
          className="flex min-w-0 items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-micro font-semibold text-amber-900 ring-1 ring-amber-300 transition hover:bg-amber-100"
        >
          <Link2 size={11} className="shrink-0" />
          <span className="max-w-[15rem] truncate">Waiting on {wait.title}</span>
        </button>
      ))}
    </div>
  )
}

/** The ring a focused card wears — inside, so the board's geometry does not move. */
const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500'

function CardBase({ item, type, summary, parent, wide, symbols, flags, kind, kinds, onSetKind, tags, dropTarget, blockedTone = 'detail', lens, draggable, onDragStateChange, locked, selected, boundary, waitingOn, onBoundary, multi, dimmed, users, onOpen, onMultiSelect, onContextMenu, onLift }: Props) {
  const held = heldByOther(usePresence((state) => state.locks), item.id)
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
      ? 'ring-2 ring-slate-900'
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
  // A removed member keeps their chip: the card still belongs partly to the person who did the
  // work, and "Former member" is a truer chip than a name silently disappearing (task 144).
  const assignees = (item.assignees ?? []).map((id) => {
    const person = users?.find((u) => u.id === id)
    return {
      id,
      name: person?.name ?? FORMER_MEMBER,
      avatarUrl: person?.avatarUrl,
      gone: !person,
    }
  })

  // Blocked rolls up: the item's own status is precise; a count of blocked
  // descendants is what lets a team blockage surface on its initiative.
  //
  // A card's *own* blocked state is the loudest thing that can be true of a card, so it is a
  // full-width alert rather than a chip the size of the link count. The rolled-up count stays a
  // chip, because it is metadata about the work below rather than a statement about this card.
  const blockedAlert = item.blocked ? (
    <span
      className="flex w-full items-start gap-1.5 rounded-md bg-rose-50 px-2 py-1.5 text-rose-700 ring-1 ring-rose-200"
      title={item.blockedReason ? `Blocked — ${item.blockedReason}` : 'Blocked'}
    >
      <Lock size={12} className="mt-0.5 shrink-0" />
      <span className="min-w-0 text-micro font-medium leading-snug">
        <span className="font-bold uppercase tracking-wide">Blocked</span>
        {item.blockedReason ? <span> · {item.blockedReason}</span> : null}
      </span>
    </span>
  ) : null

  const rolledUpBlocked =
    !item.blocked && summary.blockedBelow > 0 ? (
      // Rolled up: a solid pill on the initiative, so a blockage anywhere beneath it reads at a
      // glance rather than as another piece of metadata. The aggregate tone stays softer in colour
      // for a top-level initiative, but keeps the same weight of shape.
      <span
        className={cn(
          'flex w-fit shrink-0 items-center gap-1 rounded px-2 py-0.5 text-micro font-bold text-white',
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

  // How long it has sat where it is, when that is long enough to be worth saying. Shown on the
  // card's own values line, beside the size and the people.
  const aged = summary.ageDays !== undefined && summary.ageDays >= STALE_AFTER_DAYS
  const checklist = summary.checklist
  const hasChecklist = Boolean(checklist && checklist.total > 0)
  const checklistDone = checklist?.done ?? 0
  const checklistTotal = checklist?.total ?? 0
  const checklistPct = checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : 0

  if (wide) {
    // A rollup is a statement about the work below. An initiative with nothing under it has no
    // percentage to show and no bar to fill: both would say "0%" about work that has not been
    // planned, which is a different fact and the wrong one.
    const pct = summary.childCount > 0 ? summary.rollupPercent : undefined
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
    // dashboard reads — with two exceptions the card is responsible for: a blockage rolled up
    // from team cards keeps the softer tone the card has always given it, so a programme reader is
    // not shouted at with a fact three levels down; and "Waiting on" joins them, because it is the
    // one warning the health rules do not own — it is about the item itself, not the work below.
    const badges: { key: string; label: string; why: string; tone: 'risk' | 'watch' }[] = [
      ...(flags ?? []).map((f) => {
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
              why: 'Waiting on an external dependency — see the boundary workflow below the cards',
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
          '@container group relative flex w-full flex-col overflow-hidden rounded-lg border border-slate-300/80 bg-white text-left shadow-md transition',
          summary.done && 'bg-slate-50',
          FOCUS_RING,
          // On touch: a vertical swipe still scrolls the board (the browser takes it, and the
          // lift aborts on `pointercancel`), while a horizontal swipe is the drag. Both axes ours
          // would make the board unscrollable from a card; both the browser's would make a card
          // undraggable.
          draggable && !locked && 'touch-pan-y',
          locked ? 'cursor-default' : 'cursor-pointer hover:border-slate-400 hover:shadow-lg',
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

        <div className="flex flex-1 flex-col gap-2 p-3">
          {/* The title, at the size the reading happens at. Beside it the one small judgement it
              carries: priority. */}
          <div className="flex items-start gap-2">
            <span className={cn('min-w-0 flex-1 line-clamp-3 break-words text-title font-semibold leading-snug', summary.done ? 'text-slate-700' : 'text-slate-900')}>
              {item.title}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 pt-1">
              {held && (
                <span
                  title={`${held.holderName} is editing this card — you can read it and move it`}
                  aria-label={`${held.holderName} is editing this card`}
                  className="text-amber-600"
                >
                  <Lock size={12} />
                </span>
              )}
              <PriorityBadge priority={item.priority} />
            </span>
          </div>

          {/* What it rolls up to, under the title: the parent the card sits under, read as part
              of the card's own words — and as plain text, so a press on the card's face opens
              this card and no other. */}
          {parent && <RollupLine parent={parent} />}

          {/* What is below it, and how far along: the children's own stages as pips, then the
              rollup. The pips say it on their own — a count beside them only repeated what the
              colours already show. The bar underneath is the same number, wider. */}
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
                      // initiative whose face the pip sits on. It is, though, the way to a
                      // child that may be in the other workflow or below the fold, so the
                      // surface is asked to reveal it.
                      e.stopPropagation()
                      onOpen(p.id, { reveal: true })
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
            ) : null}
            <span className="ml-auto flex items-center gap-1.5">
              {summary.done && <DoneStamp />}
              {pct !== undefined && (
                <span
                  className="text-body font-bold tabular-nums"
                  style={{ color: pct >= 100 ? '#047857' : pct > 0 ? '#4338ca' : '#475569' }}
                  title="Rollup — the share of leaf work done, weighted by size"
                >
                  {pct}%
                </span>
              )}
            </span>
          </div>
          {pct !== undefined && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor(pct) }} />
            </div>
          )}

          {/* The board's own words for it, above the rule. */}
          {Boolean(tags?.length) && (
            <div className="flex flex-wrap items-center gap-1">
              <TagChips tags={tags} />
            </div>
          )}

          {/* A checklist, if this initiative carries one — the same row, in the same place, a card
              gives it. */}
          {summary.checklist && summary.checklist.total > 0 && (
            <div className="flex items-center gap-2">
              <span
                className="flex shrink-0 items-center gap-1 text-meta font-semibold text-slate-700"
                title={`Checklist — ${summary.checklist.done} of ${summary.checklist.total} sub-tasks done`}
              >
                <ListChecks size={13} className="shrink-0 text-slate-600" />
                {summary.checklist.done} / {summary.checklist.total} sub-tasks
              </span>
              <span
                className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200"
                title={`${Math.round((summary.checklist.done / summary.checklist.total) * 100)}% of the checklist done`}
              >
                <span
                  className="block h-full transition-all"
                  style={{
                    width: `${Math.round((summary.checklist.done / summary.checklist.total) * 100)}%`,
                    backgroundColor: summary.checklist.done === summary.checklist.total ? STAGE_COLOR.done : STAGE_COLOR.inProgress,
                  }}
                />
              </span>
            </div>
          )}

          {/* What the card is asking a reader to look at: its own blockage, then the warnings. The
              rollup of blockages below is one of the warnings, so it is not also a chip of its own. */}
          {blockedAlert}

          {/* The warnings, as one set of badges in one place — always here, above the rule, so a
              reader scanning a column knows where to look. Never hidden, and never softened into
              the values around them. */}
          <WaitChips waits={waitingOn} onBoundary={onBoundary} />
          {badges.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {badges.map((b) => (
                <span key={b.key} className={cn(FLAG_BADGE_SHAPE, FLAG_BADGE[b.tone])} title={b.why}>
                  {b.label}
                </span>
              ))}
            </div>
          )}

          {/* Under the rule at the foot of it: what the work below it is worth, and who has it.
              An initiative has no estimate of its own, so its size is the one under it. Its
              lineage is above, with the title. */}
          {((summary.sizeBelow ?? 0) > 0 || assignees.length > 0) && (
            <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-200 pt-1.5 text-micro text-slate-600">
              {(summary.sizeBelow ?? 0) > 0 && (
                <span
                  className="shrink-0 rounded border bg-white px-1.5 py-px text-micro font-semibold tabular-nums text-slate-700"
                  style={{ borderColor: tintOn(type.color, 0.6) }}
                  title={`Size below — ${summary.sizeBelow} point${summary.sizeBelow === 1 ? '' : 's'}, from the work under this initiative`}
                >
                  {summary.sizeBelow} pts
                </span>
              )}
              <span className="ml-auto flex shrink-0 items-center -space-x-1.5">
                {assignees.slice(0, 3).map((u) => (
                  <Avatar key={u.id} user={u} />
                ))}
                {assignees.length > 3 && (
                  <span
                    className="grid h-6 w-6 place-items-center rounded-full bg-slate-200 text-micro font-semibold text-slate-600 ring-2 ring-white"
                    title={assignees.map((u) => u.name).join(', ')}
                  >
                    +{assignees.length - 3}
                  </span>
                )}
              </span>
            </div>
          )}
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
        // The type is the rail down the left edge and the badge in the identity row. The rest of
        // the surface is white, as the board's card spec asks: the lane is already tinted, and a
        // card that tints itself too is a second, competing answer to "where am I?".
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
        // Flat and quiet: a hairline border and the type as a rail down the left. The resting
        // shadow is what makes the card an object on a tinted lane rather than another pale
        // plane beside it; it deepens on hover, when the card is asked a question. What is loud
        // on a card is its warnings, not its box.
        'group relative flex min-h-[116px] w-full flex-col overflow-hidden rounded-lg border border-l-[4px] border-slate-300/80 text-left shadow-md transition',
        summary.done ? 'bg-slate-50' : 'bg-white',
        FOCUS_RING,
        draggable && !locked && 'touch-pan-y',
        locked ? 'cursor-default' : 'cursor-pointer hover:shadow-lg',
        lensCls,
        lockCls,
        dimCls,
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Tier 1 — identity and weight. The type sits at the leading edge and the two marks a
            reader weighs it by sit at the trailing edge, on the same line at every card width. */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-1.5">
          <span
            className="inline-flex min-h-[20px] shrink-0 items-center whitespace-nowrap rounded px-1.5 text-micro font-bold uppercase tracking-wide"
            style={softChipColors(type.color)}
          >
            {type.name}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <PriorityBadge priority={item.priority} />
            {item.size ? (
              <span
                className="rounded-full bg-slate-200/70 px-2 py-0.5 text-micro font-semibold tabular-nums text-slate-700"
                title={`Estimate — ${item.size} point${item.size === 1 ? '' : 's'}`}
              >
                {item.size} pts
              </span>
            ) : null}
          </span>
        </div>

        {/* Tier 2 — the title, then the lineage that places it, then what the card is saying. */}
        <div className="flex flex-1 flex-col gap-1.5 px-3 py-2.5">
          <div className={cn('line-clamp-2 break-words text-title font-semibold leading-snug', summary.done ? 'text-slate-700' : 'text-slate-900')}>
            {item.title}
          </div>

          {/* Under the title, as plain text: the parent the card sits under, read as part of the
              card's own words. Nothing here is a control — pressing a card must open that card,
              never the one it rolls up to. */}
          {parent && <RollupLine parent={parent} />}

          {/* The board's own words for it — the card's vocabulary, quieter than its facts. */}
          {Boolean(tags?.length) && (
            <div className="flex flex-wrap items-center gap-1">
              <TagChips tags={tags} />
            </div>
          )}

          {/* What the card is asking a reader to look at: its own blockage, a rolled-up blockage,
              the work waiting on it, a card waiting on something outside the board. All of it
              above the telemetry row, so nothing there can be read as one of these. */}
          {blockedAlert}
          {rolledUpBlocked}
          <WaitChips waits={waitingOn} onBoundary={onBoundary} />
          {summary.dependentsCount > 0 && (
            <span
              className="flex w-fit items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-micro font-semibold text-amber-800 ring-1 ring-amber-300"
              title={`${summary.dependentsCount} card${summary.dependentsCount === 1 ? '' : 's'} depend on this`}
            >
              <ShieldAlert size={11} /> {summary.dependentsCount} depend on it
            </span>
          )}
        </div>

        {/* Tier 3 — execution telemetry and ownership, on one quiet rule at the foot. */}
        {(hasChecklist || aged || summary.done || assignees.length > 0) && (
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-3 py-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {hasChecklist && (
                <span
                  className="flex shrink-0 items-center gap-1 rounded bg-white px-1.5 py-0.5 text-micro text-slate-600 ring-1 ring-slate-200"
                  title={`Checklist — ${checklistDone} of ${checklistTotal} sub-tasks done`}
                >
                  <ListChecks size={12} className="shrink-0 text-indigo-600" />
                  <span className="font-semibold tabular-nums text-slate-700">
                    {checklistDone}/{checklistTotal}
                  </span>
                  <span className="h-1.5 w-10 overflow-hidden rounded-full bg-slate-200" title={`${checklistPct}% of the checklist done`}>
                    <span
                      className="block h-full rounded-full transition-all"
                      style={{ width: `${checklistPct}%`, backgroundColor: checklistDone === checklistTotal ? STAGE_COLOR.done : STAGE_COLOR.inProgress }}
                    />
                  </span>
                </span>
              )}
              {aged && (
                <span
                  className="flex shrink-0 items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-micro font-semibold text-amber-700 ring-1 ring-amber-200"
                  title={`${summary.ageDays} days in this lane`}
                >
                  <Clock size={11} /> {summary.ageDays}d in lane
                </span>
              )}
              {summary.done && <DoneStamp />}
            </div>
            {assignees.length > 0 && (
              <span className="flex shrink-0 items-center -space-x-1.5">
                {assignees.slice(0, 3).map((u) => (
                  <Avatar key={u.id} user={u} />
                ))}
                {assignees.length > 3 && (
                  <span
                    className="grid h-6 w-6 place-items-center rounded-full bg-slate-200 text-micro font-semibold text-slate-600 ring-2 ring-white"
                    title={assignees.map((u) => u.name).join(', ')}
                  >
                    +{assignees.length - 3}
                  </span>
                )}
              </span>
            )}
          </div>
        )}
      </div>
      {multi && <span className="pointer-events-none absolute inset-0 bg-indigo-500/15" aria-hidden />}
    </div>
  )
}

/** A user's avatar: their profile photo, their initials, or a mark for somebody who has left. */
function Avatar({ user }: { user: { id: string; name: string; avatarUrl?: string; gone?: boolean } }) {
  if (user.gone) {
    return (
      <span
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-200 text-micro font-bold text-slate-600 ring-2 ring-white"
        title={`${user.name} — their account has been removed`}
        aria-label={user.name}
      >
        ?
      </span>
    )
  }
  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.name}
        title={user.name}
        className="h-6 w-6 shrink-0 rounded-full object-cover ring-2 ring-white"
      />
    )
  }
  return (
    <span
      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-700 text-micro font-bold text-white ring-2 ring-white"
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
  if (a.waitingOn?.length !== b.waitingOn?.length) return false
  if (a.waitingOn && b.waitingOn && a.waitingOn.some((w, i) => w.id !== b.waitingOn![i].id || w.title !== b.waitingOn![i].title)) return false
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
