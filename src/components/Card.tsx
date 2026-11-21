import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeftRight, Ban, Check, Clock, CornerDownRight, Link2, ListChecks, Lock, Tag as TagIcon, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BUCKET_DOT, chipColors, FLAG_BADGE, FLAG_BADGE_SHAPE, softChipColors, STAGE_COLOR, tintOn } from '@/lib/colors'
import { dueLabel, dueState } from '@/domain/due'
import type { BoardDetail } from '@/domain/boardDetail'
import { NONE_TYPE_ID } from '@/domain/board'
import { STAGE_LABELS } from '@/domain/lanes'
import { peopleOf } from '@/domain/users'
import { externalLabelOf, hasExternalLink, safeExternalUrl } from '@/domain/externalLink'
import { STALE_AFTER_DAYS } from '@/domain/filters'
import type { HealthFlagInfo } from '@/domain/health'
import type { InitiativeType, Tag } from '@/domain/types'
import { PersonAvatar } from './PersonAvatar'
import { PROGRESS_STAGE_ORDER, StageProgressBar, type StageCounts } from './StageProgressBar'
import { PriorityBadge } from './PriorityBadge'
import { DueChip } from './DueChip'
import { heldByOther, usePresence } from '@/lib/presence'
import { MiniHoverCard, MiniHoverReasons } from './MiniHoverCard'
import type { IssueType, Item, Stage, User } from '@/domain/types'

export interface CardSummary {
  childCount: number
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
  /** In progress and nobody is assigned: the ownership warning, narrower than "has no owner". */
  unowned?: boolean
  /** For parents: the share of leaf descendants done (derived rollup). */
  rollupPercent?: number
  /**
   * The leaves below, by stage. Discarded work is already excluded, so the bar's segments and the
   * percentage are one population. Absent on a card; present on an initiative.
   */
  rollupStages?: StageCounts
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
  /**
   * The child's own facts, resolved by the surface that draws the pips. A pip is a pointer shortcut
   * to a card that may be on another board, and its hover reading has to name what the reader would
   * see if they opened it — without the initiative card walking the whole workspace for each pip.
   */
  type?: IssueType
  /** An initiative child's own kind, when it has one. */
  kind?: InitiativeType
  assigneeIds?: string[]
  dueDate?: string
  priority?: Item['priority']
  tags?: Tag[]
  blocked?: boolean
  /** Something to watch that is not the blockage itself: due, age, owner, a health flag. */
  warned?: boolean
  /** The reasons behind the amber marker, in the card's own warning vocabulary. */
  warnings?: Array<{ label: string; why?: string; tone: 'risk' | 'watch' }>
  blockedReason?: string
  boardName?: string
  flowName?: string
  laneName?: string
  /** For an initiative child: the work below it, as the count the child's own card reads. */
  below?: { total: number; percent?: number }
}

/**
 * A pip's rich reading, shown while the pointer is over it.
 *
 * Visual only, like the Mini reading card: a pointer can hover a pip, but the keyboard path to a
 * child is the initiative's own panel, which lists every child and opens each with a name. The panel
 * is therefore hidden from assistive technology and does not take the pointer — moving off the pip
 * closes it, exactly as moving off a tooltip does.
 */
function PipPreview({ symbol, anchor, users }: { symbol: CardSymbol; anchor: DOMRect; users?: User[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const people = peopleOf(users ?? [], symbol.assigneeIds)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const box = element.getBoundingClientRect()
    const gap = 8
    const left =
      anchor.right + gap + box.width <= window.innerWidth - gap
        ? anchor.right + gap
        : Math.max(gap, anchor.left - gap - box.width)
    const top = Math.max(gap, Math.min(anchor.top - 8, window.innerHeight - box.height - gap))
    setAt({ left, top })
  }, [anchor])

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-start gap-2">
      <dt className="w-[74px] shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-slate-800">{value}</dd>
    </div>
  )
  const type = symbol.type
  const kind = symbol.kind

  return createPortal(
    <div
      ref={ref}
      data-pip-preview
      aria-hidden
      role="presentation"
      style={{ left: at?.left ?? -9999, top: at?.top ?? -9999 }}
      className="pointer-events-none fixed z-40 w-72 overflow-hidden rounded-lg border border-slate-300 bg-white text-meta shadow-xl"
    >
      <div className="space-y-2 px-3 py-2.5">
        <p className="line-clamp-2 break-words text-body font-semibold leading-snug text-slate-900">{symbol.title}</p>

        {symbol.blocked && (
          <p className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-micro font-medium text-rose-800">
            Blocked{symbol.blockedReason ? `: ${symbol.blockedReason}` : ''}
          </p>
        )}

        {symbol.warnings && symbol.warnings.length > 0 && (
          <div data-pip-warnings className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5">
            <p className="text-micro font-bold uppercase tracking-wide text-amber-800">
              {symbol.warnings.length === 1 ? 'Warning' : 'Warnings'}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {symbol.warnings.map((warning) => (
                <WarningBadge
                  key={warning.label}
                  label={warning.label}
                  why={warning.why ?? warning.label}
                  tone={warning.tone}
                />
              ))}
            </div>
          </div>
        )}

        {(type || kind || symbol.priority) && (
          <div className="flex flex-wrap items-center gap-1">
            {type && type.id !== NONE_TYPE_ID && (
              <span
                className="inline-flex items-center rounded border px-1.5 py-px text-micro font-bold uppercase tracking-wide"
                style={{ ...softChipColors(type.color), borderColor: tintOn(type.color, 0.32) }}
              >
                {type.name}
              </span>
            )}
            {type && type.id === NONE_TYPE_ID && (
              <span className="text-micro text-slate-500">Type: None</span>
            )}
            {kind && (
              <span className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-px text-micro font-medium text-slate-700">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: kind.color }} />
                {kind.name}
              </span>
            )}
            {symbol.priority && <PriorityBadge priority={symbol.priority} />}
          </div>
        )}

        <dl className="space-y-1">
          {row(
            'People',
            people.length === 0 ? (
              <span className="text-slate-500">Unassigned</span>
            ) : (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="flex shrink-0 items-center -space-x-1">
                  {people.slice(0, 3).map((person) => (
                    <PersonAvatar key={person.id} user={person} gone={person.gone} small className="ring-1 ring-white" />
                  ))}
                </span>
                <span className="min-w-0 truncate">{people.map((person) => person.name).join(', ')}</span>
              </span>
            ),
          )}
          {row(
            'Deadline',
            symbol.dueDate ? (
              <DueChip item={symbol} complete={symbol.bucket === 'done'} />
            ) : (
              <span className="text-slate-500">—</span>
            ),
          )}
          {symbol.tags && symbol.tags.length > 0 && row('Tags', <span className="flex flex-wrap items-center gap-1"><TagChips tags={symbol.tags} /></span>)}
        </dl>

        <div className="border-t border-slate-100 pt-1.5">
          <dl className="space-y-1">
            {row(
              'Status',
              <span data-pip-status className="inline-flex items-center gap-1">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', BUCKET_DOT[symbol.bucket])} />
                {STAGE_LABELS[symbol.bucket]}
              </span>,
            )}
            {symbol.boardName && row('Board', <span className="block truncate" title={symbol.boardName}>{symbol.boardName}</span>)}
            {symbol.flowName && row('Workflow', <span className="block truncate" title={symbol.flowName}>{symbol.flowName}</span>)}
            {symbol.laneName && row('Column', <span className="block truncate" title={symbol.laneName}>{symbol.laneName}</span>)}
            {symbol.below && row(
              'Below',
              symbol.below.total === 0
                ? <span className="text-slate-500">Nothing yet</span>
                : <span>{symbol.below.total} {symbol.below.total === 1 ? 'item' : 'items'}{symbol.below.percent !== undefined ? ` · ${symbol.below.percent}% done` : ''}</span>,
            )}
          </dl>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** One pip: a way into a child, with the child's own facts on hover. */
function ChildPip({ symbol, onOpen, users }: { symbol: CardSymbol; onOpen: (id: string) => void; users?: User[] }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)

  // The panel is fixed against the viewport, so a scroll would leave it pointing at where the pip
  // used to be. Closing is the honest answer; the pointer can find the pip again.
  useLayoutEffect(() => {
    if (!anchor) return
    const close = () => setAnchor(null)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [anchor])

  return (
    <>
      <button
        ref={ref}
        type="button"
        data-child-pip
        data-pip-for={symbol.id}
        data-pip-stage={symbol.bucket}
        // A board carries one pip for every child of every initiative on it, so a tab stop each
        // would put hundreds of stops between the top of a board and the cards below. The pip is a
        // pointer shortcut; the keyboard path to a child is the card's own panel.
        tabIndex={-1}
        aria-label={`${symbol.title} — ${STAGE_LABELS[symbol.bucket]}${
          symbol.blocked ? ', blocked' : ''
        }${symbol.warned ? ', has a warning' : ''}`}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'mouse') return
          setAnchor(event.currentTarget.getBoundingClientRect())
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setAnchor(null)
        }}
        onClick={(e) => {
          // The pip is not the card: opening the child must not also open the initiative whose
          // face the pip sits on.
          setAnchor(null)
          e.stopPropagation()
          onOpen(symbol.id)
        }}
        // Risk supersedes the stage: a pip with a blockage or a warning *becomes* the alert,
        // rather than wearing a dot in a corner of a stage-coloured square. Two boxes, not four
        // decorations — the shape says "look here" before the stage colour can.
        data-pip-marker={symbol.blocked ? 'blocked' : symbol.warned ? 'warning' : undefined}
        className={cn(
          'relative grid h-4 w-4 shrink-0 place-items-center rounded border transition hover:brightness-95',
          // A finger needs a bigger square than a pointer does, and the square is the hit area —
          // so it grows, and the touch target is what you can see.
          'pointer-coarse:h-6 pointer-coarse:w-6',
          symbol.blocked
            ? 'border-rose-600 bg-rose-100 text-rose-700'
            : symbol.warned
              ? 'border-amber-500 bg-amber-100 text-amber-700'
              : cn('border-transparent', BUCKET_DOT[symbol.bucket]),
        )}
      >
        {symbol.blocked && <Ban size={11} aria-hidden className="pointer-events-none" />}
        {!symbol.blocked && symbol.warned && <TriangleAlert size={11} aria-hidden className="pointer-events-none" />}
      </button>
      {anchor && <PipPreview symbol={symbol} anchor={anchor} users={users} />}
    </>
  )
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
function RollupLine({ parent, blocked = false }: { parent: CardParent; blocked?: boolean }) {
  return (
    <span
      className={cn('flex min-w-0 items-center gap-1 text-micro font-medium', blocked ? 'text-slate-700' : 'text-slate-500')}
      title={`Rolls up to ${parent.type.name}: ${parent.title}`}
    >
      <CornerDownRight size={11} className={cn('shrink-0', blocked ? 'text-slate-500' : 'text-slate-400')} aria-hidden />
      <span className="sr-only">Rolls up to </span>
      <span className="min-w-0 truncate">{parent.title}</span>
    </span>
  )
}

interface Props {
  item: Item
  type: IssueType
  summary: CardSummary
  /** The item's own column is Done, even when a child is still open. Warnings stop there. */
  completed?: boolean
  /** The people directory, to resolve `item.assignees` ids to names / initials. */
  users?: User[]
  parent?: CardParent
  /** Wide "summary" card for management/initiative boards: progress bar + symbols. */
  wide?: boolean
  symbols?: CardSymbol[]
  /**
   * A pip opens its child through this rather than the card's own `onOpen`, so the surface can
   * navigate to the child's board and unfold its workflow and column before opening it.
   */
  onOpenChild?: (id: string) => void
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
   * An initiative's kind, already resolved (`initiativeTypeById`). Given only on the initiatives
   * surface: a card has no kind, so nothing renders on the cards workflow. The band reads the
   * kind; it is changed from the card menu or the drawer, never from the card face.
   */
  kind?: InitiativeType
  /**
   * How much of the card to draw. The board's dial chooses `mini`, `summary` or `full`; a surface
   * that has no dial (the Timeline, a dashboard card) leaves it out and gets the full card.
   */
  detail?: BoardDetail
  /** This item's tags, already resolved. A set, so the footer shows a few and counts the rest. */
  tags?: Tag[]
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
  /** Locked (edit mode): no drag, no click-to-open. */
  locked?: boolean
  selected?: boolean
  /** Highlighted because it waits on the selected boundary card. */
  boundary?: boolean
  /**
   * How many items this card waits on that are not done — on this board or beyond its edge. A
   * summary of the relationship, not a chip per dependency: the card's panel names them.
   */
  openDependencies?: number
  /**
   * Whether the item has any dependency links at all — open, satisfied or closed. An initiative's
   * hierarchy door is shown when there is a child or a link to read, even with no open count.
   */
  hasDependencies?: boolean
  /**
   * Open the card's dependencies — the drawer's Hierarchy face, with its connections showing.
   * The badge is a door; a surface that has no drawer leaves it out and the count is read only.
   */
  onOpenDependencies?: (itemId: string) => void
  /** The open drawer's scoped connections are this card's: the badge is a pressed toggle. */
  connectionsOpen?: boolean
  /**
   * Whether to show the card's dependency/connections button. A management board reads outcomes;
   * its bands are not working surfaces, so the door is left off where it would only add noise.
   */
  showConnections?: boolean
  /**
   * The day this card's planned start slipped, when the board still says it has not begun. The
   * card's face and the dashboard's attention list read the same rule (`lateStartDay`).
   */
  lateStart?: string
  /** Part of the multi-select group (shift+click). */
  multi?: boolean
  /**
   * The initiative a card in the air would become a child of. Drawn as a ring, and drawn *over*
   * every other highlight: it is the thing about to happen, not the state the card is in.
   */
  dropTarget?: boolean
  /** Dimmed because another card is part of the active multi-select group. */
  dimmed?: boolean
  /** Outside the active card filters, and the board is keeping it as context. */
  filterDimmed?: boolean
  /**
   * Not a choice in the pick mode that is open. A press, a right-click, a lift or a key does
   * nothing: the card is drawn only to be read, not acted on, until the pick ends.
   */
  inert?: boolean
  /**
   * The item the pick is being made for — the card waiting for a parent, or the initiative
   * waiting for a card. Kept lit and ringed while every other non-choice recedes, so the reader
   * can see at a glance which card the edge is being formed around.
   */
  connectRoot?: boolean
  /** Open an item. The surface brings the card into view as part of opening it. */
  onOpen: (id: string) => void
  /** Shift+click — start/extend the multi-select group. */
  onMultiSelect?: (id: string) => void
  /** Right-click (or the ⋯ button) — open the card context menu at (x, y). */
  onContextMenu?: (id: string, x: number, y: number) => void
}

/**
 * The external link, as a chip a reader can press.
 *
 * A link, not a field: it opens in a new tab, and the press does not open the card (a card is a
 * group with a click of its own, so the anchor stops the event and the keydown that would open it).
 * Nothing is fetched — no preview, no favicon — so it costs a request only when somebody presses it.
 */
function ExternalLinkChip({ item }: { item: Item }) {
  const url = safeExternalUrl(item.externalUrl)
  const label = externalLabelOf(item)
  if (!url || !label) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      draggable={false}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      title={`${label} — opens in a new tab`}
      className="flex min-w-0 shrink items-center gap-1 rounded bg-white px-1.5 py-0.5 text-micro font-semibold text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-50"
    >
      <Link2 size={11} className="shrink-0" />
      <span className="max-w-[9rem] truncate">{label}</span>
    </a>
  )
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
      title="Everything below this is finished"
    >
      <Check size={11} strokeWidth={3} /> Done
    </span>
  )
}

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
  onOpen: (id: string) => void,
  onContextMenu: ((id: string, x: number, y: number) => void) | undefined,
) => ({
  role: 'group' as const,
  'aria-label': item.title,
  // A group is the honest container — the card holds its own actions — but "group" alone does not
  // tell a screen reader this is a card or that it can be opened. Say both.
  'aria-roledescription': 'card',
  'aria-keyshortcuts': 'Enter Space Shift+F10',
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

/**
 * The open dependencies, counted rather than named.
 *
 * A card can wait on work in its own cells or across the board's edge, and the two are the same
 * fact to a reader: the card cannot finish yet. A compact count is what fits beside the weight a
 * reader scans for; the card's panel lists the named rows. A dependency that has reached Done is
 * not waiting, so it is not counted.
 *
 * An initiative card offers the door when it has a hierarchy or a link to read, even with a count
 * of zero; an empty initiative is left quiet.
 */
/**
 * A warning, as a shape of its own.
 *
 * Tags are the board's vocabulary and wear a soft pill and a tag mark. A warning is a state the
 * card is in, so it wears a rounded badge with a small triangle — the shape says "look here"
 * before the words are read, and the hue says whether it is a risk or something to watch.
 */
function WarningBadge({ label, why, tone = 'watch' }: { label: string; why: string; tone?: 'risk' | 'watch' }) {
  return (
    <span className={cn(FLAG_BADGE_SHAPE, FLAG_BADGE[tone], 'inline-flex w-fit items-center gap-1')} title={why}>
      <TriangleAlert size={10} className="shrink-0" aria-hidden />
      {label}
    </span>
  )
}

function DependencyCount({
  count,
  onOpen,
  always = false,
  open = false,
}: {
  count?: number
  onOpen?: () => void
  /** Draw the door even with no open dependencies — an initiative always has a hierarchy. */
  always?: boolean
  /** The drawer is open on this card's scoped connections: the next press closes it. */
  open?: boolean
}) {
  if (!count && (!always || !onOpen)) return null
  const countLabel = count ? `${count} open ${count === 1 ? 'dependency' : 'dependencies'}` : ''
  const label = open
    ? count
      ? `${countLabel} — close its hierarchy and connections`
      : 'Close hierarchy and connections'
    : count
      ? `${countLabel} — open its hierarchy and connections`
      : 'Open hierarchy and connections'
  const shape = cn(
    'flex shrink-0 items-center gap-0.5 rounded py-0.5 text-micro font-semibold tabular-nums ring-1 transition',
    open
      ? 'bg-indigo-100 text-indigo-800 ring-indigo-300'
      : 'bg-slate-100 text-slate-700 ring-slate-300',
    count ? 'px-1.5' : 'px-1',
  )
  const content = (
    <>
      <ArrowLeftRight size={11} className="shrink-0 text-slate-600" aria-hidden />
      {count ? count : null}
    </>
  )
  if (!onOpen) {
    return (
      <span data-open-dependencies={count} role="img" aria-label={countLabel} title={countLabel} className={shape}>
        {content}
      </span>
    )
  }
  return (
    <button
      type="button"
      data-open-connections=""
      data-connections-open={open ? '' : undefined}
      data-open-dependencies={count || undefined}
      aria-label={label}
      aria-pressed={open}
      title={label}
      onClick={(event) => {
        event.stopPropagation()
        onOpen()
      }}
      onKeyDown={(event) => {
        // The card's own keyboard handler opens the card on Enter/Space; the badge has already
        // done its work, and Escape must still reach the app to close the drawer.
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        shape,
        open
          ? 'cursor-pointer hover:bg-indigo-200 hover:text-indigo-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500'
          : 'cursor-pointer hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500',
      )}
    >
      {content}
    </button>
  )
}

/** The ring a focused card wears — inside, so the board's geometry does not move. */
const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500'

/** The one badge that is allowed to shout: a card's own blockage, in the header's top-right. */
const BLOCKED_BADGE = 'shrink-0 rounded bg-rose-600 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-white shadow-sm'

function CardBase({ item, type, summary, completed = false, parent, wide, symbols, onOpenChild, flags, kind, detail = 'full', tags, dropTarget, blockedTone = 'detail', draggable, onDragStateChange, locked, selected, boundary, openDependencies, hasDependencies, onOpenDependencies, connectionsOpen = false, showConnections = true, lateStart, multi, dimmed, filterDimmed, inert, connectRoot, users, onOpen, onMultiSelect, onContextMenu, onLift }: Props) {
  const complete = summary.done || completed
  const held = heldByOther(usePresence((state) => state.locks), item.id)

  // The Mini tile carries no text, so its reading is a hover/focus layer. The tile is the anchor
  // and the state lives here, beside the data the layer repeats; a press clears it first, so the
  // click that opens or lifts a card never leaves a layer hovering over the next surface.
  const tileRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const hoverAllowed = useRef(true)
  const closeHover = useCallback(() => setHovered(false), [])

  const dragProps = inert
    ? {
        // Swallow the press here rather than let it reach the ground beneath and become a pan or
        // a click-away: the card is in the pick mode's picture, not in its list of choices.
        onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
      }
    : draggable && !locked
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

  // Highlight priority: a selected boundary dependency (slate) > multi-select
  // (indigo) > item selection (indigo, strongest). The outline is drawn *inside* the card, so a
  // card at the edge of a column keeps its whole frame; a ring outside it was clipped by the
  // column's rounded box.
  const selectionCls = cn(
    boundary
      ? 'z-10 outline-2 outline-solid outline-offset-[-2px] outline-slate-900 shadow-lg'
      : multi
        ? 'z-10 outline-2 outline-solid outline-offset-[-2px] outline-indigo-600 shadow-md'
        : selected
          ? 'z-10 outline-[3px] outline-solid outline-offset-[-3px] outline-indigo-600 shadow-lg'
          : '',
  )
  // A blockage is the loudest fact a card can carry. Normal cards no longer wear a type-colour
  // rail, so the one card with a rose rail is the one that is blocked; the callout says why.
  const blocked = Boolean(item.blocked && !complete)
  const cardEdges = blocked
    ? 'border-slate-300/80 border-l-4 border-l-rose-600'
    : summary.done
      ? wide
        ? 'border-emerald-300'
        : 'border-emerald-200/80'
      : 'border-slate-300/80'
  const lockCls = locked ? 'opacity-50 saturate-75' : ''
  // While a multi-select group is active, the cards outside it recede. A filter can also ask for
  // its non-matching cards to recede; hover or keyboard focus brings either back to full emphasis.
  const dimCls = dimmed || filterDimmed
    ? 'opacity-40 saturate-50 hover:opacity-100 hover:saturate-100 focus-visible:opacity-100 focus-visible:saturate-100'
    : ''
  // The pick's root: the one card the edge is being formed around. It keeps a halo while the
  // cards that are neither the root nor a choice recede.
  const connectRootCls = connectRoot ? 'ring-2 ring-indigo-600 ring-offset-2 ring-offset-white shadow-lg' : ''
  // A removed member keeps their chip: the card still belongs partly to the person who did the
  // work, and "Former member" is a truer chip than a name silently disappearing (task 144).
  const assignees = peopleOf(users ?? [], item.assignees)

  // Blocked rolls up: the item's own status is precise; a count of blocked
  // descendants is what lets a team blockage surface on its initiative.
  //
  // A card's *own* blocked state is the loudest thing that can be true of a card, so it is a
  // full-width alert rather than a chip the size of the link count. The rolled-up count stays a
  // chip, because it is metadata about the work below rather than a statement about this card.
  // A reason is the only thing this box has to say. Without one, the header's Blocked badge
  // already carries the state, and an empty box in the middle of the card is noise.
  const blockedAlert = item.blocked && !complete && item.blockedReason ? (
    <span
      className="flex w-full items-start gap-2 rounded-md bg-white px-2.5 py-2 text-slate-800 shadow-sm ring-1 ring-rose-200"
      title={`Blocked: ${item.blockedReason}`}
    >
      <Ban size={14} className="mt-0.5 shrink-0 text-rose-600" />
      <span className="min-w-0 text-micro leading-snug">
        <span className="block font-bold uppercase tracking-wide text-rose-600">Blocker reason:</span>
        <span className="mt-0.5 block text-slate-800">{item.blockedReason}</span>
      </span>
    </span>
  ) : null

  const rolledUpBlocked =
    !complete && !item.blocked && summary.blockedBelow > 0 ? (
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
  const aged = !complete && summary.ageDays !== undefined && summary.ageDays >= STALE_AFTER_DAYS
  const checklist = summary.checklist
  const hasChecklist = Boolean(checklist && checklist.total > 0)
  const checklistDone = checklist?.done ?? 0
  const checklistTotal = checklist?.total ?? 0
  const checklistPct = checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : 0

  /**
   * The things a reader has to notice, in the same order the full card shows them. The compact
   * levels reuse these words rather than inventing a second warning vocabulary: the blocked card,
   * the blocked work below it, an initiative's health flags, what it waits on, and who waits on it.
   * A due date joins only the Mini tile's marker — Summary already carries the Due chip.
   */
  const attention = (withDue: boolean) => {
    const found: Array<{ label: string; tone: 'risk' | 'watch'; why?: string }> = []
    if (item.blocked && !complete) {
      found.push({
        label: 'Blocked',
        tone: 'risk',
        why: item.blockedReason ? `Blocked: ${item.blockedReason}` : 'Blocked',
      })
    }
    if (!complete && !item.blocked && summary.blockedBelow > 0) {
      found.push({
        label: `${summary.blockedBelow} blocked below`,
        tone: blockedTone === 'aggregate' ? 'watch' : 'risk',
        why:
          blockedTone === 'aggregate'
            ? `${summary.blockedBelow} blocked below — rolled up from team cards`
            : `${summary.blockedBelow} blocked below`,
      })
    }
    if (!complete) {
      for (const flag of flags ?? []) found.push({ label: flag.label, tone: flag.tone, why: flag.why })
    }
    if (!complete && lateStart) {
      found.push({
        label: 'Late start',
        tone: 'watch',
        why: `Its planned start (${lateStart}) passed and it has not started`,
      })
    }
    if (!complete && summary.unowned) {
      found.push({
        label: 'Unowned',
        tone: 'watch',
        why: 'It is in progress and nobody is assigned',
      })
    }
    if (aged) {
      found.push({
        label: `${summary.ageDays}d in lane`,
        tone: 'watch',
        why: `${summary.ageDays} days in this lane — work that has stopped moving`,
      })
    }
    if (withDue) {
      const due = dueState(item.dueDate, complete)
      if (due?.tone === 'overdue') found.push({ label: dueLabel(due), tone: 'risk' })
      else if (due?.tone === 'soon') found.push({ label: dueLabel(due), tone: 'watch' })
    }
    return [...new Map(found.map((entry) => [entry.label, entry])).values()]
  }
  const miniAttention = attention(true)
  const openDependenciesDoor = onOpenDependencies && !locked && !inert ? () => onOpenDependencies(item.id) : undefined

  const openOnClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (locked || inert) return
    closeHover()
    if (e.shiftKey && onMultiSelect) onMultiSelect(item.id)
    else onOpen(item.id)
  }
  const openOnContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (inert) {
      // A menu on a card that is not a choice would offer edits unrelated to the pick.
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (locked || !onContextMenu) return
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(item.id, e.clientX, e.clientY)
  }

  if (detail === 'summary') {
    // Summary keeps the warning's presence, not its sentence. The card's own Blocked badge already
    // says the loudest one, so it is not repeated here; a small triangle carries the rest.
    const summaryWarnings = attention(false).filter((warning) => !(blocked && warning.label === 'Blocked'))
    // The foot is a band only when it has something to hold: an empty band on a lean card is
    // chrome pretending to be information.
    const summaryFoot = Boolean(item.dueDate) || assignees.length > 0
    const summaryTone = summaryWarnings.some((warning) => warning.tone === 'risk') ? 'risk' : 'watch'
    const summaryWarningLabel = summaryWarnings.map((warning) => warning.why ?? warning.label).join(' · ')
    // An initiative's progress is not a detail of its full face: the bar and its number are the
    // reading a summary is for. A card has no rollup, so this appears only on the wide card.
    const summaryStages = wide && summary.rollupStages && summary.rollupStages.total > 0 ? summary.rollupStages : undefined
    const summaryPercent = summaryStages ? summary.rollupPercent : undefined
    return (
      <div
        {...dragProps}
        {...cardKeyboard(item, locked || inert, onOpen, onContextMenu)}
        aria-label={filterDimmed ? `${item.title} — does not match the active filters` : item.title}
        data-filter-dimmed={filterDimmed ? '' : undefined}
        title={filterDimmed ? 'Does not match the active filters' : undefined}
        data-card-id={item.id}
        data-card-detail="summary"
        data-card-initiative={wide ? '' : undefined}
        data-card-blocked={blocked ? '' : undefined}
        data-pick-root={connectRoot ? '' : undefined}
        onClick={openOnClick}
        onContextMenu={openOnContextMenu}
        className={cn(
          'group relative flex min-h-[76px] w-full flex-col overflow-hidden rounded-lg border text-left shadow-xs transition',
          blocked ? 'bg-rose-50' : 'bg-white',
          cardEdges,
          summary.done && 'bg-slate-50',
          FOCUS_RING,
          draggable && !locked && !inert && 'touch-pan-y',
          locked || inert
            ? 'cursor-default'
            : cn(
                'cursor-pointer hover:shadow-sm',
                blocked ? 'hover:border-slate-400 hover:border-l-rose-600' : summary.done ? 'hover:border-emerald-300' : 'hover:border-slate-400',
              ),
          selectionCls,
          lockCls,
          dimCls,
          dropTarget && 'ring-2 ring-indigo-500',
          connectRootCls,
        )}
      >
        {/* Strategy A: type on the top edge, in its own colour. It is a channel, not a title
            decoration — the header itself stays white so the type chip and the title keep their
            clean ground. */}
        {type.id !== NONE_TYPE_ID && (
          <span
            aria-hidden
            data-card-type-stripe
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px]"
            style={{ backgroundColor: type.color }}
          />
        )}
        <div className="flex items-center gap-1.5 px-2 pb-1 pt-2.5">
          {type.id !== NONE_TYPE_ID && (
            <span
              className="inline-flex min-h-[18px] shrink-0 items-center whitespace-nowrap rounded border px-1.5 text-micro font-bold uppercase tracking-wide"
              style={{ ...softChipColors(type.color), borderColor: tintOn(type.color, 0.32) }}
            >
              {type.name}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            {held && (
              <span
                role="img"
                aria-label={`${held.holderName} has this card open`}
                title={`${held.holderName} has this card open`}
                className="inline-flex shrink-0 items-center text-amber-600"
              >
                <Lock size={12} />
              </span>
            )}
            {summaryWarnings.length > 0 && (
              <span
                role="img"
                data-card-warning-summary={summaryTone}
                aria-label={`${summaryWarnings.length} warning${summaryWarnings.length === 1 ? '' : 's'}: ${summaryWarningLabel}`}
                title={summaryWarningLabel}
                className={cn('inline-flex shrink-0 items-center', summaryTone === 'risk' ? 'text-rose-600' : 'text-amber-600')}
              >
                <TriangleAlert size={12} />
              </span>
            )}
            {showConnections && (
              <DependencyCount
                count={complete ? 0 : openDependencies}
                onOpen={openDependenciesDoor}
                always={wide && (summary.childCount > 0 || Boolean(hasDependencies))}
                open={connectionsOpen}
              />
            )}
            {blocked && <span className={BLOCKED_BADGE}>Blocked</span>}
          </span>
        </div>

        <div
          className={cn(
            'line-clamp-2 break-words px-2 pt-0.5 text-body font-semibold leading-snug',
            summary.done ? 'text-slate-700' : 'text-slate-900',
          )}
        >
          {item.title}
        </div>

        {summaryStages && (
          <div className="px-2 pt-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-micro text-slate-500">
                {summaryStages.total} {summaryStages.total === 1 ? 'item' : 'items'} below
              </span>
              {summaryPercent !== undefined && (
                <span
                  className="text-body font-bold tabular-nums"
                  style={{ color: summaryPercent >= 100 ? '#047857' : summaryPercent > 0 ? '#4338ca' : '#475569' }}
                  title="Share of the work below that is done"
                >
                  {summaryPercent}%
                </span>
              )}
            </div>
            <StageProgressBar counts={summaryStages} />
          </div>
        )}

        <div
          data-card-footer={summaryFoot ? '' : undefined}
          className={cn(
            'mt-auto flex items-end justify-between gap-2 px-2 pb-1.5 pt-1',
            summaryFoot && cn('border-t', footerSurface(blocked, Boolean(summary.done))),
          )}
        >
          {/* The due date sits at the foot, where the Full card puts it, and the people stay on
              the right, so scanning down the column reads the same shape at either level. Summary
              carries no warning words: a small triangle above marks their presence, and Full is
              where each one explains itself. */}
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <DueChip item={item} complete={complete} />
          </div>
          {assignees.length > 0 && (
            <span className="flex shrink-0 items-center -space-x-1">
              {assignees.slice(0, 3).map((person) => (
                <PersonAvatar key={person.id} user={person} gone={person.gone} small className="ring-1 ring-white" />
              ))}
              {assignees.length > 3 && (
                <span
                  className="grid h-4 w-4 place-items-center rounded-full bg-slate-200 text-micro font-semibold text-slate-600 ring-1 ring-white"
                  title={assignees.map((person) => person.name).join(', ')}
                >
                  +{assignees.length - 3}
                </span>
              )}
            </span>
          )}
        </div>
        {multi && <span className="pointer-events-none absolute inset-0 bg-indigo-500/15" aria-hidden />}
      </div>
    )
  }

  if (detail === 'mini') {
    const warned = miniAttention.some((warning) => warning.label !== 'Blocked')
    // The tile's accessible name is the same reading the hover layer gives a pointer: what it is,
    // what it rolls up to, who has it, and why it is marked.
    const label = [
      item.title,
      type.name,
      parent ? `Rolls up to ${parent.title}` : null,
      assignees.length > 0 ? `Assigned to ${assignees.map((person) => person.name).join(', ')}` : 'Unassigned',
      openDependencies ? `${openDependencies} open ${openDependencies === 1 ? 'dependency' : 'dependencies'}` : null,
      ...miniAttention.map((warning) => warning.why ?? warning.label),
    ]
      .filter(Boolean)
      .join(' — ')
    return (
      <div
        ref={tileRef}
        {...dragProps}
        {...cardKeyboard(item, locked || inert, onOpen, onContextMenu)}
        aria-label={filterDimmed ? `${label} — does not match the active filters` : label}
        data-filter-dimmed={filterDimmed ? '' : undefined}
        title={filterDimmed ? 'Does not match the active filters' : undefined}
        data-card-id={item.id}
        data-card-detail="mini"
        data-card-initiative={wide ? '' : undefined}
        data-card-blocked={blocked ? '' : undefined}
        data-card-warning={warned ? '' : undefined}
        data-pick-root={connectRoot ? '' : undefined}
        onClick={openOnClick}
        onContextMenu={openOnContextMenu}
        // A pointer over the tile is a reader asking what it is; a press is a reader acting on
        // it, so the layer goes first and does not reappear until the pointer has left.
        onMouseEnter={inert ? undefined : () => {
          hoverAllowed.current = true
          setHovered(true)
        }}
        onMouseLeave={inert ? undefined : () => {
          hoverAllowed.current = true
          setHovered(false)
        }}
        onFocus={inert ? undefined : () => {
          if (hoverAllowed.current) setHovered(true)
        }}
        onBlur={inert ? undefined : closeHover}
        // Capture, so the tile's own press-to-lift handler still runs.
        onPointerDownCapture={() => {
          hoverAllowed.current = false
          setHovered(false)
        }}
        onKeyDownCapture={(e) => {
          if (e.key === 'Enter' || e.key === ' ') closeHover()
        }}
        className={cn(
          'relative h-6 w-6 shrink-0 rounded-[5px] border-2 transition',
          FOCUS_RING,
          draggable && !locked && !inert && 'touch-pan-y',
          locked || inert ? 'cursor-default' : 'cursor-pointer hover:brightness-95',
          selectionCls,
          lockCls,
          dimCls,
          dropTarget && 'ring-2 ring-indigo-500',
          connectRootCls,
        )}
        style={{ backgroundColor: tintOn(type.color, 0.28), borderColor: type.color }}
      >
        {blocked && (
          <span
            data-card-marker="blocked"
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-rose-600 ring-2 ring-white"
          />
        )}
        {warned && (
          <span
            data-card-marker="warning"
            className="absolute -bottom-1 -right-1 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white"
          />
        )}
        {multi && <span className="pointer-events-none absolute inset-0 rounded-[4px] bg-indigo-500/20" aria-hidden />}

        <MiniHoverCard open={hovered && !locked && !inert} anchor={tileRef} onClose={closeHover}>
          <div>
            <div className="flex items-center gap-1.5">
              {type.id !== NONE_TYPE_ID && (
                <span
                  className="inline-flex min-h-[18px] shrink-0 items-center whitespace-nowrap rounded border px-1.5 text-micro font-bold uppercase tracking-wide"
                  style={{ ...softChipColors(type.color), borderColor: tintOn(type.color, 0.32) }}
                >
                  {type.name}
                </span>
              )}
              {summary.done && (
                <span className="ml-auto flex shrink-0 items-center gap-0.5 text-micro font-semibold text-emerald-700">
                  <Check size={11} strokeWidth={3} /> Done
                </span>
              )}
            </div>

            <p className="mt-1.5 break-words text-meta font-semibold leading-snug text-slate-900">{item.title}</p>

            {parent && (
              <p className="mt-1 flex min-w-0 items-center gap-1 text-micro text-slate-500">
                <CornerDownRight size={11} className="shrink-0 text-slate-400" aria-hidden />
                <span className="min-w-0 truncate">Rolls up to {parent.title}</span>
              </p>
            )}

            <div className="mt-2 border-t border-slate-200 pt-1.5">
              <p className="text-micro font-semibold uppercase tracking-wide text-slate-500">Assigned</p>
              {assignees.length === 0 ? (
                <p className="mt-0.5 text-micro text-slate-600">Unassigned</p>
              ) : (
                <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                  {assignees.map((person) => (
                    <li key={person.id} className="flex min-w-0 items-center gap-1 text-micro text-slate-700">
                      <PersonAvatar user={person} gone={person.gone} small />
                      <span className="truncate">{person.gone ? `${person.name} (former member)` : person.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!complete && Boolean(openDependencies) && (
              <p
                data-mini-hover-dependencies
                className="mt-2 flex items-center gap-1 text-micro text-slate-600"
              >
                <Link2 size={11} className="shrink-0 text-slate-500" />
                {openDependencies} open {openDependencies === 1 ? 'dependency' : 'dependencies'}
              </p>
            )}

            <MiniHoverReasons reasons={miniAttention} />
          </div>
        </MiniHoverCard>
      </div>
    )
  }

  if (wide) {
    // A rollup is a statement about the work below. An initiative with nothing counting below it
    // has no percentage to show and no bar to fill: both would say "0%" about work that has not
    // been planned, or only about work that was discarded, which is a different fact and the
    // wrong one.
    const stages = summary.rollupStages && summary.rollupStages.total > 0 ? summary.rollupStages : undefined
    const pct = stages ? summary.rollupPercent : undefined
    // The children's own stages, in the progress bar's order — delivered, under way, not begun,
    // backlog. The pips and the bar beside them are the same reading at two sizes.
    const pips = [...(symbols ?? [])].sort((a, b) => PROGRESS_STAGE_ORDER.indexOf(a.bucket) - PROGRESS_STAGE_ORDER.indexOf(b.bucket))
    const MAX_PIPS = 12
    // One set, one place. The health rules are the source — the same words and tones the
    // dashboard reads — with one exception the card is responsible for: a blockage rolled up from
    // team cards keeps the softer tone the card has always given it, so a programme reader is not
    // shouted at with a fact three levels down. Dependencies are counted separately, not folded
    // into this list: they are not a health flag.
    const badges: { key: string; label: string; why: string; tone: 'risk' | 'watch' }[] = complete
      ? []
      : [
          ...(flags ?? []).map((f) => {
            const soft = f.flag === 'blocked' && blockedTone === 'aggregate'
            return {
              key: f.flag,
              label: soft ? `${summary.blockedBelow} blocked below` : f.label,
              why: soft ? `${summary.blockedBelow} blocked below — rolled up from team cards` : f.why,
              tone: soft ? ('watch' as const) : f.tone,
            }
          }),
          ...(lateStart
            ? [
                {
                  key: 'lateStart',
                  label: 'Late start',
                  why: `Its planned start (${lateStart}) passed and it has not started`,
                  tone: 'watch' as const,
                },
              ]
            : []),
        ]

    return (
      <div
        {...dragProps}
        {...cardKeyboard(item, locked || inert, onOpen, onContextMenu)}
        aria-label={filterDimmed ? `${item.title} — does not match the active filters` : item.title}
        data-filter-dimmed={filterDimmed ? '' : undefined}
        title={filterDimmed ? 'Does not match the active filters' : undefined}
        data-card-id={item.id}
        data-card-detail="full"
        // The wide card is the initiative, and an initiative is what a card can roll up to — so
        // the marker is how a drop finds the cards that could be its target. A card is not one.
        data-card-initiative=""
        data-card-blocked={blocked ? '' : undefined}
        data-pick-root={connectRoot ? '' : undefined}
        onContextMenu={(e) => {
          if (inert) {
            e.preventDefault()
            e.stopPropagation()
            return
          }
          if (locked || !onContextMenu) return
          e.preventDefault()
          e.stopPropagation()
          onContextMenu(item.id, e.clientX, e.clientY)
        }}
        onClick={(e) => {
          e.stopPropagation()
          if (locked || inert) return
          if (e.shiftKey && onMultiSelect) onMultiSelect(item.id)
          else onOpen(item.id)
        }}
        className={cn(
          // `@container` lets the card shed detail as its column narrows (see the `@[Npx]:`
          // variants below) instead of overflowing a customised flow.
          '@container group relative flex w-full flex-col overflow-hidden rounded-lg border text-left shadow-sm transition',
          blocked ? 'bg-rose-50' : 'bg-white',
          cardEdges,
          summary.done && 'bg-slate-50',
          FOCUS_RING,
          // On touch: a vertical swipe still scrolls the board (the browser takes it, and the
          // lift aborts on `pointercancel`), while a horizontal swipe is the drag. Both axes ours
          // would make the board unscrollable from a card; both the browser's would make a card
          // undraggable.
          draggable && !locked && !inert && 'touch-pan-y',
          locked || inert
            ? 'cursor-default'
            : cn(
                'cursor-pointer hover:shadow-md',
                blocked ? 'hover:border-slate-400 hover:border-l-rose-600' : summary.done ? 'hover:border-emerald-300' : 'hover:border-slate-400',
              ),
          selectionCls,
          lockCls,
          dimCls,
          // Last, so it wins: `cn` keeps the last ring of the group, and the target is what the
          // gesture is about to do rather than what the card is.
          dropTarget && 'ring-2 ring-indigo-500',
          connectRootCls,
        )}
      >
        {/* The kind, as a band across the top — the initiative's identity, and the one thing a
            card never has. It is a label here, not a control: the card menu and the drawer are
            where a kind is changed. */}
        {kind && <KindBand kind={kind} />}

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
                  title={`${held.holderName} has this card open. You can read it and move it.`}
                  aria-label={`${held.holderName} has this card open`}
                  className="text-amber-600"
                >
                  <Lock size={12} />
                </span>
              )}
              {showConnections && (
                <DependencyCount
                  count={complete ? 0 : openDependencies}
                  onOpen={openDependenciesDoor}
                  always={summary.childCount > 0 || Boolean(hasDependencies)}
                  open={connectionsOpen}
                />
              )}
              <PriorityBadge priority={item.priority} />
              {blocked && <span className={BLOCKED_BADGE}>Blocked</span>}
            </span>
          </div>

          {/* What it rolls up to, under the title: the parent the card sits under, read as part
              of the card's own words — and as plain text, so a press on the card's face opens
              this card and no other. */}
          {parent && <RollupLine parent={parent} blocked={blocked} />}

          {/* What is below it, and how far along: the children's own stages as pips, then the
              rollup. The pips say it on their own — a count beside them only repeated what the
              colours already show. The bar underneath is the same number, wider. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-slate-600">
            {pips.length > 0 ? (
              <span data-child-pips className="flex items-center gap-1">
                {pips.slice(0, MAX_PIPS).map((p) => (
                  <ChildPip key={p.id} symbol={p} onOpen={onOpenChild ?? onOpen} users={users} />
                ))}
                {pips.length > MAX_PIPS && <span className="font-semibold text-slate-600">+{pips.length - MAX_PIPS}</span>}
              </span>
            ) : null}
            {pct !== undefined && (
              <span
                className="ml-auto text-body font-bold tabular-nums"
                style={{ color: pct >= 100 ? '#047857' : pct > 0 ? '#4338ca' : '#475569' }}
                title="Share of the work below that is done"
              >
                {pct}%
              </span>
            )}
          </div>
          {stages && <StageProgressBar counts={stages} />}

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
                title={`Checklist: ${summary.checklist.done} of ${summary.checklist.total} sub-tasks done`}
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
              reader scanning a column knows where to look. Dependencies are counted in the header
              of the card, not folded into this list: they are not a health flag. */}
          {badges.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {badges.map((b) => (
                <WarningBadge key={b.key} label={b.label} why={b.why} tone={b.tone} />
              ))}
            </div>
          )}

        </div>

        {/* The same foot a card wears: the promise, the link and the finished stamp on one quiet
            rule, with the people at the right. The progress bar above is the initiative's own
            reading; this row says what a reader can act on. */}
        {(Boolean(item.dueDate) || summary.done || hasExternalLink(item) || assignees.length > 0) && (
          <div
            data-card-footer
            className={cn(
              'mt-auto flex items-center justify-between gap-2 border-t px-3 py-1.5',
              footerSurface(blocked, Boolean(summary.done)),
            )}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <DueChip item={item} complete={complete} />
              <ExternalLinkChip item={item} />
              {summary.done && <DoneStamp />}
            </div>
            {assignees.length > 0 && (
              <span className="flex shrink-0 items-center -space-x-1.5">
                {assignees.slice(0, 3).map((u) => (
                  <PersonAvatar key={u.id} user={u} gone={u.gone} className="ring-2 ring-white" />
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
    )
  }

  return (
    <div
      {...dragProps}
      {...cardKeyboard(item, locked || inert, onOpen, onContextMenu)}
      aria-label={filterDimmed ? `${item.title} — does not match the active filters` : item.title}
      data-filter-dimmed={filterDimmed ? '' : undefined}
      title={filterDimmed ? 'Does not match the active filters' : undefined}
      data-card-id={item.id}
      data-card-detail="full"
      data-card-blocked={blocked ? '' : undefined}
      data-pick-root={connectRoot ? '' : undefined}
      onClick={(e) => {
        e.stopPropagation()
        if (locked || inert) return
        if (e.shiftKey && onMultiSelect) onMultiSelect(item.id)
        else onOpen(item.id)
      }}
      onContextMenu={(e) => {
        if (inert) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        if (locked || !onContextMenu) return
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(item.id, e.clientX, e.clientY)
      }}
      className={cn(
        // Flat and quiet: a hairline border and white surface. The type is a chip in the identity
        // row, not a rail: a coloured edge on every card competed with the one edge that matters,
        // the rose rail of a blocked card. What is loud on a card is its state, not its type.
        'group relative flex min-h-[116px] w-full flex-col overflow-hidden rounded-lg border text-left shadow-sm transition',
        blocked ? 'bg-rose-50' : 'bg-white',
        cardEdges,
        summary.done && 'bg-slate-50',
        FOCUS_RING,
        draggable && !locked && !inert && 'touch-pan-y',
        locked || inert
          ? 'cursor-default'
          : cn(
              'cursor-pointer hover:shadow-md',
              blocked ? 'hover:border-slate-400 hover:border-l-rose-600' : summary.done ? 'hover:border-emerald-300' : 'hover:border-slate-400',
            ),
        selectionCls,
        lockCls,
        dimCls,
        connectRootCls,
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Strategy A: type on the top edge. The header stays white; the stripe is the channel. */}
        {type.id !== NONE_TYPE_ID && (
          <span
            aria-hidden
            data-card-type-stripe
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px]"
            style={{ backgroundColor: type.color }}
          />
        )}
        {/* Tier 1 — identity and weight. The type sits at the leading edge and the two marks a
            reader weighs it by sit at the trailing edge, on the same line at every card width. */}
        <div
          data-card-header
          className="flex items-center justify-between gap-2 px-3 pb-0.5 pt-3"
        >
          {type.id !== NONE_TYPE_ID && (
            <span
              className="inline-flex min-h-[20px] shrink-0 items-center whitespace-nowrap rounded border px-1.5 text-micro font-bold uppercase tracking-wide"
              style={{ ...softChipColors(type.color), borderColor: tintOn(type.color, 0.32) }}
            >
              {type.name}
            </span>
          )}
          {/* `ml-auto` and not only the row's `justify-between`: a card of type None has no
              leading chip, and with one child the row would start the marks at the left edge.
              The weight a reader scans for stays in the top-right corner whatever the type. */}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {held && (
              <span
                title={`${held.holderName} has this card open. You can read it and move it.`}
                aria-label={`${held.holderName} has this card open`}
                className="text-amber-600"
              >
                <Lock size={12} />
              </span>
            )}
            {showConnections && (
              <DependencyCount count={complete ? 0 : openDependencies} onOpen={openDependenciesDoor} open={connectionsOpen} />
            )}
            <PriorityBadge priority={item.priority} />
            {blocked && <span className={BLOCKED_BADGE}>Blocked</span>}
          </span>
        </div>

        {/* Tier 2 — the title, then the lineage that places it, then what the card is saying. */}
        <div className="flex flex-1 flex-col gap-1.5 px-3 pb-2.5 pt-1.5">
          <div className={cn('line-clamp-2 break-words text-title font-semibold leading-snug', summary.done ? 'text-slate-700' : 'text-slate-900')}>
            {item.title}
          </div>

          {/* Under the title, as plain text: the parent the card sits under, read as part of the
              card's own words. Nothing here is a control — pressing a card must open that card,
              never the one it rolls up to. */}
          {parent && <RollupLine parent={parent} blocked={blocked} />}

          {/* The board's own words for it — the card's vocabulary, quieter than its facts. */}
          {Boolean(tags?.length) && (
            <div className="flex flex-wrap items-center gap-1">
              <TagChips tags={tags} />
            </div>
          )}

          {/* What the card is asking a reader to look at: its own blockage, a rolled-up blockage.
              All of it above the telemetry row, so nothing there can be read as one of these. */}
          {blockedAlert}
          {rolledUpBlocked}
          {!complete && lateStart && (
            <WarningBadge label="Late start" why={`Its planned start (${lateStart}) passed and it has not started`} />
          )}
          {!complete && summary.unowned && (
            <WarningBadge label="Unowned" why="It is in progress and nobody is assigned" />
          )}
        </div>

        {/* Tier 3 — execution telemetry and ownership, on one quiet rule at the foot. */}
        {(hasChecklist || aged || summary.done || assignees.length > 0 || Boolean(item.dueDate) || hasExternalLink(item)) && (
          <div
            data-card-footer
            className={cn(
              'mt-auto flex items-center justify-between gap-2 border-t px-3 py-1.5',
              footerSurface(blocked, Boolean(summary.done)),
            )}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {hasChecklist && (
                <span
                  className="flex shrink-0 items-center gap-1 rounded bg-white px-1.5 py-0.5 text-micro text-slate-600 ring-1 ring-slate-200"
                  title={`Checklist: ${checklistDone} of ${checklistTotal} sub-tasks done`}
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
              <DueChip item={item} complete={complete} />
              <ExternalLinkChip item={item} />
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
                  <PersonAvatar key={u.id} user={u} gone={u.gone} className="ring-2 ring-white" />
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
  if (a.item !== b.item || a.type !== b.type || a.users !== b.users || a.detail !== b.detail) return false
  if (a.wide !== b.wide || a.blockedTone !== b.blockedTone) return false
  if (a.draggable !== b.draggable || a.locked !== b.locked) return false
  if (a.selected !== b.selected || a.boundary !== b.boundary || a.multi !== b.multi || a.dimmed !== b.dimmed || a.filterDimmed !== b.filterDimmed) return false
  if (a.inert !== b.inert || a.connectRoot !== b.connectRoot) return false
  if (a.openDependencies !== b.openDependencies) return false
  if (a.connectionsOpen !== b.connectionsOpen) return false
  if (a.hasDependencies !== b.hasDependencies) return false
  if (a.showConnections !== b.showConnections) return false
  if (a.lateStart !== b.lateStart) return false
  if (a.dropTarget !== b.dropTarget) return false
  if (a.parent?.id !== b.parent?.id || a.parent?.title !== b.parent?.title) return false
  // The kind is drawn, so a change to it re-renders.
  if (a.kind?.id !== b.kind?.id || a.kind?.name !== b.kind?.name || a.kind?.color !== b.kind?.color) return false
  if (a.tags?.length !== b.tags?.length) return false
  if (a.tags && b.tags && a.tags.some((t, i) => t.id !== b.tags![i].id || t.name !== b.tags![i].name || t.color !== b.tags![i].color)) return false
  if (a.symbols?.length !== b.symbols?.length) return false
  // A symbol now carries the child's own reading — people, dates, placement — so a change to the
  // child has to redraw the initiative's pips, not only a change to its title or stage.
  if (a.symbols && b.symbols && JSON.stringify(a.symbols) !== JSON.stringify(b.symbols)) return false
  if (a.flags?.length !== b.flags?.length) return false
  if (a.flags && b.flags && a.flags.some((f, i) => f.flag !== b.flags![i].flag || f.label !== b.flags![i].label || f.tone !== b.flags![i].tone)) return false
  return summaryEqual(a.summary, b.summary)
}

const summaryEqual = (a: CardSummary, b: CardSummary) =>
  a.childCount === b.childCount &&
  a.blockedBelow === b.blockedBelow &&
  a.openDescendants === b.openDescendants &&
  a.rollupPercent === b.rollupPercent &&
  a.unowned === b.unowned &&
  a.rollupStages?.total === b.rollupStages?.total &&
  a.rollupStages?.backlog === b.rollupStages?.backlog &&
  a.rollupStages?.notStarted === b.rollupStages?.notStarted &&
  a.rollupStages?.inProgress === b.rollupStages?.inProgress &&
  a.rollupStages?.done === b.rollupStages?.done &&
  a.done === b.done &&
  a.ageDays === b.ageDays &&
  a.checklist?.done === b.checklist?.done &&
  a.checklist?.total === b.checklist?.total

/**
 * An initiative's kind, as a band across the top of its card.
 *
 * A kind is the board's own label for an outcome — a bet, a programme, an experiment — and it is
 * the one thing a card never has. So it is drawn as the one thing a card never is: a band across
 * the top, in the kind's own colour. A card is white with its type as a chip; a blocked card
 * carries the only coloured rail, and it is rose; an initiative wears its kind as a band. The
 * shapes are told apart before either is read.
 *
 * **The band reads; it does not change.** The kind is edited from the card's context menu or the
 * drawer's Kind field, which are the app's normal homes for a property. A menu on the card face was
 * a second place to type a word, and it made a label look like a control.
 *
 * **A header is drawn only when there is something to put in it.** An initiative wearing no kind
 * has no band — not a band saying "No kind" — because a header for an absence is a header for
 * nothing, and the app says the same thing everywhere else about a label nobody set.
 */
function KindBand({ kind }: { kind: InitiativeType }) {
  const chip = chipColors(kind.color)
  return (
    <div
      style={{ backgroundColor: chip.background, color: chip.color }}
      className="flex w-full items-center gap-1.5 px-2.5 py-1 text-micro font-bold uppercase tracking-wide"
      title={`Kind: ${kind.name}`}
      aria-label={`Kind: ${kind.name}`}
    >
      <span className="min-w-0 flex-1 truncate">{kind.name}</span>
    </div>
  )
}

/**
 * An item's tags, on the card face.
 *
 * Quieter than everything else a card says, on purpose. A tag is the board's own vocabulary rather
 * than a fact about the work: it is not the type — the solid chip that says what this is — and it
 * is never a warning, so it wears a soft pill with a tag mark rather than the rounded triangle
 * badge a warning wears.
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
            className="inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-micro font-medium"
            style={{ backgroundColor: chip.background, color: chip.color, borderColor: tintOn(t.color, 0.32) }}
            title={`Tag: ${t.name}`}
          >
            <TagIcon size={9} className="shrink-0 opacity-70" aria-hidden />
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

/**
 * The foot of a card: one band at the bottom for the facts a reader acts on.
 *
 * The promise, the link, the checklist, the finished stamp and the people sit there, so the same
 * information is found in the same place on every card, at every detail level. The band is opaque —
 * the drag layer renders the card's own markup, and a translucent card shows the lane through it
 * the moment it is lifted — and it is one step deeper than the card's own surface, so a blocked
 * card's foot is rose and a done card's is a shade of grey.
 */
function footerSurface(blocked: boolean, done: boolean): string {
  if (blocked) return 'border-rose-200 bg-rose-100'
  return done ? 'border-slate-200 bg-slate-100' : 'border-slate-200 bg-slate-50'
}

/** A card that does not re-render when nothing about it changed. See `cardPropsEqual`. */
export const Card = memo(CardBase, cardPropsEqual)
