import { Fragment, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Target, Trash2, TriangleAlert, X } from 'lucide-react'
import { BoardSummary } from './BoardSummary'
import { ItemPicker } from './ItemPicker'
import { MappedInitiativeDetails } from './MappedInitiativeDetails'
import { ObjectiveStatusPicker } from './ObjectiveStatusPicker'
import { PeriodToolbar } from './PeriodToolbar'
import { PortfolioHeatmap } from './PortfolioHeatmap'
import { objectiveInitiatives, portfolioInitiatives } from '@/domain/board'
import { OBJECTIVE_STATUS_LABELS } from '@/domain/objectives'
import { portfolioHeatmap } from '@/domain/portfolio'
import { objectiveRollup, okrCoverage, type Graph } from '@/domain/derive'
import { periodById, periodNameOf, periodRank } from '@/domain/periods'
import { periodRangeLabel } from '@/lib/periodRange'
import { OBJECTIVE_STATUS_STYLES, OBJECTIVE_STATUS_DOT } from '@/lib/colors'
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
 * Attribution edges are the same ones the portfolio board edits ("one relation, two homes").
 * In **Edit objectives** the map itself becomes the authoring surface: titles, descriptions, status,
 * key results, periods and ordering are edited in place, and the same view returns when editing ends.
 * An objective has no score of its own: how far along it is comes from the work that serves it,
 * and it is due when its period ends rather than on a date somebody typed for it.
 */
export function StrategyMap({ boardId, editing = false }: { boardId: string; editing?: boolean }) {
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
  const updateObjective = useStore((s) => s.updateObjective)
  const moveObjective = useStore((s) => s.moveObjective)
  const removeObjective = useStore((s) => s.removeObjective)
  const addKeyResult = useStore((s) => s.addKeyResult)
  const updateKeyResult = useStore((s) => s.updateKeyResult)
  const removeKeyResult = useStore((s) => s.removeKeyResult)
  const [krDraft, setKrDraft] = useState<Record<string, string>>({})

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
  const { unserved } = okrCoverage(inScope, objectives, edges)
  const unservedIds = new Set(unserved.map((o) => o.id))

  // Periods read in their own order — a start date when they have one, the name when they do not —
  // so a map of two periods is a calendar, not the order somebody happened to type them in.
  const ordered = [...objectives].sort(
    (a, b) =>
      periodRank(periods, a.periodId) - periodRank(periods, b.periodId) ||
      (a.order ?? 0) - (b.order ?? 0) ||
      a.title.localeCompare(b.title),
  )
  const periodCount = new Set(ordered.map((o) => o.periodId)).size

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
    const peers = ordered.filter((peer) => peer.periodId === o.periodId)
    const peerIndex = peers.findIndex((peer) => peer.id === o.id)
    return (
      <div
        key={o.id}
        id={`objective-${o.id}`}
        data-objective-id={o.id}
        data-objective-group={o.title}
        className="flex scroll-mt-2 flex-col overflow-hidden rounded-lg border border-slate-300 border-l-4 border-l-violet-500 bg-white shadow-sm"
      >
        <div className="flex items-center gap-2 border-b border-violet-100 bg-violet-50/70 px-3 py-2">
          <Target size={15} className="shrink-0 text-violet-600" />
          {editing ? (
            <input
              value={o.title}
              onChange={(e) => updateObjective(o.id, { title: e.target.value })}
              aria-label={`Title of ${o.title}`}
              className="min-w-0 flex-1 rounded border border-transparent bg-transparent text-heading font-semibold tracking-tight text-slate-900 hover:border-violet-200 focus:border-indigo-300 focus:outline-none"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-left text-heading font-semibold tracking-tight text-slate-900">
              {o.title}
            </span>
          )}
          {/* What is connected, in one number, before the columns say it in detail — and how far
              along the work that serves it is, from the same rollup an initiative uses. */}
          <span className="shrink-0 text-micro text-slate-600" title="Initiatives mapped to this objective">
            {rows.length} mapped
          </span>
          {roll && (
            <span
              className="shrink-0 text-title font-bold tabular-nums text-violet-700"
              title="The work below this objective's initiatives"
            >
              {roll.percent}%
            </span>
          )}
          {editing ? (
            <>
              <ObjectiveStatusPicker
                value={o.status}
                onChange={(status) => updateObjective(o.id, { status })}
                label={`Status of ${o.title}`}
              />
              <button
                onClick={() => moveObjective(o.id, -1)}
                disabled={peerIndex <= 0}
                aria-label={`Move ${o.title} up`}
                title="Move this objective up"
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-600 transition hover:bg-indigo-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronUp size={13} />
              </button>
              <button
                onClick={() => moveObjective(o.id, 1)}
                disabled={peerIndex < 0 || peerIndex >= peers.length - 1}
                aria-label={`Move ${o.title} down`}
                title="Move this objective down"
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-600 transition hover:bg-indigo-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronDown size={13} />
              </button>
              <button
                onClick={() => removeObjective(o.id)}
                aria-label={`Delete ${o.title}`}
                title="Delete this objective"
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-600 transition hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 size={12} />
              </button>
            </>
          ) : (
            <span className={cn('inline-flex shrink-0 items-center gap-1 rounded px-1 py-px text-micro font-semibold uppercase ring-1', OBJECTIVE_STATUS_STYLES[o.status])}>
              <span className={cn('h-1.5 w-1.5 rounded-full', OBJECTIVE_STATUS_DOT[o.status])} aria-hidden="true" />
              {OBJECTIVE_STATUS_LABELS[o.status]}
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2 p-2.5">
          {editing ? (
            <label className="flex flex-col gap-1">
              <span className={subLabel}>Description</span>
              <textarea
                value={o.description ?? ''}
                onChange={(e) => updateObjective(o.id, { description: e.target.value })}
                aria-label={`Description of ${o.title}`}
                placeholder="What this objective means…"
                rows={2}
                className="min-w-0 resize-y rounded border border-slate-200 px-1.5 py-1 text-meta text-slate-700 placeholder:text-slate-400 hover:border-slate-300 focus:border-indigo-300 focus:outline-none"
              />
            </label>
          ) : (
            o.description && <p className="whitespace-pre-line text-meta leading-relaxed text-slate-600">{o.description}</p>
          )}

          {editing ? (
            <div>
              <div className={subLabel}>Key results</div>
              <div className="space-y-1">
                {krs.map((k) => (
                  <div key={k.id} className="flex items-center gap-2">
                    <input
                      value={k.title}
                      onChange={(e) => updateKeyResult(k.id, { title: e.target.value })}
                      aria-label={`Key result ${k.title}`}
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
                  onChange={(e) => setKrDraft((draft) => ({ ...draft, [o.id]: e.target.value }))}
                  placeholder="Add a key result…"
                  className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-0.5 text-meta"
                />
                <button
                  disabled={(krDraft[o.id] ?? '').trim().length < 2}
                  onClick={() => {
                    addKeyResult(o.id, (krDraft[o.id] ?? '').trim())
                    setKrDraft((draft) => ({ ...draft, [o.id]: '' }))
                  }}
                  className="flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-meta font-medium text-white disabled:opacity-40"
                >
                  <Plus size={11} /> Add
                </button>
              </div>
            </div>
          ) : (
            krs.length > 0 && (
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
            )
          )}

          {editing && <MappedInitiativeDetails objectiveId={o.id} />}

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

          {editing && (
            <div className="mt-auto">
              <div className="mt-1">
                <ItemPicker
                  items={available}
                  boardOf={boardNameOf}
                  movesFrom={(itemId) =>
                    ordered.find((objective) => attribution.some((e) => e.from === objective.id && e.to === itemId))?.title
                  }
                  onPick={(itemId) => setAttribution(itemId, o.id, true)}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 p-2">
      {editing && <PeriodToolbar />}

      <PortfolioHeatmap heatmap={heatmap} />

      {objectives.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-meta text-slate-600">
          {periods.length === 0
            ? editing
              ? 'No periods yet. Name one above, set its window, then add an objective.'
              : 'No periods yet. Choose Edit objectives to name one, then commit an objective to it.'
            : editing
              ? 'No objectives yet — name one above, with the period it is committed for.'
              : 'No objectives yet — choose Edit objectives to add one.'}
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

      </div>
    </div>
  )
}
