import { Fragment, useState } from 'react'
import { Target, TriangleAlert, X } from 'lucide-react'
import { buildRefs, initiativeTypeById, initiativeTypeId } from '@/domain/board'
import { decompositionParent, okrCoverage, rollupOf, type Graph } from '@/domain/derive'
import { HEALTH_META, initiativeHealth } from '@/domain/health'
import { STAGE_LABELS } from '@/domain/lanes'
import { OBJECTIVE_STATUS_STYLES, chipColors, stageChip } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Item, Objective, Stage } from '@/domain/types'

/**
 * The Strategy map — a portfolio board's L3 surface. Objectives and the strategic
 * initiatives that serve them on one page, so the connection is *containment*
 * rather than a report.
 *
 * Both coverage gaps are first-class and inline: an objective no initiative serves,
 * and an initiative no objective carries. That replaces the separate "OKR coverage"
 * section — the gaps are visible exactly where they occur.
 *
 * Laid out as a card grid, like the Objectives view: a full-width row puts a metric
 * far from its label, which reads as a table rather than a map.
 *
 * Attribution edges are the same ones the Objectives view edits ("one relation, two
 * homes"). Editing the OKR itself (title, KRs, score) stays in the Objectives view,
 * which this links out to.
 */
export function StrategyMap({ boardId }: { boardId: string }) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const issueTypes = useStore((s) => s.issueTypes)
  const objectives = useStore((s) => s.objectives)
  const boards = useStore((s) => s.boards)
  const keyResults = useStore((s) => s.keyResults)
  const setAttribution = useStore((s) => s.setAttribution)
  const openItem = useStore((s) => s.openItem)
  const setObjectives = useStore((s) => s.setObjectives)

  /** objectiveId → initiativeId, for the per-objective "map an initiative" select. */
  const [pick, setPick] = useState<Record<string, string>>({})
  /** initiativeId → objectiveId, for the per-initiative "map to an objective" select. */
  const [mapTo, setMapTo] = useState<Record<string, string>>({})

  const graph: Graph = { items, edges, links, placements, lanes }
  const refs = buildRefs(items, issueTypes)
  const initId = initiativeTypeId(issueTypes)

  // This board's own strategic initiatives: Initiative-typed, placed here, and local
  // top-level — an initiative whose parent is also on this board isn't a separate row.
  const onBoardIds = new Set(placements.filter((p) => p.boardId === boardId).map((p) => p.itemId))
  const mine = items
    .filter((i) => onBoardIds.has(i.id) && i.typeId === initId && !i.archived)
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

  const serving = (objectiveId: string) =>
    mine.filter((i) => attribution.some((e) => e.from === objectiveId && e.to === i.id))

  /**
   * One strategic initiative: ref, title, rolled-up progress and status. No type chip —
   * on this surface every row is a strategic initiative, so it would be pure noise.
   */
  const initiativeRow = (it: Item, objectiveId?: string) => {
    const roll = rollupOf(it.id, graph)
    const bucket = roll.bucket as Stage
    // The same rules the dashboard reads, from the same derivation — a portfolio and a
    // programme cannot disagree about whether an initiative is in trouble.
    const health = initiativeHealth(it.id, graph)
    const kind = initiativeTypeById(boards, it.initiativeTypeId)
    return (
      <div key={it.id} className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-1.5 py-1">
        <span className="shrink-0 text-micro font-semibold tabular-nums text-slate-600">{refs.get(it.id)}</span>
        <button
          onClick={() => openItem(it.id)}
          className="min-w-0 flex-1 truncate text-left text-meta font-medium text-slate-700 hover:text-violet-700"
          title="Open this initiative"
        >
          {it.title}
        </button>
        {/* A kind is a label and nothing more, so it reads beside the title rather than in the
            health cluster: it says what sort of bet this is, not whether it is in trouble. */}
        {kind && (
          <span
            className="shrink-0 rounded px-1 py-px text-micro font-bold uppercase tracking-wide"
            style={{ backgroundColor: chipColors(kind.color).background, color: chipColors(kind.color).color }}
            title={`Kind: ${kind.name}`}
          >
            {kind.name}
          </span>
        )}
        {health.flags.length > 0 && (
          <span
            className={cn('flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-micro font-semibold ring-1', HEALTH_META[health.level].chip)}
            title={health.flags.map((f) => f.why).join(' · ')}
          >
            <TriangleAlert size={10} /> {HEALTH_META[health.level].label}
          </span>
        )}
        <span className="shrink-0 text-micro font-semibold tabular-nums text-slate-600">{roll.percent}%</span>
        <span className={cn('shrink-0 rounded px-1 py-px text-micro font-bold', stageChip(bucket))}>
          {STAGE_LABELS[bucket]}
        </span>
        {objectiveId && (
          <button
            onClick={() => setAttribution(it.id, objectiveId, false)}
            className="shrink-0 text-slate-600 hover:text-rose-500"
            title="Unmap from this objective"
          >
            <X size={12} />
          </button>
        )}
      </div>
    )
  }

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
    return (
      <div key={o.id} className="flex flex-col rounded-md border border-slate-300 bg-white shadow-sm">
        <div className="flex items-center gap-2 rounded-t-md border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
          <Target size={12} className="shrink-0 text-violet-500" />
          <button
            onClick={() => setObjectives(true)}
            className="min-w-0 flex-1 truncate text-left text-body font-semibold text-slate-800 hover:text-violet-700"
            title="Edit this objective in the Objectives view"
          >
            {o.title}
          </button>
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
                <div key={k.id} className="flex items-center gap-2 text-meta text-slate-600">
                  <span className="min-w-0 flex-1 truncate">{k.title}</span>
                  <div className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full bg-violet-500" style={{ width: `${k.progress ?? 0}%` }} />
                  </div>
                  <span className="w-8 shrink-0 text-right tabular-nums text-slate-600">{k.progress ?? 0}%</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-auto">
            <div className={subLabel}>
              Initiatives serving this <span className="rounded bg-slate-100 px-1 text-slate-600">{rows.length}</span>
            </div>
            <div className="space-y-1">
              {rows.length > 0 ? (
                rows.map((it) => initiativeRow(it, o.id))
              ) : !unservedIds.has(o.id) ? (
                <p className="px-1 text-meta text-slate-600">Served by a strategic initiative on another board.</p>
              ) : (
                <div className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-meta text-amber-800">
                  <TriangleAlert size={11} className="shrink-0" /> No strategic initiative serves this OKR.
                </div>
              )}
            </div>
            <div className="mt-1 flex items-center gap-1">
              <select
                value={pick[o.id] ?? ''}
                onChange={(e) => setPick((p) => ({ ...p, [o.id]: e.target.value }))}
                className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-0.5 text-meta"
              >
                <option value="">Map a strategic initiative…</option>
                {candidates.map((i) => (
                  <option key={i.id} value={i.id}>
                    {refs.get(i.id)} {i.title}
                  </option>
                ))}
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
      </div>

      {objectives.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-meta text-slate-600">
          No objectives yet.{' '}
          <button onClick={() => setObjectives(true)} className="font-medium text-violet-700 hover:underline">
            Add one in Objectives
          </button>
          .
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
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
            <div className="flex items-center gap-2 rounded-t-md border-b border-amber-200 px-2.5 py-1.5">
              <TriangleAlert size={12} className="shrink-0 text-amber-600" />
              <span className="min-w-0 flex-1 truncate text-meta font-bold uppercase tracking-wide text-amber-800">
                Unmapped strategic initiatives
              </span>
              <span className="shrink-0 text-micro text-amber-700">no OKR carries this</span>
            </div>
            <div className="flex flex-1 flex-col gap-1.5 p-2.5">
              {unmapped.map((it) => (
                <div key={it.id} className="space-y-1">
                  {initiativeRow(it)}
                  <div className="flex items-center gap-1">
                    <select
                      value={mapTo[it.id] ?? ''}
                      onChange={(e) => setMapTo((m) => ({ ...m, [it.id]: e.target.value }))}
                      className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-0.5 text-meta"
                    >
                      <option value="">Map to an objective…</option>
                      {ordered.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.title}
                        </option>
                      ))}
                    </select>
                    {mapButton('Map', !mapTo[it.id], () => {
                      setAttribution(it.id, mapTo[it.id], true)
                      setMapTo((m) => ({ ...m, [it.id]: '' }))
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
