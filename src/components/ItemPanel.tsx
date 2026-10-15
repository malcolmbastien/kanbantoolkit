import { useRef, useState } from 'react'
import {
  Archive,
  ArrowDown,
  Ban,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDot,
  Eye,
  Flag,
  GitBranch,
  LayoutGrid,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Network,
  Pencil,
  Plus,
  Target,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react'
import {
  attributedObjectives,
  checklistItems,
  decompositionChildren,
  decompositionParent,
  dependenciesOf,
  dependentsOf,
  depth as depthOf,
  descendants,
  dependencyState,
  dependentSummary,
  lineageOf,
  openDescendants,
  rollupOf,
  statusOf,
  type Graph,
} from '@/domain/derive'
import { buildRefs, boardCardTypes } from '@/domain/board'
import { lanePath, STAGE_LABELS } from '@/domain/lanes'
import { renderMarkdown } from '@/lib/markdown'
import { PRIORITY_META, PRIORITY_ORDER } from './PriorityBadge'
import { initialsOf } from '@/domain/users'
import { chipColors, DEP_STATE_STYLES, stageChip } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Item } from '@/domain/types'

interface Props {
  itemId: string
}

/** Dot colour per log event kind. */
const LOG_STYLES: Record<string, string> = {
  created: 'bg-slate-300',
  blocked: 'bg-rose-500',
  unblocked: 'bg-emerald-500',
  noted: 'bg-indigo-400',
  limit: 'bg-amber-500',
}


type Tab = 'details' | 'hierarchy' | 'activity'

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
  const linkTeamInitiative = useStore((s) => s.linkTeamInitiative)
  const addDependency = useStore((s) => s.addDependency)
  const setAttribution = useStore((s) => s.setAttribution)
  const blockItem = useStore((s) => s.blockItem)
  const unblockItem = useStore((s) => s.unblockItem)
  const addLogNote = useStore((s) => s.addLogNote)
  const archiveItem = useStore((s) => s.archiveItem)
  const unarchiveItem = useStore((s) => s.unarchiveItem)
  const deleteItem = useStore((s) => s.deleteItem)
  const askConfirm = useStore((s) => s.askConfirm)
  const addAssignee = useStore((s) => s.addAssignee)
  const boardId = useStore((s) => s.boardId)
  const selectBoard = useStore((s) => s.selectBoard)
  const setObjectives = useStore((s) => s.setObjectives)
  const toggleLens = useStore((s) => s.toggleLens)
  const lensId = useStore((s) => s.lensId)

  const [tab, setTab] = useState<Tab>('details')
  const [moreOpen, setMoreOpen] = useState(false)
  const [priorityOpen, setPriorityOpen] = useState(false)
  const [blockOpen, setBlockOpen] = useState(false)
  const [dependencyId, setDependencyId] = useState('')
  const [parentChoice, setParentChoice] = useState('')
  const [linkBoardId, setLinkBoardId] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [blockReason, setBlockReason] = useState('')
  const [note, setNote] = useState('')
  const [newSubtask, setNewSubtask] = useState('')
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
  const refs = buildRefs(items, issueTypes)
  const d = depthOf(item.id, graph)
  const parentId = decompositionParent(item.id, edges)
  const parent = parentId ? items.find((i) => i.id === parentId) : undefined
  const children = decompositionChildren(item.id, edges)
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is Item => Boolean(i))
  const dependencies = dependenciesOf(item.id, graph)
  const dependents = dependentsOf(item.id, graph)
  const exposure = openDescendants(item.id, graph)
  const badge = dependentSummary(item.id, graph)
  const attributed = attributedObjectives(item.id, edges, objectives)
  const status = statusOf(item.id, graph)
  const stage = rollupOf(item.id, graph).bucket
  const log = item.log ?? []
  const itemPlacements = placements.filter((p) => p.itemId === item.id)

  const initiativeTypeId = issueTypes.find((t) => t.name === 'Initiative')?.id
  const isInitiative = Boolean(initiativeTypeId && item.typeId === initiativeTypeId)
  const isSubtask = item.typeId === issueTypes.find((t) => t.name === 'Sub-task')?.id
  // Two types belong to the system rather than the user, so the control is not offered.
  const typeIsFixed = isInitiative || isSubtask
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

  // Lineage rows — the OKRs first, then the chain top-down. Rendered with a
  // centred arrow between rows so depth reads clearly without indentation.
  const lineageRows = [
    ...lineageObjectives.map((o) => ({
      key: `okr-${o.id}`,
      node: (
        <button
          onClick={() => {
            close(null)
            setObjectives(true)
          }}
          title="Open Objectives & Key Results"
          className="flex w-full items-center gap-1.5 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-left text-meta font-medium text-indigo-700 transition hover:bg-indigo-100"
        >
          <Target size={11} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{o.title}</span>
          <span className="shrink-0 text-micro font-semibold uppercase tracking-wide text-indigo-400">OKR</span>
        </button>
      ),
    })),
    ...lineage.map((node) => {
      const self = node.id === item.id
      const body = (
        <>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: typeColor(node.typeId) }} />
          <span className="min-w-0 flex-1 truncate">{node.title}</span>
          <span className={cn('shrink-0 text-micro font-semibold uppercase tracking-wide', self ? 'text-slate-600' : 'text-slate-600')}>
            {typeName(node.typeId)}
          </span>
        </>
      )
      return {
        key: node.id,
        node: self ? (
          <div className="flex items-center gap-1.5 rounded bg-slate-800 px-2 py-1 text-meta font-medium text-white">{body}</div>
        ) : (
          <button
            onClick={() => close(node.id)}
            title={`Open ${node.title}`}
            className="flex w-full items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-left text-meta text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600"
          >
            {body}
          </button>
        ),
      }
    }),
  ]
  // Initiative is reserved for the Initiatives workflow — a card can't be promoted to it.
  // The board's allowed card types, plus the item's current type so it always shows.
  const boardTypes = boardCardTypes(boards.find((b) => b.id === boardId), issueTypes)
  const typeOptions = issueTypes.filter((t) => boardTypes.some((b) => b.id === t.id) || t.id === item.typeId)
  const teamBoards = boards.filter((b) => b.band === 'team')
  const linkedInitiatives = children.filter((c) => c.typeId === initiativeTypeId)
  const boardOf = (id: string) =>
    boards.find((b) => b.id === placements.find((p) => p.itemId === id)?.boardId)

  const candidates = items.filter((i) => i.id !== item.id && !descendants(item.id, graph).includes(i.id))
  const relatedCount = children.length + dependencies.length + dependents.length + itemPlacements.length


  const tabs: { id: Tab; label: string; icon: typeof LayoutGrid; count?: number }[] = [
    { id: 'details', label: 'Details', icon: LayoutGrid },
    { id: 'hierarchy', label: 'Hierarchy & Links', icon: Network, count: relatedCount },
    { id: 'activity', label: 'Activity', icon: MessageSquare, count: log.length },
  ]

  return (
    <aside
      data-item-panel
      className="flex h-full w-[460px] shrink-0 flex-col border-l border-slate-300 bg-slate-50 shadow-[-10px_0_24px_-14px_rgba(15,23,42,0.25)]"
    >
      {/* ---- Header: breadcrumb, actions, title, tabs ------------------------------ */}
      <div className="shrink-0 space-y-2 border-b border-slate-200 bg-white px-3 py-2.5">
        <div className="flex items-center gap-2">
          <nav className="flex min-w-0 items-center gap-1 text-meta text-slate-600">
            {[...lineage].reverse().slice(0, 3).map((node) => (
              <span key={node.id} className="flex min-w-0 items-center gap-1">
                <button
                  onClick={() => close(node.id)}
                  title={`Open ${node.title}`}
                  className="min-w-0 truncate transition hover:text-slate-700"
                >
                  {node.title}
                </button>
                <span className="text-slate-600">/</span>
              </span>
            ))}
            <span className="shrink-0 font-semibold text-indigo-600">{refs.get(item.id)}</span>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <IconButton
              title={focusOn ? 'Clear focus' : 'Focus — highlight this lineage on the board'}
              active={focusOn}
              onClick={() => toggleLens(item.id)}
            >
              <Eye size={15} />
            </IconButton>
            <IconButton
              title="More — card type, archive, delete"
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
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
            {typeIsFixed ? (
              <p className="text-meta text-slate-600">
                {isInitiative
                  ? 'Type is fixed. An initiative is defined by the Initiative type, and the initiatives workflow reads it — so it is never retyped into a card type.'
                  : 'Type is fixed. Sub-task belongs to the system rather than to you — a card\'s sub-tasks are a checklist, not items.'}
              </p>
            ) : (
              <label className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-micro uppercase tracking-wide text-slate-600">Type</span>
                <select
                  value={item.typeId}
                  onChange={(e) => setItemFields(item.id, { typeId: e.target.value })}
                  className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-meta font-medium"
                >
                  {typeOptions.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex items-center gap-1.5">
              {item.archived ? (
                <button
                  onClick={() => unarchiveItem(item.id)}
                  className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-meta font-medium text-amber-700 hover:bg-amber-100"
                >
                  <Archive size={11} /> Restore
                </button>
              ) : (
                <button
                  onClick={() => archiveItem(item.id)}
                  title="File this item (and its children) off the boards"
                  className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-meta font-medium text-slate-600 hover:bg-slate-100"
                >
                  <Archive size={11} /> Archive
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
                className="flex items-center gap-1 rounded border border-rose-300 px-2 py-1 text-meta font-medium text-rose-600 hover:bg-rose-50"
              >
                <Trash2 size={11} /> Delete
              </button>
            </div>
          </div>
        )}

        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="rounded px-1.5 py-px text-micro font-bold uppercase tracking-wide"
              style={{ backgroundColor: chipColors(type.color).background, color: chipColors(type.color).color }}
            >
              {type.name}
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-px font-mono text-meta font-semibold text-slate-600">
              {refs.get(item.id)}
            </span>
            <span className="rounded bg-indigo-50 px-1.5 py-px text-meta font-medium text-indigo-600" title="Where this card sits">
              {boards.find((b) => b.id === boardId)?.name ?? 'Board'}
            </span>
            {item.blocked ? (
              <button
                onClick={() => unblockItem(item.id)}
                className="ml-auto flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-meta font-semibold text-white hover:bg-rose-700"
              >
                <Ban size={11} /> Unblock
              </button>
            ) : (
              <button
                onClick={() => setBlockOpen((o) => !o)}
                className={cn(
                  'ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold transition',
                  blockOpen ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600 hover:bg-rose-50 hover:text-rose-600',
                )}
              >
                <Flag size={11} /> Mark Blocked
              </button>
            )}
          </div>

          {item.blocked && item.blockedReason && (
            <p className="rounded bg-rose-50 px-2 py-1 text-meta text-rose-700">{item.blockedReason}</p>
          )}
          {blockOpen && !item.blocked && (
            <div className="flex items-center gap-1">
              <input
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder="Reason (optional)…"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    blockItem(item.id, blockReason)
                    setBlockReason('')
                    setBlockOpen(false)
                  }
                }}
                className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-meta outline-none focus:ring-2 focus:ring-rose-300"
              />
              <button
                onClick={() => {
                  blockItem(item.id, blockReason)
                  setBlockReason('')
                  setBlockOpen(false)
                }}
                className="flex items-center gap-1 rounded bg-rose-600 px-2 py-1 text-meta font-medium text-white hover:bg-rose-700"
              >
                <Ban size={11} /> Block
              </button>
            </div>
          )}

          <input
            value={item.title}
            onChange={(e) => setItemFields(item.id, { title: e.target.value })}
            className="w-full rounded border border-transparent bg-transparent text-title font-semibold leading-snug text-slate-800 hover:border-slate-200 focus:border-indigo-300 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
          {tabs.map((t) => {
            const on = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md px-1.5 py-1 text-meta font-medium transition',
                  on ? 'bg-white font-semibold text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-800',
                )}
              >
                <t.icon size={13} />
                <span className="truncate">{t.label}</span>
                {t.count !== undefined && t.count > 0 && (
                  <span className={cn('rounded-full px-1.5 text-micro font-bold tabular-nums', on ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600')}>
                    {t.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ---- Body ---------------------------------------------------------------- */}
      {/* The panel is the one place a card's own words are worth copying, so it opts back in. */}
      <div className="min-h-0 flex-1 select-text overflow-y-auto px-3 py-3 text-meta">
        {tab === 'details' && (
          <div className="space-y-4">
            {/* Property grid — the four things you set while working */}
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-2.5">
              <Field label="Status">
                <div
                  className="flex items-center gap-1.5 rounded bg-white px-2 py-1.5 shadow-sm"
                  title="Derived from the board cell and the work beneath — never editable"
                >
                  <CircleDot size={12} className={cn(status.resolved ? 'text-emerald-500' : status.started ? 'text-indigo-500' : 'text-slate-300')} />
                  <span className="truncate text-meta font-medium text-slate-700">{STAGE_LABELS[stage]}</span>
                </div>
              </Field>

              <Field label="Priority">
                <div className="relative">
                  <button
                    onClick={() => setPriorityOpen((o) => !o)}
                    className="flex w-full items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1.5 text-meta font-medium shadow-sm outline-none focus:ring-2 focus:ring-indigo-300"
                    title="Priority — a judgement, stored rather than derived"
                  >
                    {item.priority ? (
                      <>
                        {(() => {
                          const Icon = PRIORITY_META[item.priority].icon
                          return <Icon size={12} className={PRIORITY_META[item.priority].dot} />
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

              <Field label="Lead">
                <div className="flex flex-wrap items-center gap-1">
                  {(item.assignees ?? []).map((id) => {
                    const u = userById(id)
                    return (
                      <span key={id} className="flex items-center gap-1 rounded-full bg-slate-700 py-0.5 pl-0.5 pr-1.5 text-meta font-medium text-white">
                        <span className="grid h-4 w-4 place-items-center rounded-full bg-white/20 text-micro font-bold">
                          {initialsOf(u?.name ?? id)}
                        </span>
                        {u?.name ?? id}
                        <button
                          onClick={() => setItemFields(item.id, { assignees: (item.assignees ?? []).filter((x) => x !== id) })}
                          className="text-slate-300 hover:text-white"
                          title={`Remove ${u?.name ?? id}`}
                        >
                          <X size={10} />
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
                    placeholder="add…"
                    className="min-w-[4rem] flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-meta outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <datalist id="flowline-assignees">
                    {users.map((u) => (
                      <option key={u.id} value={u.name} />
                    ))}
                  </datalist>
                </div>
              </Field>

              <Field label="Estimate">
                <div className="flex items-center gap-1 rounded bg-white px-2 py-1.5 shadow-sm">
                  <input
                    type="number"
                    min={0}
                    value={item.size ?? ''}
                    onChange={(e) => setItemFields(item.id, { size: e.target.value === '' ? undefined : Number(e.target.value) })}
                    placeholder="—"
                    className="w-12 min-w-0 bg-transparent text-meta font-semibold tabular-nums text-slate-700 outline-none"
                  />
                  <span className="text-meta text-slate-600">pts</span>
                </div>
              </Field>

              <Field label="Target start">
                <div className="flex items-center gap-1 rounded bg-white px-2 py-1.5 shadow-sm">
                  <CalendarDays size={12} className="shrink-0 text-slate-400" />
                  <input
                    type="date"
                    value={item.targetStartDate ?? ''}
                    onChange={(e) => setItemFields(item.id, { targetStartDate: e.target.value || undefined })}
                    className="min-w-0 flex-1 bg-transparent text-meta text-slate-600 outline-none"
                  />
                </div>
              </Field>

              <Field label="Target end">
                <div className="flex items-center gap-1 rounded bg-white px-2 py-1.5 shadow-sm">
                  <CalendarDays size={12} className="shrink-0 text-slate-400" />
                  <input
                    type="date"
                    value={item.targetEndDate ?? ''}
                    onChange={(e) => setItemFields(item.id, { targetEndDate: e.target.value || undefined })}
                    className="min-w-0 flex-1 bg-transparent text-meta text-slate-600 outline-none"
                  />
                </div>
              </Field>
            </div>

            {/* Strategic impact — OKRs attach to initiatives, and to nothing else. A card is
                not shown its initiative's OKRs either: relating work to strategy is the
                initiative's job, and asking a team to do it card by card is the thing
                initiatives exist to save them from. */}
            {isInitiative && (
                <section className="rounded-lg bg-indigo-50/70 p-2.5 ring-1 ring-indigo-100">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-micro font-semibold uppercase tracking-wide text-indigo-700">
                    <TrendingUp size={12} /> Strategic impact
                  </span>
                </div>

                {attributed.length === 0 ? (
                  <p className="mt-1 text-meta text-indigo-700/70">No OKR maps to this initiative yet.</p>
                ) : (
                  <div className="mt-1.5 space-y-2">
                    {attributed.map((o) => {
                      const krs = keyResults.filter((k) => k.objectiveId === o.id)
                      return (
                        <div key={o.id} className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-meta font-medium text-slate-700">{o.title}</span>
                            <span className="shrink-0 text-meta text-slate-600">{o.period}</span>
                          </div>
                          {krs.length === 0 && <p className="text-meta text-slate-600">No key results yet.</p>}
                          {krs.map((k) => (
                            <div key={k.id} className="space-y-0.5">
                              <div className="flex items-center justify-between gap-2 text-meta">
                                <span className="min-w-0 truncate text-slate-600">{k.title}</span>
                                <span className="shrink-0 font-semibold tabular-nums text-slate-600">
                                  {k.progress !== undefined ? `${k.progress}%` : '—'}
                                </span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-indigo-100">
                                <div className="h-full bg-indigo-500 transition-all" style={{ width: `${k.progress ?? 0}%` }} />
                              </div>
                              {(k.target || k.current) && (
                                <div className="text-meta text-slate-600">
                                  {k.current ? `now ${k.current}` : ''}{k.current && k.target ? ' · ' : ''}{k.target ? `target ${k.target}` : ''}
                                </div>
                              )}
                            </div>
                          ))}
                          <button
                            onClick={() => setAttribution(item.id, o.id, false)}
                            className="text-meta text-indigo-500 hover:text-indigo-700"
                            title="Unlink this OKR"
                          >
                            unlink
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="mt-2 border-t border-indigo-100 pt-1.5">
                    <span className="text-micro uppercase tracking-wide text-indigo-500">Map an OKR</span>
                    <div className="mt-1 space-y-0.5">
                      {objectives.map((o) => {
                        const on = attributed.some((a) => a.id === o.id)
                        return (
                          <label key={o.id} className="flex items-center gap-2 rounded bg-white/70 px-2 py-1">
                            <input type="checkbox" checked={on} onChange={(e) => setAttribution(item.id, o.id, e.target.checked)} />
                            <span className="min-w-0 flex-1 truncate text-meta text-slate-700">{o.title}</span>
                            <span className="shrink-0 text-meta text-slate-600">{o.period}</span>
                          </label>
                        )
                      })}
                    </div>
                    {attributed.length > 1 && (
                      <p className="mt-1 text-meta text-emerald-700">Serves {attributed.length} OKRs — still 1 unit of WIP.</p>
                    )}
                </div>
                </section>
            )}

            {/* Product specification — the description, rendered as markdown */}
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <SectionLabel>Product specification</SectionLabel>
                <div className="mb-1.5 flex items-center gap-0.5 rounded border border-slate-200 p-0.5">
                  {(['Write', 'Preview'] as const).map((m) => {
                    const on = (m === 'Preview') === showPreview
                    return (
                      <button
                        key={m}
                        onClick={() => setShowPreview(m === 'Preview')}
                        className={cn('rounded px-1.5 py-px text-meta font-medium', on ? 'bg-slate-800 text-white' : 'text-slate-600 hover:text-slate-700')}
                      >
                        {m}
                      </button>
                    )
                  })}
                </div>
              </div>
              {showPreview ? (
                <div
                  className="min-h-[72px] rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-meta leading-relaxed text-slate-700"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(item.description ?? '') || '<p class="text-slate-600">Nothing to preview.</p>' }}
                />
              ) : (
                <textarea
                  value={item.description ?? ''}
                  onChange={(e) => setItemFields(item.id, { description: e.target.value })}
                  rows={5}
                  placeholder="Add a description… (supports **bold**, lists, `code`, links)"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-meta outline-none focus:ring-2 focus:ring-indigo-400"
                />
              )}
            </section>

            {/* Checklist — a card's sub-tasks. They are not work of their own: no
                placement, no WIP, no status beyond ticked. An initiative has children
                instead, and they are listed under Hierarchy & Links. */}
            {!isInitiative && (
              <section>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <SectionLabel>Checklist</SectionLabel>
                  {checklist.length > 0 && (
                    <span className="rounded-full bg-slate-200 px-1.5 text-micro font-bold tabular-nums text-slate-600">
                      {checklist.filter((c) => c.done).length}/{checklist.length}
                    </span>
                  )}
                </div>
                <div className="space-y-0.5">
                  {checklist.length === 0 && <p className="text-meta text-slate-600">No sub-tasks yet.</p>}
                  {checklist.map((entry) => (
                    <div key={entry.id} className="group flex items-center gap-2 rounded px-1 py-1 transition hover:bg-slate-100">
                      <button onClick={() => toggleChecklistEntry(item.id, entry.id)} title={entry.done ? 'Untick' : 'Tick'} className="shrink-0">
                        <span
                          className={cn(
                            'flex h-3.5 w-3.5 items-center justify-center rounded border transition',
                            entry.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white',
                          )}
                        >
                          {entry.done && <Check size={10} />}
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
                          className="min-w-0 flex-1 rounded border border-indigo-300 bg-white px-1 py-px text-meta outline-none focus:ring-2 focus:ring-indigo-300"
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
                        className="shrink-0 text-slate-600 opacity-0 transition group-hover:opacity-100 hover:text-rose-500"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <input
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addSubtask()
                    }}
                    placeholder="Add a sub-task…"
                    className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-meta outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <button
                    disabled={newSubtask.trim().length === 0}
                    onClick={addSubtask}
                    className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-meta font-medium text-white disabled:opacity-40"
                  >
                    <Plus size={11} /> Add
                  </button>
                </div>
              </section>
            )}

          </div>
        )}

        {tab === 'hierarchy' && (
          <div className="space-y-4">
            {/* Lineage — OKR → top-level initiative → … → this item */}
            <section>
              <SectionLabel>Lineage — how this rolls up</SectionLabel>
              <ol className="space-y-0.5">
                {lineageRows.map((row, i) => (
                  <li key={row.key}>
                    {row.node}
                    {i < lineageRows.length - 1 && (
                      <div className="flex justify-center py-0.5 text-slate-300" aria-hidden>
                        <ArrowDown size={12} />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              <p className="mt-1 text-meta text-slate-600">
                {lineageObjectives.length > 0
                  ? 'Top-down: OKR → initiative → this work. Click any step to jump.'
                  : 'Click any step to jump. No OKR maps above this item.'}{' '}
                Depth {d} — derived from the parent chain, not a field.
              </p>
            </section>

            {/* Parent */}
            <section>
              <SectionLabel>Parent — one parent, any number of children</SectionLabel>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
                  <span className="text-micro uppercase tracking-wide text-slate-600">Parent</span>
                  {parent ? (
                    <>
                      <button onClick={() => close(parent.id)} className="min-w-0 flex-1 truncate text-left text-slate-700 hover:text-indigo-600">
                        {typeName(parent.typeId)} · {parent.title}
                      </button>
                      <button onClick={() => setParent(item.id, null)} className="text-slate-600 hover:text-rose-500" title="Remove parent">
                        <X size={12} />
                      </button>
                    </>
                  ) : (
                    <span className="flex-1 text-meta text-slate-600">none (root)</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <select
                    value={parentChoice}
                    onChange={(e) => setParentChoice(e.target.value)}
                    className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-meta"
                  >
                    <option value="">Set parent…</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>{typeName(c.typeId)}: {c.title}</option>
                    ))}
                  </select>
                  <button
                    disabled={!parentChoice}
                    onClick={() => { setParent(item.id, parentChoice); setParentChoice('') }}
                    className="rounded bg-slate-800 px-2 py-1 text-meta font-medium text-white disabled:opacity-40"
                  >
                    Set
                  </button>
                </div>
              </div>
            </section>

            {/* Children — the items below this one. Real work, with its own status and its
                own home on a board; a card's own sub-tasks are a checklist, not children. */}
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <SectionLabel>Children — the items below this one</SectionLabel>
                  {children.length > 0 && (
                    <span className="rounded-full bg-slate-200 px-1.5 text-micro font-bold tabular-nums text-slate-600">{children.length}</span>
                  )}
                </div>
                {exposure.length > 0 && <span className="text-meta text-amber-700">{exposure.length} open below</span>}
              </div>
              <div className="space-y-1">
                {children.length === 0 && <p className="text-meta text-slate-600">No children.</p>}
                {children.map((c) => {
                  const cStatus = statusOf(c.id, graph)
                  return (
                    <button
                      key={c.id}
                      onClick={() => close(c.id)}
                      className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left transition hover:bg-slate-50"
                    >
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', cStatus.resolved ? 'bg-emerald-500' : cStatus.started ? 'bg-indigo-500' : 'bg-slate-300')} />
                      <span className="shrink-0 font-mono text-meta font-medium text-indigo-600">{refs.get(c.id)}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-700">{c.title}</span>
                      {c.archived && <span className="shrink-0 rounded bg-amber-100 px-1 text-meta font-semibold text-amber-700">archived</span>}
                      <span className="shrink-0 text-meta text-slate-600">{boardOf(c.id)?.name ?? '—'}</span>
                      <span className={cn('shrink-0 rounded px-1.5 py-px text-meta font-semibold', stageChip(rollupOf(c.id, graph).bucket))}>
                        {STAGE_LABELS[rollupOf(c.id, graph).bucket]}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-1 text-meta text-slate-600">
                A child is an item of its own — set its parent from its own panel, or link a team initiative below.
              </p>
            </section>

            {/* Links — dependencies between two items */}
            <section>
              <SectionLabel>Links — dependencies</SectionLabel>
              {badge.count > 0 && (
                <div className="mb-2 flex items-center gap-1.5 rounded bg-amber-50 px-2 py-1 text-meta text-amber-800 ring-1 ring-amber-100">
                  <GitBranch size={11} /> {badge.count} card{badge.count > 1 ? 's' : ''} depend on this across {badge.boards} board{badge.boards > 1 ? 's' : ''}
                </div>
              )}
              <div className="space-y-1">
                {dependencies.length === 0 && dependents.length === 0 && <p className="text-meta text-slate-600">No links.</p>}
                {dependencies.map((dep) => {
                  const state = DEP_STATE_STYLES[dep.state]
                  return (
                    <div key={dep.link.id} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                      <div className="flex items-center gap-1 text-meta text-slate-600"><GitBranch size={10} /> depends on</div>
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-slate-700">{dep.dependency.title}</span>
                        {dep.dependency.archived && <span className="rounded bg-amber-100 px-1 text-meta font-semibold text-amber-700">archived</span>}
                        <span className={cn('rounded px-1 text-meta font-semibold ring-1', state.className)}>{state.label}</span>
                      </div>
                      <div className="text-meta text-slate-600">
                        derived → {dependencyState(dep.dependency.id, dep.dependent.id, graph)}
                      </div>
                    </div>
                  )
                })}
                {dependents.map((dep) => (
                  <div key={dep.link.id} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                    <div className="flex items-center gap-1 text-meta text-slate-600"><GitBranch size={10} /> depended on by</div>
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1 truncate text-slate-700">{dep.dependent.title}</div>
                      {dep.dependent.archived && <span className="rounded bg-amber-100 px-1 text-meta font-semibold text-amber-700">archived</span>}
                    </div>
                    <div className="text-meta text-slate-600">{statusOf(dep.dependent.id, graph).resolved ? 'dependent resolved' : `derived → ${DEP_STATE_STYLES[dep.state].label}`}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-1">
                <select value={dependencyId} onChange={(e) => setDependencyId(e.target.value)} className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-meta">
                  <option value="">Add link: this depends on…</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>{typeName(c.typeId)}: {c.title}</option>
                  ))}
                </select>
                <button disabled={!dependencyId} onClick={() => { addDependency(dependencyId, item.id); setDependencyId('') }} className="rounded bg-slate-800 px-2 py-1 text-meta font-medium text-white disabled:opacity-40">Add link</button>
              </div>
              <p className="mt-1 text-meta text-slate-600">
                Links connect two items — this one depends on another. They never set the blocked status.
              </p>
            </section>

            {/* Team initiatives (link a management initiative down to a team board) */}
            {isInitiative && (
              <section>
                <SectionLabel>Team initiatives — linked</SectionLabel>
                <div className="space-y-1">
                  {linkedInitiatives.length === 0 && (
                    <p className="text-meta text-slate-600">No linked team initiatives yet.</p>
                  )}
                  {linkedInitiatives.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => close(c.id)}
                      className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-left hover:bg-slate-50"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                      <span className="min-w-0 flex-1 truncate text-slate-700">{c.title}</span>
                      <span className="text-meta text-slate-600">{boardOf(c.id)?.name ?? '—'}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <select
                    value={linkBoardId}
                    onChange={(e) => setLinkBoardId(e.target.value)}
                    className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-meta"
                  >
                    <option value="">Link to a team board…</option>
                    {teamBoards.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  <input
                    value={linkTitle}
                    onChange={(e) => setLinkTitle(e.target.value)}
                    placeholder="New initiative"
                    className="w-28 rounded border border-slate-200 bg-white px-1.5 py-1 text-meta"
                  />
                  <button
                    disabled={!linkBoardId || linkTitle.trim().length < 2}
                    onClick={() => {
                      linkTeamInitiative(item.id, linkBoardId, linkTitle.trim())
                      setLinkTitle('')
                    }}
                    className="rounded bg-indigo-600 px-2 py-1 text-meta font-medium text-white disabled:opacity-40"
                  >
                    Create
                  </button>
                </div>
                <p className="mt-1 text-meta text-slate-600">
                  Creates a team initiative on that board, beneath this one — its cards roll up here.
                </p>
              </section>
            )}

            {/* Placements — board + cell (click to jump there) */}
            <section>
              <SectionLabel>On these boards ({itemPlacements.length})</SectionLabel>
              <div className="space-y-1">
                {itemPlacements.length === 0 && <p className="text-meta text-slate-600">Not placed on any board.</p>}
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
                      title={here ? 'This board' : `Go to ${b?.name ?? 'board'}`}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg border px-2 py-1 text-left transition',
                        here ? 'border-slate-200 bg-slate-100' : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-slate-700">{b?.name ?? '—'}</span>
                      <span className="min-w-0 max-w-[55%] truncate text-meta text-slate-600">{lanePath(lanes, p.laneId).join(' / ')}</span>
                      {!here && <span className="shrink-0 text-meta text-indigo-500">↗</span>}
                    </button>
                  )
                })}
              </div>
            </section>
          </div>
        )}

        {tab === 'activity' && (
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <SectionLabel>Activity ({log.length})</SectionLabel>
              <span className="text-meta text-slate-600">append-only</span>
            </div>
            <div className="space-y-1">
              {log.length === 0 && <p className="text-meta text-slate-600">No events yet.</p>}
              {[...log].reverse().map((e) => (
                <div key={e.id} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                  <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', LOG_STYLES[e.kind] ?? 'bg-slate-300')} />
                  <div className="min-w-0 flex-1">
                    <div className="text-meta text-slate-700">
                      <span className="font-semibold capitalize">{e.kind}</span>
                      {e.note ? ` — ${e.note}` : ''}
                    </div>
                    <div className="text-meta text-slate-600">{new Date(e.at).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ---- Sticky composer ------------------------------------------------------ */}
      <div className="shrink-0 space-y-1 border-t border-slate-200 bg-white px-3 py-2">
        <div className="relative flex items-center">
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
            className="w-full rounded-lg bg-slate-100 py-2 pl-3 pr-20 text-meta outline-none transition focus:bg-slate-50 focus:ring-2 focus:ring-indigo-300"
          />
          <div className="absolute right-1.5 flex items-center gap-1">
            <button
              disabled={note.trim().length === 0}
              onClick={() => {
                addLogNote(item.id, note.trim())
                setNote('')
              }}
              className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-meta font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-40"
            >
              <Pencil size={11} /> Send
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between px-1 text-meta text-slate-600">
          <span>Enter to send</span>
          <span>Markdown supported</span>
        </div>
      </div>
    </aside>
  )
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
        'grid h-7 w-7 place-items-center rounded transition',
        danger
          ? 'text-slate-400 hover:bg-rose-50 hover:text-rose-600'
          : active
            ? 'bg-indigo-50 text-indigo-600'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-700',
      )}
    >
      {children}
    </button>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-micro font-semibold uppercase tracking-wide text-slate-600">{label}</span>
      {children}
    </label>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-slate-600">{children}</div>
}
