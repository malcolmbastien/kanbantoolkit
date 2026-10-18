import { Fragment, useState } from 'react'
import { Plus, Target, TriangleAlert } from 'lucide-react'
import { BoardSummary } from './BoardSummary'
import { buildRefs, initiativeTypeId } from '@/domain/board'
import { decompositionParent, objectiveRollup, okrCoverage, type Graph } from '@/domain/derive'
import { OBJECTIVE_STATUS_STYLES } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Objective } from '@/domain/types'

/**
 * The Strategy map — a portfolio board's surface, and the portfolio's own initiatives flow.
 *
 * An objective is not a report on the work; it is *where the work is read from*. So each objective
 * heads its own **initiatives workflow** — this board's own typed columns, exactly the flow the
 * team boards show, narrowed to the strategic initiatives that serve it. The connection is
 * containment: an initiative appears under the objective it is attributed to, in the column its
 * own work puts it in, with the progress and health it has everywhere else. Move it between cells
 * on its own board and it moves here; map it to another objective and it appears there too, because
 * attribution is a relation and not a container.
 *
 * Both coverage gaps are first-class and inline: an objective no initiative serves — which shows as
 * four empty columns with the reason said out loud — and an initiative no objective carries, which
 * gets a flow of its own at the end. That replaces the separate "OKR coverage" section: the gaps
 * are visible exactly where they occur.
 *
 * Attribution edges are the same ones the Objectives view edits ("one relation, two homes").
 * Editing the OKR itself (title, KRs, score) stays in the Objectives view, which this links out to.
 */
export function StrategyMap({ boardId }: { boardId: string }) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const placements = useStore((s) => s.placements)
  const issueTypes = useStore((s) => s.issueTypes)
  const links = useStore((s) => s.links)
  const lanes = useStore((s) => s.lanes)
  const objectives = useStore((s) => s.objectives)
  const keyResults = useStore((s) => s.keyResults)
  const setAttribution = useStore((s) => s.setAttribution)
  const setObjectives = useStore((s) => s.setObjectives)
  const addObjective = useStore((s) => s.addObjective)

  /** objectiveId → initiativeId, for the per-objective "map an initiative" select. */
  const [pick, setPick] = useState<Record<string, string>>({})
  /** The draft for a new objective, made here rather than sent to another page for. */
  const [newObjective, setNewObjective] = useState('')

  const graph: Graph = { items, edges, links, placements, lanes }
  const refs = buildRefs(items, issueTypes)
  const initId = initiativeTypeId(issueTypes)

  const onBoardIds = new Set(placements.filter((p) => p.boardId === boardId).map((p) => p.itemId))
  // Everything of this board's that could serve an objective: Initiative-typed, placed here, not
  // filed away — nested ones included, because an initiative under another on this board can be
  // attributed to an objective just as the OKR page will let you, and then it belongs in that
  // objective's flow like any other.
  const boardInits = items.filter((i) => onBoardIds.has(i.id) && i.typeId === initId && !i.archived)
  // The ones the map *heads*: local top-level, so an initiative whose parent is also on this board
  // is not a second row. Coverage is read over these — an outcome is committed or it is not, and a
  // piece of one is not a separate commitment.
  const mine = boardInits
    .filter((i) => {
      const parent = decompositionParent(i.id, edges)
      return !parent || !onBoardIds.has(parent)
    })
    .sort((a, b) => a.title.localeCompare(b.title))

  const attribution = edges.filter((e) => e.kind === 'attribution')
  // The two coverage gaps, straight from the domain rule: an initiative no objective
  // carries, and an objective no initiative serves.
  const { unmapped, unserved } = okrCoverage(mine, objectives, edges)
  const unservedIds = new Set(unserved.map((o) => o.id))
  const gapCount = unmapped.length + unserved.length

  const ordered = [...objectives].sort(
    (a, b) => a.period.localeCompare(b.period) || a.title.localeCompare(b.title),
  )
  const periodCount = new Set(ordered.map((o) => o.period)).size
  // Where an objective made here lands: the latest period the map already shows, so it appears
  // under a heading a reader recognises rather than inventing one.
  const latestPeriod = ordered[ordered.length - 1]?.period ?? 'FY26 Q1'
  const makeObjective = () => {
    if (newObjective.trim().length < 2) return
    addObjective(newObjective.trim(), latestPeriod)
    setNewObjective('')
  }

  /** Everything attributed to an objective — what its flow holds, nested initiatives included. */
  const serving = (objectiveId: string) =>
    boardInits.filter((i) => attribution.some((e) => e.from === objectiveId && e.to === i.id))

  const mapButton = (label: string, disabled: boolean, onMap: () => void) => (
    <button
      disabled={disabled}
      onClick={onMap}
      className="shrink-0 rounded bg-violet-600 px-2 py-0.5 text-meta font-medium text-white hover:bg-violet-500 disabled:opacity-40"
    >
      {label}
    </button>
  )

  const subLabel = 'mb-1 text-micro font-bold uppercase tracking-wide text-slate-600'

  const objectiveGroup = (o: Objective) => {
    const krs = keyResults.filter((k) => k.objectiveId === o.id)
    const rows = serving(o.id)
    const candidates = mine.filter((i) => !rows.some((r) => r.id === i.id))
    const roll = objectiveRollup(o.id, graph)
    return (
      <div key={o.id} data-objective-group={o.title} className="flex flex-col rounded-md border border-slate-300 bg-white shadow-sm">
        <div className="flex items-center gap-2 rounded-t-md border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
          <Target size={12} className="shrink-0 text-violet-500" />
          <button
            onClick={() => setObjectives(true)}
            className="min-w-0 flex-1 truncate text-left text-body font-semibold text-slate-800 hover:text-violet-700"
            title="Edit this objective in the Objectives view"
          >
            {o.title}
          </button>
          {/* What is connected, in one number, before the columns say it in detail — and how far
              along the work that serves it is, from the same rollup an initiative uses. */}
          <span className="shrink-0 text-micro text-slate-600" title="Strategic initiatives attributed to this objective">
            {rows.length} serving
          </span>
          {roll && (
            <span
              className="shrink-0 text-body font-bold tabular-nums text-violet-700"
              title="The work below the initiatives that serve this objective — the same rollup an initiative uses"
            >
              {roll.percent}%
            </span>
          )}
          {o.score !== undefined && (
            <span className="shrink-0 text-micro font-semibold tabular-nums text-slate-600" title="Objective score">
              score {o.score}
            </span>
          )}
          <span className={cn('shrink-0 rounded px-1 py-px text-micro font-semibold uppercase ring-1', OBJECTIVE_STATUS_STYLES[o.status])}>
            {o.status}
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-2 p-2.5">
          {krs.length > 0 && (
            <div className="space-y-1">
              <div className={subLabel}>Key results</div>
              {krs.map((k) => (
                <div key={k.id} className="truncate text-meta text-slate-600" title={k.title}>
                  {k.title}
                </div>
              ))}
            </div>
          )}

          {/* The objective's own flow: this board's typed columns, the same ones a team board
              shows, narrowed to the initiatives attributed to this objective. The columns appear
              when there is something to read in them — an objective nobody serves says so in
              words instead of drawing four empty boxes, because "nothing yet" and "served from
              somewhere else" are different facts and neither is a workflow. */}
          {rows.length === 0 && !unservedIds.has(o.id) && (
            <p className="px-1 text-meta text-slate-600">Served by a strategic initiative on another board.</p>
          )}
          {unservedIds.has(o.id) && (
            <div className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-meta text-amber-800">
              <TriangleAlert size={11} className="shrink-0" /> No strategic initiative serves this OKR.
            </div>
          )}

          {rows.length > 0 && <BoardSummary boardId={boardId} onlyIds={rows.map((r) => r.id)} variant="initiatives" />}

          <div className="mt-auto">
            <div className="mt-1 flex items-center gap-1">
              <select
                value={pick[o.id] ?? ''}
                onChange={(e) => setPick((p) => ({ ...p, [o.id]: e.target.value }))}
                className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-0.5 text-meta"
              >
                <option value="">Map a strategic initiative…</option>
                {candidates.map((i) => {
                  // An initiative serves one objective, so mapping one that already serves another
                  // moves it. Said here rather than discovered after the fact.
                  const from = ordered.find((x) => attribution.some((e) => e.from === x.id && e.to === i.id))
                  return (
                    <option key={i.id} value={i.id}>
                      {refs.get(i.id)} {i.title}{from ? ` — moves from ${from.title}` : ''}
                    </option>
                  )
                })}
              </select>
              {mapButton('Map', !pick[o.id], () => {
                setAttribution(pick[o.id], o.id, true)
                setPick((p) => ({ ...p, [o.id]: '' }))
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

  return (
    <div className="space-y-2 p-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-meta text-slate-600">
        <span>{count(objectives.length, 'objective')}</span>
        <span>{count(mine.length, 'strategic initiative')}</span>
        <span className={cn(gapCount > 0 && 'font-semibold text-amber-700')}>{count(gapCount, 'gap')}</span>

        {/* Making an objective is the board's business too: a portfolio is where a reader notices
            that something the organisation is committed to has no initiative serving it. The new
            one arrives as a card with its coverage gap inline — which is the next thing to fix. */}
        <div className="ml-auto flex items-center gap-1">
          <input
            value={newObjective}
            onChange={(e) => setNewObjective(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') makeObjective()
            }}
            placeholder={`New objective in ${latestPeriod}…`}
            className="w-48 rounded border border-slate-200 bg-white px-2 py-1 text-meta text-slate-700 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-violet-300"
          />
          <button
            disabled={newObjective.trim().length < 2}
            onClick={makeObjective}
            title={`Add an objective to ${latestPeriod} — it appears here with its coverage gap until a strategic initiative serves it`}
            className="flex items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-meta font-medium text-white hover:bg-violet-500 disabled:opacity-40"
          >
            <Plus size={12} /> New objective
          </button>
        </div>
      </div>

      {objectives.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-meta text-slate-600">
          No objectives yet — name one above and press{' '}
          <span className="font-semibold text-slate-700">New objective</span>.
        </div>
      )}

      {/* One objective per row. A flow needs the width: three objectives side by side gave each
          column a twelfth of the page, which is narrower than the card it has to hold. */}
      <div className="space-y-3">
        {ordered.map((o, i) => (
          <Fragment key={o.id}>
            {periodCount > 1 && (i === 0 || ordered[i - 1].period !== o.period) && (
              <div className="col-span-full px-1 pt-1 text-micro font-bold uppercase tracking-wide text-slate-600">
                {o.period}
              </div>
            )}
            {objectiveGroup(o)}
          </Fragment>
        ))}

        {unmapped.length > 0 && (
          <div className="flex flex-col rounded-md border border-amber-300 bg-amber-50/70 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 rounded-t-md border-b border-amber-200 px-2.5 py-1.5">
              <TriangleAlert size={12} className="shrink-0 text-amber-600" />
              <span className="min-w-0 flex-1 truncate text-meta font-bold uppercase tracking-wide text-amber-800">
                No objective yet
              </span>
              <span className="shrink-0 text-micro text-amber-700">
                {count(unmapped.length, 'strategic initiative')} serving no objective — map one from the objective it belongs to
              </span>
            </div>
            <div className="p-2.5">
              {/* The same flow again, so the gap is read in the same language as the work: an
                  initiative waiting to be claimed, in the column its own progress puts it in. */}
              <BoardSummary boardId={boardId} onlyIds={unmapped.map((i) => i.id)} variant="initiatives" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
