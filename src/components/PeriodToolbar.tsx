import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Pencil, Plus, Trash2 } from 'lucide-react'
import { periodProgress, periodsInOrder, type PeriodProgress } from '@/domain/periods'
import { periodRangeLabel } from '@/lib/periodRange'
import { parseDay } from '@/domain/filters'
import { useStore } from '@/store'
import { VocabularySaveError } from './VocabularySaveError'

const COMMITMENT_LIMIT = 5 // "3–5 objectives" is a commitment limit, not a WIP limit

/**
 * Period management and objective creation, above the strategy map while the board is in
 * **Edit objectives**.
 *
 * The map keeps showing every period; this bar chooses which period a new objective joins and
 * which one is being edited. Nothing here is a draft: changes save through the vocabulary sync as
 * they are made, because that is how objectives and periods already live.
 */
export function PeriodToolbar() {
  const periods = useStore((s) => s.periods)
  const objectives = useStore((s) => s.objectives)
  const addObjective = useStore((s) => s.addObjective)
  const addPeriod = useStore((s) => s.addPeriod)
  const updatePeriod = useStore((s) => s.updatePeriod)
  const removePeriod = useStore((s) => s.removePeriod)

  const ordered = periodsInOrder(periods)
  const [periodId, setPeriodId] = useState(ordered[0]?.id ?? '')
  const selected = ordered.find((p) => p.id === periodId)
  const progress = selected ? periodProgress(selected) : undefined
  const shown = objectives.filter((o) => o.periodId === periodId)

  useEffect(() => {
    if (periodId && !periods.some((p) => p.id === periodId)) setPeriodId(periodsInOrder(periods)[0]?.id ?? '')
  }, [periodId, periods])

  const [newPeriodOpen, setNewPeriodOpen] = useState(false)
  const [newPeriod, setNewPeriod] = useState('')
  const [newPeriodStart, setNewPeriodStart] = useState('')
  const [newPeriodEnd, setNewPeriodEnd] = useState('')
  const [periodError, setPeriodError] = useState('')
  const objectiveTitle = useRef<HTMLInputElement>(null)

  const [editingPeriod, setEditingPeriod] = useState(false)
  const [periodDraft, setPeriodDraft] = useState({ name: '', start: '', end: '' })
  const [periodEditError, setPeriodEditError] = useState('')

  useEffect(() => {
    setEditingPeriod(false)
    setPeriodEditError('')
  }, [periodId])

  const beginPeriodEdit = () => {
    if (!selected) return
    setPeriodDraft({ name: selected.name, start: selected.start ?? '', end: selected.end ?? '' })
    setPeriodEditError('')
    setEditingPeriod(true)
  }

  const savePeriod = () => {
    if (!selected) return
    const name = periodDraft.name.trim()
    if (!name) {
      setPeriodEditError('A period needs a name.')
      return
    }
    if (periods.some((p) => p.id !== selected.id && p.name.trim().toLowerCase() === name.toLowerCase())) {
      setPeriodEditError('A period with that name already exists.')
      return
    }
    if (periodDraft.start && periodDraft.end && periodDraft.end < periodDraft.start) {
      setPeriodEditError('The period must end on or after the day it starts.')
      return
    }
    updatePeriod(selected.id, { name, start: periodDraft.start || undefined, end: periodDraft.end || undefined })
    setEditingPeriod(false)
    setPeriodEditError('')
  }

  const cancelPeriodEdit = () => {
    setEditingPeriod(false)
    setPeriodEditError('')
  }

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
    requestAnimationFrame(() => objectiveTitle.current?.focus())
  }

  const [newTitle, setNewTitle] = useState('')

  const fullDay = (iso?: string) =>
    parseDay(iso)?.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) ?? 'Not set'

  const progressLabel = (value: PeriodProgress): string => {
    switch (value.state) {
      case 'upcoming':
        return value.daysUntilStart === 1 ? 'Starts tomorrow' : `Starts in ${value.daysUntilStart} days`
      case 'running':
        if (value.day !== undefined && value.totalDays !== undefined) return `Day ${value.day} of ${value.totalDays}`
        if (value.day !== undefined) return `Day ${value.day}`
        if (value.daysLeft !== undefined) return `${value.daysLeft} day${value.daysLeft === 1 ? '' : 's'} left`
        return 'In progress'
      case 'ended':
        return value.daysSinceEnd === 1 ? 'Ended yesterday' : value.daysSinceEnd === 0 ? 'Ended today' : `Ended ${value.daysSinceEnd} days ago`
      default:
        return 'No window set'
    }
  }

  const progressDetail = (value: PeriodProgress): string | undefined => {
    if (value.totalDays === undefined) return undefined
    if (value.state === 'running' && value.daysLeft !== undefined) return `${value.daysLeft} day${value.daysLeft === 1 ? '' : 's'} left`
    if (value.state === 'upcoming') return `${value.totalDays} day${value.totalDays === 1 ? '' : 's'} long`
    if (value.state === 'ended') return `${value.totalDays} day${value.totalDays === 1 ? '' : 's'} long`
    return undefined
  }

  return (
    <div className="space-y-2 rounded-lg border border-violet-300 bg-violet-50/70 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="text-meta font-semibold text-slate-700">
          {shown.length} of {COMMITMENT_LIMIT} this period
          {shown.length > COMMITMENT_LIMIT && (
            <span className="ml-2 rounded bg-rose-100 px-1.5 py-px text-meta font-semibold text-rose-700 ring-1 ring-rose-300" title={`Commitment limit: ${COMMITMENT_LIMIT} objectives per period`}>
              over the commitment limit
            </span>
          )}
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

          <div className="flex items-center gap-1">
            <input
              ref={objectiveTitle}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || newTitle.trim().length < 2 || !periodId) return
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
      </div>

      {selected && progress && (
        <section data-period-header className="overflow-hidden rounded-xl border border-violet-300 border-l-4 border-l-violet-600 bg-white shadow-sm">
          <div className="bg-violet-50/70 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-micro font-bold uppercase tracking-wide text-violet-700">
                  <CalendarDays size={12} /> Period
                </div>
                <h3 className="mt-0.5 break-words text-heading font-semibold leading-tight text-slate-900">{selected.name}</h3>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {!editingPeriod && (
                  <button
                    type="button"
                    onClick={beginPeriodEdit}
                    className="flex items-center gap-1 rounded-md border border-violet-300 bg-white px-2 py-1 text-meta font-medium text-violet-700 transition hover:bg-violet-50"
                    title={`Edit ${selected.name}'s name and window`}
                  >
                    <Pencil size={12} /> Edit period
                  </button>
                )}
                {shown.length === 0 && (
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
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-meta text-slate-600">
              <span>
                <span className="mr-1 text-micro font-semibold uppercase tracking-wide text-slate-500">Starts</span>
                {fullDay(selected.start)}
              </span>
              <span>
                <span className="mr-1 text-micro font-semibold uppercase tracking-wide text-slate-500">Ends</span>
                {fullDay(selected.end)}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-body font-semibold text-slate-800">{progressLabel(progress)}</span>
              {progress.percent !== undefined && (
                <span className="text-meta font-semibold tabular-nums text-violet-700">{progress.percent}%</span>
              )}
              {progress.percent !== undefined && (
                <div className="h-1.5 min-w-32 flex-1 overflow-hidden rounded-full bg-violet-100">
                  <div className="h-full rounded-full bg-violet-600 transition-all" style={{ width: `${progress.percent}%` }} />
                </div>
              )}
              {progressDetail(progress) && <span className="text-micro text-slate-500">{progressDetail(progress)}</span>}
            </div>
          </div>

          {editingPeriod && (
            <div className="flex flex-wrap items-end gap-2 border-t border-violet-100 px-4 py-3">
              <label className="flex flex-col gap-0.5 text-micro font-medium text-slate-600">
                Name
                <input
                  autoFocus
                  aria-label="Edit period name"
                  value={periodDraft.name}
                  onChange={(e) => setPeriodDraft((draft) => ({ ...draft, name: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      savePeriod()
                    }
                    if (e.key === 'Escape') cancelPeriodEdit()
                  }}
                  className="w-44 rounded border border-slate-200 bg-white px-1.5 py-1 text-meta text-slate-700 outline-none focus:ring-2 focus:ring-violet-300"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-micro font-medium text-slate-600">
                Starts
                <input
                  type="date"
                  aria-label="Period start"
                  value={periodDraft.start}
                  onChange={(e) => setPeriodDraft((draft) => ({ ...draft, start: e.target.value }))}
                  className="rounded border border-slate-200 bg-white px-1.5 py-1 text-meta text-slate-700 outline-none focus:ring-2 focus:ring-violet-300"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-micro font-medium text-slate-600">
                Ends
                <input
                  type="date"
                  aria-label="Period end"
                  value={periodDraft.end}
                  onChange={(e) => setPeriodDraft((draft) => ({ ...draft, end: e.target.value }))}
                  className="rounded border border-slate-200 bg-white px-1.5 py-1 text-meta text-slate-700 outline-none focus:ring-2 focus:ring-violet-300"
                />
              </label>
              <button
                type="button"
                onClick={savePeriod}
                className="rounded-md bg-violet-700 px-2.5 py-1 text-meta font-medium text-white transition hover:bg-violet-600"
              >
                Save period
              </button>
              <button
                type="button"
                onClick={cancelPeriodEdit}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-meta font-medium text-slate-600 transition hover:border-slate-300"
              >
                Cancel
              </button>
              {periodEditError && <span className="text-micro font-medium text-rose-700">{periodEditError}</span>}
            </div>
          )}
        </section>
      )}

      <VocabularySaveError lists={['periods', 'objectives', 'keyResults']} />
    </div>
  )
}
