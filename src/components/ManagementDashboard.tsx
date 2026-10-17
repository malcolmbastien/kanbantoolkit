import { CalendarClock, Download, Layers, Target } from 'lucide-react'
import { BAND_STYLES } from './BandBadge'
import { blockedBelow, decompositionChildren, rollupOf, type Graph } from '@/domain/derive'
import { boardInitiatives, buildRefs, initiativeTypeById, tagsOf } from '@/domain/board'
import { HEALTH_META, initiativeHealth } from '@/domain/health'
import { csvFilename, dashboardCsv } from '@/domain/csv'
import { childrenOf, rootLane, STAGE_LABELS, subtreeIds } from '@/domain/lanes'
import { laneAges, medianOf, STALE_AFTER_DAYS } from '@/domain/filters'
import { BAND_ACCENT, stageChip } from '@/lib/colors'
import { downloadText } from '@/lib/download'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { IssueType, Stage } from '@/domain/types'

const barColor = (pct: number) => (pct >= 100 ? '#10b981' : pct > 0 ? '#6366f1' : '#cbd5e1')

/** Days in a column, quiet: a whole number of days, or one decimal for an in-between median. */
const daysLabel = (n: number | undefined) =>
  n === undefined ? '\u2014' : `${Number.isInteger(n) ? n : n.toFixed(1)}d`

/** Parse an ISO 'YYYY-MM-DD' as a local date so it doesn't shift a day. */
function parseDate(iso?: string): Date | undefined {
  return iso ? new Date(`${iso}T00:00:00`) : undefined
}
function formatDate(iso?: string): string {
  const d = parseDate(iso)
  return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
}

/**
 * A summary dashboard for a board: its initiatives with their rolled-up work progress,
 * target date, computed status, and an indicator of any blocked work down the chain.
 *
 * Read-only by design — projection and richer health signals can be layered on later
 * without changing this shape. It wears the board's band, because the same summary means
 * something different to a team, a programme and a portfolio.
 */
export function ManagementDashboard({ boardId }: { boardId: string }) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const issueTypes = useStore((s) => s.issueTypes)
  const boards = useStore((s) => s.boards)
  const openItem = useStore((s) => s.openItem)
  const selectedItemId = useStore((s) => s.selectedItemId)

  const graph: Graph = { items, edges, links, placements, lanes }
  // The cards workflow's columns, each reading how long its work has sat still — derived
  // from the placements' lane stamps, never stored, never acting on anything.
  const done = new Set(items.filter((i) => i.archived).map((i) => i.id))
  const boardPlacements = placements.filter((p) => p.boardId === boardId && !done.has(p.itemId))
  const cardsRoot = rootLane(lanes, boardId, 'cards')
  const columns = (cardsRoot ? childrenOf(lanes, cardsRoot.id) : []).map((c) => {
    const ids = new Set(subtreeIds(lanes, c.id))
    const cards = boardPlacements.filter((p) => ids.has(p.laneId)).length
    const ages = laneAges(lanes, boardPlacements, c.id)
    return { lane: c, cards, oldest: ages.length ? Math.max(...ages) : undefined, median: medianOf(ages) }
  })
  const refs = buildRefs(items, issueTypes)
  const typeOf = (typeId: string): IssueType =>
    issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }

  const board = boards.find((b) => b.id === boardId)
  const band = board?.band ?? 'team'
  const accent = BAND_ACCENT[band]
  const bandStyle = BAND_STYLES[band] ?? BAND_STYLES.team
  const teamBoardNames = (board?.linkedBoardIds ?? [])
    .map((id) => boards.find((b) => b.id === id)?.name)
    .filter((n): n is string => Boolean(n))

  // Board-local top-level initiatives — the same computation the initiatives workflow and the
  // timeline read, so the surfaces cannot disagree about what this board's initiatives are.
  const initiativeTypeId = issueTypes.find((t) => t.name === 'Initiative')?.id
  const initiatives = boardInitiatives(graph, boardId, issueTypes)

  const rows = initiatives.map((item) => {
    const roll = rollupOf(item.id, graph)
    const blocked = blockedBelow(item.id, graph)
    const target = parseDate(item.targetEndDate)
    const overdue = Boolean(target && roll.bucket !== 'done' && target.getTime() < Date.now())
    const childInits = decompositionChildren(item.id, edges).filter(
      (id) => items.find((i) => i.id === id)?.typeId === initiativeTypeId,
    ).length
    return {
      item,
      roll,
      blocked,
      target,
      overdue,
      childInits,
      health: initiativeHealth(item.id, graph),
      // The kind is the board's own label, resolved wherever it is defined — and "None" is the
      // absence of one, so the column is never blank in a way that needs explaining.
      kind: initiativeTypeById(boards, item.initiativeTypeId)?.name ?? 'None',
      tags: tagsOf(boards, item).map((t) => t.name).join('; '),
    }
  })

  const doneInitiatives = rows.filter((r) => r.roll.bucket === 'done').length
  const atRisk = rows.filter((r) => r.health.level === 'atRisk').length

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-slate-200 p-4">
      <div className="mx-auto w-full max-w-5xl">
        {/* Header */}
        <div className={cn('mb-3 flex flex-wrap items-end gap-x-6 gap-y-2 rounded-lg border px-4 py-3', accent.section)}>
          <div>
            <div className="flex items-center gap-1.5">
              <span className={cn('rounded px-1.5 py-px text-micro font-bold uppercase tracking-wide', bandStyle.chip)}>
                {bandStyle.label}
              </span>
              <span className="flex items-center gap-1 text-meta font-bold uppercase tracking-wide text-slate-600">
                <Target size={12} /> Dashboard
              </span>
            </div>
            <div className="text-heading font-semibold text-slate-800">{board?.name ?? 'Board'}</div>
            {teamBoardNames.length > 0 && (
              <div className="text-meta text-slate-600">Rolls up {teamBoardNames.join(' · ')}</div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-4 text-meta text-slate-600">
            <Stat label="Initiatives" value={rows.length} />
            <Stat label="Done" value={doneInitiatives} tone="emerald" />
            <Stat label="At risk" value={atRisk} tone={atRisk > 0 ? 'rose' : undefined} />
            {/* One explicit action, one file — the rows above, as a spreadsheet. */}
            <button
              onClick={() => downloadText(csvFilename(board?.name ?? 'board', 'initiatives'), dashboardCsv(rows, items, issueTypes))}
              className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-meta font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
              title="Export these initiative rows as a CSV file — progress, target dates, status and blocked work"
            >
              <Download size={11} /> Export CSV
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100 text-micro uppercase tracking-wide text-slate-600">
                <th className="px-4 py-2 font-semibold">Initiative</th>
                <th className="px-4 py-2 font-semibold">Work progress</th>
                <th className="px-4 py-2 font-semibold">Target date</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Health</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, roll, overdue, childInits, health }) => {
                const type = typeOf(item.typeId)
                const bucket = roll.bucket as Stage
                return (
                  <tr
                    key={item.id}
                    onClick={() => openItem(item.id)}
                    className={cn(
                      'cursor-pointer border-b border-slate-100 transition last:border-0 hover:bg-slate-50',
                      selectedItemId === item.id && 'bg-indigo-50',
                    )}
                  >
                    <td className="max-w-[280px] px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="rounded px-1 py-px text-micro font-bold uppercase tracking-wide"
                          style={{ backgroundColor: type.color, color: '#fff' }}
                        >
                          {type.name}
                        </span>
                        <span className="text-micro font-semibold text-slate-600">{refs.get(item.id)}</span>
                      </div>
                      <div className="truncate text-body font-semibold text-slate-800">{item.title}</div>
                      {childInits > 0 && (
                        <div className="flex items-center gap-1 text-micro text-slate-600" title={`${childInits} child initiatives`}>
                          <Layers size={10} /> {childInits} child initiative{childInits === 1 ? '' : 's'}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full transition-all" style={{ width: `${roll.percent}%`, backgroundColor: barColor(roll.percent) }} />
                        </div>
                        <span className="w-9 text-right text-meta font-bold tabular-nums text-slate-600">{roll.percent}%</span>
                      </div>
                      <div className="mt-0.5 text-micro text-slate-600">
                        {roll.done} of {roll.total} done
                        {roll.inProgress > 0 ? ` · ${roll.inProgress} active` : ''}
                      </div>
                    </td>

                    <td className="px-4 py-2.5">
                      <div className={cn('flex items-center gap-1 text-meta', overdue ? 'font-semibold text-rose-600' : 'text-slate-600')}>
                        <CalendarClock size={12} className={overdue ? 'text-rose-500' : 'text-slate-400'} />
                        {item.targetStartDate ? `${formatDate(item.targetStartDate)} → ` : ''}
                        {formatDate(item.targetEndDate)}
                      </div>
                      {overdue && <div className="text-micro font-semibold text-rose-500">overdue</div>}
                    </td>

                    <td className="px-4 py-2.5">
                      <span className={cn('rounded px-1.5 py-0.5 text-micro font-bold', stageChip(bucket))}>
                        {STAGE_LABELS[bucket]}
                      </span>
                    </td>

                    {/* Health: the level, then each rule that spoke. A healthy initiative says so
                        quietly — the absence of a flag is information too. */}
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-micro font-bold ring-1', HEALTH_META[health.level].chip)}>
                          {HEALTH_META[health.level].label}
                        </span>
                        {health.flags.map((f) => (
                          <span
                            key={f.flag}
                            title={f.why}
                            className={cn(
                              'shrink-0 rounded px-1 py-px text-micro font-medium',
                              f.tone === 'risk' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800',
                            )}
                          >
                            {f.label}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-meta text-slate-600">
                    No initiatives on this board yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Time in column — where time sits, per column of this board's cards workflow.
            A stuck column is a number before it is a feeling, and the oldest number speaks
            at the same staleness threshold the card's own aging cue does. */}
        <section className="mt-4 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-100 px-4 py-2 text-micro font-semibold uppercase tracking-wide text-slate-600">
            Time in column
          </div>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 text-micro uppercase tracking-wide text-slate-600">
                <th className="px-4 py-2 font-semibold">Column</th>
                <th className="px-4 py-2 font-semibold">Cards</th>
                <th className="px-4 py-2 font-semibold">Oldest</th>
                <th className="px-4 py-2 font-semibold">Median</th>
              </tr>
            </thead>
            <tbody>
              {columns.map(({ lane, cards, oldest, median }) => {
                const stale = oldest !== undefined && oldest >= STALE_AFTER_DAYS
                return (
                  <tr key={lane.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-1.5 font-medium text-slate-700">
                      {lane.name || STAGE_LABELS[lane.stage ?? 'inProgress']}
                    </td>
                    <td className="px-4 py-1.5 tabular-nums text-slate-600">{cards}</td>
                    <td
                      className={cn('px-4 py-1.5 tabular-nums', stale ? 'text-amber-700' : 'text-slate-600')}
                      title={stale ? 'A card has sat still past the staleness threshold — the same moment a card starts showing its age' : undefined}
                    >
                      {daysLabel(oldest)}
                    </td>
                    <td className="px-4 py-1.5 tabular-nums text-slate-600">{daysLabel(median)}</td>
                  </tr>
                )
              })}
              {columns.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-meta text-slate-600">
                    The cards workflow has no columns yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="border-t border-slate-100 px-4 py-2 text-micro text-slate-600">
            Read from each placement's lane stamp — never stored on the item and never acting: nothing is auto-moved or
            flagged. The clock starts when a card enters its lane, so splitting a column re-stamps the cards it reshapes.
          </p>
        </section>

        <p className="mt-3 text-meta text-slate-600">
          Work progress and status are computed from the leaf work beneath each initiative. Health is derived the same
          way — blocked work, open dependencies, a clock that has stopped, work nobody owns, an initiative with nothing
          under it, and committed work over Backlog. Nothing is set by hand and nothing goes stale: each rule reads what
          the board already knows.
        </p>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'rose' }) {
  return (
    <div className="text-center">
      <div
        className={cn(
          'text-heading font-bold tabular-nums leading-none',
          tone === 'emerald' ? 'text-emerald-600' : tone === 'rose' ? 'text-rose-600' : 'text-slate-700',
        )}
      >
        {value}
      </div>
      <div className="text-micro uppercase tracking-wide text-slate-600">{label}</div>
    </div>
  )
}
