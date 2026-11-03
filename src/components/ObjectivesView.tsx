import { useEffect, useRef, useState } from 'react'
import { Plus, Target, Trash2, TriangleAlert, X } from 'lucide-react'
import { objectiveInitiatives } from '@/domain/board'
import { objectiveRollup, rollupOf, type Graph } from '@/domain/derive'
import { periodsInOrder } from '@/domain/periods'
import { periodRangeLabel } from '@/lib/periodRange'
import { OBJECTIVE_STATUS_STYLES } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { VocabularySaveError } from './VocabularySaveError'
import { ItemPicker } from './ItemPicker'
import type { IssueType, Item, Objective } from '@/domain/types'

const COMMITMENT_LIMIT = 5 // "3–5 objectives" is a commitment limit, not a WIP limit

export function ObjectivesView() {
  const objectives = useStore((s) => s.objectives)
  const periods = useStore((s) => s.periods)
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
  const addPeriod = useStore((s) => s.addPeriod)
  const updatePeriod = useStore((s) => s.updatePeriod)
  const removePeriod = useStore((s) => s.removePeriod)
  const addKeyResult = useStore((s) => s.addKeyResult)
  const updateKeyResult = useStore((s) => s.updateKeyResult)
  const removeKeyResult = useStore((s) => s.removeKeyResult)
  const setAttribution = useStore((s) => s.setAttribution)
  const openItem = useStore((s) => s.openItem)

  const graph: Graph = { items, edges, links, placements, lanes }
  const typeOf = (id: string): IssueType => issueTypes.find((t) => t.id === id) ?? { id, name: 'Item', color: '#64748b' }

  // A period is a record with a window, so the view selects one by id and shows the window it is
  // committed in. Objectives are filtered by it — the list is one period at a time, which is what
  // makes "3–5 objectives" a commitment limit rather than a display choice.
  const ordered = periodsInOrder(periods)
  const [periodId, setPeriodId] = useState(ordered[0]?.id ?? '')
  const selected = ordered.find((p) => p.id === periodId)
  const shown = objectives.filter((o) => o.periodId === periodId)
  // A period can be removed — by this view, or by somebody else — while it is selected. The view
  // falls to the first period rather than showing an empty list under a window nobody has.
  useEffect(() => {
    if (periodId && !periods.some((p) => p.id === periodId)) setPeriodId(periodsInOrder(periods)[0]?.id ?? '')
  }, [periodId, periods])
  const [newPeriodOpen, setNewPeriodOpen] = useState(false)
  const [newPeriod, setNewPeriod] = useState('')
  const [newPeriodStart, setNewPeriodStart] = useState('')
  const [newPeriodEnd, setNewPeriodEnd] = useState('')
  const [periodError, setPeriodError] = useState('')
  const objectiveTitle = useRef<HTMLInputElement>(null)

  const createPeriod = () => {
    const name = newPeriod.trim()
    if (!name) return
    const id = addPeriod(name, newPeriodStart || undefined, newPeriodEnd || undefined)
    if (!id) {
      setPeriodError('A period with that name already exists.')
      return
    }
    setPeriodId(id)
    setNewPeriodOpen(false)
    setNewPeriod('')
    setNewPeriodStart('')
    setNewPeriodEnd('')
    setPeriodError('')
    // The empty state is already saying what to do; put the caret where it belongs.
    requestAnimationFrame(() => objectiveTitle.current?.focus())
  }

  const [newTitle, setNewTitle] = useState('')
  const [krDraft, setKrDraft] = useState<Record<string, string>>({})

  // An objective is served by root initiatives — any board's, not only one placed here. A nested
  // initiative inherits its parent's objective, and a card is never mapped.
  const initiatives = objectiveInitiatives(graph, issueTypes)
  /** The board an initiative is carried by, said beside it because the work may live anywhere. */
  const boardNameOf = (itemId: string): string | undefined => {
    const placement = placements.find((p) => p.itemId === itemId)
    return placement ? boards.find((b) => b.id === placement.boardId)?.name : undefined
  }

  const attributedItems = (objectiveId: string): Item[] =>
    edges
      .filter((e) => e.kind === 'attribution' && e.from === objectiveId)
      .map((e) => items.find((i) => i.id === e.to))
      .filter((i): i is Item => i !== undefined && !i.archived)

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-200">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* A light header, like every other view's: the dark strip this used to be put grey text on
            a slate ground — about 2:1, against this app's own 4.5 floor — and left the one action
            the page is for at the far end of it. The action is now a button with a name, and the
            line under the title says what the page is for. */}
        <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2 rounded-lg border border-violet-300 bg-violet-50/70 px-4 py-3">
          <div>
            <div className="flex items-center gap-1.5 text-meta font-bold uppercase tracking-wide text-violet-700">
              <Target size={12} /> Objectives &amp; Key Results
            </div>
            <div className="text-heading font-semibold text-slate-800">
              {shown.length} of {COMMITMENT_LIMIT} this period
              {shown.length > COMMITMENT_LIMIT && (
                <span className="ml-2 rounded bg-rose-100 px-1.5 py-px text-meta font-semibold text-rose-700 ring-1 ring-rose-300" title={`Commitment limit: ${COMMITMENT_LIMIT} objectives per period`}>
                  over the commitment limit
                </span>
              )}
            </div>
            <div className="text-meta text-slate-600">
              What the work is for: each objective carries the key results that say what it means, and the initiatives mapped to it. The completeness comes from the work below those initiatives, never from a number typed in. Mapping one here is attribution — it never counts as WIP.
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-1.5 text-meta text-slate-600">
              Period
              <select
                aria-label="Period"
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
                disabled={ordered.length === 0}
                className="rounded border border-slate-200 bg-white px-1.5 py-1 text-meta text-slate-700 outline-none focus:ring-2 focus:ring-violet-300 disabled:opacity-50"
              >
                {ordered.length === 0 && <option value="">No periods yet</option>}
                {ordered.map((p) => {
                  const range = periodRangeLabel(p)
                  return (
                    <option key={p.id} value={p.id}>
                      {range ? `${p.name} · ${range}` : p.name}
                    </option>
                  )
                })}
              </select>
            </label>

            {/* The window belongs to the period, not to an objective: set it once here and every
                objective committed for it is due at the same time. */}
            <div className="flex items-end gap-1.5">
              <label className="flex flex-col gap-0.5 text-micro font-medium text-slate-600">
                Starts
                <input
                  type="date"
                  aria-label="Period start"
                  value={selected?.start ?? ''}
                  disabled={!selected}
                  onChange={(e) => selected && updatePeriod(selected.id, { start: e.target.value || undefined })}
                  className="rounded border border-slate-200 bg-white px-1.5 py-1 text-meta text-slate-700 outline-none focus:ring-2 focus:ring-violet-300 disabled:opacity-50"
                />
              </label>
              <span className="pb-1.5 text-slate-400" aria-hidden="true">–</span>
              <label className="flex flex-col gap-0.5 text-micro font-medium text-slate-600">
                Ends
                <input
                  type="date"
                  aria-label="Period end"
                  value={selected?.end ?? ''}
                  disabled={!selected}
                  onChange={(e) => selected && updatePeriod(selected.id, { end: e.target.value || undefined })}
                  className="rounded border border-slate-200 bg-white px-1.5 py-1 text-meta text-slate-700 outline-none focus:ring-2 focus:ring-violet-300 disabled:opacity-50"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => {
                setNewPeriodOpen((open) => !open)
                setPeriodError('')
              }}
              className="flex items-center gap-1 rounded-md border border-violet-300 bg-white px-2 py-1 text-meta font-medium text-violet-700 transition hover:bg-violet-50"
              title="Name a period, set its window, then add an objective"
            >
              <Plus size={12} /> New period
            </button>

            {selected && shown.length === 0 && (
              <button
                type="button"
                onClick={() => {
                  removePeriod(selected.id)
                  setPeriodId(ordered.find((p) => p.id !== selected.id)?.id ?? '')
                }}
                className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-meta font-medium text-slate-600 transition hover:border-rose-300 hover:text-rose-600"
                title={`Delete ${selected.name}. Only offered while nothing is committed for it.`}
              >
                <Trash2 size={12} /> Delete period
              </button>
            )}

            <div className="flex items-center gap-1">
              <input
                ref={objectiveTitle}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || newTitle.trim().length < 2) return
                  if (!periodId) return
                  addObjective(newTitle.trim(), periodId)
                  setNewTitle('')
                }}
                placeholder={`New objective in ${selected?.name ?? 'a period'}…`}
                className="w-48 rounded border border-slate-200 bg-white px-2 py-1 text-meta text-slate-700 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-violet-300"
              />
              <button
                disabled={!periodId || newTitle.trim().length < 2}
                onClick={() => {
                  if (!periodId) return
                  addObjective(newTitle.trim(), periodId)
                  setNewTitle('')
                }}
                className="flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-meta font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
              >
                <Plus size={12} /> New objective
              </button>
            </div>
          </div>

          {newPeriodOpen && (
            <div className="flex w-full flex-wrap items-end gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2">
              <label className="flex flex-col gap-0.5 text-micro font-medium text-slate-600">
                New period
                <input
                  autoFocus
                  aria-label="New period"
                  value={newPeriod}
                  onChange={(e) => setNewPeriod(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      createPeriod()
                    }
                    if (e.key === 'Escape') {
                      setNewPeriodOpen(false)
                      setNewPeriod('')
                      setNewPeriodStart('')
                      setNewPeriodEnd('')
                      setPeriodError('')
                    }
                  }}
                  placeholder="e.g. FY27 Q1"
                  className="w-40 rounded border border-slate-200 bg-white px-1.5 py-1 text-meta text-slate-700 outline-none focus:ring-2 focus:ring-violet-300"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-micro font-medium text-slate-600">
                Starts
                <input
                  type="date"
                  aria-label="New period start"
                  value={newPeriodStart}
                  onChange={(e) => setNewPeriodStart(e.target.value)}
                  className="rounded border border-slate-200 bg-white px-1.5 py-1 text-meta text-slate-700 outline-none focus:ring-2 focus:ring-violet-300"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-micro font-medium text-slate-600">
                Ends
                <input
                  type="date"
                  aria-label="New period end"
                  value={newPeriodEnd}
                  onChange={(e) => setNewPeriodEnd(e.target.value)}
                  className="rounded border border-slate-200 bg-white px-1.5 py-1 text-meta text-slate-700 outline-none focus:ring-2 focus:ring-violet-300"
                />
              </label>
              <button
                type="button"
                disabled={!newPeriod.trim()}
                onClick={createPeriod}
                className="rounded-md bg-violet-700 px-2.5 py-1 text-meta font-medium text-white transition hover:bg-violet-600 disabled:opacity-40"
              >
                Create period
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewPeriodOpen(false)
                  setNewPeriod('')
                  setNewPeriodStart('')
                  setNewPeriodEnd('')
                  setPeriodError('')
                }}
                className="rounded-md border border-slate-200 px-2.5 py-1 text-meta font-medium text-slate-600 transition hover:border-slate-300"
              >
                Cancel
              </button>
              <span className="text-micro text-slate-500">
                The window is the objective's deadline: a period's work is due when it ends.
              </span>
              {periodError && <span className="text-micro font-medium text-rose-700">{periodError}</span>}
            </div>
          )}

          {/* An objective or a key result that did not land says so where it was named. */}
          <div className="w-full">
            <VocabularySaveError lists={['periods', 'objectives', 'keyResults']} />
          </div>
        </div>

        {shown.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-100 p-8 text-center text-meta text-slate-600">
            {ordered.length === 0 ? (
              <>No periods yet. Name one above, set its window, then add an objective.</>
            ) : (
              <>
                No objectives in {selected?.name ?? 'this period'} yet. Name one above and press{' '}
                <span className="font-semibold text-slate-700">New objective</span>.
              </>
            )}
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
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent text-body font-semibold text-slate-800 hover:border-slate-200 focus:border-indigo-300 focus:outline-none"
                  />
                  <select
                    value={o.status}
                    onChange={(e) => updateObjective(o.id, { status: e.target.value as Objective['status'] })}
                    className={cn('rounded px-1 py-px text-micro font-semibold ring-1 outline-none', OBJECTIVE_STATUS_STYLES[o.status])}
                  >
                    <option value="active">active</option>
                    <option value="reviewed">reviewed</option>
                  </select>
                  <button onClick={() => removeObjective(o.id)} className="text-slate-600 hover:text-rose-500" title="Delete objective">
                    <Trash2 size={13} />
                  </button>
                </div>

                <div className="flex flex-1 flex-col gap-3 p-2.5 text-meta">
                  {/* How far along: the rollup of the work below the initiatives that serve
                      this objective. An objective nothing serves has no number, and the gap says
                      so in words rather than as a 0%. */}
                  {(() => {
                    const roll = objectiveRollup(o.id, graph)
                    return roll ? (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-micro font-bold uppercase tracking-wide text-slate-600">Work serving it</span>
                          <span className="text-body font-bold tabular-nums text-indigo-700">{roll.percent}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${roll.percent}%` }} />
                        </div>
                        <div className="text-micro text-slate-600">
                          {roll.done} of {roll.total} {roll.total === 1 ? 'issue' : 'issues'} done
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-meta text-amber-800">
                        <TriangleAlert size={11} className="shrink-0" /> No initiative is mapped to this objective.
                      </div>
                    )
                  })()}

                  {/* key results — what the objective means, in words. The number that says how
                      far along it is comes from the work that serves it, above. */}
                  <div>
                    <div className="mb-1 text-micro font-bold uppercase tracking-wide text-slate-600">Key results</div>
                    <div className="space-y-1">
                      {krs.map((k) => (
                        <div key={k.id} className="flex items-center gap-2">
                          <input
                            value={k.title}
                            onChange={(e) => updateKeyResult(k.id, { title: e.target.value })}
                            className="min-w-0 flex-1 rounded border border-transparent px-1 py-px text-meta text-slate-700 hover:border-slate-200 focus:border-indigo-300 focus:outline-none"
                          />
                          <button
                            onClick={() => removeKeyResult(k.id)}
                            className="text-slate-400 hover:text-rose-500"
                            title="Remove this key result"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <input
                        value={krDraft[o.id] ?? ''}
                        onChange={(e) => setKrDraft((d) => ({ ...d, [o.id]: e.target.value }))}
                        placeholder="Add a key result…"
                        className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-0.5 text-meta"
                      />
                      <button
                        disabled={(krDraft[o.id] ?? '').trim().length < 2}
                        onClick={() => {
                          addKeyResult(o.id, (krDraft[o.id] ?? '').trim())
                          setKrDraft((d) => ({ ...d, [o.id]: '' }))
                        }}
                        className="rounded bg-slate-800 px-2 py-0.5 text-meta font-medium text-white disabled:opacity-40"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {/* attributed work */}
                  <div className="mt-auto">
                    <div className="mb-1 flex items-center gap-1 text-micro font-bold uppercase tracking-wide text-slate-600">
                      Initiatives mapping here <span className="rounded bg-slate-100 px-1 text-slate-600">{work.length}</span>
                      <span className="ml-1 font-normal normal-case text-slate-600">(never counts as WIP)</span>
                    </div>
                    <div className="space-y-1">
                      {work.map((it) => {
                        const r = rollupOf(it.id, graph)
                        return (
                          <div key={it.id} className="flex items-center gap-2 rounded border border-slate-200 px-1.5 py-1">
                            <span className="rounded px-1 py-px text-micro font-bold uppercase text-white" style={{ backgroundColor: typeOf(it.typeId).color }}>
                              {typeOf(it.typeId).name}
                            </span>
                            <button onClick={() => openItem(it.id)} className="min-w-0 flex-1 truncate text-left text-meta text-slate-700 hover:text-indigo-600">
                              {it.title}
                            </button>
                            <span className="text-micro font-semibold tabular-nums text-slate-600">{r.percent}%</span>
                            <button onClick={() => setAttribution(it.id, o.id, false)} className="text-slate-600 hover:text-rose-500" title="Remove from this objective">
                              <X size={12} />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                    <div className="mt-1">
                      <ItemPicker
                        items={initiatives.filter((i) => !work.some((w) => w.id === i.id))}
                        boardOf={boardNameOf}
                        movesFrom={(itemId) =>
                          objectives.find(
                            (x) => x.id !== o.id && edges.some((e) => e.kind === 'attribution' && e.from === x.id && e.to === itemId),
                          )?.title
                        }
                        onPick={(itemId) => setAttribution(itemId, o.id, true)}
                      />
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
