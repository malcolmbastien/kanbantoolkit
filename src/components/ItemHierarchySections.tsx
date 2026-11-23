/**
 * The drawer's hierarchy seams: the parent, the strategic impact, and the small section/field
 * primitives they share. Keeping them beside the drawer instead of inside its 3,000-line component
 * makes the next change to the hierarchy local.
 */
import { useMemo, useState } from 'react'
import { CornerLeftUp, Target } from 'lucide-react'
import { canSetParent, parentRefusal, type ParentRefusal } from '@/domain/board'
import { objectiveRollup, type Graph } from '@/domain/derive'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { IssueType, Item, KeyResult, Objective, Period } from '@/domain/types'

export function Section({
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

/** A field: what it is called, the value, and — where it helps — why the value is what it is. */
export function Field({
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

/**
 * How far along an objective is, wherever an objective is read beside work.
 *
 * The number comes from the initiatives attributed to the objective and the leaves below them —
 * the same rollup an initiative uses, so the two can never disagree. An objective nothing serves
 * has no number: 0% would be a worse way of saying that nothing serves it.
 */
export function ObjectiveProgress({ objectiveId }: { objectiveId: string }) {
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
        {roll.done} of {roll.total} done
      </div>
    </div>
  )
}

/** The direct parent, and the one hierarchy edit the drawer offers. */
export function ParentSection({
  item,
  parent,
  parentKind,
  graph,
  issueTypes,
  boardNameOf,
  attributed,
  onSetParent,
  onClearObjective,
  onOpenParent,
}: {
  item: Item
  parent?: Item
  parentKind?: string
  graph: Graph
  issueTypes: IssueType[]
  boardNameOf: (id: string) => string | undefined
  attributed: Objective[]
  onSetParent: (parentId: string | null) => void
  onClearObjective: () => void
  onOpenParent: (itemId: string) => void
}) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [choice, setChoice] = useState('')
  const lock: ParentRefusal | undefined = parentRefusal(item.id, null, graph, issueTypes)
  const candidates = useMemo(
    () => (editorOpen ? graph.items.filter((i) => canSetParent(item.id, i.id, graph, issueTypes)) : []),
    [editorOpen, graph, issueTypes, item.id],
  )

  return (
    <Section
      label="Parent"
      action={
        lock ? undefined : (
          <button
            onClick={() => {
              setEditorOpen((open) => !open)
              setChoice('')
            }}
            className="text-micro font-medium text-indigo-600 transition hover:text-indigo-500"
          >
            {editorOpen ? 'Cancel' : 'Change parent'}
          </button>
        )
      }
    >
      {lock === 'serves_objective' ? (
        <div className="rounded-xl bg-indigo-50/60 p-3 text-meta text-slate-700 ring-1 ring-indigo-100">
          <p className="font-medium text-slate-800">Serves {attributed[0]?.title ?? 'an objective'}.</p>
          <p className="mt-1">
            A mapped initiative stays top-level so its work counts once. Clear its objective to roll it up
            under another initiative.
          </p>
          <button
            onClick={() => {
              if (!attributed[0]) return
              onClearObjective()
              setEditorOpen(true)
            }}
            className="mt-2 rounded-lg bg-indigo-600 px-2.5 py-1 text-meta font-medium text-white transition hover:bg-indigo-500"
          >
            Clear objective
          </button>
        </div>
      ) : editorOpen ? (
        <div className="space-y-2 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
          {candidates.length === 0 ? (
            <p className="text-meta text-slate-600">No other initiative can be its parent.</p>
          ) : (
            <select
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-meta outline-none transition focus:ring-2 focus:ring-indigo-400"
            >
              <option value="">Choose an initiative…</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.title}</option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-1.5">
            <button
              disabled={!choice}
              onClick={() => {
                onSetParent(choice)
                setChoice('')
                setEditorOpen(false)
              }}
              className="rounded-lg bg-indigo-600 px-2.5 py-1 text-meta font-medium text-white transition hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-40"
            >
              Set parent
            </button>
            {parent && (
              <button
                onClick={() => {
                  onSetParent(null)
                  setEditorOpen(false)
                }}
                className="rounded-lg px-2 py-1 text-meta font-medium text-slate-600 transition hover:bg-slate-200 hover:text-slate-900"
              >
                Remove parent
              </button>
            )}
          </div>
          <p className="text-micro text-slate-600">A parent must be another initiative.</p>
        </div>
      ) : parent ? (
        <button
          onClick={() => onOpenParent(parent.id)}
          title={`Open ${parent.title}`}
          className="flex w-full items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 text-left ring-1 ring-slate-200 transition hover:bg-slate-100"
        >
          <CornerLeftUp size={15} className="shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-meta font-semibold text-slate-800">{parent.title}</span>
            <span className="block truncate text-micro text-slate-600">{parentKind}</span>
          </span>
          <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-micro font-medium text-slate-600 ring-1 ring-slate-200">
            {boardNameOf(parent.id) ?? 'Not on a board'}
          </span>
        </button>
      ) : (
        <p className="rounded-xl bg-slate-50 p-3 text-meta text-slate-600 ring-1 ring-slate-200">No parent.</p>
      )}
    </Section>
  )
}

/** An objective is served by a top-level initiative; a nested one inherits its parent's objective. */
export function StrategicImpactSection({
  canServe,
  parent,
  attributed,
  objectives,
  periods,
  keyResults,
  onSetAttribution,
}: {
  canServe: boolean
  parent?: Item
  attributed: Objective[]
  objectives: Objective[]
  periods: Period[]
  keyResults: KeyResult[]
  onSetAttribution: (objectiveId: string, on: boolean) => void
}) {
  const periodNameOf = (list: Period[], id: string | undefined) =>
    list.find((period) => period.id === id)?.name ?? 'No period'
  return (
    <Section label="Strategic impact">
      {canServe ? (
        <div className="space-y-2 rounded-xl bg-indigo-50/60 p-3 ring-1 ring-indigo-100">
          <Field label="Objective">
            <select
              value={attributed[0]?.id ?? ''}
              onChange={(event) => {
                const next = event.target.value
                if (next) onSetAttribution(next, true)
                else if (attributed[0]) onSetAttribution(attributed[0].id, false)
              }}
              title="One objective. Choosing another moves the initiative."
              className="w-full rounded-lg border border-indigo-200 bg-white px-2 py-1.5 text-meta font-medium text-slate-700 outline-none transition focus:ring-2 focus:ring-indigo-400"
            >
              <option value="">No objective</option>
              {objectives.map((objective) => (
                <option key={objective.id} value={objective.id}>
                  {objective.title} · {periodNameOf(periods, objective.periodId)}
                </option>
              ))}
            </select>
          </Field>

          {attributed.length === 0 ? (
            <p className="text-meta text-slate-600">No objective yet.</p>
          ) : (
            <>
              {keyResults.filter((keyResult) => keyResult.objectiveId === attributed[0].id).length === 0 ? (
                <p className="text-meta text-slate-600">No key results yet.</p>
              ) : (
                <ul className="space-y-0.5">
                  {keyResults
                    .filter((keyResult) => keyResult.objectiveId === attributed[0].id)
                    .map((keyResult) => (
                      <li key={keyResult.id} className="flex items-start gap-1.5 text-meta text-slate-700" title={keyResult.title}>
                        <Target size={11} className="mt-0.5 shrink-0 text-indigo-400" />
                        <span className="min-w-0 flex-1">{keyResult.title}</span>
                      </li>
                    ))}
                </ul>
              )}
              <ObjectiveProgress objectiveId={attributed[0].id} />
            </>
          )}
        </div>
      ) : (
        <p className="rounded-xl bg-slate-50 p-3 text-meta text-slate-600 ring-1 ring-slate-200">
          {parent?.title ?? 'Another initiative'} carries this initiative, so it inherits that objective.
          Only a top-level initiative is mapped.
        </p>
      )}
    </Section>
  )
}
