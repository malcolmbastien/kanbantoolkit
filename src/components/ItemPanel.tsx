import { useState } from 'react'
import {
  Archive,
  ArrowDown,
  Ban,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Eye,
  Flag,
  GitBranch,
  LayoutGrid,
  ListChecks,
  MessageSquare,
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
  checklistProgress,
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
import { initialsOf } from '@/domain/users'
import { DEP_STATE_STYLES, readableOn, stageChip } from '@/lib/colors'
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

/** Priority is a judgement, not a derivation — so it is one of the few stored fields. */
const PRIORITIES: { value: NonNullable<Item['priority']>; label: string; className: string }[] = [
  { value: 'urgent', label: 'Urgent', className: 'text-rose-600' },
  { value: 'high', label: 'High', className: 'text-amber-600' },
  { value: 'medium', label: 'Medium', className: 'text-sky-600' },
  { value: 'low', label: 'Low', className: 'text-slate-500' },
]

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
  const addChecklistItem = useStore((s) => s.addChecklistItem)
  const toggleChecklistItem = useStore((s) => s.toggleChecklistItem)
  const moveChecklistItem = useStore((s) => s.moveChecklistItem)
  const removeChecklistItem = useStore((s) => s.removeChecklistItem)
  const setParent = useStore((s) => s.setParent)
  const addChild = useStore((s) => s.addChild)
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
  const [blockOpen, setBlockOpen] = useState(false)
  const [dependencyId, setDependencyId] = useState('')
  const [childType, setChildType] = useState('')
  const [parentChoice, setParentChoice] = useState('')
  const [linkBoardId, setLinkBoardId] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [blockReason, setBlockReason] = useState('')
  const [note, setNote] = useState('')
  const [newChecklist, setNewChecklist] = useState('')
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
  const checklist = checklistItems(item)
  const progress = checklistProgress(item)
  const itemPlacements = placements.filter((p) => p.itemId === item.id)

  const initiativeTypeId = issueTypes.find((t) => t.name === 'Initiative')?.id
  const isInitiative = Boolean(initiativeTypeId && item.typeId === initiativeTypeId)
  const typeName = (id: string) => issueTypes.find((t) => t.id === id)?.name ?? 'Item'
  const typeColor = (id: string) => issueTypes.find((t) => t.id === id)?.color ?? '#64748b'
  const userById = (id: string) => users.find((u) => u.id === id)
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
  // An initiative owns its OKRs; a card only inherits them through the lineage.
  const impactObjectives = isInitiative ? attributed : lineageObjectives
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
          className="flex w-full items-center gap-1.5 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-left text-[11px] font-medium text-indigo-700 transition hover:bg-indigo-100"
        >
          <Target size={11} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{o.title}</span>
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-indigo-400">OKR</span>
        </button>
      ),
    })),
    ...lineage.map((node) => {
      const self = node.id === item.id
      const body = (
        <>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: typeColor(node.typeId) }} />
          <span className="min-w-0 flex-1 truncate">{node.title}</span>
          <span className={cn('shrink-0 text-[9px] font-semibold uppercase tracking-wide', self ? 'text-slate-300' : 'text-slate-400')}>
            {typeName(node.typeId)}
          </span>
        </>
      )
      return {
        key: node.id,
        node: self ? (
          <div className="flex items-center gap-1.5 rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white">{body}</div>
        ) : (
          <button
            onClick={() => close(node.id)}
            title={`Open ${node.title}`}
            className="flex w-full items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-left text-[11px] text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600"
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

  const dateLabel = (iso?: string) =>
    iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : undefined
  const targetLabel =
    item.targetStartDate && item.targetEndDate
      ? `${dateLabel(item.targetStartDate)} – ${dateLabel(item.targetEndDate)}`
      : item.targetEndDate
        ? dateLabel(item.targetEndDate)
        : undefined

  const tabs: { id: Tab; label: string; icon: typeof LayoutGrid; count?: number }[] = [
    { id: 'details', label: 'Details', icon: LayoutGrid },
    { id: 'hierarchy', label: 'Hierarchy & Links', icon: Network, count: relatedCount },
    { id: 'activity', label: 'Activity', icon: MessageSquare, count: log.length },
  ]

  return (
    <aside data-item-panel className="flex h-full w-[460px] shrink-0 flex-col border-l border-slate-300 bg-slate-50">
      {/* ---- Header: breadcrumb, actions, title, tabs ------------------------------ */}
      <div className="shrink-0 space-y-2 border-b border-slate-200 bg-white px-3 py-2.5">
        <div className="flex items-center gap-2">
          <nav className="flex min-w-0 items-center gap-1 text-[10px] text-slate-400">
            {[...lineage].reverse().slice(0, 3).map((node) => (
              <span key={node.id} className="flex min-w-0 items-center gap-1">
                <button
                  onClick={() => close(node.id)}
                  title={`Open ${node.title}`}
                  className="min-w-0 truncate transition hover:text-slate-700"
                >
                  {node.title}
                </button>
                <span className="text-slate-300">/</span>
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
            {isInitiative ? (
              <p className="text-[10px] text-slate-400">
                Type is fixed. An initiative is defined by the Initiative type, and the initiatives workflow reads it —
                so it is never retyped into a card type.
              </p>
            ) : (
              <label className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-slate-400">Type</span>
                <select
                  value={item.typeId}
                  onChange={(e) => setItemFields(item.id, { typeId: e.target.value })}
                  className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] font-medium"
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
                  className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100"
                >
                  <Archive size={11} /> Restore
                </button>
              ) : (
                <button
                  onClick={() => archiveItem(item.id)}
                  title="File this item (and its children) off the boards"
                  className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
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
                className="flex items-center gap-1 rounded border border-rose-300 px-2 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50"
              >
                <Trash2 size={11} /> Delete
              </button>
            </div>
          </div>
        )}

        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wide"
              style={{ backgroundColor: type.color, color: readableOn(type.color) }}
            >
              {type.name}
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-px font-mono text-[10px] font-semibold text-slate-500">
              {refs.get(item.id)}
            </span>
            <span className="rounded bg-indigo-50 px-1.5 py-px text-[10px] font-medium text-indigo-600" title="Where this card sits">
              {boards.find((b) => b.id === boardId)?.name ?? 'Board'}
            </span>
            {item.blocked ? (
              <button
                onClick={() => unblockItem(item.id)}
                className="ml-auto flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-rose-700"
              >
                <Ban size={11} /> Unblock
              </button>
            ) : (
              <button
                onClick={() => setBlockOpen((o) => !o)}
                className={cn(
                  'ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition',
                  blockOpen ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600 hover:bg-rose-50 hover:text-rose-600',
                )}
              >
                <Flag size={11} /> Mark Blocked
              </button>
            )}
          </div>

          {item.blocked && item.blockedReason && (
            <p className="rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-700">{item.blockedReason}</p>
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
                className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-[11px] outline-none focus:ring-2 focus:ring-rose-300"
              />
              <button
                onClick={() => {
                  blockItem(item.id, blockReason)
                  setBlockReason('')
                  setBlockOpen(false)
                }}
                className="flex items-center gap-1 rounded bg-rose-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-700"
              >
                <Ban size={11} /> Block
              </button>
            </div>
          )}

          <input
            value={item.title}
            onChange={(e) => setItemFields(item.id, { title: e.target.value })}
            className="w-full rounded border border-transparent bg-transparent text-[15px] font-semibold leading-snug text-slate-800 hover:border-slate-200 focus:border-indigo-300 focus:outline-none"
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
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium transition',
                  on ? 'bg-white font-semibold text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800',
                )}
              >
                <t.icon size={13} />
                <span className="truncate">{t.label}</span>
                {t.count !== undefined && t.count > 0 && (
                  <span className={cn('rounded-full px-1.5 text-[9px] font-bold tabular-nums', on ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-500')}>
                    {t.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ---- Body ---------------------------------------------------------------- */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-[12px]">
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
                  <span className="truncate text-[12px] font-medium text-slate-700">{STAGE_LABELS[stage]}</span>
                </div>
              </Field>

              <Field label="Priority">
                <select
                  value={item.priority ?? ''}
                  onChange={(e) => setItemFields(item.id, { priority: (e.target.value || undefined) as Item['priority'] })}
                  className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-[12px] font-medium shadow-sm outline-none focus:ring-2 focus:ring-indigo-300"
                >
                  <option value="">None</option>
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </Field>

              <Field label="Lead">
                <div className="flex flex-wrap items-center gap-1">
                  {(item.assignees ?? []).map((id) => {
                    const u = userById(id)
                    return (
                      <span key={id} className="flex items-center gap-1 rounded-full bg-slate-700 py-0.5 pl-0.5 pr-1.5 text-[11px] font-medium text-white">
                        <span className="grid h-4 w-4 place-items-center rounded-full bg-white/20 text-[8px] font-bold">
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
                    className="min-w-[4rem] flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] outline-none focus:ring-2 focus:ring-indigo-300"
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
                    className="w-12 min-w-0 bg-transparent text-[12px] font-semibold tabular-nums text-slate-700 outline-none"
                  />
                  <span className="text-[10px] text-slate-400">pts</span>
                </div>
              </Field>

              <Field label="Target" className="col-span-2">
                <div className="flex items-center gap-1 rounded bg-white px-2 py-1.5 shadow-sm">
                  <CalendarDays size={12} className="shrink-0 text-slate-400" />
                  <input
                    type="date"
                    value={item.targetStartDate ?? ''}
                    onChange={(e) => setItemFields(item.id, { targetStartDate: e.target.value || undefined })}
                    className="min-w-0 flex-1 bg-transparent text-[11px] text-slate-600 outline-none"
                  />
                  <span className="text-slate-300">→</span>
                  <input
                    type="date"
                    value={item.targetEndDate ?? ''}
                    onChange={(e) => setItemFields(item.id, { targetEndDate: e.target.value || undefined })}
                    className="min-w-0 flex-1 bg-transparent text-[11px] text-slate-600 outline-none"
                  />
                  {targetLabel && <span className="shrink-0 text-[10px] text-slate-400">{targetLabel}</span>}
                </div>
              </Field>
            </div>

            {/* Strategic impact — an initiative owns its OKRs; a card inherits them */}
            <section className="rounded-lg bg-indigo-50/70 p-2.5 ring-1 ring-indigo-100">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
                  <TrendingUp size={12} /> Strategic impact
                </span>
                {!isInitiative && (
                  <span className="text-[10px] text-indigo-500" title="OKRs attach to strategic initiatives — a card inherits the mapping">
                    inherited
                  </span>
                )}
              </div>

              {impactObjectives.length === 0 ? (
                <p className="mt-1 text-[11px] text-indigo-700/70">
                  {isInitiative ? 'No OKR maps to this initiative yet.' : 'No OKR maps above this card.'}
                </p>
              ) : (
                <div className="mt-1.5 space-y-2">
                  {impactObjectives.map((o) => {
                    const krs = keyResults.filter((k) => k.objectiveId === o.id)
                    return (
                      <div key={o.id} className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-[12px] font-medium text-slate-700">{o.title}</span>
                          <span className="shrink-0 text-[10px] text-slate-400">{o.period}</span>
                        </div>
                        {krs.length === 0 && <p className="text-[10px] text-slate-400">No key results yet.</p>}
                        {krs.map((k) => (
                          <div key={k.id} className="space-y-0.5">
                            <div className="flex items-center justify-between gap-2 text-[10px]">
                              <span className="min-w-0 truncate text-slate-500">{k.title}</span>
                              <span className="shrink-0 font-semibold tabular-nums text-slate-600">
                                {k.progress !== undefined ? `${k.progress}%` : '—'}
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-indigo-100">
                              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${k.progress ?? 0}%` }} />
                            </div>
                            {(k.target || k.current) && (
                              <div className="text-[10px] text-slate-400">
                                {k.current ? `now ${k.current}` : ''}{k.current && k.target ? ' · ' : ''}{k.target ? `target ${k.target}` : ''}
                              </div>
                            )}
                          </div>
                        ))}
                        {isInitiative && (
                          <button
                            onClick={() => setAttribution(item.id, o.id, false)}
                            className="text-[10px] text-indigo-500 hover:text-indigo-700"
                            title="Unlink this OKR"
                          >
                            unlink
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {isInitiative && (
                <div className="mt-2 border-t border-indigo-100 pt-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-indigo-500">Map an OKR</span>
                  <div className="mt-1 space-y-0.5">
                    {objectives.map((o) => {
                      const on = attributed.some((a) => a.id === o.id)
                      return (
                        <label key={o.id} className="flex items-center gap-2 rounded bg-white/70 px-2 py-1">
                          <input type="checkbox" checked={on} onChange={(e) => setAttribution(item.id, o.id, e.target.checked)} />
                          <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700">{o.title}</span>
                          <span className="shrink-0 text-[10px] text-slate-400">{o.period}</span>
                        </label>
                      )
                    })}
                  </div>
                  {attributed.length > 1 && (
                    <p className="mt-1 text-[10px] text-emerald-700">Serves {attributed.length} OKRs — still 1 unit of WIP.</p>
                  )}
                </div>
              )}
            </section>

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
                        className={cn('rounded px-1.5 py-px text-[10px] font-medium', on ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-700')}
                      >
                        {m}
                      </button>
                    )
                  })}
                </div>
              </div>
              {showPreview ? (
                <div
                  className="min-h-[72px] rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[12px] leading-relaxed text-slate-700"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(item.description ?? '') || '<p class="text-slate-400">Nothing to preview.</p>' }}
                />
              ) : (
                <textarea
                  value={item.description ?? ''}
                  onChange={(e) => setItemFields(item.id, { description: e.target.value })}
                  rows={5}
                  placeholder="Add a description… (supports **bold**, lists, `code`, links)"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[12px] outline-none focus:ring-2 focus:ring-indigo-400"
                />
              )}
            </section>

            {/* Sub-tasks — the decomposition children */}
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <SectionLabel>Sub-tasks</SectionLabel>
                  {children.length > 0 && (
                    <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-bold tabular-nums text-slate-500">{children.length}</span>
                  )}
                </div>
                {exposure.length > 0 && (
                  <span className="text-[10px] text-amber-700">{exposure.length} open below</span>
                )}
              </div>
              <div className="space-y-1">
                {children.length === 0 && <p className="text-[11px] text-slate-400">No sub-tasks yet.</p>}
                {children.map((c) => {
                  const cStatus = statusOf(c.id, graph)
                  return (
                    <button
                      key={c.id}
                      onClick={() => close(c.id)}
                      className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left transition hover:bg-slate-50"
                    >
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', cStatus.resolved ? 'bg-emerald-500' : cStatus.started ? 'bg-indigo-500' : 'bg-slate-300')} />
                      <span className="shrink-0 font-mono text-[10px] font-medium text-indigo-600">{refs.get(c.id)}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-700">{c.title}</span>
                      {c.archived && <span className="shrink-0 rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-700">archived</span>}
                      <span className={cn('shrink-0 rounded px-1.5 py-px text-[10px] font-semibold', stageChip(rollupOf(c.id, graph).bucket))}>
                        {STAGE_LABELS[rollupOf(c.id, graph).bucket]}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="mt-1.5 flex items-center gap-1">
                <select
                  value={childType}
                  onChange={(e) => setChildType(e.target.value)}
                  className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px]"
                >
                  <option value="">Add sub-task of type…</option>
                  {issueTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button
                  disabled={!childType}
                  onClick={() => { addChild(item.id, childType, `New ${typeName(childType)}`); setChildType('') }}
                  className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                >
                  <Plus size={11} /> Add
                </button>
              </div>
            </section>

            {/* Acceptance criteria — the checklist inside the card */}
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <SectionLabel>Acceptance criteria</SectionLabel>
                  {progress.total > 0 && (
                    <span className="text-[10px] font-semibold text-emerald-600">
                      {progress.done} of {progress.total} done ({Math.round((progress.done / progress.total) * 100)}%)
                    </span>
                  )}
                </div>
                <span className="flex items-center gap-1 text-[10px] text-slate-400" title="Sub-tasks that live inside this card — never scheduled, never WIP, never rolled up">
                  <ListChecks size={11} /> in-card
                </span>
              </div>
              {progress.total > 0 && (
                <div className="mb-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                  />
                </div>
              )}
              <div className="space-y-1">
                {checklist.length === 0 && <p className="text-[11px] text-slate-400">No criteria yet.</p>}
                {checklist.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
                    <input type="checkbox" checked={c.done} onChange={() => toggleChecklistItem(item.id, c.id)} />
                    <span className={cn('min-w-0 flex-1 truncate text-slate-700', c.done && 'text-slate-400 line-through')}>{c.text}</span>
                    <button
                      disabled={i === 0}
                      onClick={() => moveChecklistItem(item.id, c.id, -1)}
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
                      title="Move up"
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      disabled={i === checklist.length - 1}
                      onClick={() => moveChecklistItem(item.id, c.id, 1)}
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
                      title="Move down"
                    >
                      <ChevronDown size={13} />
                    </button>
                    <button
                      onClick={() => removeChecklistItem(item.id, c.id)}
                      className="rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex items-center gap-1">
                <input
                  value={newChecklist}
                  onChange={(e) => setNewChecklist(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      addChecklistItem(item.id, newChecklist)
                      setNewChecklist('')
                    }
                  }}
                  placeholder="Add a criterion…"
                  className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <button
                  disabled={newChecklist.trim().length === 0}
                  onClick={() => {
                    addChecklistItem(item.id, newChecklist)
                    setNewChecklist('')
                  }}
                  className="flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                >
                  <Plus size={11} /> Add
                </button>
              </div>
            </section>
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
              <p className="mt-1 text-[10px] text-slate-400">
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
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">Parent</span>
                  {parent ? (
                    <>
                      <button onClick={() => close(parent.id)} className="min-w-0 flex-1 truncate text-left text-slate-700 hover:text-indigo-600">
                        {typeName(parent.typeId)} · {parent.title}
                      </button>
                      <button onClick={() => setParent(item.id, null)} className="text-slate-300 hover:text-rose-500" title="Remove parent">
                        <X size={12} />
                      </button>
                    </>
                  ) : (
                    <span className="flex-1 text-[11px] text-slate-400">none (root)</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <select
                    value={parentChoice}
                    onChange={(e) => setParentChoice(e.target.value)}
                    className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px]"
                  >
                    <option value="">Set parent…</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>{typeName(c.typeId)}: {c.title}</option>
                    ))}
                  </select>
                  <button
                    disabled={!parentChoice}
                    onClick={() => { setParent(item.id, parentChoice); setParentChoice('') }}
                    className="rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                  >
                    Set
                  </button>
                </div>
              </div>
            </section>

            {/* Links — dependencies between two items */}
            <section>
              <SectionLabel>Links — dependencies</SectionLabel>
              {badge.count > 0 && (
                <div className="mb-2 flex items-center gap-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 ring-1 ring-amber-100">
                  <GitBranch size={11} /> {badge.count} card{badge.count > 1 ? 's' : ''} depend on this across {badge.boards} board{badge.boards > 1 ? 's' : ''}
                </div>
              )}
              <div className="space-y-1">
                {dependencies.length === 0 && dependents.length === 0 && <p className="text-[11px] text-slate-400">No links.</p>}
                {dependencies.map((dep) => {
                  const state = DEP_STATE_STYLES[dep.state]
                  return (
                    <div key={dep.link.id} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                      <div className="flex items-center gap-1 text-[10px] text-slate-400"><GitBranch size={10} /> depends on</div>
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-slate-700">{dep.dependency.title}</span>
                        {dep.dependency.archived && <span className="rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-700">archived</span>}
                        <span className={cn('rounded px-1 text-[9px] font-semibold ring-1', state.className)}>{state.label}</span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        derived → {dependencyState(dep.dependency.id, dep.dependent.id, graph)}
                      </div>
                    </div>
                  )
                })}
                {dependents.map((dep) => (
                  <div key={dep.link.id} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                    <div className="flex items-center gap-1 text-[10px] text-slate-400"><GitBranch size={10} /> depended on by</div>
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1 truncate text-slate-700">{dep.dependent.title}</div>
                      {dep.dependent.archived && <span className="rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-700">archived</span>}
                    </div>
                    <div className="text-[10px] text-slate-400">{statusOf(dep.dependent.id, graph).resolved ? 'dependent resolved' : `derived → ${DEP_STATE_STYLES[dep.state].label}`}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-1">
                <select value={dependencyId} onChange={(e) => setDependencyId(e.target.value)} className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px]">
                  <option value="">Add link: this depends on…</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>{typeName(c.typeId)}: {c.title}</option>
                  ))}
                </select>
                <button disabled={!dependencyId} onClick={() => { addDependency(dependencyId, item.id); setDependencyId('') }} className="rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40">Add link</button>
              </div>
              <p className="mt-1 text-[10px] text-slate-400">
                Links connect two items — this one depends on another. They never set the blocked status.
              </p>
            </section>

            {/* Team initiatives (link a management initiative down to a team board) */}
            {isInitiative && (
              <section>
                <SectionLabel>Team initiatives — linked</SectionLabel>
                <div className="space-y-1">
                  {linkedInitiatives.length === 0 && (
                    <p className="text-[11px] text-slate-400">No linked team initiatives yet.</p>
                  )}
                  {linkedInitiatives.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => close(c.id)}
                      className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-left hover:bg-slate-50"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                      <span className="min-w-0 flex-1 truncate text-slate-700">{c.title}</span>
                      <span className="text-[10px] text-slate-400">{boardOf(c.id)?.name ?? '—'}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <select
                    value={linkBoardId}
                    onChange={(e) => setLinkBoardId(e.target.value)}
                    className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px]"
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
                    className="w-28 rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px]"
                  />
                  <button
                    disabled={!linkBoardId || linkTitle.trim().length < 2}
                    onClick={() => {
                      linkTeamInitiative(item.id, linkBoardId, linkTitle.trim())
                      setLinkTitle('')
                    }}
                    className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                  >
                    Create
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-slate-400">
                  Creates a team initiative on that board, beneath this one — its cards roll up here.
                </p>
              </section>
            )}

            {/* Placements — board + cell (click to jump there) */}
            <section>
              <SectionLabel>On these boards ({itemPlacements.length})</SectionLabel>
              <div className="space-y-1">
                {itemPlacements.length === 0 && <p className="text-[11px] text-slate-400">Not placed on any board.</p>}
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
                      <span className="min-w-0 max-w-[55%] truncate text-[10px] text-slate-400">{lanePath(lanes, p.laneId).join(' / ')}</span>
                      {!here && <span className="shrink-0 text-[10px] text-indigo-500">↗</span>}
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
              <span className="text-[10px] text-slate-400">append-only</span>
            </div>
            <div className="space-y-1">
              {log.length === 0 && <p className="text-[11px] text-slate-400">No events yet.</p>}
              {[...log].reverse().map((e) => (
                <div key={e.id} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                  <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', LOG_STYLES[e.kind] ?? 'bg-slate-300')} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-slate-700">
                      <span className="font-semibold capitalize">{e.kind}</span>
                      {e.note ? ` — ${e.note}` : ''}
                    </div>
                    <div className="text-[10px] text-slate-400">{new Date(e.at).toLocaleString()}</div>
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
            className="w-full rounded-lg bg-slate-100 py-2 pl-3 pr-20 text-[12px] outline-none transition focus:bg-slate-50 focus:ring-2 focus:ring-indigo-300"
          />
          <div className="absolute right-1.5 flex items-center gap-1">
            <button
              disabled={note.trim().length === 0}
              onClick={() => {
                addLogNote(item.id, note.trim())
                setNote('')
              }}
              className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-40"
            >
              <Pencil size={11} /> Send
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between px-1 text-[10px] text-slate-400">
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
            : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
      )}
    >
      {children}
    </button>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{children}</div>
}
