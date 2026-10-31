import { Fragment, useState } from 'react'
import { Plus, Target, TriangleAlert } from 'lucide-react'
import { BoardSummary } from './BoardSummary'
import { InitiativePicker } from './InitiativePicker'
import { PortfolioHeatmap } from './PortfolioHeatmap'
import { objectiveInitiatives, portfolioInitiatives } from '@/domain/board'
import { portfolioHeatmap } from '@/domain/portfolio'
import { objectiveRollup, okrCoverage, type Graph } from '@/domain/derive'
import { periodById, periodNameOf, periodRank, periodsInOrder } from '@/domain/periods'
import { periodRangeLabel } from '@/lib/periodRange'
import { OBJECTIVE_STATUS_STYLES } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Item, Objective } from '@/domain/types'

/**
 * The Strategy map — a portfolio board's surface, and the portfolio's own initiatives flow.
 *
 * An objective is not a report on the work; it is *where the work is read from*. So each objective
 * heads its own **initiatives workflow** — this board's own typed columns, exactly the flow the
 * team boards show, narrowed to the initiatives mapped to it. The connection is
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
 * Editing the OKR itself (title, key results, its period) stays in the Objectives view, which this
 * links out to. An objective has no score of its own: how far along it is comes from the work that
 * serves it, and it is due when its period ends rather than on a date somebody typed for it.
 */
export function StrategyMap({ boardId }: { boardId: string }) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const placements = useStore((s) => s.placements)
  const issueTypes = useStore((s) => s.issueTypes)
  const links = useStore((s) => s.links)
  const lanes = useStore((s) => s.lanes)
  const objectives = useStore((s) => s.objectives)
  const periods = useStore((s) => s.periods)
  const keyResults = useStore((s) => s.keyResults)
  const boards = useStore((s) => s.boards)
  const setAttribution = useStore((s) => s.setAttribution)
  const setObjectives = useStore((s) => s.setObjectives)
  const addObjective = useStore((s) => s.addObjective)

  /** The draft for a new objective, made here rather than sent to another page for. */
  const [newObjective, setNewObjective] = useState('')

  const graph: Graph = { items, edges, links, placements, lanes }

  const attribution = edges.filter((e) => e.kind === 'attribution')
  // Every initiative that can serve an objective — a root, wherever its board sits. Linking names
  // the outcome; it does not move the work onto this board.
  const candidates = objectiveInitiatives(graph, issueTypes)
  // The work this portfolio is read for: the outcomes in its remit, plus anything already linked
  // to an objective. The "serving nothing" gap is about that set.
  const inScope = portfolioInitiatives(graph, boards, boardId, issueTypes)

  // One pass over the attribution edges: every objective's mapped ids, and the items they name, so
  // a map of many objectives does not rescan the workspace once per card.
  const attributedByObjective = new Map<string, string[]>()
  for (const edge of attribution) {
    const ids = attributedByObjective.get(edge.from)
    if (ids) ids.push(edge.to)
    else attributedByObjective.set(edge.from, [edge.to])
  }
  const itemById = new Map(items.map((item) => [item.id, item]))

  // The portfolio's risk reading, from the same attribution edges the flows below draw.
  const heatmap = portfolioHeatmap(objectives, periods, graph)

  // Both coverage gaps, on the initiatives this portfolio reads: one served by no objective, and an
  // objective served by no initiative.
  const { unmapped, unserved } = okrCoverage(inScope, objectives, edges)
  const unservedIds = new Set(unserved.map((o) => o.id))
  const gapCount = unmapped.length + unserved.length
  const linkedCount = new Set(attribution.map((e) => e.to)).size

  // Periods read in their own order — a start date when they have one, the name when they do not —
  // so a map of two periods is a calendar, not the order somebody happened to type them in.
  const orderedPeriods = periodsInOrder(periods)
  const ordered = [...objectives].sort(
    (a, b) => periodRank(periods, a.periodId) - periodRank(periods, b.periodId) || a.title.localeCompare(b.title),
  )
  const periodCount = new Set(ordered.map((o) => o.periodId)).size
  // Where an objective made here lands: the latest period the map already shows, so it appears
  // under a heading a reader recognises rather than inventing one. With no period yet there is
  // nothing to commit for — the Objectives view is where a period is named.
  const latestPeriod = orderedPeriods[orderedPeriods.length - 1]
  const makeObjective = () => {
    if (!latestPeriod || newObjective.trim().length < 2) return
    addObjective(newObjective.trim(), latestPeriod.id)
    setNewObjective('')
  }

  /** The board an initiative is carried by, for the picker — where the work actually lives. */
  const boardNameOf = (itemId: string): string | undefined => {
    const placement = placements.find((p) => p.itemId === itemId)
    return placement ? boards.find((b) => b.id === placement.boardId)?.name : undefined
  }

  /** Everything attributed to an objective — the initiatives whose outcome it names. */
  const serving = (objectiveId: string): Item[] =>
    (attributedByObjective.get(objectiveId) ?? [])
      .map((id) => itemById.get(id))
      .filter((item): item is Item => item !== undefined && !item.archived)

  const subLabel = 'mb-1 text-micro font-bold uppercase tracking-wide text-slate-600'

  const objectiveGroup = (o: Objective) => {
    const krs = keyResults.filter((k) => k.objectiveId === o.id)
    const rows = serving(o.id)
    const available = candidates.filter((i) => !rows.some((r) => r.id === i.id))
    const roll = objectiveRollup(o.id, graph)
    return (
      <div
        key={o.id}
        id={`objective-${o.id}`}
        data-objective-group={o.title}
        className="flex scroll-mt-2 flex-col overflow-hidden rounded-lg border border-slate-300 border-l-4 border-l-violet-500 bg-white shadow-sm"
      >
        <div className="flex items-center gap-2 border-b border-violet-100 bg-violet-50/70 px-3 py-2">
          <Target size={15} className="shrink-0 text-violet-600" />
          <button
            onClick={() => setObjectives(true)}
            className="min-w-0 flex-1 truncate text-left text-heading font-semibold tracking-tight text-slate-900 hover:text-violet-700"
            title="Edit this objective in the Objectives view"
          >
            {o.title}
          </button>
          {/* What is connected, in one number, before the columns say it in detail — and how far
              along the work that serves it is, from the same rollup an initiative uses. */}
          <span className="shrink-0 text-micro text-slate-600" title="Initiatives mapped to this objective">
            {rows.length} mapped
          </span>
          {roll && (
            <span
              className="shrink-0 text-title font-bold tabular-nums text-violet-700"
              title="The work below the initiatives that serve this objective — the same rollup an initiative uses"
            >
              {roll.percent}%
            </span>
          )}
          <span className={cn('shrink-0 rounded px-1 py-px text-micro font-semibold uppercase ring-1', OBJECTIVE_STATUS_STYLES[o.status])}>
            {o.status}
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-2 p-2.5">
          {krs.length > 0 && (
            <div>
              <div className={subLabel}>Key results</div>
              {/* A key result is a sentence a person reads, not a column of the flow: chips wrap
                  beside each other so two short statements share a line instead of each taking the
                  full width. The chip carries the whole text as its title for a long one. */}
              <ul className="flex flex-wrap gap-1">
                {krs.map((k) => (
                  <li
                    key={k.id}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-meta text-slate-600"
                    title={k.title}
                  >
                    <span className="h-1 w-1 shrink-0 rounded-full bg-violet-400" aria-hidden="true" />
                    <span className="truncate">{k.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* The objective's own flow: this board's typed columns, the same ones a team board
              shows, narrowed to the initiatives attributed to this objective — wherever they live.
              The columns appear when there is something to read in them; an objective nobody
              serves says so in words instead of drawing four empty boxes. */}
          {unservedIds.has(o.id) && (
            <div className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-meta text-amber-800">
              <TriangleAlert size={11} className="shrink-0" /> No initiative is mapped to this objective.
            </div>
          )}

          {rows.length > 0 && <BoardSummary boardId={boardId} onlyIds={rows.map((r) => r.id)} variant="initiatives" />}

          <div className="mt-auto">
            <div className="mt-1">
              <InitiativePicker
                initiatives={available}
                boardOf={boardNameOf}
                movesFrom={(itemId) =>
                  ordered.find((objective) => attribution.some((e) => e.from === objective.id && e.to === itemId))?.title
                }
                onPick={(itemId) => setAttribution(itemId, o.id, true)}
              />
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
        <span title="Initiatives mapped to an objective, wherever their board sits">{count(linkedCount, 'linked initiative')}</span>
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
            disabled={!latestPeriod}
            placeholder={`New objective in ${latestPeriod?.name ?? 'a period'}…`}
            className="w-48 rounded border border-slate-200 bg-white px-2 py-1 text-meta text-slate-700 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-violet-300 disabled:opacity-50"
          />
          <button
            disabled={!latestPeriod || newObjective.trim().length < 2}
            onClick={makeObjective}
            title={
              latestPeriod
                ? `Add an objective to ${latestPeriod.name} — it appears here with its coverage gap until an initiative is mapped to it`
                : 'Name a period in the Objectives view first — an objective is committed for one'
            }
            className="flex items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-meta font-medium text-white hover:bg-violet-500 disabled:opacity-40"
          >
            <Plus size={12} /> New objective
          </button>
        </div>
      </div>

      <PortfolioHeatmap heatmap={heatmap} />

      {objectives.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-meta text-slate-600">
          {latestPeriod ? (
            <>
              No objectives yet — name one above and press{' '}
              <span className="font-semibold text-slate-700">New objective</span>.
            </>
          ) : (
            <>No periods yet. Name one in the Objectives view, set its window, then commit an objective to it.</>
          )}
        </div>
      )}

      {/* One objective per row. A flow needs the width: three objectives side by side gave each
          column a twelfth of the page, which is narrower than the card it has to hold. */}
      <div className="space-y-3">
        {ordered.map((o, i) => {
          const period = periodById(periods, o.periodId)
          const range = periodRangeLabel(period)
          return (
            <Fragment key={o.id}>
              {periodCount > 1 && (i === 0 || ordered[i - 1].periodId !== o.periodId) && (
                <div className="col-span-full flex flex-wrap items-baseline gap-2 px-1 pt-1">
                  <span className="text-micro font-bold uppercase tracking-wide text-slate-600">
                    {periodNameOf(periods, o.periodId)}
                  </span>
                  {range && <span className="text-micro text-slate-500">{range}</span>}
                </div>
              )}
              {objectiveGroup(o)}
            </Fragment>
          )
        })}

        {unmapped.length > 0 && (
          <div className="flex flex-col rounded-md border border-amber-300 bg-amber-50/70 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 rounded-t-md border-b border-amber-200 px-2.5 py-1.5">
              <TriangleAlert size={12} className="shrink-0 text-amber-600" />
              <span className="min-w-0 flex-1 truncate text-meta font-bold uppercase tracking-wide text-amber-800">
                No objective yet
              </span>
              <span className="shrink-0 text-micro text-amber-700">
                {count(unmapped.length, 'initiative')} in this portfolio serving no objective — map one from the objective it belongs to
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
