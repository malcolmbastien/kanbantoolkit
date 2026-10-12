import { useState } from 'react'
import { Plus, Target, Trash2, X } from 'lucide-react'
import { buildRefs, isStrategicInitiative } from '@/domain/board'
import { rollupOf, type Graph } from '@/domain/derive'
import { OBJECTIVE_STATUS_STYLES } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { IssueType, Item, Objective } from '@/domain/types'

const COMMITMENT_LIMIT = 5 // "3–5 objectives" is a commitment limit, not a WIP limit

export function ObjectivesView() {
  const objectives = useStore((s) => s.objectives)
  const keyResults = useStore((s) => s.keyResults)
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const boards = useStore((s) => s.boards)
  const issueTypes = useStore((s) => s.issueTypes)
  const addObjective = useStore((s) => s.addObjective)
  const updateObjective = useStore((s) => s.updateObjective)
  const removeObjective = useStore((s) => s.removeObjective)
  const addKeyResult = useStore((s) => s.addKeyResult)
  const updateKeyResult = useStore((s) => s.updateKeyResult)
  const removeKeyResult = useStore((s) => s.removeKeyResult)
  const setAttribution = useStore((s) => s.setAttribution)
  const openItem = useStore((s) => s.openItem)

  const graph: Graph = { items, edges, links, placements, lanes }
  const refs = buildRefs(items, issueTypes)
  const typeOf = (id: string): IssueType => issueTypes.find((t) => t.id === id) ?? { id, name: 'Item', color: '#64748b' }

  const periods = [...new Set(objectives.map((o) => o.period))]
  const [period, setPeriod] = useState(periods[0] ?? 'FY26 Q1')
  const shown = objectives.filter((o) => o.period === period)

  const [newTitle, setNewTitle] = useState('')
  const [krDraft, setKrDraft] = useState<Record<string, string>>({})
  const [attrPick, setAttrPick] = useState<Record<string, string>>({})

  // OKRs attach to strategic initiatives only — an Initiative on a portfolio board.
  const strategicCtx = { items, placements, boards, issueTypes }
  const initiatives = items
    .filter((i) => isStrategicInitiative(i.id, strategicCtx))
    .sort((a, b) => a.title.localeCompare(b.title))

  const attributedItems = (objectiveId: string): Item[] =>
    edges
      .filter((e) => e.kind === 'attribution' && e.from === objectiveId)
      .map((e) => items.find((i) => i.id === e.to))
      .filter((i): i is Item => i !== undefined && isStrategicInitiative(i.id, strategicCtx))

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-950/40 bg-slate-800 px-3 py-1.5 text-[11px] text-slate-300">
        <Target size={14} className="text-indigo-300" />
        <span className="text-[13px] font-bold text-white">Objectives &amp; Key Results</span>
        <span className="text-slate-400">— how work maps to organizational priorities</span>
        <label className="ml-2 flex items-center gap-1 text-slate-400">
          Period
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-md border border-slate-600 bg-slate-700 px-1.5 py-1 text-[11px] text-slate-100 outline-none">
            {periods.length === 0 && <option value={period}>{period}</option>}
            {periods.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <span
          className={cn('rounded px-1.5 py-px font-semibold', shown.length > COMMITMENT_LIMIT ? 'bg-rose-500 text-white' : 'bg-slate-700 text-slate-200')}
          title={`Commitment limit: ${COMMITMENT_LIMIT} objectives per period`}
        >
          {shown.length} / {COMMITMENT_LIMIT} objectives
        </span>

        <div className="ml-auto flex items-center gap-1">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="New objective…"
            className="w-44 rounded-md border border-slate-600 bg-slate-700 px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-400 outline-none"
          />
          <button
            disabled={newTitle.trim().length < 2}
            onClick={() => {
              addObjective(newTitle.trim(), period)
              setNewTitle('')
            }}
            className="flex items-center gap-1 rounded-md bg-indigo-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
          >
            <Plus size={12} /> Objective
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {shown.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-100 p-8 text-center text-[12px] text-slate-500">
            No objectives for {period}. Add one above.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {shown.map((o) => {
            const krs = keyResults.filter((k) => k.objectiveId === o.id)
            const work = attributedItems(o.id)
            return (
              <section key={o.id} className="flex flex-col rounded-lg border border-slate-300 bg-white shadow-sm">
                <div className="flex items-center gap-2 rounded-t-lg border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
                  <input
                    value={o.title}
                    onChange={(e) => updateObjective(o.id, { title: e.target.value })}
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent text-[13px] font-semibold text-slate-800 hover:border-slate-200 focus:border-indigo-300 focus:outline-none"
                  />
                  <select
                    value={o.status}
                    onChange={(e) => updateObjective(o.id, { status: e.target.value as Objective['status'] })}
                    className={cn('rounded px-1 py-px text-[10px] font-semibold ring-1 outline-none', OBJECTIVE_STATUS_STYLES[o.status])}
                  >
                    <option value="active">active</option>
                    <option value="scored">scored</option>
                  </select>
                  <button onClick={() => removeObjective(o.id)} className="text-slate-300 hover:text-rose-500" title="Delete objective">
                    <Trash2 size={13} />
                  </button>
                </div>

                <div className="flex flex-1 flex-col gap-3 p-2.5 text-[12px]">
                  {/* score */}
                  <label className="flex items-center gap-2 text-slate-500">
                    Score
                    <input
                      type="number" min={0} max={100}
                      value={o.score ?? ''}
                      onChange={(e) => updateObjective(o.id, { score: e.target.value === '' ? undefined : Number(e.target.value) })}
                      className="w-16 rounded border border-slate-200 px-1.5 py-0.5 text-[11px]"
                    />
                    <span className="text-slate-400">/ 100</span>
                  </label>

                  {/* key results */}
                  <div>
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Key results</div>
                    <div className="space-y-1">
                      {krs.map((k) => (
                        <div key={k.id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={(k.progress ?? 0) >= 100}
                            onChange={(e) => updateKeyResult(k.id, { progress: e.target.checked ? 100 : 0 })}
                            title="Mark achieved"
                          />
                          <input
                            value={k.title}
                            onChange={(e) => updateKeyResult(k.id, { title: e.target.value })}
                            className="min-w-0 flex-1 rounded border border-transparent px-1 py-px text-[12px] text-slate-700 hover:border-slate-200 focus:border-indigo-300 focus:outline-none"
                          />
                          <input
                            type="number" min={0} max={100}
                            value={k.progress ?? ''}
                            onChange={(e) => updateKeyResult(k.id, { progress: e.target.value === '' ? undefined : Number(e.target.value) })}
                            placeholder="%"
                            className="w-12 rounded border border-slate-200 px-1 py-px text-[11px]"
                          />
                          <button onClick={() => removeKeyResult(k.id)} className="text-slate-300 hover:text-rose-500"><X size={12} /></button>
                        </div>
                      ))}
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <input
                        value={krDraft[o.id] ?? ''}
                        onChange={(e) => setKrDraft((d) => ({ ...d, [o.id]: e.target.value }))}
                        placeholder="Add a key result…"
                        className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-0.5 text-[11px]"
                      />
                      <button
                        disabled={(krDraft[o.id] ?? '').trim().length < 2}
                        onClick={() => {
                          addKeyResult(o.id, (krDraft[o.id] ?? '').trim())
                          setKrDraft((d) => ({ ...d, [o.id]: '' }))
                        }}
                        className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-40"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {/* attributed work */}
                  <div className="mt-auto">
                    <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      Initiatives mapping here <span className="rounded bg-slate-100 px-1 text-slate-500">{work.length}</span>
                      <span className="ml-1 font-normal normal-case text-slate-400">(never counts as WIP)</span>
                    </div>
                    <div className="space-y-1">
                      {work.map((it) => {
                        const r = rollupOf(it.id, graph)
                        return (
                          <div key={it.id} className="flex items-center gap-2 rounded border border-slate-200 px-1.5 py-1">
                            <span className="rounded px-1 py-px text-[9px] font-bold uppercase text-white" style={{ backgroundColor: typeOf(it.typeId).color }}>
                              {typeOf(it.typeId).name}
                            </span>
                            <button onClick={() => openItem(it.id)} className="min-w-0 flex-1 truncate text-left text-[11px] text-slate-700 hover:text-indigo-600">
                              <span className="tabular-nums text-slate-400">{refs.get(it.id)}</span> {it.title}
                            </button>
                            <span className="text-[10px] font-semibold tabular-nums text-slate-500">{r.percent}%</span>
                            <button onClick={() => setAttribution(it.id, o.id, false)} className="text-slate-300 hover:text-rose-500" title="Remove from this objective">
                              <X size={12} />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <select
                        value={attrPick[o.id] ?? ''}
                        onChange={(e) => setAttrPick((p) => ({ ...p, [o.id]: e.target.value }))}
                        className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-0.5 text-[11px]"
                      >
                        <option value="">Map an initiative…</option>
                        {initiatives.map((i) => (
                          <option key={i.id} value={i.id}>{refs.get(i.id)} {i.title}</option>
                        ))}
                      </select>
                      <button
                        disabled={!attrPick[o.id]}
                        onClick={() => {
                          setAttribution(attrPick[o.id], o.id, true)
                          setAttrPick((p) => ({ ...p, [o.id]: '' }))
                        }}
                        className="rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-40"
                      >
                        Map
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
