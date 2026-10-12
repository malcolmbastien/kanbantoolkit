import { useState } from 'react'
import { Archive, ArrowDown, Ban, ChevronDown, ChevronUp, GitBranch, ListChecks, Plus, Sparkles, Target, Trash2, X } from 'lucide-react'
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
  statusOf,
  type Graph,
} from '@/domain/derive'
import { buildRefs } from '@/domain/board'
import { lanePath } from '@/domain/lanes'
import { renderMarkdown } from '@/lib/markdown'
import { DEP_STATE_STYLES, readableOn } from '@/lib/colors'
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
}

export function ItemPanel({ itemId }: Props) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const boards = useStore((s) => s.boards)
  const issueTypes = useStore((s) => s.issueTypes)
  const objectives = useStore((s) => s.objectives)
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
  const boardId = useStore((s) => s.boardId)
  const selectBoard = useStore((s) => s.selectBoard)
  const setObjectives = useStore((s) => s.setObjectives)

  const [dependencyId, setDependencyId] = useState('')
  const [childType, setChildType] = useState('')
  const [parentChoice, setParentChoice] = useState('')
  const [linkBoardId, setLinkBoardId] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [blockReason, setBlockReason] = useState('')
  const [note, setNote] = useState('')
  const [newChecklist, setNewChecklist] = useState('')

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
  const log = item.log ?? []
  const checklist = checklistItems(item)
  const progress = checklistProgress(item)
  const itemPlacements = placements.filter((p) => p.itemId === item.id)

  const initiativeTypeId = issueTypes.find((t) => t.name === 'Initiative')?.id
  const isInitiative = Boolean(initiativeTypeId && item.typeId === initiativeTypeId)
  const typeName = (id: string) => issueTypes.find((t) => t.id === id)?.name ?? 'Item'
  const typeColor = (id: string) => issueTypes.find((t) => t.id === id)?.color ?? '#64748b'
  // The chain from the root down to this item, plus the OKRs its ancestors map to.
  const lineage = lineageOf(item.id, graph)
  const lineageObjectives = [
    ...new Map(
      lineage.flatMap((n) => attributedObjectives(n.id, edges, objectives)).map((o) => [o.id, o]),
    ).values(),
  ]

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
  const typeOptions = issueTypes.filter((t) => t.id !== initiativeTypeId || t.id === item.typeId)
  const teamBoards = boards.filter((b) => b.level !== 'portfolio')
  const linkedInitiatives = children.filter((c) => c.typeId === initiativeTypeId)
  const boardOf = (id: string) =>
    boards.find((b) => b.id === placements.find((p) => p.itemId === id)?.boardId)
  const assignees = [...new Set(items.map((i) => i.assignee).filter((a): a is string => Boolean(a)))]

  const candidates = items.filter((i) => i.id !== item.id && !descendants(item.id, graph).includes(i.id))

  return (
    <aside data-item-panel className="flex h-full w-[400px] shrink-0 flex-col border-l border-slate-300 bg-slate-50">
      <div className="flex items-start gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <span className="mt-1 h-8 w-1 rounded-full" style={{ backgroundColor: type.color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className="rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide"
              style={{ backgroundColor: type.color, color: readableOn(type.color) }}
            >
              {type.name}
            </span>
            <span className="text-[10px] text-slate-400">
              {refs.get(item.id)} · depth {d}
            </span>
          </div>
          <input
            value={item.title}
            onChange={(e) => setItemFields(item.id, { title: e.target.value })}
            className="mt-0.5 w-full rounded border border-transparent bg-transparent text-[14px] font-semibold leading-snug text-slate-800 hover:border-slate-200 focus:border-indigo-300 focus:outline-none"
          />
        </div>
        <button onClick={() => close(null)} className="text-slate-400 hover:text-slate-600">
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-[12px]">
        {/* Type + status */}
        <section className="rounded-md border border-indigo-100 bg-indigo-50/60 p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-700">
            <Sparkles size={12} /> Type is a label · status comes from the board cell
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <select
              value={item.typeId}
              onChange={(e) => setItemFields(item.id, { typeId: e.target.value })}
              className="rounded border border-indigo-200 bg-white px-1.5 py-1 text-[11px] font-medium"
            >
              {typeOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <span className="text-[11px] text-slate-600">
              {status.resolved ? 'resolved' : status.started ? 'in progress' : 'not started'}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-indigo-700/80">
            depth {d} — derived from the parent/child chain, not a field.
          </div>
        </section>

        {/* Blocked — an explicit status, independent of the cell and of links */}
        <section>
          <SectionLabel>Blocked — a status you set</SectionLabel>
          {item.blocked ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-700">
                <Ban size={12} /> Blocked
              </div>
              {item.blockedReason && <p className="mt-0.5 text-[11px] text-rose-700/80">{item.blockedReason}</p>}
              <button
                onClick={() => unblockItem(item.id)}
                className="mt-1.5 rounded bg-rose-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-700"
              >
                Unblock
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <input
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder="Reason (optional)…"
                className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-[11px] outline-none focus:ring-2 focus:ring-rose-300"
              />
              <button
                onClick={() => { blockItem(item.id, blockReason); setBlockReason('') }}
                className="flex items-center gap-1 rounded bg-rose-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-700"
              >
                <Ban size={11} /> Block
              </button>
            </div>
          )}
          <p className="mt-1 text-[10px] text-slate-400">
            Blocking is independent of links — it never changes the cell and never counts as WIP. Each block/unblock is recorded below.
          </p>
        </section>

        {/* Archive — file the item away (cascades to its whole subtree) */}
        <section>
          <SectionLabel>Archive</SectionLabel>
          {item.archived ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700">
                <Archive size={12} /> Archived
                {item.archivedAt && <span className="font-normal text-amber-600/80">· {new Date(item.archivedAt).toLocaleDateString()}</span>}
              </div>
              <button
                onClick={() => unarchiveItem(item.id)}
                className="mt-1.5 rounded bg-amber-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-700"
              >
                Restore
              </button>
            </div>
          ) : (
            <button
              onClick={() => archiveItem(item.id)}
              className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
              title="File this item (and its children) off the boards"
            >
              <Archive size={11} /> Archive (with children)
            </button>
          )}
          <p className="mt-1 text-[10px] text-slate-400">
            Archived items leave the boards but stay searchable and linked. Archiving cascades to the whole subtree.
          </p>
        </section>

        {/* Delete — permanent; removes the card and its relationships */}
        <section>
          <SectionLabel>Delete</SectionLabel>
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
            <Trash2 size={11} /> Delete card
          </button>
          <p className="mt-1 text-[10px] text-slate-400">Permanent. Use Archive to file a card away instead.</p>
        </section>

        {/* Details — full card editor */}
        <section>
          <SectionLabel>Details</SectionLabel>
          <div className="space-y-2">
            <div>
              <div className="mb-1 flex items-center gap-1">
                <span className="text-[11px] font-medium text-slate-500">Description</span>
                <span className="text-[10px] text-slate-400">(markdown)</span>
                <div className="ml-auto flex items-center gap-0.5 rounded border border-slate-200 p-0.5">
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
                  className="min-h-[72px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[12px] leading-relaxed text-slate-700"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(item.description ?? '') || '<p class="text-slate-400">Nothing to preview.</p>' }}
                />
              ) : (
                <textarea
                  value={item.description ?? ''}
                  onChange={(e) => setItemFields(item.id, { description: e.target.value })}
                  rows={5}
                  placeholder="Add a description… (supports **bold**, lists, `code`, links)"
                  className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-indigo-400"
                />
              )}
            </div>
            <div className="flex items-end gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] text-slate-500">
                Assignee
                <input
                  list="flowline-assignees"
                  value={item.assignee ?? ''}
                  onChange={(e) => setItemFields(item.id, { assignee: e.target.value })}
                  placeholder="initials…"
                  className="w-full rounded border border-slate-200 px-1.5 py-1 text-[12px] outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <datalist id="flowline-assignees">
                  {assignees.map((a) => (
                    <option key={a} value={a} />
                  ))}
                </datalist>
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-500">
                Size
                <input
                  type="number"
                  min={0}
                  value={item.size ?? ''}
                  onChange={(e) => setItemFields(item.id, { size: e.target.value === '' ? undefined : Number(e.target.value) })}
                  className="w-20 rounded border border-slate-200 px-1.5 py-1 text-[12px] outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-500">
                Target start
                <input
                  type="date"
                  value={item.targetStartDate ?? ''}
                  onChange={(e) => setItemFields(item.id, { targetStartDate: e.target.value || undefined })}
                  className="rounded border border-slate-200 px-1.5 py-1 text-[12px] outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-500">
                Target end
                <input
                  type="date"
                  value={item.targetEndDate ?? ''}
                  onChange={(e) => setItemFields(item.id, { targetEndDate: e.target.value || undefined })}
                  className="rounded border border-slate-200 px-1.5 py-1 text-[12px] outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </label>
            </div>
          </div>
        </section>

        {/* Checklist — sub-tasks inside the card (never scheduled, never WIP) */}
        <section>
          <SectionLabel>
            <span className="flex items-center gap-1">
              <ListChecks size={12} /> Checklist{progress.total > 0 ? ` · ${progress.done}/${progress.total}` : ''}
            </span>
          </SectionLabel>
          {progress.total > 0 && (
            <div className="mb-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
          )}
          <div className="space-y-1">
            {checklist.length === 0 && <p className="text-[11px] text-slate-400">No checklist items yet.</p>}
            {checklist.map((c, i) => (
              <div key={c.id} className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1">
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
          <div className="mt-2 flex items-center gap-1">
            <input
              value={newChecklist}
              onChange={(e) => setNewChecklist(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addChecklistItem(item.id, newChecklist)
                  setNewChecklist('')
                }
              }}
              placeholder="Add a checklist item…"
              className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-[11px] outline-none focus:ring-2 focus:ring-indigo-300"
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
          <p className="mt-1 text-[10px] text-slate-400">
            Sub-tasks that live inside this card — never scheduled, never counted as WIP, never rolled up.
          </p>
        </section>

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
                    'flex w-full items-center gap-2 rounded border px-2 py-1 text-left transition',
                    here ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-slate-700">{b?.name ?? '—'}</span>
                  <span className="min-w-0 max-w-[55%] truncate text-[10px] text-slate-400">{lanePath(lanes, p.laneId).join(' / ')}</span>
                  {!here && <span className="shrink-0 text-[10px] text-indigo-500">↗</span>}
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-[10px] text-slate-400">Click a board to jump there with this card open.</p>
        </section>

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
              : 'Click any step to jump. No OKR maps above this item.'}
          </p>
        </section>

        {/* Parent + children */}
        <section>
          <SectionLabel>Hierarchy — one parent, any number of children</SectionLabel>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1">
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
                className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-[11px]"
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

            {exposure.length > 0 && (
              <p className="text-[10px] text-amber-700">{exposure.length} open descendants (composition pressure).</p>
            )}
            {children.map((c) => (
              <button
                key={c.id}
                onClick={() => close(c.id)}
                className="flex w-full items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-left hover:bg-slate-50"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: issueTypes.find((t) => t.id === c.typeId)?.color }} />
                <span className="min-w-0 flex-1 truncate text-slate-700">{c.title}</span>
                {c.archived && <span className="rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-700">archived</span>}
                <span className="text-[10px] text-slate-400">{statusOf(c.id, graph).resolved ? 'done' : ''}</span>
              </button>
            ))}
            <div className="flex items-center gap-1">
              <select
                value={childType}
                onChange={(e) => setChildType(e.target.value)}
                className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-[11px]"
              >
                <option value="">Add child of type…</option>
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
          </div>
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
                  className="flex w-full items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-left hover:bg-slate-50"
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
                className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-[11px]"
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
                className="w-32 rounded border border-slate-200 px-1.5 py-1 text-[11px]"
              />
              <button
                disabled={!linkBoardId || linkTitle.trim().length < 2}
                onClick={() => {
                  linkTeamInitiative(item.id, linkBoardId, linkTitle.trim())
                  setLinkTitle('')
                }}
                className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
              >
                Create &amp; link
              </button>
            </div>
            <p className="mt-1 text-[10px] text-slate-400">
              Creates a team initiative on that board, beneath this one — its cards roll up here.
            </p>
          </section>
        )}

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
                <div key={dep.link.id} className="rounded border border-slate-200 bg-white px-2 py-1.5">
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
              <div key={dep.link.id} className="rounded border border-slate-200 bg-white px-2 py-1.5">
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
            <select value={dependencyId} onChange={(e) => setDependencyId(e.target.value)} className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-[11px]">
              <option value="">Add link: this depends on…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>{typeName(c.typeId)}: {c.title}</option>
              ))}
            </select>
            <button disabled={!dependencyId} onClick={() => { addDependency(dependencyId, item.id); setDependencyId('') }} className="rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40">Add link</button>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">
            Links connect two items — this one depends on another. They indicate linked items but never set the blocked status above.
          </p>
        </section>

        {/* OKRs — only initiatives map to objectives; cards inherit it via the lineage */}
        {isInitiative && (
          <section>
            <SectionLabel>OKRs — informs, never counts</SectionLabel>
            <div className="space-y-1">
              {objectives.map((o) => {
                const on = attributed.some((a) => a.id === o.id)
                return (
                  <label key={o.id} className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1">
                    <input type="checkbox" checked={on} onChange={(e) => setAttribution(item.id, o.id, e.target.checked)} />
                    <span className="flex-1 text-slate-700">{o.title}</span>
                    <span className="text-[10px] text-slate-400">{o.period}</span>
                  </label>
                )
              })}
            </div>
            {attributed.length > 1 && (
              <p className="mt-1 text-[10px] text-emerald-700">Serves {attributed.length} OKRs — still 1 unit of WIP.</p>
            )}
            <p className="mt-1 text-[10px] text-slate-400">
              OKRs map to initiatives. Cards inherit the mapping through the lineage.
            </p>
          </section>
        )}

        {/* Log — append-only history (block/unblock events, notes) */}
        <section>
          <SectionLabel>Log ({log.length})</SectionLabel>
          <div className="space-y-1">
            {log.length === 0 && <p className="text-[11px] text-slate-400">No events yet.</p>}
            {[...log].reverse().map((e) => (
              <div key={e.id} className="flex items-start gap-2 rounded border border-slate-200 bg-white px-2 py-1">
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
          <div className="mt-2 flex items-center gap-1">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note…"
              className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-[11px] outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <button
              disabled={note.trim().length === 0}
              onClick={() => { addLogNote(item.id, note.trim()); setNote('') }}
              className="rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
            >
              Log
            </button>
          </div>
        </section>
      </div>
    </aside>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{children}</div>
}
