import type { ReactNode } from 'react'
import { TrendingUp } from 'lucide-react'
import {
  bucketsFor,
  committedAt,
  cumulativeFlow,
  deliveredSince,
  flowRecord,
  flowSummary,
  throughput,
  windowStart,
  type FlowRecord,
} from '@/domain/metrics'
import { isInitiativeItem } from '@/domain/board'
import { effectiveStage, STAGE_LABELS, STAGES } from '@/domain/lanes'
import { STAGE_ACCENT } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { Item } from '@/domain/types'
import { cardsFlows, kindOf } from '@/domain/flows'
import { FLOW_WINDOWS, type FlowWindow } from '@/domain/flowWindow'

const DAY_MS = 86_400_000

/** Days, quiet: a whole number, or one decimal for an in-between median. */
const days = (n: number | undefined) => (n === undefined ? '—' : `${Number.isInteger(n) ? n : n.toFixed(1)}d`)
const shortDate = (at: number) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/**
 * Flow metrics for one board: lead time, cycle time, throughput and a cumulative flow diagram.
 *
 * Everything here is derived from the cards themselves — when they were created, when they were
 * resolved, and the `moved` entries in their logs, each of which records the **stage** it landed
 * in. So a team can rename, split and rearrange its columns without corrupting its own past, and
 * there is nothing to maintain by hand: no targets, no reporting, no number that can drift from
 * the board.
 *
 * Read-only. The only thing it asks of the reader is patience with the early weeks, because the
 * history starts the day the app began recording moves.
 */
export function MetricsView({ boardId }: { boardId: string }) {
  const items = useStore((s) => s.items)
  const lanes = useStore((s) => s.lanes)
  const flows = useStore((s) => s.flows)
  const placements = useStore((s) => s.placements)
  const boards = useStore((s) => s.boards)
  const issueTypes = useStore((s) => s.issueTypes)
  const openItem = useStore((s) => s.openItem)
  const selectedItemId = useStore((s) => s.selectedItemId)
  const flowWindow = useStore((s) => s.flowWindow)
  const metricsFlowId = useStore((s) => s.metricsFlowId)
  const setFlowWindow = useStore((s) => s.setFlowWindow)
  const setMetricsFlow = useStore((s) => s.setMetricsFlow)

  const board = boards.find((b) => b.id === boardId)
  const boardFlows = cardsFlows(flows, boardId)
  // A flow the board no longer has — a link from when it did, or a flow removed in another tab —
  // is not a reading: the screen shows every flow and the URL is normalised on the next write.
  const selectedFlow = boardFlows.find((f) => f.id === metricsFlowId) ?? null

  // The cards this board carries in its cards workflow — archived ones included, because filing
  // a delivered card away must not erase it from the board's throughput.
  const laneOf = new Map(placements.filter((p) => p.boardId === boardId).map((p) => [p.itemId, p.laneId]))
  const cards = [...laneOf.keys()]
    .filter((id) => {
      const lane = lanes.find((l) => l.id === laneOf.get(id))
      if (!lane || kindOf(flows, lane.flowId) !== 'cards') return false
      return selectedFlow === null || lane.flowId === selectedFlow.id
    })
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is Item => Boolean(i) && !isInitiativeItem(i, issueTypes))

  const now = Date.now()
  const records: FlowRecord[] = cards.map((c) => flowRecord(c, effectiveStage(lanes, laneOf.get(c.id)!)))
  const since = windowStart(flowWindow, now)
  const buckets = bucketsFor(flowWindow, records, now)
  const summary = flowSummary(records, now, since)
  const flow = cumulativeFlow(records, buckets)
  const delivered = throughput(records, buckets)

  // Each diagram has its own scale: a flow column is as tall as the most work the board carried
  // at a week's end, a throughput bar as tall as the busiest week in the window.
  const tallest = Math.max(1, ...flow.map((counts) => STAGES.reduce((sum, s) => sum + counts[s], 0)))
  const busiest = Math.max(1, ...delivered)
  const slowest = deliveredSince(records, since).sort((a, b) => lead(b) - lead(a)).slice(0, 8)

  return (
    <div data-flow-view className="flex h-full min-h-0 flex-col overflow-auto bg-slate-200 p-4">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2 rounded-lg border border-slate-300 bg-white px-4 py-3 shadow-sm">
          <div>
            <div className="flex items-center gap-1 text-meta font-bold uppercase tracking-wide text-slate-600">
              <TrendingUp size={12} /> Flow
            </div>
            <div className="text-heading font-semibold text-slate-800">{board?.name ?? 'Board'}</div>
            <div className="text-meta text-slate-600">
              {selectedFlow ? `The ${selectedFlow.name} flow` : 'The cards workflows of this board'},
              read from each card's own history — nothing to maintain. That history starts the day
              Kanban Toolkit began recording moves, so the earliest weeks are thin.
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2">
            <Stat label="In flight" value={summary.inFlight} />
            <Stat label="Delivered" value={summary.delivered} tone="emerald" />
            <Stat
              label="Lead time"
              value={days(summary.lead.p50)}
              note={`p85 ${days(summary.lead.p85)} · p95 ${days(summary.lead.p95)} · ${summary.lead.n} cards`}
              hint="Created to done. p85 and p95 are the tail: that share of cards took this long or less."
            />
            <Stat
              label="Cycle time"
              value={days(summary.cycle.p50)}
              note={`p85 ${days(summary.cycle.p85)} · p95 ${days(summary.cycle.p95)} · ${summary.cycle.n} cards`}
              hint="First committed (leaving Backlog) to done. p85 and p95 are the tail."
            />
          </div>

          {/* The reading is part of the place: both controls write the URL, so a quarter of one
              flow can be sent to somebody rather than described over a call. */}
          <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-2">
            <label className="flex items-center gap-1.5 text-meta text-slate-600">
              Window
              <select
                aria-label="Range"
                value={String(flowWindow)}
                onChange={(event) =>
                  setFlowWindow(event.target.value === 'all' ? 'all' : (Number(event.target.value) as FlowWindow))
                }
                className="rounded border border-slate-200 bg-white px-1.5 py-1 text-meta text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300"
              >
                {FLOW_WINDOWS.map((weeks) => (
                  <option key={weeks} value={weeks}>
                    {weeks} weeks
                  </option>
                ))}
                <option value="all">All history</option>
              </select>
            </label>
            {boardFlows.length > 1 && (
              <label className="flex items-center gap-1.5 text-meta text-slate-600">
                Cards flow
                <select
                  aria-label="Cards flow"
                  value={selectedFlow?.id ?? ''}
                  onChange={(event) => setMetricsFlow(event.target.value || null)}
                  className="rounded border border-slate-200 bg-white px-1.5 py-1 text-meta text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300"
                >
                  <option value="">All cards flows</option>
                  {boardFlows.map((flow) => (
                    <option key={flow.id} value={flow.id}>
                      {flow.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="text-micro text-slate-500">
              Lead is created → done; cycle is committed (leaving Backlog) → done. In flight and
              delivered are now; the delivery samples are the window.
            </span>
          </div>
        </div>

        {records.length === 0 ? (
          <div className="rounded-lg border border-slate-300 bg-white px-4 py-6 text-meta text-slate-600 shadow-sm">
            This board carries no cards yet. Flow is read from cards' moves, so there is nothing to read — add
            cards and move them between columns.
          </div>
        ) : (
          <>
            <Panel
              title="Cumulative flow"
              note="Where the work was at the end of each week. A card that was rejected shows as work moving back."
            >
              <div className="flex gap-1.5">
                {flow.map((counts, i) => {
                  const total = STAGES.reduce((sum, s) => sum + counts[s], 0)
                  return (
                    <div key={buckets[i]} data-flow-bucket className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="text-center text-micro font-bold tabular-nums text-slate-600">{total}</div>
                      <div className="flex h-36 flex-col justify-end">
                        {/* Stacked in the board's own order — Backlog at the top, down through Not
                            Started and In Progress, to Done at the bottom — so a column on the board
                            and a band here are read the same way round. The legend below lists them
                            in that order too. */}
                        <div className="flex flex-col" style={{ height: `${(total / tallest) * 100}%` }}>
                          {STAGES.map((stage) =>
                            counts[stage] === 0 ? null : (
                              <div
                                key={stage}
                                title={`${STAGE_LABELS[stage]}: ${counts[stage]}`}
                                style={{
                                  height: `${(counts[stage] / Math.max(1, total)) * 100}%`,
                                  backgroundColor: STAGE_ACCENT[stage],
                                }}
                              />
                            ),
                          )}
                        </div>
                      </div>
                      <div className="truncate text-center text-micro text-slate-600">{shortDate(buckets[i])}</div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-slate-600">
                {STAGES.map((stage) => (
                  <span key={stage} className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: STAGE_ACCENT[stage] }} />
                    {STAGE_LABELS[stage]}
                  </span>
                ))}
              </div>
            </Panel>

            <Panel title="Throughput" note="Cards that reached Done in each week — delivery, not activity.">
              <div className="flex gap-1.5">
                {delivered.map((n, i) => (
                  <div key={buckets[i]} data-flow-week className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="text-center text-micro font-bold tabular-nums text-slate-600">{n}</div>
                    <div className="flex h-20 flex-col justify-end">
                      <div
                        className={cn('rounded-sm', n === 0 ? 'bg-slate-200' : 'bg-emerald-500')}
                        style={{ height: `${Math.max(3, (n / busiest) * 100)}%` }}
                        title={`${n} delivered in the week ending ${shortDate(buckets[i])}`}
                      />
                    </div>
                    <div className="truncate text-center text-micro text-slate-600">{shortDate(buckets[i])}</div>
                  </div>
                ))}
              </div>
            </Panel>

            {slowest.length > 0 && (
              <Panel
                title="Delivered, slowest first"
                note="Every number above traces back to a card: lead is created to done, cycle is committed to done."
              >
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-200 text-micro uppercase tracking-wide text-slate-600">
                      <th className="py-1.5 pr-3 font-semibold">Card</th>
                      <th className="px-3 py-1.5 font-semibold">Lead</th>
                      <th className="px-3 py-1.5 font-semibold">Cycle</th>
                      <th className="px-3 py-1.5 font-semibold">Done</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slowest.map((r) => {
                      const committed = committedAt(r) ?? r.createdAt
                      return (
                        <tr
                          key={r.id}
                          onClick={() => openItem(r.id)}
                          className={cn(
                            'cursor-pointer border-b border-slate-100 transition last:border-0 hover:bg-slate-50',
                            selectedItemId === r.id && 'bg-indigo-50',
                          )}
                        >
                          <td className="max-w-[320px] py-2 pr-3">
                            <span className="text-body font-medium text-slate-800">{r.title}</span>
                          </td>
                          <td className="px-3 py-2 text-meta tabular-nums text-slate-600">{days(lead(r))}</td>
                          <td className="px-3 py-2 text-meta tabular-nums text-slate-600">
                            {days((r.resolvedAt! - committed) / DAY_MS)}
                          </td>
                          <td className="px-3 py-2 text-meta text-slate-600">{shortDate(r.resolvedAt!)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </Panel>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** A delivered card's lead time in days: created to resolved. */
const lead = (r: FlowRecord) => (r.resolvedAt! - r.createdAt) / DAY_MS

function Stat({
  label,
  value,
  note,
  tone,
  hint,
}: {
  label: string
  value: string | number
  note?: string
  tone?: 'emerald'
  hint?: string
}) {
  return (
    <div data-flow-stat={label} title={hint}>
      <div className="text-micro uppercase tracking-wide text-slate-600">{label}</div>
      <div data-flow-stat-value className={cn('text-title font-semibold tabular-nums', tone === 'emerald' ? 'text-emerald-700' : 'text-slate-800')}>
        {value}
      </div>
      {note && <div className="text-micro text-slate-600">{note}</div>}
    </div>
  )
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="mb-3 rounded-lg border border-slate-300 bg-white px-4 py-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <span className="text-meta font-bold uppercase tracking-wide text-slate-700">{title}</span>
        {note && <span className="text-micro text-slate-600">{note}</span>}
      </div>
      {children}
    </div>
  )
}
