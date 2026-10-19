import { useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArrowRight,
  Ban,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  CornerLeftUp,
  Eye,
  Flag,
  Minus,
  MoreHorizontal,
  Plus,
  Send,
  SquareArrowOutUpRight,
  Target,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import {
  attributedObjectives,
  checklistItems,
  decompositionChildren,
  decompositionParent,
  dependenciesOf,
  dependentsOf,
  descendants,
  lineageOf,
  objectiveRollup,
  openDescendants,
  rollupOf,
  statusOf,
  type Graph,
} from '@/domain/derive'
import { boardInitiativeTypes, boardTags, cardTypes, initiativeTypeById, isInitiativeItem, isStrategicInitiative, placementOn, tagsOf } from '@/domain/board'
import { lanePath, STAGE_LABELS } from '@/domain/lanes'
import { initiativeHealth } from '@/domain/health'
import { renderMarkdown } from '@/lib/markdown'
import { PRIORITY_META, PRIORITY_ORDER } from './PriorityBadge'
import { initialsOf } from '@/domain/users'
import { chipColors, FLAG_BADGE, FLAG_BADGE_SHAPE, STAGE_DOT, stageChip, statusDot, TAG_PALETTE } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore, isBoardSurface } from '@/store'
import { TagInput } from './TagInput'
import type { Item, Stage } from '@/domain/types'

interface Props {
  itemId: string
}

/** Dot colour per log event kind. */
const LOG_STYLES: Record<string, string> = {
  created: 'bg-slate-300',
  moved: 'bg-sky-500',
  edited: 'bg-slate-400',
  linked: 'bg-violet-400',
  unlinked: 'bg-violet-200',
  blocked: 'bg-rose-500',
  unblocked: 'bg-emerald-500',
  noted: 'bg-indigo-400',
  limit: 'bg-amber-500',
}

/** The one field style: a white well on the card's grey ground. */
const WELL = 'flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5'
const CHIP = 'flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-1.5 text-meta font-medium text-slate-700 ring-1 ring-slate-200'

type Tab = 'overview' | 'hierarchy' | 'activity'

/** The stages in the order a board reads them, which is the order the work below is listed in. */
const STAGE_ORDER: Stage[] = ['backlog', 'notStarted', 'inProgress', 'done']

export function ItemPanel({ itemId }: Props) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const boards = useStore((s) => s.boards)
  const issueTypes = useStore((s) => s.issueTypes)
  const objectives = useStore((s) => s.objectives)
  const keyResults = useStore((s) => s.keyResults)
  const users = useStore((s) => s.users)
  const close = useStore((s) => s.openItem)
  const setItemFields = useStore((s) => s.setItemFields)
  const setParent = useStore((s) => s.setParent)
  const addChecklistEntry = useStore((s) => s.addChecklistEntry)
  const toggleChecklistEntry = useStore((s) => s.toggleChecklistEntry)
  const setChecklistEntryText = useStore((s) => s.setChecklistEntryText)
  const removeChecklistEntry = useStore((s) => s.removeChecklistEntry)
  const addDependency = useStore((s) => s.addDependency)
  const setAttribution = useStore((s) => s.setAttribution)
  const blockItem = useStore((s) => s.blockItem)
  const unblockItem = useStore((s) => s.unblockItem)
  const addLogNote = useStore((s) => s.addLogNote)
  const logTextEdit = useStore((s) => s.logTextEdit)
  const removeDependency = useStore((s) => s.removeDependency)
  const archiveItem = useStore((s) => s.archiveItem)
  const unarchiveItem = useStore((s) => s.unarchiveItem)
  const deleteItem = useStore((s) => s.deleteItem)
  const duplicateCard = useStore((s) => s.duplicateCard)
  const setInitiativeKind = useStore((s) => s.setInitiativeKind)
  const setView = useStore((s) => s.setView)
  const toggleItemTag = useStore((s) => s.toggleItemTag)
  const addTag = useStore((s) => s.addTag)
  const askConfirm = useStore((s) => s.askConfirm)
  const boardSurface = useStore(isBoardSurface)
  const addAssignee = useStore((s) => s.addAssignee)
  const boardId = useStore((s) => s.boardId)
  const selectBoard = useStore((s) => s.selectBoard)
  const setObjectives = useStore((s) => s.setObjectives)
  const toggleLens = useStore((s) => s.toggleLens)
  const lensId = useStore((s) => s.lensId)

  const [tab, setTab] = useState<Tab>('overview')
  const [moreOpen, setMoreOpen] = useState(false)
  const [priorityOpen, setPriorityOpen] = useState(false)
  const [blockOpen, setBlockOpen] = useState(false)
  const [dependencyId, setDependencyId] = useState('')
  const [parentChoice, setParentChoice] = useState('')
  const [parentEditorOpen, setParentEditorOpen] = useState(false)
  // Which warning's affected work is open. Closed by default: the chip row is the summary, and
  // the cards behind a chip are what you ask for, not what you are given.
  const [openWarning, setOpenWarning] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [blockReason, setBlockReason] = useState('')
  const [note, setNote] = useState('')
  const [newSubtask, setNewSubtask] = useState('')
  // Free text is logged once, when the field is left: a title is typed a letter at a time, and
  // a history of every keystroke is not a history. See `logTextEdit`.
  const textEditRef = useRef<{ id: string; field: 'title' | 'description'; before: string } | null>(null)
  const startTextEdit = (id: string, field: 'title' | 'description', before: string) => {
    textEditRef.current = { id, field, before }
  }
  const endTextEdit = (field: 'title' | 'description') => {
    const edit = textEditRef.current
    if (!edit || edit.field !== field) return
    logTextEdit(edit.id, field, edit.before)
    textEditRef.current = null
  }
  const [editingEntry, setEditingEntry] = useState<string | null>(null)
  const [entryDraft, setEntryDraft] = useState('')
  // Escape closes the editor without saving, and the blur that follows must not put the text
  // back. A ref rather than state, because the blur can arrive before a render.
  const abandoned = useRef(false)
  const [assigneeDraft, setAssigneeDraft] = useState('')

  const graph: Graph = { items, edges, links, placements, lanes }
  const item = items.find((i) => i.id === itemId)
  if (!item) return null

  const type = issueTypes.find((t) => t.id === item.typeId) ?? { id: item.typeId, name: 'Item', color: '#64748b' }
  const parentId = decompositionParent(item.id, edges)
  const parent = parentId ? items.find((i) => i.id === parentId) : undefined
  const children = decompositionChildren(item.id, edges)
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is Item => Boolean(i))
  const dependencies = dependenciesOf(item.id, graph)
  const dependents = dependentsOf(item.id, graph)
  const exposure = openDescendants(item.id, graph)
  const attributed = attributedObjectives(item.id, edges, objectives)
  const status = statusOf(item.id, graph)
  const roll = rollupOf(item.id, graph)
  const stage = roll.bucket
  const log = item.log ?? []
  const itemPlacements = placements.filter((p) => p.itemId === item.id)

  const initiativeTypeId = issueTypes.find((t) => t.name === 'Initiative')?.id
  const isInitiative = Boolean(initiativeTypeId && item.typeId === initiativeTypeId)
  const isSubtask = item.typeId === issueTypes.find((t) => t.name === 'Sub-task')?.id
  // Two types belong to the system rather than the user, so the control is not offered.
  const typeIsFixed = isInitiative || isSubtask
  // OKRs attach to *strategic* initiatives — a portfolio board's own — and everything below inherits
  // through the decomposition. The model refuses the rest (`setAttribution`), so the panel offers the
  // control only where it works and says why where it does not: a checkbox that quietly does nothing
  // is the one failure the house rules are most against.
  const isStrategic = isInitiative && isStrategicInitiative(item.id, { items, placements, boards, issueTypes })
  // A copy lands in the original's cell, so Duplicate needs one: this card, in a cell of the
  // board in front of us. Everywhere else there is nothing for a copy to land on.
  const duplicateCell = placementOn(placements, item.id, boardId)
  const canDuplicate = boardSurface && Boolean(duplicateCell)
  const duplicateReason = boardSurface
    ? 'A copy lands in the original’s cell, and this card is not in one here.'
    : 'A copy lands in the original’s cell — open this card from its board.'
  // The kinds this board offers, and the one this initiative carries — which may come from
  // another board, since an initiative can be placed on more than one.
  const kinds = boardInitiativeTypes(boards.find((b) => b.id === boardId))
  // Tags are the board's, and a board that defines none offers none — the select then says so.
  const boardTagList = boardTags(boards.find((b) => b.id === boardId))
  const itemTags = tagsOf(boards, item)
  const kind = initiativeTypeById(boards, item.initiativeTypeId)
  const typeName = (id: string) => issueTypes.find((t) => t.id === id)?.name ?? 'Item'
  const typeColor = (id: string) => issueTypes.find((t) => t.id === id)?.color ?? '#64748b'
  const userById = (id: string) => users.find((u) => u.id === id)
  // A card's sub-tasks are a checklist rather than items: they have no placement, no WIP and
  // no status beyond ticked, so there is nothing for a type or a board to say about them.
  const checklist = checklistItems(item)
  const addSubtask = () => {
    const text = newSubtask.trim()
    if (!text) return
    addChecklistEntry(item.id, text)
    setNewSubtask('')
  }
  const startEditingEntry = (entryId: string, text: string) => {
    abandoned.current = false
    setEntryDraft(text)
    setEditingEntry(entryId)
  }
  const saveEntry = (entryId: string) => {
    if (abandoned.current) {
      abandoned.current = false
      return
    }
    setChecklistEntryText(item.id, entryId, entryDraft)
    setEditingEntry(null)
  }
  const applyAssignee = () => {
    const name = assigneeDraft.trim()
    if (!name) return
    addAssignee(item.id, name)
    setAssigneeDraft('')
  }
  // The chain from the root down to this item, plus the OKRs its ancestors map to.
  const lineage = lineageOf(item.id, graph)
  const lineageObjectives = [
    ...new Map(
      lineage.flatMap((n) => attributedObjectives(n.id, edges, objectives)).map((o) => [o.id, o]),
    ).values(),
  ]
  const focusOn = lensId === item.id
  const boardOf = (id: string) =>
    boards.find((b) => b.id === placements.find((p) => p.itemId === id)?.boardId)
  // Where this item actually sits — its own board, never the one behind the panel. The two differ
  // whenever the panel was opened from somewhere that is not a board: a dashboard row, a band on
  // another board, a search result. That difference is the only thing the header has to say about
  // it, so it is the only time it says anything.
  const itemBoard = boardOf(item.id)
  // The parent reads as what it is and what its board calls it: "Initiative · Bet" says more about
  // the thing above this one than its title alone can.
  const parentKind = parent
    ? [typeName(parent.typeId), initiativeTypeById(boards, parent.initiativeTypeId)?.name].filter(Boolean).join(' · ')
    : ''

  /**
   * Take the reader to an item where it actually is: its board, the board's own view, then the
   * drawer on it. The order matters — choosing a board clears the selection by design, so the
   * drawer is opened after it rather than before.
   *
   * This is what makes a warning actionable. A badge says something is wrong; the rows under it
   * name the cards it is about, and clicking one lands you on the board they sit in with that card
   * open — including when that board is not the one you were looking at.
   */
  const goTo = (id: string) => {
    const there = boardOf(id)
    if (there && there.id !== boardId) selectBoard(there.id)
    setView('board')
    close(id)
  }

  /**
   * Open an item where it actually lives: in place when it is on the board in front of us, and on
   * its own board when it is not. A row that leads somewhere must not leave the reader on one
   * board reading a card from another.
   */
  const openOrGo = (id: string) => {
    const there = boardOf(id)
    if (there && there.id !== boardId) goTo(id)
    else close(id)
  }

  /**
   * The initiative's health, as warnings a reader can act on.
   *
   * The rules and the words are `initiativeHealth`'s — the same the card's badge row and the
   * dashboard's Health column read — and each one brings the cards it found, so the drawer can
   * point at the work rather than only describe it. The dependents signal joins them: it is a
   * fact about this item rather than a health rule, and the card already draws it as one of the
   * same badges.
   *
   * Memoized on the store's own arrays, because health is the one derivation here that is not
   * linear in the size of the initiative — and a drawer that recomputed it on every keystroke in
   * the description field would be a drawer that stutters.
   */
  // One of the rules counts days, so the day is part of the key: a drawer left open overnight must
  // not go on saying "still 12d".
  const today = Math.floor(Date.now() / 86_400_000)
  const warnings = useMemo(() => {
    if (!isInitiative) return []
    const g: Graph = { items, edges, links, placements, lanes }
    const rows = initiativeHealth(item.id, g, Date.now()).flags.map((f) => ({
      key: f.flag as string,
      label: f.label,
      why: f.why,
      tone: f.tone,
      cards: (f.items ?? []).map((id) => items.find((i) => i.id === id)).filter((i): i is Item => Boolean(i)),
    }))
    const depending = dependentsOf(item.id, g)
    if (depending.length > 0) {
      rows.push({
        key: 'dependents',
        label: `${depending.length} depend${depending.length === 1 ? 's' : ''} on it`,
        why: `${depending.length} item${depending.length === 1 ? '' : 's'} ${depending.length === 1 ? 'depends' : 'depend'} on this — if it slips, they are blocked`,
        tone: 'watch',
        cards: depending.map((d) => d.dependent),
      })
    }
    return rows
  }, [isInitiative, item.id, items, edges, links, placements, lanes, issueTypes, today])
  const openWarningRow = warnings.find((w) => w.key === openWarning)

  // A board to go to only when it is not the one already in front of us.
  const somewhereToGo = boardSurface === false || boardOf(item.id)?.id !== boardId
  /** How many of a warning's cards are named before the rest are counted. */
  const WARN_CARDS = 4

  // A parent is always an initiative — the same rule the store enforces, offered here so the
  // select cannot propose something that would be refused.
  const candidates = items.filter(
    (i) => i.id !== item.id && !descendants(item.id, graph).includes(i.id) && isInitiativeItem(i, issueTypes),
  )
  // Initiative is reserved for the Initiatives workflow — a card can't be promoted to it.
  // Every card type is offered; the item's current type is always among them.
  const typeOptions = cardTypes(issueTypes)
  const relatedCount = children.length + dependencies.length + dependents.length + itemPlacements.length
  const doneBelow = children.length > 0 ? `${roll.done} of ${roll.total} done` : undefined

  // The three faces of one item, in the order a reader wants them: what it is, where it sits in
  // the work, and what has happened to it. The counts are on the tabs so the panel says how much
  // is behind each one before you open it.
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'hierarchy', label: 'Hierarchy', count: relatedCount },
    { id: 'activity', label: 'Activity', count: log.length },
  ]

  /**
   * One item as a row in a list: how it stands, what it is called, and where it lives — the three
   * things a reader needs before deciding to go there. The name is the way in; a row that carries
   * an action of its own keeps that action beside the name rather than making the row a button.
   */
  const itemRow = (c: Item, onOpen: () => void, opts: { onRemove?: () => void; stage?: boolean } = {}) => {
    const cStatus = statusOf(c.id, graph)
    const bucket = rollupOf(c.id, graph).bucket
    return (
      <div
        key={c.id}
        className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 transition hover:border-slate-300 hover:bg-slate-50"
      >
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot(cStatus))} />
        <button onClick={onOpen} title={`Open ${c.title}`} className="min-w-0 flex-1 truncate text-left text-slate-700 transition hover:text-indigo-600">
          {c.title}
        </button>
        {c.archived && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-micro font-semibold text-amber-800">archived</span>}
        <span className="shrink-0 text-micro text-slate-600">{boardOf(c.id)?.name ?? '—'}</span>
        {/* Where a heading already says the stage — the groups under "Items below" — the row does
            not say it again. */}
        {opts.stage !== false && (
          <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-micro font-semibold', stageChip(bucket))}>{STAGE_LABELS[bucket]}</span>
        )}
        {opts.onRemove && (
          <button
            onClick={opts.onRemove}
            className="shrink-0 text-slate-500 transition hover:text-rose-600"
            title="Remove this link — the other item is untouched"
            aria-label={`Remove the link to ${c.title}`}
          >
            <X size={12} />
          </button>
        )}
      </div>
    )
  }

  return (
    <aside
      data-item-panel
      aria-label={`Card details: ${item.title}`}
      className="flex h-full w-full max-w-[460px] shrink-0 flex-col border-l border-slate-300 bg-white shadow-[-10px_0_24px_-14px_rgba(15,23,42,0.25)]"
    >
      {/* ---- Header: where you are, what it is, what it is called, and the three views ---- */}
      <header className="shrink-0 border-b border-slate-200 px-4 pb-3 pt-3">
        <div className="flex items-center gap-2">
          {/* The path ends where you are: ancestors as links, this item in ink. */}
          <nav className="flex min-w-0 items-center gap-1 text-meta text-slate-600">
            {lineage.slice(-3).map((node, i, shown) => {
              const self = node.id === item.id
              return (
                <span key={node.id} className="flex min-w-0 items-center gap-1">
                  {i > 0 && <span className="shrink-0 text-slate-400">/</span>}
                  {self ? (
                    // The end of the path keeps the room: where you are matters more than the
                    // way you came, and the full chain is a tab away.
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-800" title={node.title}>
                      {node.title}
                    </span>
                  ) : (
                    <button
                      onClick={() => close(node.id)}
                      title={`Open ${node.title}`}
                      className={cn('min-w-0 truncate transition hover:text-slate-900', shown.length > 1 && 'max-w-[5rem]')}
                    >
                      {node.title}
                    </button>
                  )}
                </span>
              )
            })}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <IconButton
              title={focusOn ? 'Stop focusing this line' : 'Focus this line on the board'}
              active={focusOn}
              onClick={() => toggleLens(item.id)}
            >
              <Eye size={15} />
            </IconButton>
            <IconButton
              title="More — duplicate, archive, delete"
              active={moreOpen}
              onClick={() => setMoreOpen((o) => !o)}
            >
              <MoreHorizontal size={15} />
            </IconButton>
            <IconButton title="Close" danger onClick={() => close(null)}>
              <X size={16} />
            </IconButton>
          </div>
        </div>

        {moreOpen && (
          <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center gap-1.5">
              {/* The "copy me" template: a new card with this one's shape and none of its
                  commitments, landing in the same cell. An initiative and a sub-task belong
                  to the system rather than to you, so for those the row is not there. */}
              {!typeIsFixed && (
                <button
                  onClick={() => duplicateCard(item.id)}
                  disabled={!canDuplicate}
                  title={canDuplicate ? 'Copy this card into the same cell, just below it' : undefined}
                  className={cn(
                    'flex items-center gap-1 rounded-lg border bg-white px-2 py-1 text-meta font-medium transition',
                    canDuplicate
                      ? 'border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      : 'cursor-not-allowed border-slate-200 text-slate-400',
                  )}
                >
                  <Copy size={12} /> Duplicate
                </button>
              )}
              {item.archived ? (
                <button
                  onClick={() => unarchiveItem(item.id)}
                  className="flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-meta font-medium text-amber-800 transition hover:bg-amber-100"
                >
                  <Archive size={12} /> Restore
                </button>
              ) : (
                <button
                  onClick={() => archiveItem(item.id)}
                  title="File this item and everything below it away"
                  className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-meta font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                >
                  <Archive size={12} /> Archive
                </button>
              )}
              <button
                onClick={() =>
                  askConfirm({
                    title: `Delete "${item.title}"?`,
                    body: "This can't be undone. Its parent, links and attribution are removed, and its children lose their parent.",
                    confirmLabel: 'Delete card',
                    danger: true,
                    onConfirm: () => deleteItem(item.id),
                  })
                }
                className="flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2 py-1 text-meta font-medium text-rose-600 transition hover:bg-rose-50"
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
            {/* A disabled button shows no tooltip, so the reason is said in words. */}
            {!typeIsFixed && !canDuplicate && <p className="text-micro text-slate-600">{duplicateReason}</p>}
            {/* A menu is where you would look for the missing control, so the missing control
                explains itself. */}
            {typeIsFixed && (
              <p className="text-micro text-slate-600">
                {isInitiative
                  ? 'An initiative is always an initiative — that type is what the initiatives workflow reads.'
                  : 'A sub-task is a line on the checklist, not an item, so its type is not yours to change.'}
              </p>
            )}
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span
            className="rounded px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide"
            style={{ backgroundColor: chipColors(type.color).background, color: chipColors(type.color).color }}
          >
            {type.name}
          </span>
          {/* A chip that repeats the board behind the panel says nothing, so it is not drawn.
              When the card is somewhere else, it is the first thing worth saying. */}
          {itemBoard && itemBoard.id !== boardId && (
            <span
              className="rounded-full bg-slate-100 px-2 py-0.5 text-micro font-medium text-slate-600"
              title={`This card sits on ${itemBoard.name}, not on the board behind this panel`}
            >
              On {itemBoard.name}
            </span>
          )}
          {item.blocked ? (
            <button
              onClick={() => unblockItem(item.id)}
              className="ml-auto flex items-center gap-1 rounded-lg bg-rose-600 px-2 py-1 text-meta font-semibold text-white transition hover:bg-rose-700"
            >
              <Ban size={12} /> Unblock
            </button>
          ) : (
            <button
              onClick={() => setBlockOpen((o) => !o)}
              className={cn(
                'ml-auto flex items-center gap-1 rounded-lg border px-2 py-1 text-meta font-medium transition',
                blockOpen
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-slate-200 text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600',
              )}
            >
              <Flag size={12} /> Mark blocked
            </button>
          )}
        </div>

        {item.blocked && item.blockedReason && (
          <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-meta text-rose-800 ring-1 ring-rose-200">
            {item.blockedReason}
          </p>
        )}
        {blockOpen && !item.blocked && (
          <div className="mt-2 flex items-center gap-1.5">
            <input
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              placeholder="Why is it blocked? (optional)"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  blockItem(item.id, blockReason)
                  setBlockReason('')
                  setBlockOpen(false)
                }
              }}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-meta outline-none transition focus:ring-2 focus:ring-rose-300"
            />
            <button
              onClick={() => {
                blockItem(item.id, blockReason)
                setBlockReason('')
                setBlockOpen(false)
              }}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1.5 text-meta font-semibold text-white transition hover:bg-rose-700"
            >
              <Ban size={12} /> Block
            </button>
          </div>
        )}

        {/* The title is the panel's heading: the one thing at the size the reading happens at. */}
        <input
          value={item.title}
          onFocus={() => startTextEdit(item.id, 'title', item.title)}
          onBlur={() => endTextEdit('title')}
          onChange={(e) => setItemFields(item.id, { title: e.target.value })}
          aria-label="Title"
          className="mt-2 w-full rounded-lg border border-transparent bg-transparent text-heading font-semibold leading-snug text-slate-900 transition hover:border-slate-200 focus:border-indigo-300 focus:outline-none"
        />

        <div className="mt-3 flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
          {tabs.map((t) => {
            const on = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-meta font-medium transition',
                  on ? 'bg-white font-semibold text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900',
                )}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className={cn('text-micro font-semibold tabular-nums', on ? 'text-indigo-500' : 'text-slate-600')}>{t.count}</span>
                )}
              </button>
            )
          })}
        </div>
      </header>

      {/* ---- Body ---------------------------------------------------------------- */}
      {/* The panel is the one place a card's own words are worth copying, so it opts back in. */}
      <div className="min-h-0 flex-1 select-text space-y-5 overflow-y-auto px-4 py-4 text-meta">
        {tab === 'overview' && (
          <>
            {/* Warnings first, because that is what they are for: the card's badge row says
                something is wrong, and this says how much and takes you to it. One chip per
                signal — the summary — and the work behind a chip on request. */}
            {isInitiative && warnings.length > 0 && (
              <section className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 text-meta font-semibold text-amber-900">
                    <TriangleAlert size={14} className="shrink-0" />
                    {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
                  </span>
                  {somewhereToGo && (
                    <button
                      onClick={() => goTo(item.id)}
                      className="ml-auto flex shrink-0 items-center gap-1 rounded-lg border border-amber-300 bg-white px-2 py-0.5 text-micro font-medium text-amber-800 transition hover:bg-amber-100"
                      title={`Go to ${boardOf(item.id)?.name ?? 'the board'} with this initiative open`}
                    >
                      <SquareArrowOutUpRight size={11} /> Open on the board
                    </button>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {warnings.map((w) => (
                    <button
                      key={w.key}
                      onClick={() => setOpenWarning(openWarning === w.key ? null : w.key)}
                      title={w.why}
                      aria-expanded={openWarning === w.key}
                      className={cn(FLAG_BADGE_SHAPE, FLAG_BADGE[w.tone], 'flex items-center gap-1 transition hover:brightness-95')}
                    >
                      {w.label}
                      {w.cards.length > 0 && (
                        <ChevronDown size={11} className={cn('shrink-0 transition', openWarning === w.key && 'rotate-180')} />
                      )}
                    </button>
                  ))}
                </div>

                {openWarningRow && (
                  <div className="mt-2 rounded-lg bg-white/80 p-2 ring-1 ring-amber-200">
                    <p className="text-meta text-slate-700">{openWarningRow.why}</p>
                    {openWarningRow.cards.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {openWarningRow.cards.slice(0, WARN_CARDS).map((c) => {
                          const there = boardOf(c.id)
                          return (
                            <button
                              key={c.id}
                              onClick={() => goTo(c.id)}
                              title={`Open ${c.title}${there ? ` — on ${there.name}` : ''}`}
                              className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left transition hover:bg-amber-100/70"
                            >
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: chipColors(typeColor(c.typeId)).background }} />
                              <span className="min-w-0 flex-1 truncate text-slate-700">{c.title}</span>
                              {/* Which board it is on, when that is not this one — the warning is
                                  often resolved somewhere else. */}
                              {there && there.id !== boardId && <span className="shrink-0 text-micro text-slate-600">{there.name}</span>}
                              <ArrowRight size={11} className="shrink-0 text-slate-400" />
                            </button>
                          )
                        })}
                        {openWarningRow.cards.length > WARN_CARDS && (
                          <p className="px-1 text-micro text-slate-600">
                            +{openWarningRow.cards.length - WARN_CARDS} more
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* The properties, grouped the way they are read: what state it is in, who has it,
                what it is worth, and when it is wanted. */}
            <section className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
              <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                <Field label="Status">
                  <div className={WELL} title="Derived from its column and the work below — never typed in">
                    <span
                      className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot(status))}
                    />
                    <span className="truncate text-meta font-medium text-slate-700">{STAGE_LABELS[stage]}</span>
                    <span className="ml-auto shrink-0 text-micro text-slate-600">Derived</span>
                  </div>
                </Field>

                <Field label="Priority">
                  <div className="relative">
                    <button
                      onClick={() => setPriorityOpen((o) => !o)}
                      className={cn(WELL, 'w-full text-left font-medium outline-none transition focus:ring-2 focus:ring-indigo-400')}
                    >
                      {item.priority ? (
                        <>
                          {(() => {
                            const Icon = PRIORITY_META[item.priority].icon
                            return <Icon size={12} className={cn('shrink-0', PRIORITY_META[item.priority].dot)} />
                          })()}
                          <span>{PRIORITY_META[item.priority].label}</span>
                        </>
                      ) : (
                        <span className="text-slate-600">None</span>
                      )}
                      <ChevronDown size={12} className="ml-auto shrink-0 text-slate-400" />
                    </button>
                    {priorityOpen && (
                      <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white py-0.5 shadow-lg">
                        <button
                          onClick={() => { setItemFields(item.id, { priority: undefined }); setPriorityOpen(false) }}
                          className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-meta text-slate-600 hover:bg-slate-50"
                        >
                          <Minus size={12} /> None
                          {!item.priority && <Check size={11} className="ml-auto text-indigo-600" />}
                        </button>
                        {PRIORITY_ORDER.map((p) => {
                          const { label, icon: Icon, dot } = PRIORITY_META[p]
                          return (
                            <button
                              key={p}
                              onClick={() => { setItemFields(item.id, { priority: p }); setPriorityOpen(false) }}
                              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-meta text-slate-700 hover:bg-slate-50"
                            >
                              <Icon size={12} className={dot} /> {label}
                              {item.priority === p && <Check size={11} className="ml-auto text-indigo-600" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </Field>

                {/* Type and Kind — the labels a card or an initiative wears. A card's type is the
                    one you choose; an initiative's type is what makes it one, so it is fixed (the
                    ⋯ menu says so) and only its kind is a choice. */}
                {!typeIsFixed && (
                  <Field label="Type">
                    <select
                      value={item.typeId}
                      onChange={(e) => setItemFields(item.id, { typeId: e.target.value })}
                      className={cn(WELL, 'w-full font-medium outline-none transition focus:ring-2 focus:ring-indigo-400')}
                    >
                      {typeOptions.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </Field>
                )}

                {isInitiative && (
                  <Field label="Kind">
                    <select
                      value={item.initiativeTypeId ?? ''}
                      onChange={(e) => setInitiativeKind(item.id, e.target.value || undefined)}
                      className={cn(WELL, 'w-full font-medium outline-none transition focus:ring-2 focus:ring-indigo-400')}
                    >
                      <option value="">None</option>
                      {kinds.map((k) => (
                        <option key={k.id} value={k.id}>{k.name}</option>
                      ))}
                      {/* A kind defined on another board still shows, so the control never lies
                          about what the item says. */}
                      {kind && !kinds.some((k) => k.id === kind.id) && <option value={kind.id}>{kind.name}</option>}
                    </select>
                  </Field>
                )}

                <Field label="People">
                  <div className="flex flex-wrap items-center gap-1">
                    {(item.assignees ?? []).map((id) => {
                      const u = userById(id)
                      return (
                        <span key={id} className={CHIP}>
                          <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-white text-micro font-bold text-slate-600 ring-1 ring-slate-200">
                            {initialsOf(u?.name ?? id)}
                          </span>
                          {u?.name ?? id}
                          <button
                            onClick={() => setItemFields(item.id, { assignees: (item.assignees ?? []).filter((x) => x !== id) })}
                            className="text-slate-500 transition hover:text-rose-600"
                            title={`Remove ${u?.name ?? id}`}
                            aria-label={`Remove ${u?.name ?? id}`}
                          >
                            <X size={11} />
                          </button>
                        </span>
                      )
                    })}
                    <input
                      list="flowline-assignees"
                      value={assigneeDraft}
                      onChange={(e) => setAssigneeDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          applyAssignee()
                        }
                      }}
                      placeholder="Add a name…"
                      className="min-w-[6rem] flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-meta outline-none transition focus:ring-2 focus:ring-indigo-400"
                    />
                    <datalist id="flowline-assignees">
                      {users.map((u) => (
                        <option key={u.id} value={u.name} />
                      ))}
                    </datalist>
                  </div>
                </Field>

                {/* Tags — a set, on a card or an initiative alike. Adding offers this board's tags
                    (the board whose surface the panel is beside); removing always works, so an item
                    can be cleared whatever happened to a definition. */}
                <Field label="Tags" hint={boardTagList.length === 0 ? 'This board has no tags yet — type one to make it.' : undefined}>
                  <div className="flex flex-wrap items-center gap-1">
                    {itemTags.map((t) => {
                      const chip = chipColors(t.color)
                      return (
                        <span
                          key={t.id}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-meta font-medium"
                          style={{ backgroundColor: chip.background, color: chip.color }}
                        >
                          {t.name}
                          <button
                            onClick={() => toggleItemTag(boardId, item.id, t.id)}
                            className="opacity-60 transition hover:opacity-100"
                            title={`Remove ${t.name}`}
                            aria-label={`Remove ${t.name}`}
                          >
                            <X size={11} />
                          </button>
                        </span>
                      )
                    })}
                    {/* Type to find one: the board's vocabulary, filtered as you go — or to make
                        a new one, which the board settings then owns like any other. */}
                    <TagInput
                      tags={boardTagList}
                      carried={item.tagIds ?? []}
                      onAdd={(id) => toggleItemTag(boardId, item.id, id)}
                      onCreate={(name) => {
                        const id = addTag(boardId, name, TAG_PALETTE[boardTagList.length % TAG_PALETTE.length])
                        if (id) toggleItemTag(boardId, item.id, id)
                      }}
                      className="min-w-[7rem] flex-1"
                    />
                  </div>
                </Field>

                {isInitiative ? (
                  /* An initiative has no estimate: its size is the sum of the sizes of the items
                     below it. So the field reads rather than writes, and says why. */
                  <Field label="Size below">
                    <div className={WELL} title="The sizes of the leaf work below this initiative, unsized work counting as 1 — never entered">
                      <span className="min-w-0 flex-1 truncate text-meta font-semibold tabular-nums text-slate-700">{roll.size} pts</span>
                      <span className="shrink-0 text-micro text-slate-600">Derived</span>
                    </div>
                  </Field>
                ) : (
                  <Field label="Estimate">
                    <div className={WELL}>
                      <input
                        type="number"
                        min={0}
                        value={item.size ?? ''}
                        onChange={(e) => setItemFields(item.id, { size: e.target.value === '' ? undefined : Number(e.target.value) })}
                        placeholder="—"
                        aria-label="Estimate in points"
                        className="w-12 min-w-0 bg-transparent text-meta font-semibold tabular-nums text-slate-700 outline-none"
                      />
                      <span className="text-meta text-slate-600">pts</span>
                    </div>
                  </Field>
                )}

                <Field label="Target dates" className="col-span-2">
                  <div className={WELL}>
                    <CalendarDays size={13} className="shrink-0 text-slate-400" />
                    <input
                      type="date"
                      value={item.targetStartDate ?? ''}
                      onChange={(e) => setItemFields(item.id, { targetStartDate: e.target.value || undefined })}
                      aria-label="Target start"
                      className="min-w-0 flex-1 bg-transparent text-meta text-slate-700 outline-none"
                    />
                    <ArrowRight size={12} className="shrink-0 text-slate-400" />
                    <input
                      type="date"
                      value={item.targetEndDate ?? ''}
                      onChange={(e) => setItemFields(item.id, { targetEndDate: e.target.value || undefined })}
                      aria-label="Target end"
                      className="min-w-0 flex-1 bg-transparent text-meta text-slate-700 outline-none"
                    />
                  </div>
                </Field>
              </div>
            </section>

            {/* The direct parent, called out on its own rather than left to be read out of the
                chain: it is the one relationship a card has, and the one thing about it you can
                change. The whole chain is a tab away. */}
            <Section
              label="Parent"
              action={
                <button
                  onClick={() => {
                    setParentEditorOpen((o) => !o)
                    setParentChoice('')
                  }}
                  className="text-micro font-medium text-indigo-600 transition hover:text-indigo-500"
                >
                  {parentEditorOpen ? 'Cancel' : 'Change parent'}
                </button>
              }
            >
              {parentEditorOpen ? (
                <div className="space-y-2 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
                  <select
                    value={parentChoice}
                    onChange={(e) => setParentChoice(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-meta outline-none transition focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="">Choose an initiative…</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1.5">
                    <button
                      disabled={!parentChoice}
                      onClick={() => { setParent(item.id, parentChoice); setParentChoice(''); setParentEditorOpen(false) }}
                      className="rounded-lg bg-indigo-600 px-2.5 py-1 text-meta font-medium text-white transition hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-40"
                    >
                      Set parent
                    </button>
                    {parent && (
                      <button
                        onClick={() => { setParent(item.id, null); setParentEditorOpen(false) }}
                        className="rounded-lg px-2 py-1 text-meta font-medium text-slate-600 transition hover:bg-slate-200 hover:text-slate-900"
                      >
                        Remove parent
                      </button>
                    )}
                  </div>
                  <p className="text-micro text-slate-600">A parent is always an initiative. Everything below it rolls up to it.</p>
                </div>
              ) : parent ? (
                <button
                  onClick={() => close(parent.id)}
                  title={`Open ${parent.title}`}
                  className="flex w-full items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 text-left ring-1 ring-slate-200 transition hover:bg-slate-100"
                >
                  <CornerLeftUp size={15} className="shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-meta font-semibold text-slate-800">{parent.title}</span>
                    <span className="block truncate text-micro text-slate-600">{parentKind}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-micro font-medium text-slate-600 ring-1 ring-slate-200">
                    {boardOf(parent.id)?.name ?? 'Not on a board'}
                  </span>
                </button>
              ) : (
                <p className="rounded-xl bg-slate-50 p-3 text-meta text-slate-600 ring-1 ring-slate-200">
                  No parent — this sits on its own.
                </p>
              )}
            </Section>

            {/* Strategic impact — OKRs attach to initiatives, and to nothing else. A card is
                not shown its initiative's OKRs either: relating work to strategy is the
                initiative's job, and asking a team to do it card by card is the thing
                initiatives exist to save them from. */}
            {isStrategic && (
              <Section label="Strategic impact">
                <div className="space-y-2 rounded-xl bg-indigo-50/60 p-3 ring-1 ring-indigo-100">
                    {/* One choice, not a set — the shape the kind and the type already have, and the
                        shape the model keeps. Choosing another objective moves the initiative, so
                        there is nothing here to tick twice and nothing that could serve two. */}
                    <Field label="Objective">
                      <select
                        value={attributed[0]?.id ?? ''}
                        onChange={(e) => {
                          const next = e.target.value
                          if (next) setAttribution(item.id, next, true)
                          else if (attributed[0]) setAttribution(item.id, attributed[0].id, false)
                        }}
                        title="The objective this initiative serves — at most one, so choosing another moves it"
                        className="w-full rounded-lg border border-indigo-200 bg-white px-2 py-1.5 text-meta font-medium text-slate-700 outline-none transition focus:ring-2 focus:ring-indigo-400"
                      >
                        <option value="">No objective</option>
                        {objectives.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.title} · {o.period}
                          </option>
                        ))}
                      </select>
                    </Field>

                    {attributed.length === 0 ? (
                      <p className="text-meta text-slate-600">No objective yet.</p>
                    ) : (
                      <>
                        {/* What the objective means, and how far along the work that serves it is.
                            The key results are the words; the number comes from the work. */}
                        {keyResults.filter((k) => k.objectiveId === attributed[0].id).length === 0 ? (
                          <p className="text-meta text-slate-600">This objective has no key results yet.</p>
                        ) : (
                          <ul className="space-y-0.5">
                            {keyResults
                              .filter((k) => k.objectiveId === attributed[0].id)
                              .map((k) => (
                                <li key={k.id} className="flex items-start gap-1.5 text-meta text-slate-700" title={k.title}>
                                  <Target size={11} className="mt-0.5 shrink-0 text-indigo-400" />
                                  <span className="min-w-0 flex-1">{k.title}</span>
                                </li>
                              ))}
                          </ul>
                        )}
                      <ObjectiveProgress objectiveId={attributed[0].id} />
                    </>
                  )}
                </div>
              </Section>
            )}

            {/* The description — the card's own words, written as markdown. */}
            <Section
              label="Description"
              action={
                <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 p-0.5">
                  {(['Write', 'Preview'] as const).map((m) => {
                    const on = (m === 'Preview') === showPreview
                    return (
                      <button
                        key={m}
                        onClick={() => setShowPreview(m === 'Preview')}
                        className={cn(
                          'rounded-md px-2 py-0.5 text-micro font-medium transition',
                          on ? 'bg-slate-800 text-white' : 'text-slate-600 hover:text-slate-900',
                        )}
                      >
                        {m}
                      </button>
                    )
                  })}
                </div>
              }
            >
              {showPreview ? (
                <div
                  className="min-h-[72px] rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-meta leading-relaxed text-slate-700"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(item.description ?? '') || '<p class="text-slate-600">Nothing to preview yet.</p>' }}
                />
              ) : (
                <textarea
                  value={item.description ?? ''}
                  onFocus={() => startTextEdit(item.id, 'description', item.description ?? '')}
                  onBlur={() => endTextEdit('description')}
                  onChange={(e) => setItemFields(item.id, { description: e.target.value })}
                  rows={5}
                  placeholder="Add a description. Markdown is supported — **bold**, lists, `code`, links."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-meta leading-relaxed outline-none transition focus:ring-2 focus:ring-indigo-400"
                />
              )}
            </Section>

            {/* Checklist — a card's sub-tasks. They are not work of their own: no
                placement, no WIP, no status beyond ticked. An initiative has children
                instead, and they are listed under Hierarchy. */}
            {!isInitiative && (
              <Section
                label="Checklist"
                count={checklist.length}
                aside={
                  checklist.length > 0 ? (
                    <span className="text-micro text-slate-600">{checklist.filter((c) => c.done).length} of {checklist.length} done</span>
                  ) : undefined
                }
              >
                <div className="space-y-0.5">
                  {checklist.length === 0 && <p className="text-meta text-slate-600">Nothing here yet. Add the first sub-task below.</p>}
                  {checklist.map((entry) => (
                    <div key={entry.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition hover:bg-slate-50">
                      <button onClick={() => toggleChecklistEntry(item.id, entry.id)} title={entry.done ? 'Untick' : 'Tick'} className="shrink-0">
                        <span
                          className={cn(
                            'flex h-4 w-4 items-center justify-center rounded border transition',
                            entry.done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white',
                          )}
                        >
                          {entry.done && <Check size={11} />}
                        </span>
                      </button>
                      {editingEntry === entry.id ? (
                        <input
                          data-checklist-editor
                          autoFocus
                          value={entryDraft}
                          onChange={(e) => setEntryDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEntry(entry.id)
                            if (e.key === 'Escape') {
                              abandoned.current = true
                              setEditingEntry(null)
                            }
                          }}
                          onBlur={() => saveEntry(entry.id)}
                          className="min-w-0 flex-1 rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-meta outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                      ) : (
                        <button
                          onClick={() => startEditingEntry(entry.id, entry.text)}
                          title="Click to edit — clearing it removes the line"
                          className={cn(
                            'min-w-0 flex-1 cursor-text truncate text-left text-meta',
                            entry.done ? 'text-slate-600 line-through' : 'text-slate-700',
                          )}
                        >
                          {entry.text}
                        </button>
                      )}
                      <button
                        onClick={() => removeChecklistEntry(item.id, entry.id)}
                        title="Remove"
                        aria-label={`Remove ${entry.text}`}
                        className="shrink-0 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:text-rose-600"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addSubtask()
                    }}
                    placeholder="Add a sub-task…"
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-meta outline-none transition focus:ring-2 focus:ring-indigo-400"
                  />
                  <button
                    disabled={newSubtask.trim().length === 0}
                    onClick={addSubtask}
                    className="flex shrink-0 items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-meta font-medium text-white transition hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>
              </Section>
            )}
          </>
        )}

        {tab === 'hierarchy' && (
          <>
            {/* The whole chain, from the objective down to this item — read here, changed on the
                Overview. */}
            <Section label="How this rolls up">
              <div className="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-200">
                  {/* The objectives this work serves, at the top of the chain — they are the
                      "why" above the "what". */}
                  {lineageObjectives.map((o) => (
                    <button
                      key={`okr-${o.id}`}
                      onClick={() => {
                        close(null)
                        setObjectives(true)
                      }}
                      title="Open Objectives & Key Results"
                      className="flex w-full items-center gap-2 bg-indigo-50/60 px-2.5 py-2 text-left transition hover:bg-indigo-50"
                    >
                      <Target size={12} className="shrink-0 text-indigo-500" />
                      <span className="min-w-0 flex-1 truncate text-meta font-medium text-indigo-700">{o.title}</span>
                      <span className="shrink-0 text-micro font-semibold uppercase tracking-wide text-indigo-500">Objective</span>
                    </button>
                  ))}
                  {lineage.map((node) => {
                    const self = node.id === item.id
                    return self ? (
                      <div key={node.id} className="flex items-center gap-2 bg-slate-50 px-2.5 py-2">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: typeColor(node.typeId) }} />
                        <span className="min-w-0 flex-1 truncate text-meta font-semibold text-slate-800">{node.title}</span>
                      </div>
                    ) : (
                      <button
                        key={node.id}
                        onClick={() => close(node.id)}
                        title={`Open ${node.title}`}
                        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition hover:bg-slate-50"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: typeColor(node.typeId) }} />
                        <span className="min-w-0 flex-1 truncate text-meta text-slate-700">{node.title}</span>
                        <span className="shrink-0 text-micro text-slate-600">{typeName(node.typeId)}</span>
                      </button>
                    )
                  })}
              </div>
            </Section>

            {/* Children — the items below this one. Real work, with its own status and its
                own home on a board; a card's own sub-tasks are a checklist, not children. */}
            <Section label="Items below" count={children.length} aside={doneBelow && <span className="text-micro text-slate-600">{doneBelow}</span>}>
              {children.length === 0 ? (
                <p className="text-meta text-slate-600">
                  Nothing below this yet. An initiative below it is made with <span className="font-medium">+ Initiative</span> on the board.
                </p>
              ) : (
                /* Grouped by stage, in the order a board reads them: the list and the board can be
                   read against each other, and a reader looking for what has not started is not
                   hunting through what is done. */
                <div className="space-y-3">
                  {STAGE_ORDER.map((stage) => {
                    const group = children.filter((c) => rollupOf(c.id, graph).bucket === stage)
                    if (group.length === 0) return null
                    return (
                      <div key={stage} className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className={cn('h-1.5 w-1.5 rounded-full', STAGE_DOT[stage])} />
                          <span className="text-micro font-semibold uppercase tracking-wide text-slate-600">{STAGE_LABELS[stage]}</span>
                          <span className="text-micro tabular-nums text-slate-600">{group.length}</span>
                        </div>
                        {group.map((c) => itemRow(c, () => close(c.id), { stage: false }))}
                      </div>
                    )
                  })}
                </div>
              )}
              {exposure.length > 0 && <p className="text-micro text-amber-700">{exposure.length} still open below.</p>}
            </Section>

            {/* Dependencies — a link between two items. */}
            <Section label="Dependencies" count={dependencies.length + dependents.length}>
              {dependencies.length === 0 && dependents.length === 0 && (
                <p className="text-meta text-slate-600">No links yet. Add one below.</p>
              )}
              {dependencies.length > 0 && (
                <div className="space-y-1">
                  <p className="text-micro font-semibold uppercase tracking-wide text-slate-600">Depends on</p>
                  {dependencies.map((dep) =>
                    itemRow(dep.dependency, () => openOrGo(dep.dependency.id), {
                      onRemove: () => removeDependency(dep.dependency.id, dep.dependent.id),
                    }),
                  )}
                </div>
              )}
              {dependents.length > 0 && (
                <div className="space-y-1">
                  <p className="text-micro font-semibold uppercase tracking-wide text-slate-600">Depends on this</p>
                  {dependents.map((dep) => itemRow(dep.dependent, () => openOrGo(dep.dependent.id)))}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <select
                  value={dependencyId}
                  onChange={(e) => setDependencyId(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-meta outline-none transition focus:ring-2 focus:ring-indigo-400"
                >
                  <option value="">This depends on…</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
                <button
                  disabled={!dependencyId}
                  onClick={() => { addDependency(dependencyId, item.id); setDependencyId('') }}
                  className="shrink-0 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-meta font-medium text-white transition hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-40"
                >
                  Add link
                </button>
              </div>
              <p className="text-micro text-slate-600">A link says one item depends on another. It never blocks anything by itself.</p>
            </Section>

            {/* Placements — the boards this item is on, and the cell in each. */}
            <Section label="On these boards" count={itemPlacements.length}>
              {itemPlacements.length === 0 ? (
                <p className="text-meta text-slate-600">Not on any board yet.</p>
              ) : (
                <div className="space-y-1">
                  {itemPlacements.map((p) => {
                    const b = boards.find((bb) => bb.id === p.boardId)
                    const here = p.boardId === boardId
                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          selectBoard(p.boardId)
                          close(item.id)
                        }}
                        title={here ? 'This is the board in front of you' : `Go to ${b?.name ?? 'board'}`}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition',
                          here ? 'border-slate-200 bg-slate-50' : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate text-slate-700">{b?.name ?? '—'}</span>
                        <span className="min-w-0 max-w-[55%] truncate text-micro text-slate-600">{lanePath(lanes, p.laneId).join(' / ')}</span>
                        {!here && <ArrowRight size={12} className="shrink-0 text-indigo-500" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </Section>
          </>
        )}

        {tab === 'activity' && (
          <Section label="Activity" count={log.length} aside={<span className="text-micro text-slate-600">Newest first</span>}>
            {log.length === 0 ? (
              <p className="text-meta text-slate-600">Nothing has happened to this yet.</p>
            ) : (
              <div className="space-y-1">
                {[...log].reverse().map((e) => (
                  <div key={e.id} className="flex items-start gap-2 rounded-lg border border-slate-200 px-2.5 py-2">
                    <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', LOG_STYLES[e.kind] ?? 'bg-slate-300')} />
                    <div className="min-w-0 flex-1">
                      <div className="text-meta text-slate-700">
                        <span className="font-medium capitalize">{e.kind}</span>
                        {e.kind === 'noted' && e.note ? (
                          // A comment is markdown, like a description — the composer promises it.
                          <div className="mt-0.5" dangerouslySetInnerHTML={{ __html: renderMarkdown(e.note) }} />
                        ) : (
                          e.note ? ` — ${e.note}` : ''
                        )}
                      </div>
                      <div className="text-micro text-slate-600">{whenLabel(e.at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}
      </div>

      {/* ---- The composer: one line, and what it will do ------------------------- */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && note.trim()) {
                addLogNote(item.id, note.trim())
                setNote('')
              }
            }}
            placeholder="Leave a note or mention @teammate…"
            aria-label="Leave a note"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-meta outline-none transition focus:ring-2 focus:ring-indigo-400"
          />
          <button
            disabled={note.trim().length === 0}
            onClick={() => {
              addLogNote(item.id, note.trim())
              setNote('')
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-meta font-semibold text-white transition hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-40"
          >
            <Send size={13} /> Send
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between px-0.5 text-micro text-slate-600">
          <span>Press Enter to send</span>
          <span>Markdown supported</span>
        </div>
      </div>
    </aside>
  )
}

/**
 * When something happened, as a person says it: today, yesterday, or the date.
 *
 * The full timestamp is what the log holds; a drawer read at a glance wants the day, and the time
 * only when it is the same day — where "14:32" is the useful part and the date is noise.
 */
function whenLabel(at: number): string {
  const then = new Date(at)
  const now = new Date()
  const day = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  const time = then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (day(then) === day(now)) return `Today at ${time}`
  const yesterday = new Date(now.getTime() - 86_400_000)
  if (day(then) === day(yesterday)) return `Yesterday at ${time}`
  return then.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

function IconButton({
  children,
  title,
  onClick,
  active,
  danger,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  active?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'grid h-7 w-7 place-items-center rounded-lg transition',
        danger
          ? 'text-slate-500 hover:bg-rose-50 hover:text-rose-600'
          : active
            ? 'bg-indigo-50 text-indigo-600'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      )}
    >
      {children}
    </button>
  )
}

/**
 * A named part of the panel: a small heading, the count of what is in it, and — where there is
 * one — the action or the summary that belongs at the heading's right edge. One shape for every
 * section, so the eye can find the next one without reading.
 */
function Section({
  label,
  count,
  aside,
  action,
  children,
}: {
  label: string
  count?: number
  aside?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex min-h-6 items-center gap-2">
        <h3 className="text-micro font-semibold uppercase tracking-wide text-slate-600">{label}</h3>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-slate-100 px-1.5 text-micro font-semibold tabular-nums text-slate-600">{count}</span>
        )}
        {(aside || action) && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {aside}
            {action}
          </div>
        )}
      </div>
      {children}
    </section>
  )
}

/**
 * How far along an objective is, wherever an objective is read beside work.
 *
 * The number comes from the initiatives attributed to the objective and the leaves below them —
 * the same rollup an initiative uses, so the two can never disagree. An objective nothing serves
 * has no number: 0% would be a worse way of saying that nothing serves it.
 */
function ObjectiveProgress({ objectiveId }: { objectiveId: string }) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const roll = objectiveRollup(objectiveId, { items, edges, links, placements, lanes })
  if (!roll) return null
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-meta">
        <span className="text-slate-600">Work serving it</span>
        <span className="shrink-0 font-semibold tabular-nums text-slate-700">{roll.percent}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-indigo-100">
        <div className="h-full bg-indigo-500 transition-all" style={{ width: `${roll.percent}%` }} />
      </div>
      <div className="text-micro text-slate-600">
        {roll.total} {roll.total === 1 ? 'item' : 'items'} below, {roll.size} pts
      </div>
    </div>
  )
}

/** A field: what it is called, the value, and — where it helps — why the value is what it is. */
function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-meta font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="text-micro leading-snug text-slate-600">{hint}</span>}
    </label>
  )
}
