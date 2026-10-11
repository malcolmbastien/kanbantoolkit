import { useState } from 'react'
import { Ban, ChevronRight, GitBranch, Plus, Sparkles, X } from 'lucide-react'
import {
  attributedObjectives,
  blockingSummary,
  decompositionChildren,
  decompositionParent,
  depth as depthOf,
  descendants,
  dependencyState,
  incomingDependencies,
  openDescendants,
  outgoingDependencies,
  statusOf,
  type Graph,
} from '@/domain/derive'
import { buildRefs } from '@/domain/board'
import { lanePath } from '@/domain/lanes'
import { DEP_STATE_STYLES, readableOn } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Item } from '@/domain/types'

interface Props {
  itemId: string
}

export function ItemPanel({ itemId }: Props) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const boards = useStore((s) => s.boards)
  const issueTypes = useStore((s) => s.issueTypes)
  const objectives = useStore((s) => s.objectives)
  const close = useStore((s) => s.openItem)
  const setItemFields = useStore((s) => s.setItemFields)
  const setParent = useStore((s) => s.setParent)
  const addChild = useStore((s) => s.addChild)
  const linkTeamInitiative = useStore((s) => s.linkTeamInitiative)
  const raiseDependency = useStore((s) => s.raiseDependency)
  const confirmDependency = useStore((s) => s.confirmDependency)
  const rejectDependency = useStore((s) => s.rejectDependency)
  const setAttribution = useStore((s) => s.setAttribution)

  const [blockerId, setBlockerId] = useState('')
  const [childType, setChildType] = useState('')
  const [parentChoice, setParentChoice] = useState('')
  const [linkBoardId, setLinkBoardId] = useState('')
  const [linkTitle, setLinkTitle] = useState('')

  const graph: Graph = { items, edges, placements, lanes }
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
  const incoming = incomingDependencies(item.id, graph)
  const outgoing = outgoingDependencies(item.id, graph)
  const exposure = openDescendants(item.id, graph)
  const badge = blockingSummary(item.id, graph)
  const attributed = attributedObjectives(item.id, edges, objectives)
  const status = statusOf(item.id, graph)
  const itemPlacements = placements.filter((p) => p.itemId === item.id)

  const initiativeTypeId = issueTypes.find((t) => t.name === 'Initiative')?.id
  const isInitiative = Boolean(initiativeTypeId && item.typeId === initiativeTypeId)
  const teamBoards = boards.filter((b) => b.level !== 'portfolio')
  const linkedInitiatives = children.filter((c) => c.typeId === initiativeTypeId)
  const boardOf = (id: string) =>
    boards.find((b) => b.id === placements.find((p) => p.itemId === id)?.boardId)

  const candidates = items.filter((i) => i.id !== item.id && !descendants(item.id, graph).includes(i.id))
  const typeName = (id: string) => issueTypes.find((t) => t.id === id)?.name ?? 'Item'

  return (
    <aside className="flex h-full w-[400px] shrink-0 flex-col border-l border-slate-300 bg-slate-50">
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
              {issueTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <span className="text-[11px] text-slate-600">
              {status.resolved ? 'resolved' : status.cancelled ? 'cancelled' : status.started ? 'in progress' : 'not started'}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-indigo-700/80">
            depth {d} — derived from the parent/child chain, not a field.
          </div>
        </section>

        {/* Placements — board + cell */}
        <section>
          <SectionLabel>On these boards ({itemPlacements.length})</SectionLabel>
          <div className="space-y-1">
            {itemPlacements.length === 0 && <p className="text-[11px] text-slate-400">Not placed on any board.</p>}
            {itemPlacements.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-slate-700">{boards.find((b) => b.id === p.boardId)?.name}</span>
                <span className="min-w-0 max-w-[55%] truncate text-[10px] text-slate-400">{lanePath(lanes, p.laneId).join(' / ')}</span>
              </div>
            ))}
          </div>
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

        {/* Dependencies */}
        <section>
          <SectionLabel>Dependencies</SectionLabel>
          {badge.count > 0 && (
            <div className="mb-2 flex items-center gap-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 ring-1 ring-amber-100">
              <Ban size={11} /> This blocks {badge.count} item{badge.count > 1 ? 's' : ''} across {badge.boards} board{badge.boards > 1 ? 's' : ''}
            </div>
          )}
          <div className="space-y-1">
            {incoming.length === 0 && outgoing.length === 0 && <p className="text-[11px] text-slate-400">No dependency edges.</p>}
            {incoming.map((dep) => {
              const state = DEP_STATE_STYLES[dep.state]
              return (
                <div key={dep.edge.id} className="rounded border border-slate-200 bg-white px-2 py-1.5">
                  <div className="flex items-center gap-1 text-[10px] text-slate-400"><Ban size={10} /> blocked by</div>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-slate-700">{dep.blocker.title}</span>
                    {dep.edge.dep?.status === 'proposed' ? (
                      <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-500">pending</span>
                    ) : (
                      <span className={cn('rounded px-1 text-[9px] font-semibold ring-1', state.className)}>{state.label}</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    derived → {dependencyState(dep.blocker.id, dep.dependent.id, graph)}
                  </div>
                  {dep.edge.dep?.pinTo && (
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500">
                      <ChevronRight size={10} /> pinned to {items.find((i) => i.id === dep.edge.dep?.pinTo)?.title ?? dep.edge.dep.pinTo}
                    </div>
                  )}
                </div>
              )
            })}
            {outgoing.map((dep) => (
              <div key={dep.edge.id} className="rounded border border-slate-200 bg-white px-2 py-1.5">
                <div className="flex items-center gap-1 text-[10px] text-slate-400"><GitBranch size={10} /> blocks</div>
                <div className="text-slate-700">{dep.dependent.title}</div>
                {dep.edge.dep?.status === 'proposed' ? (
                  <div className="mt-1 flex items-center gap-1">
                    <span className="rounded bg-amber-50 px-1 text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200">confirmation requested</span>
                    <button onClick={() => confirmDependency(dep.edge.id)} className="rounded bg-emerald-600 px-1.5 py-px text-[10px] font-medium text-white hover:bg-emerald-700">Confirm</button>
                    <button onClick={() => rejectDependency(dep.edge.id, 'Not a real dependency')} className="rounded border border-slate-200 px-1.5 py-px text-[10px] font-medium text-slate-600 hover:bg-slate-50">Reject</button>
                  </div>
                ) : (
                  <div className="text-[10px] text-slate-400">{statusOf(dep.dependent.id, graph).resolved ? 'dependent resolved' : `derived → ${DEP_STATE_STYLES[dep.state].label}`}</div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1">
            <select value={blockerId} onChange={(e) => setBlockerId(e.target.value)} className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-[11px]">
              <option value="">Raise: this is blocked by…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>{typeName(c.typeId)}: {c.title}</option>
              ))}
            </select>
            <button disabled={!blockerId} onClick={() => { raiseDependency(blockerId, item.id); setBlockerId('') }} className="rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40">Raise</button>
          </div>
        </section>

        {/* Attribution */}
        <section>
          <SectionLabel>Attribution — informs, never counts</SectionLabel>
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
            <p className="mt-1 text-[10px] text-emerald-700">Serves {attributed.length} objectives — still 1 unit of WIP.</p>
          )}
        </section>
      </div>
    </aside>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{children}</div>
}
