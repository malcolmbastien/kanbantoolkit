import { useRef, useState, type ReactNode } from 'react'
import { TrendingUp } from 'lucide-react'
import {
  aging,
  bucketsFor,
  committedAt,
  cumulativeFlow,
  deliveredSince,
  firstRecordedMove,
  flowRecord,
  flowSummary,
  forecastBy,
  forecastWhen,
  histogram,
  MIN_FORECAST_DELIVERED,
  MIN_FORECAST_WEEKS,
  MIN_SAMPLE,
  moveCoverage,
  openScope,
  percentile,
  sampleStats,
  scatterPoints,
  serviceLevel,
  throughput,
  windowStart,
  type FlowRecord,
  type ScatterPoint,
} from '@/domain/metrics'
import { isInitiativeItem } from '@/domain/board'
import { effectiveStage, STAGE_LABELS, STAGES } from '@/domain/lanes'
import { chipColors, STAGE_ACCENT, STAGE_PILL } from '@/lib/colors'
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
  const [serviceShare, setServiceShare] = useState(85)
  const [includeBacklog, setIncludeBacklog] = useState(false)
  const [byDate, setByDate] = useState(() => new Date(Date.now() + 8 * 7 * DAY_MS).toISOString().slice(0, 10))
  const [atLeast, setAtLeast] = useState('')
  const flowWindow = useStore((s) => s.flowWindow)
  const metricsFlowId = useStore((s) => s.metricsFlowId)
  const setFlowWindow = useStore((s) => s.setFlowWindow)
  const setMetricsFlow = useStore((s) => s.setMetricsFlow)

  const board = boards.find((b) => b.id === boardId)
  const boardFlows = cardsFlows(flows, boardId)
  // A flow the board no longer has — a link from when it did, or a flow removed in another tab —
  // is not a reading: the screen shows every flow and the URL is normalised on the next write.
  const selectedFlow = boardFlows.find((f) => f.id === metricsFlowId) ?? null
  const typeNameOf = (id: string) => {
    const item = items.find((candidate) => candidate.id === id)
    return issueTypes.find((type) => type.id === item?.typeId)?.name ?? 'No type'
  }

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
  const cycles = scatterPoints(records, since).map((point) => point.cycle)
  const firstMove = firstRecordedMove(records)
  const coverage = moveCoverage(records)
  const deliveredTotal = delivered.reduce((sum, n) => sum + n, 0)

  const sle = serviceLevel(records, since, serviceShare)
  const remaining = openScope(records, now, includeBacklog)
  const forecast = forecastWhen(remaining, delivered, now)
  const atLeastCount = atLeast.trim() === '' ? remaining : Math.max(0, Math.min(remaining, Number(atLeast) || 0))
  const byDateAt = new Date(`${byDate}T12:00:00`).getTime()
  const by = forecastBy(remaining, delivered, now, byDateAt, { atLeast: atLeastCount })

  // Each diagram has its own scale: a flow column is as tall as the most work the board carried at
  // a week's end, a throughput bar as tall as the busiest week in the window.
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
            <div data-flow-history className="mt-1 text-micro text-slate-500">
              {firstMove === undefined
                ? 'No moves recorded yet — the stage history starts when work moves.'
                : `Moves recorded since ${shortDate(firstMove)} · ${coverage.withMoves} of ${coverage.total} cards have move history.`}
              {coverage.total > coverage.withMoves && ' The rest start where they sit.'}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2">
            <Stat label="In flight" value={summary.inFlight} />
            <Stat label="Delivered" value={summary.delivered} tone="emerald" />
            <Stat
              label="Lead time"
              value={days(summary.lead.p50)}
              note={`p85 ${days(summary.lead.p85)} · p95 ${days(summary.lead.p95)} · ${summary.lead.n} cards${
                summary.lead.n > 0 && summary.lead.n < MIN_SAMPLE ? ' · thin sample' : ''
              }`}
              hint="Created to done. p85 and p95 are the tail: that share of cards took this long or less."
            />
            <Stat
              label="Cycle time"
              value={days(summary.cycle.p50)}
              note={`p85 ${days(summary.cycle.p85)} · p95 ${days(summary.cycle.p95)} · ${summary.cycle.n} cards${
                summary.cycle.n > 0 && summary.cycle.n < MIN_SAMPLE ? ' · thin sample' : ''
              }`}
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
            <CycleScatter
              records={records}
              since={since}
              openItem={openItem}
              selectedItemId={selectedItemId}
              typeNameOf={typeNameOf}
            />

            <CycleHistogram cycles={cycles} p50={summary.cycle.p50} p85={summary.cycle.p85} />

            <AgingWork
              records={records}
              now={now}
              placements={placements}
              boardId={boardId}
              items={items}
              issueTypes={issueTypes}
              p85={summary.cycle.p85}
              openItem={openItem}
            />

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

            <Panel
              title="Throughput"
              note={`Cards that reached Done in each week — delivery, not activity. ${deliveredTotal} in ${delivered.length} week${delivered.length === 1 ? '' : 's'}; the busiest week had ${Math.max(...delivered)}.`}
            >
              {deliveredTotal === 0 ? (
                <div className="text-meta text-slate-600">No cards reached Done in this window.</div>
              ) : (
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
              )}
            </Panel>

            {/* One planning row, not three stacked sections: the past reading (service level) sits
                beside the two questions about the future, and they share a window and a model. */}
            <Panel
              title="Planning"
              note="A reading of the past beside two questions about the future, from the same window and the same throughput."
            >
              <div className="grid gap-5 lg:grid-cols-3 lg:gap-6">
                <section data-sle className="min-w-0">
                  <div className="text-micro font-semibold uppercase tracking-wide text-slate-700">
                    Service level expectation
                  </div>
                  <p className="mt-1 text-micro text-slate-500">
                    The cycle time within which that share of delivered cards finished. It describes
                    the past, not a promise.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-slate-700">
                    <label className="flex items-center gap-1.5 text-slate-600">
                      Share
                      <select
                        aria-label="Service level share"
                        value={serviceShare}
                        onChange={(event) => setServiceShare(Number(event.target.value))}
                        className="rounded border border-slate-200 bg-white px-1.5 py-1 text-meta text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300"
                      >
                        {[50, 85, 95].map((share) => (
                          <option key={share} value={share}>
                            {share}%
                          </option>
                        ))}
                      </select>
                    </label>
                    <span data-sle-line>
                      {sle.days === undefined
                        ? 'No delivered cards in this window.'
                        : `${sle.share}% finished within ${days(sle.days)} (${sle.n} card${sle.n === 1 ? '' : 's'}).`}
                    </span>
                  </div>
                  {sle.n > 0 && sle.n < MIN_SAMPLE && (
                    <p className="mt-1 text-micro text-slate-500">Only {sle.n} cards — a hint, not a baseline.</p>
                  )}
                </section>

                <section data-forecast className="min-w-0">
                  <div className="text-micro font-semibold uppercase tracking-wide text-slate-700">
                    When will this be done?
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-slate-700">
                    <label className="flex items-center gap-1.5 text-slate-600">
                      <input
                        type="checkbox"
                        checked={includeBacklog}
                        onChange={(event) => setIncludeBacklog(event.target.checked)}
                        className="accent-indigo-600"
                      />
                      Include Backlog
                    </label>
                    <span>
                      Scope: <span className="font-semibold tabular-nums">{remaining}</span> open card
                      {remaining === 1 ? '' : 's'}
                    </span>
                  </div>
                  {forecast.ok ? (
                    <>
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                        {(['p50', 'p85', 'p95'] as const).map((key) => (
                          <div key={key}>
                            <div className="text-micro uppercase tracking-wide text-slate-500">
                              {key === 'p50' ? '50%' : key === 'p85' ? '85%' : '95%'} by
                            </div>
                            <div data-forecast-date={key} className="text-meta font-semibold text-slate-800">
                              {forecast.dates[key] === undefined
                                ? '—'
                                : new Date(forecast.dates[key]!).toLocaleDateString(undefined, {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                            </div>
                            <div className="text-micro text-slate-500">{days(forecast.weeks[key])}</div>
                          </div>
                        ))}
                      </div>
                      <p className="mt-1 text-micro text-slate-500">
                        {forecast.trials.toLocaleString()} trials over {forecast.sampledWeeks} weeks.
                        Assumes the scope stays as it is, the future resembles those weeks, and
                        throughput arrives weekly. Dependencies and batch size are not modelled.
                      </p>
                    </>
                  ) : (
                    <p data-forecast-refusal className="mt-2 text-meta text-slate-600">
                      {forecastRefusal(forecast.reason, forecast.weeks, forecast.delivered)}
                    </p>
                  )}
                </section>

                <section data-forecast-by className="min-w-0">
                  <div className="text-micro font-semibold uppercase tracking-wide text-slate-700">
                    How many by a date?
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-slate-700">
                    <label className="flex items-center gap-1.5 text-slate-600">
                      By
                      <input
                        type="date"
                        aria-label="Forecast date"
                        value={byDate}
                        onChange={(event) => setByDate(event.target.value)}
                        className="rounded border border-slate-200 bg-white px-1.5 py-1 text-meta text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 text-slate-600">
                      At least
                      <input
                        type="number"
                        aria-label="At least cards"
                        min={0}
                        max={remaining}
                        value={atLeast}
                        placeholder={String(remaining)}
                        onChange={(event) => setAtLeast(event.target.value)}
                        className="w-14 rounded border border-slate-200 bg-white px-1.5 py-1 text-meta text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300"
                      />
                      card{atLeastCount === 1 ? '' : 's'}
                    </label>
                  </div>
                  {by.ok ? (
                    <div className="mt-2 text-meta text-slate-700">
                      <p>
                        <span className="text-title font-semibold tabular-nums">{Math.round(by.share * 100)}%</span>{' '}
                        chance of at least {by.atLeast} card{by.atLeast === 1 ? '' : 's'} by then.
                      </p>
                      <p className="mt-0.5 text-micro text-slate-500">
                        50% chance of {countAtMost(by.counts.p50)} or more · 85%{' '}
                        {countAtMost(by.counts.p85)} · 95% {countAtMost(by.counts.p95)}.
                      </p>
                    </div>
                  ) : (
                    <p data-forecast-by-refusal className="mt-2 text-meta text-slate-600">
                      {by.reason === 'past-date'
                        ? 'Choose a date after today.'
                        : forecastRefusal(by.reason, by.weeks, by.delivered)}
                    </p>
                  )}
                </section>
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

/**
 * The shape of the cycle times, in whole days.
 *
 * A median and a p85 are two points; this is the distribution they came from. Empty days are drawn
 * so a bimodal flow — quick fixes and long features — is visible as two humps, and a single very
 * long card becomes a tail bucket rather than a chart nobody can read.
 */
function CycleHistogram({ cycles, p50, p85 }: { cycles: number[]; p50?: number; p85?: number }) {
  const buckets = histogram(cycles, 1, 60)
  if (buckets.length === 0) {
    return (
      <Panel title="Cycle time distribution" note="Delivered cards, in one-day buckets.">
        <div className="text-meta text-slate-600">No cycle times in this window yet.</div>
      </Panel>
    )
  }

  const tallest = Math.max(1, ...buckets.map((bucket) => bucket.count))
  const peak = buckets.reduce((best, bucket) => (bucket.count > best.count ? bucket : best), buckets[0])
  const longest = Math.max(...cycles)
  const peakLabel = peak.tail
    ? `${peak.from}+ days`
    : peak.from === peak.to - 1
      ? `${peak.from} day${peak.from === 1 ? '' : 's'}`
      : `${peak.from}–${peak.to - 1} days`
  const marker = (value: number | undefined) =>
    value === undefined ? undefined : Math.min(buckets.length - 1, Math.max(0, Math.floor(value)))
  const p50Index = marker(p50)
  const p85Index = marker(p85)

  return (
    <Panel
      title="Cycle time distribution"
      note={`Delivered cards in one-day buckets. Most finished in ${peakLabel}; the longest took ${days(longest)}.${
        cycles.length < MIN_SAMPLE ? ` Only ${cycles.length} card${cycles.length === 1 ? '' : 's'} — a thin sample.` : ''
      }`}
    >
      <div data-cycle-histogram className="relative">
        <div className="flex h-24 items-end gap-px">
          {buckets.map((bucket) => (
            <div
              key={bucket.from}
              data-cycle-histogram-bar
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`${bucket.tail ? `${bucket.from}+` : `${bucket.from}–${bucket.to - 1}`} days: ${bucket.count} card${bucket.count === 1 ? '' : 's'}`}
            >
              <div
                className={cn('rounded-sm', bucket.count === 0 ? 'bg-slate-100' : 'bg-indigo-500')}
                style={{ height: `${bucket.count === 0 ? 2 : Math.max(3, (bucket.count / tallest) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        {p50Index !== undefined && (
          <span
            className="pointer-events-none absolute inset-y-0 w-px bg-slate-500"
            style={{ left: `${((p50Index + 0.5) / buckets.length) * 100}%` }}
            title={`p50: ${days(p50)}`}
          />
        )}
        {p85Index !== undefined && (
          <span
            className="pointer-events-none absolute inset-y-0 w-px bg-rose-500"
            style={{ left: `${((p85Index + 0.5) / buckets.length) * 100}%` }}
            title={`p85: ${days(p85)}`}
          />
        )}
        <div className="mt-1 flex justify-between text-micro text-slate-600">
          <span>0d</span>
          <span>{buckets.length > 1 ? `${buckets[buckets.length - 1].tail ? `${buckets[buckets.length - 1].from}+` : `${buckets[buckets.length - 1].to - 1}`}d` : '1d'}</span>
        </div>
        <div className="mt-0.5 flex gap-3 text-micro text-slate-600">
          <span className="flex items-center gap-1">
            <span className="h-2 w-px bg-slate-500" /> p50
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-px bg-rose-500" /> p85
          </span>
        </div>
      </div>

      <div className="mt-2 border-t border-slate-100 pt-2 text-micro text-slate-600">
        <div className="mb-1 font-semibold uppercase tracking-wide text-slate-700">The numbers</div>
        <table data-cycle-histogram-table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 uppercase tracking-wide text-slate-600">
              <th className="py-1 pr-2 font-semibold">Days</th>
              <th className="px-2 py-1 text-right font-semibold">Cards</th>
            </tr>
          </thead>
          <tbody>
            {buckets.filter((bucket) => bucket.count > 0).map((bucket) => (
              <tr key={bucket.from} className="border-b border-slate-100 last:border-0">
                <td className="py-1 pr-2">{bucket.tail ? `${bucket.from}+` : `${bucket.from}–${bucket.to - 1}`}</td>
                <td className="px-2 py-1 text-right tabular-nums">{bucket.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

const MAX_AGING_ROWS = 100

/**
 * What is old right now, oldest commitment first.
 *
 * Aging is the one panel about today rather than the window: a card is as old as it is, whatever
 * range the charts are drawn over. The cycle-time p85 comes from the window's delivered cards and
 * is drawn as a marker on each bar — a card past it has been in flight longer than 85% of the work
 * the team finished in that window, which is the conversation worth having.
 */
function AgingWork({
  records,
  now,
  placements,
  boardId,
  items,
  issueTypes,
  p85,
  openItem,
}: {
  records: FlowRecord[]
  now: number
  placements: ReturnType<typeof useStore.getState>['placements']
  boardId: string
  items: ReturnType<typeof useStore.getState>['items']
  issueTypes: ReturnType<typeof useStore.getState>['issueTypes']
  p85: number | undefined
  openItem: (id: string | null) => void
}) {
  const entered = new Map(
    placements
      .filter((placement) => placement.boardId === boardId && placement.laneEnteredAt !== undefined)
      .map((placement) => [placement.itemId, placement.laneEnteredAt as number]),
  )
  const aged = aging(records, now, (record) => entered.get(record.id))
  const shown = aged.slice(0, MAX_AGING_ROWS)
  const itemById = new Map(items.map((item) => [item.id, item]))
  const typeById = new Map(issueTypes.map((type) => [type.id, type]))
  const tallest = Math.max(1, p85 ?? 1, ...aged.map((entry) => entry.daysSinceCommit ?? entry.daysInColumn))

  return (
    <Panel
      title="Aging work"
      note="Open cards, oldest commitment first. The red line is the cycle-time p85 for work delivered in this window — past it, a card has been in flight longer than 85% of what the team finished."
    >
      {aged.length === 0 ? (
        <div className="text-meta text-slate-600">No work in flight.</div>
      ) : (
        <>
          <div data-flow-aging className="space-y-0.5">
            {shown.map((entry) => {
              const item = itemById.get(entry.id)
              const type = item ? typeById.get(item.typeId) : undefined
              const age = entry.daysSinceCommit ?? entry.daysInColumn
              return (
                <button
                  key={entry.id}
                  type="button"
                  data-flow-aging-row
                  data-card-id={entry.id}
                  onClick={() => openItem(entry.id)}
                  className="flex w-full items-center gap-3 rounded px-1 py-1 text-left transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                  title={`${entry.title}${type ? ` · ${type.name}` : ''}`}
                >
                  <span className="min-w-0 flex-1">
                    <span data-flow-aging-title className="block truncate text-meta font-medium text-slate-800">
                      {entry.title}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1">
                      <span
                        className="rounded-full px-1.5 py-0.5 text-micro font-semibold"
                        style={chipColors(type?.color ?? '#64748b')}
                      >
                        {type?.name ?? 'No type'}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-micro font-semibold',
                          STAGE_PILL[entry.stage],
                        )}
                      >
                        {STAGE_LABELS[entry.stage]}
                      </span>
                    </span>
                  </span>
                  <span className="relative h-2 w-32 shrink-0 rounded bg-slate-100">
                    <span
                      className="absolute inset-y-0 left-0 rounded bg-indigo-400"
                      style={{ width: `${Math.min(100, (age / tallest) * 100)}%` }}
                    />
                    {p85 !== undefined && (
                      <span
                        className="absolute inset-y-[-2px] w-px bg-rose-500"
                        style={{ left: `${Math.min(100, (p85 / tallest) * 100)}%` }}
                        title={`Cycle p85: ${days(p85)}`}
                      />
                    )}
                  </span>
                  <span className="w-12 shrink-0 text-right text-micro tabular-nums text-slate-700">{days(age)}</span>
                </button>
              )
            })}
          </div>
          {aged.length > shown.length && (
            <div className="mt-1 text-micro text-slate-600">
              Showing the oldest {shown.length} of {aged.length} open cards.
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

const MAX_SCATTER_POINTS = 400

/**
 * Cycle time against the date work was delivered.
 *
 * One dot per card, so the shape and the outliers are visible rather than collapsed into a median.
 * The y axis stops at the 98th percentile: a handful of very long cards would otherwise squash the
 * bulk into a thin band. Cards above the cap are still drawn — at the top, in the tail colour — and
 * their real value is in the tooltip and the table. The percentile lines are calculated from every
 * card in the window, not from what the axis happens to show.
 */
function CycleScatter({
  records,
  since,
  openItem,
  selectedItemId,
  typeNameOf,
}: {
  records: FlowRecord[]
  since: number | undefined
  openItem: (id: string | null) => void
  selectedItemId: string | null
  typeNameOf: (id: string) => string
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ point: ScatterPoint; left: number; top: number; below: boolean } | null>(null)
  const points = scatterPoints(records, since)
  if (points.length === 0) {
    return (
      <Panel title="Cycle time by delivery" note="One dot per delivered card in the window.">
        <div className="text-meta text-slate-600">
          Nothing finished in this window yet. Widen the window, or move a card to Done.
        </div>
      </Panel>
    )
  }

  const stats = sampleStats(points.map((point) => point.cycle))
  const cap = Math.max(1, Math.ceil(percentile(points.map((point) => point.cycle), 98) ?? 1))
  const shown = points.length > MAX_SCATTER_POINTS ? points.slice(-MAX_SCATTER_POINTS) : points
  const above = points.filter((point) => point.cycle > cap).length
  const latest = points[points.length - 1].resolvedAt
  const from = Math.min(since ?? points[0].resolvedAt, latest - DAY_MS)
  const to = Math.max(Date.now(), latest, from + DAY_MS)
  const width = 720
  const height = 260
  const plot = { left: 42, right: 700, top: 14, bottom: 218 }
  const x = (at: number) => plot.left + ((at - from) / (to - from)) * (plot.right - plot.left)
  const y = (value: number) => plot.bottom - (Math.min(value, cap) / cap) * (plot.bottom - plot.top)
  const lines = [
    { label: 'p50', value: stats.p50 },
    { label: 'p85', value: stats.p85 },
    { label: 'p95', value: stats.p95 },
  ].filter((line): line is { label: string; value: number } => line.value !== undefined)

  const show = (point: ScatterPoint, element: SVGCircleElement) => {
    const box = element.getBoundingClientRect()
    const parent = wrap.current?.getBoundingClientRect()
    if (!parent) return
    const centre = box.left - parent.left + box.width / 2
    const dotY = box.top - parent.top
    // Above the dot when there is room; below it near the top of the chart, so the card details
    // never cover the panel's own heading.
    const below = dotY < 150
    setHover({
      point,
      left: Math.min(Math.max(centre, 120), Math.max(120, parent.width - 120)),
      top: below ? dotY + 14 : dotY - 8,
      below,
    })
  }

  return (
    <Panel
      title="Cycle time by delivery"
      note={`One dot per delivered card. The axis stops at p98 (${days(cap)})${
        above > 0 ? `, and ${above} card${above === 1 ? '' : 's'} above it drawn at the top` : ''
      }; the percentile lines still use every card.${
        points.length < MIN_SAMPLE ? ` Only ${points.length} delivered card${points.length === 1 ? '' : 's'} — treat the lines as a hint.` : ''
      }`}
    >
      {points.length > shown.length && (
        <div className="mb-1 text-micro text-slate-600">
          Showing the most recent {shown.length} of {points.length} delivered cards.
        </div>
      )}
      <div ref={wrap} className="relative">
      <svg
        data-flow-scatter
        viewBox={`0 0 ${width} ${height}`}
        className="h-64 w-full"
        role="group"
        aria-label="Cycle time against the date work was delivered"
      >
        {/* The frame and the two ends of the y axis. */}
        <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} stroke="#cbd5e1" />
        <line x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.bottom} stroke="#cbd5e1" />
        <text x={plot.left - 6} y={plot.bottom + 3} textAnchor="end" fontSize={9} fill="#64748b">
          0d
        </text>
        <text x={plot.left - 6} y={plot.top + 3} textAnchor="end" fontSize={9} fill="#64748b">
          {cap}d
        </text>

        {lines.map((line) => (
          <g key={line.label}>
            <line
              x1={plot.left}
              x2={plot.right}
              y1={y(line.value)}
              y2={y(line.value)}
              stroke="#94a3b8"
              strokeDasharray="4 3"
            />
            <text x={plot.right} y={y(line.value) - 3} textAnchor="end" fontSize={9} fill="#64748b">
              {line.label} {days(line.value)}
            </text>
          </g>
        ))}

        {shown.map((point) => (
          <circle
            key={point.id}
            data-flow-scatter-point
            data-above={point.cycle > cap || undefined}
            cx={x(point.resolvedAt)}
            cy={y(point.cycle)}
            r={3.5}
            tabIndex={0}
            role="button"
            aria-label={`${point.title}: ${days(point.cycle)} cycle time, delivered ${shortDate(point.resolvedAt)}`}
            className={cn(
              'cursor-pointer focus:outline-none focus-visible:stroke-2 focus-visible:stroke-slate-900',
              point.cycle > cap ? 'fill-rose-500 hover:fill-rose-700' : 'fill-indigo-500 hover:fill-indigo-700',
              selectedItemId === point.id && 'stroke-2 stroke-slate-900',
            )}
            onClick={() => openItem(point.id)}
            onMouseEnter={(event) => show(point, event.currentTarget)}
            onMouseLeave={() => setHover(null)}
            onFocus={(event) => show(point, event.currentTarget)}
            onBlur={() => setHover(null)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              openItem(point.id)
            }}
          />
        ))}

        <text x={plot.left} y={height - 4} fontSize={9} fill="#64748b">
          {shortDate(from)}
        </text>
        <text x={plot.right} y={height - 4} textAnchor="end" fontSize={9} fill="#64748b">
          {shortDate(to)}
        </text>
      </svg>

      {hover && (
        <div
          role="tooltip"
          data-flow-scatter-tip
          className={cn(
            'pointer-events-none absolute z-20 w-60 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-2.5 text-left shadow-lg',
            hover.below ? 'translate-y-0' : '-translate-y-full',
          )}
          style={{ left: hover.left, top: hover.top }}
        >
          <div className="truncate text-meta font-semibold text-slate-900">{hover.point.title}</div>
          <div className="mt-0.5 truncate text-micro text-slate-500">
            {typeNameOf(hover.point.id)} · delivered {shortDate(hover.point.resolvedAt)}
          </div>
          <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-micro text-slate-600">
            <span>Cycle</span>
            <span className="text-right font-semibold tabular-nums text-slate-800">{days(hover.point.cycle)}</span>
            <span>Lead</span>
            <span className="text-right tabular-nums text-slate-700">{days(hover.point.lead)}</span>
            <span>Created</span>
            <span className="text-right text-slate-700">{shortDate(hover.point.createdAt)}</span>
            <span>Committed</span>
            <span className="text-right text-slate-700">{shortDate(hover.point.committedAt)}</span>
          </div>
          <div className="mt-1.5 border-t border-slate-100 pt-1 text-micro text-slate-400">
            Click to open the card
          </div>
        </div>
      )}
      </div>

      <details className="mt-2 text-micro text-slate-600">
        <summary className="cursor-pointer">The numbers</summary>
        <table className="mt-1 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 uppercase tracking-wide text-slate-600">
              <th className="py-1 pr-2 font-semibold">Card</th>
              <th className="px-2 py-1 font-semibold">Created</th>
              <th className="px-2 py-1 font-semibold">Committed</th>
              <th className="px-2 py-1 font-semibold">Done</th>
              <th className="px-2 py-1 text-right font-semibold">Lead</th>
              <th className="px-2 py-1 text-right font-semibold">Cycle</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((point) => (
              <tr key={point.id} className="border-b border-slate-100 last:border-0">
                <td className="max-w-[260px] truncate py-1 pr-2">{point.title}</td>
                <td className="px-2 py-1">{shortDate(point.createdAt)}</td>
                <td className="px-2 py-1">{shortDate(point.committedAt)}</td>
                <td className="px-2 py-1">{shortDate(point.resolvedAt)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{days(point.lead)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{days(point.cycle)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Panel>
  )
}

/** A delivered card's lead time in days: created to resolved. */
const lead = (r: FlowRecord) => (r.resolvedAt! - r.createdAt) / DAY_MS

const countAtMost = (value: number | undefined) => (value === undefined ? '—' : String(Math.round(value)))

/** The same refusal sentence wherever a forecast is refused, so the two panels cannot disagree. */
function forecastRefusal(
  reason: 'no-scope' | 'no-throughput' | 'thin-history',
  weeks: number,
  delivered: number,
): string {
  if (reason === 'no-scope') return 'There is no open work in this scope.'
  if (reason === 'no-throughput') return 'No cards were delivered in this window, so there is nothing to forecast from.'
  return `Not enough history yet: ${weeks} week${weeks === 1 ? '' : 's'} and ${delivered} delivered card${
    delivered === 1 ? '' : 's'
  }. A forecast needs ${MIN_FORECAST_WEEKS} weeks and ${MIN_FORECAST_DELIVERED} cards.`
}

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
