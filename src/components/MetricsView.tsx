import { useState, type ReactNode } from 'react'
import { TrendingUp } from 'lucide-react'
import {
  aging,
  averageWip,
  blockedRuns,
  blockedSummary,
  bucketsFor,
  committedAt,
  cumulativeFlow,
  dataQuality,
  deliveredSince,
  firstRecordedMove,
  flowRecord,
  flowSummary,
  forecastBy,
  forecastWhen,
  histogram,
  littleCycle,
  metricsCsv,
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
  throughputRate,
  windowStart,
  type FlowRecord,
} from '@/domain/metrics'
import { isInitiativeItem } from '@/domain/board'
import { dependenciesOf, openDependenciesOf, type Graph } from '@/domain/derive'
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
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const users = useStore((s) => s.users)
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
  const blocked = blockedSummary(records, now, since)
  const cycles = scatterPoints(records, since).map((point) => point.cycle)
  const firstMove = firstRecordedMove(records)
  const coverage = moveCoverage(records)
  const deliveredTotal = delivered.reduce((sum, n) => sum + n, 0)

  // The data-quality check reads the same history the charts do, plus the two things a record
  // cannot know: the boards a card is placed on, and whether a blockage outlived its dependency.
  const graph: Graph = { items, edges, links, placements, lanes }
  const recordIds = new Set(records.map((record) => record.id))
  const boardsByItem: Record<string, string[]> = {}
  for (const placement of placements) {
    if (!recordIds.has(placement.itemId)) continue
    const name = boards.find((candidate) => candidate.id === placement.boardId)?.name
    if (!name) continue
    const names = boardsByItem[placement.itemId] ?? []
    if (!names.includes(name)) names.push(name)
    boardsByItem[placement.itemId] = names
  }
  const staleBlocks = records
    .filter((record) => {
      const item = items.find((candidate) => candidate.id === record.id)
      if (!item?.blocked) return false
      return dependenciesOf(item.id, graph).length > 0 && openDependenciesOf(item.id, graph).length === 0
    })
    .map((record) => record.id)
  const quality = dataQuality(records, { boardsByItem, blockedAfterDependencyDone: staleBlocks })
  const wip = averageWip(records, buckets)
  const rate = throughputRate(records, since ?? Math.min(...records.map((record) => record.createdAt), now), now)
  const implied = littleCycle(wip, rate)
  const sle = serviceLevel(records, since, serviceShare)
  const remaining = openScope(records, now, includeBacklog)
  const forecast = forecastWhen(remaining, delivered, now)
  const atLeastCount = atLeast.trim() === '' ? remaining : Math.max(0, Math.min(remaining, Number(atLeast) || 0))
  const byDateAt = new Date(`${byDate}T12:00:00`).getTime()
  const by = forecastBy(remaining, delivered, now, byDateAt, { atLeast: atLeastCount })

  // The rows behind the charts, for anyone who wants a spreadsheet. The item id is deliberately
  // absent: identity is the app's own business, and the title is what a person reads and searches.
  const downloadRows = () => {
    const rows = scatterPoints(records, since).map((point) => {
      const record = records.find((candidate) => candidate.id === point.id)
      const lane = lanes.find((candidate) => candidate.id === laneOf.get(point.id))
      const flow = boardFlows.find((candidate) => candidate.id === lane?.flowId)?.name ?? ''
      const type = issueTypes.find((candidate) => candidate.id === items.find((item) => item.id === point.id)?.typeId)?.name ?? ''
      const blockedDays = record
        ? blockedRuns(record, now).reduce((sum, run) => sum + (run.to - run.from) / DAY_MS, 0)
        : 0
      return {
        title: point.title,
        type,
        flow,
        createdAt: point.createdAt,
        committedAt: point.committedAt,
        resolvedAt: point.resolvedAt,
        lead: point.lead,
        cycle: point.cycle,
        blockedDays,
      }
    })
    const rangeLabel = flowWindow === 'all' ? 'all' : `${flowWindow}w`
    const slug = `${board?.name ?? 'board'} flow ${selectedFlow?.name ?? 'all'} ${rangeLabel}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    // The file is made here, without the board's download helper: one button is not a reason to
    // pull another module's graph into the Flow chunk.
    const url = URL.createObjectURL(new Blob([metricsCsv(rows)], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${slug || 'board'}-delivered.csv`
    anchor.rel = 'noopener'
    anchor.click()
    URL.revokeObjectURL(url)
  }

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
            <button
              type="button"
              data-flow-download
              onClick={downloadRows}
              className="ml-auto rounded border border-slate-300 bg-white px-2 py-1 text-meta font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
              title="Download the delivered cards in this window as a CSV"
            >
              Download these rows
            </button>
          </div>
        </div>

        {records.length === 0 ? (
          <div className="rounded-lg border border-slate-300 bg-white px-4 py-6 text-meta text-slate-600 shadow-sm">
            This board carries no cards yet. Flow is read from cards' moves, so there is nothing to read — add
            cards and move them between columns.
          </div>
        ) : (
          <>
            <DataQuality findings={quality} titles={new Map(records.map((record) => [record.id, record.title]))} openItem={openItem} />

            <CycleScatter records={records} since={since} openItem={openItem} selectedItemId={selectedItemId} />

            <CycleHistogram cycles={cycles} p50={summary.cycle.p50} p85={summary.cycle.p85} />

            <AgingWork
              records={records}
              now={now}
              laneOf={laneOf}
              lanes={lanes}
              placements={placements}
              boardId={boardId}
              items={items}
              issueTypes={issueTypes}
              users={users}
              p85={summary.cycle.p85}
              openItem={openItem}
            />

            <BlockedWork summary={blocked} openItem={openItem} />

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

            <Panel
              title="Little's Law"
              note="Average committed WIP ÷ throughput = the cycle time the system implies. It is a check on the two readings above, and it assumes a stable system."
            >
              <div data-littles-law className="flex flex-wrap gap-x-8 gap-y-2">
                <Measure label="Average committed WIP" value={wip.toFixed(1)} />
                <Measure label="Throughput" value={rate === undefined ? '—' : `${(rate * 7).toFixed(1)} cards/week`} />
                <Measure label="Implied cycle" value={days(implied)} name="implied" />
                <Measure label="Measured cycle p50" value={days(summary.cycle.p50)} />
              </div>
              {implied === undefined && (
                <p className="mt-1 text-micro text-slate-600">
                  {rate === undefined
                    ? 'No throughput in this window, so there is no implied cycle time.'
                    : 'No committed work in this window, so there is no WIP to divide.'}
                </p>
              )}
            </Panel>

            <Panel
              title="Service level expectation"
              note="A reading of the past, not a promise: the cycle time within which that share of the delivered cards finished."
            >
              <div data-sle className="flex flex-wrap items-center gap-x-4 gap-y-2 text-meta text-slate-700">
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
                    : `${sle.share}% of delivered cards finished within ${days(sle.days)} (${sle.n} card${sle.n === 1 ? '' : 's'}).`}
                </span>
                {sle.n > 0 && sle.n < MIN_SAMPLE && (
                  <span className="text-micro text-slate-500">Only {sle.n} cards — a hint, not a baseline.</span>
                )}
              </div>
            </Panel>

            <Panel
              title="When will this be done?"
              note="A Monte Carlo over the weekly throughput in this window: 5,000 trials, each drawing weeks at random. A range, not a promised date."
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-slate-700">
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
                  <div data-forecast className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
                    {(['p50', 'p85', 'p95'] as const).map((key) => (
                      <div key={key}>
                        <div className="text-micro uppercase tracking-wide text-slate-600">
                          {key === 'p50' ? '50%' : key === 'p85' ? '85%' : '95%'} by
                        </div>
                        <div data-forecast-date={key} className="text-title font-semibold text-slate-800">
                          {forecast.dates[key] === undefined
                            ? '—'
                            : new Date(forecast.dates[key]!).toLocaleDateString(undefined, {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              })}
                        </div>
                        <div className="text-micro text-slate-600">{days(forecast.weeks[key])}</div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1 text-micro text-slate-600">
                    {forecast.trials.toLocaleString()} trials over {forecast.sampledWeeks} sampled weeks.
                    Assumes the {forecast.remaining} open cards stay the scope, the future resembles
                    those weeks, and throughput arrives weekly. Dependencies and batch size are not
                    modelled.
                  </p>
                </>
              ) : (
                <p data-forecast-refusal className="mt-2 text-meta text-slate-600">
                  {forecastRefusal(forecast.reason, forecast.weeks, forecast.delivered)}
                </p>
              )}
            </Panel>

            <Panel
              title="How many by a date?"
              note="The same 5,000 trials, read the other way: how much of the scope is likely to be finished by a chosen date."
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-meta text-slate-700">
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
                    className="w-16 rounded border border-slate-200 bg-white px-1.5 py-1 text-meta text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  card{atLeastCount === 1 ? '' : 's'}
                </label>
              </div>
              {by.ok ? (
                <div data-forecast-by className="mt-2 text-meta text-slate-700">
                  <p>
                    <span className="text-title font-semibold tabular-nums">{Math.round(by.share * 100)}%</span>{' '}
                    chance of at least {by.atLeast} card{by.atLeast === 1 ? '' : 's'} by then.
                  </p>
                  <p className="mt-0.5 text-micro text-slate-600">
                    50% chance of {countAtMost(by.counts.p50)} or more · 85%{' '}
                    {countAtMost(by.counts.p85)} · 95% {countAtMost(by.counts.p95)}. The same scope
                    and the same assumptions as the forecast above.
                  </p>
                </div>
              ) : (
                <p data-forecast-by-refusal className="mt-2 text-meta text-slate-600">
                  {by.reason === 'past-date'
                    ? 'Choose a date after today.'
                    : forecastRefusal(by.reason, by.weeks, by.delivered)}
                </p>
              )}
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
 * Blocked work, now and in the window.
 *
 * The app keeps "blocked" (a person's explicit flag with a reason) apart from "waiting" (a dependency
 * that is not done). This panel is the first: blocked time is the sum of the runs in the card's own
 * log, and waiting is a different signal on the board and in the health badges.
 */
function BlockedWork({
  summary,
  openItem,
}: {
  summary: ReturnType<typeof blockedSummary>
  openItem: (id: string | null) => void
}) {
  return (
    <Panel
      title="Blocked work"
      note="Blocked time comes from a card's own blocked and unblocked entries. Waiting on another card is a dependency, and is not counted here."
    >
      <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-micro font-semibold uppercase tracking-wide text-slate-600">
            Blocked now{summary.now.length > 0 ? ` · ${summary.now.length}` : ''}
          </div>
          {summary.now.length === 0 ? (
            <div className="text-meta text-slate-600">Nothing is blocked right now.</div>
          ) : (
            <ul className="space-y-0.5">
              {summary.now.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    data-blocked-now
                    data-card-id={row.id}
                    onClick={() => openItem(row.id)}
                    className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                    title={row.reason}
                  >
                    <span data-blocked-title className="min-w-0 flex-1 truncate text-meta font-medium text-slate-800">
                      {row.title}
                    </span>
                    <span className="shrink-0 text-micro tabular-nums text-slate-600">
                      {row.days === undefined ? 'duration unknown' : `${days(row.days)} blocked`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="mb-1 text-micro font-semibold uppercase tracking-wide text-slate-600">
            In this window
          </div>
          {summary.runs === 0 ? (
            <div className="text-meta text-slate-600">Nothing was blocked in this window.</div>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-slate-700">
                <span>
                  <span className="font-semibold tabular-nums" data-blocked-total>
                    {days(summary.totalDays)}
                  </span>{' '}
                  blocked in total
                </span>
                <span>
                  median <span className="font-semibold tabular-nums">{days(summary.median)}</span>
                </span>
                <span>
                  p85 <span className="font-semibold tabular-nums">{days(summary.p85)}</span>
                </span>
                <span className="text-slate-500">
                  {summary.runs} run{summary.runs === 1 ? '' : 's'}
                </span>
              </div>
              {summary.reasons.length > 0 && (
                <div className="mt-1.5">
                  <div className="text-micro uppercase tracking-wide text-slate-600">Most common reasons</div>
                  <ul className="mt-0.5 space-y-0.5">
                    {summary.reasons.map((row) => (
                      <li key={row.reason} data-blocked-reason className="flex items-baseline gap-2 text-meta text-slate-700">
                        <span className="min-w-0 flex-1 truncate">{row.reason}</span>
                        <span className="shrink-0 tabular-nums text-slate-600">{row.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Panel>
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
  const peakLabel = peak.tail ? `${peak.from}+ days` : `${peak.from}–${peak.to - 1} day${peak.to - 1 === peak.from ? '' : 's'}`
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
              className="flex min-w-0 flex-1 flex-col justify-end"
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

      <details className="mt-2 text-micro text-slate-600">
        <summary className="cursor-pointer">The numbers</summary>
        <table className="mt-1 w-full border-collapse text-left">
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
      </details>
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
  laneOf,
  lanes,
  placements,
  boardId,
  items,
  issueTypes,
  users,
  p85,
  openItem,
}: {
  records: FlowRecord[]
  now: number
  laneOf: Map<string, string>
  lanes: ReturnType<typeof useStore.getState>['lanes']
  placements: ReturnType<typeof useStore.getState>['placements']
  boardId: string
  items: ReturnType<typeof useStore.getState>['items']
  issueTypes: ReturnType<typeof useStore.getState>['issueTypes']
  users: ReturnType<typeof useStore.getState>['users']
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
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]))
  const itemById = new Map(items.map((item) => [item.id, item]))
  const typeById = new Map(issueTypes.map((type) => [type.id, type]))
  const userById = new Map(users.map((user) => [user.id, user]))
  const counts = STAGES.map((stage) => ({ stage, count: aged.filter((entry) => entry.stage === stage).length })).filter(
    (row) => row.count > 0,
  )
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
          <div data-flow-aging className="mb-2 flex flex-wrap gap-1.5">
            {counts.map(({ stage, count }) => (
              <span
                key={stage}
                className="rounded bg-slate-100 px-1.5 py-0.5 text-micro font-semibold text-slate-600"
              >
                {STAGE_LABELS[stage]} {count}
              </span>
            ))}
          </div>
          <div className="space-y-0.5">
            {shown.map((entry) => {
              const item = itemById.get(entry.id)
              const lane = laneById.get(laneOf.get(entry.id) ?? '')
              const column = lane?.name?.trim() || STAGE_LABELS[entry.stage]
              const type = item ? typeById.get(item.typeId)?.name : undefined
              const people = (item?.assignees ?? [])
                .map((id) => userById.get(id)?.name)
                .filter((name): name is string => Boolean(name))
              const age = entry.daysSinceCommit ?? entry.daysInColumn
              return (
                <button
                  key={entry.id}
                  type="button"
                  data-flow-aging-row
                  data-card-id={entry.id}
                  onClick={() => openItem(entry.id)}
                  className="flex w-full items-center gap-2 rounded px-1 py-1 text-left transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                  title={`${entry.title}${type ? ` · ${type}` : ''}${people.length > 0 ? ` · ${people.join(', ')}` : ' · Unassigned'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span data-flow-aging-title className="block truncate text-meta font-medium text-slate-800">
                      {entry.title}
                    </span>
                    <span className="block truncate text-micro text-slate-500">
                      {type ?? 'No type'} · {people.length > 0 ? people.join(', ') : 'Unassigned'}
                    </span>
                  </span>
                  <span className="w-24 shrink-0 truncate text-micro text-slate-600">{column}</span>
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
                  <span className="w-16 shrink-0 text-right text-micro text-slate-500">
                    {entry.daysSinceCommit === undefined ? 'in Backlog' : 'in flight'}
                  </span>
                  {entry.stalled && (
                    <span
                      className="shrink-0 rounded bg-amber-100 px-1 py-px text-micro font-semibold text-amber-800 ring-1 ring-amber-300"
                      title="Nothing has moved on this card for seven days"
                    >
                      stalled
                    </span>
                  )}
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

/**
 * The reader's warning label, not a gate.
 *
 * JiraMetrics opens every report with this, and the reason is simple: the charts are only as good
 * as the data, and a reader who knows where the process bends the model reads the rest differently.
 * A finding lists the cards and takes you to them; it never hides one or says the team did something
 * wrong.
 */
function DataQuality({
  findings,
  titles,
  openItem,
}: {
  findings: ReturnType<typeof dataQuality>
  titles: Map<string, string>
  openItem: (id: string | null) => void
}) {
  if (findings.length === 0) {
    return (
      <div data-quality-clean className="mb-3 rounded-lg border border-slate-300 bg-white px-4 py-2 text-meta text-slate-600 shadow-sm">
        <span className="font-semibold text-slate-700">Data quality:</span> nothing to flag in this
        flow. The history matches a clean start-to-finish reading.
      </div>
    )
  }

  return (
    <Panel
      title="Data quality"
      note="Places where the history bends the start-to-finish model. They do not hide anything; they say how to read the rest."
    >
      <ul data-quality className="grid gap-x-6 gap-y-2 md:grid-cols-2">
        {findings.map((finding) => (
          <li key={finding.flag} data-quality-finding={finding.flag}>
            <div className="flex items-baseline gap-2">
              <span className="text-meta font-semibold text-slate-800">{finding.label}</span>
              <span className="text-micro tabular-nums text-slate-600">{finding.items.length}</span>
            </div>
            <div className="text-micro text-slate-600">{finding.why}</div>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {finding.items.slice(0, 4).map((id) => (
                <button
                  key={id}
                  type="button"
                  data-quality-item
                  onClick={() => openItem(id)}
                  className="max-w-[220px] truncate rounded bg-slate-100 px-1.5 py-0.5 text-left text-micro text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-700"
                  title={titles.get(id) ?? 'Open the card'}
                >
                  {titles.get(id) ?? 'Open the card'}
                </button>
              ))}
              {finding.items.length > 4 && (
                <span className="self-center text-micro text-slate-500">+{finding.items.length - 4} more</span>
              )}
            </div>
          </li>
        ))}
      </ul>
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
}: {
  records: FlowRecord[]
  since: number | undefined
  openItem: (id: string | null) => void
  selectedItemId: string | null
}) {
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
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              openItem(point.id)
            }}
          >
            <title>
              {`${point.title} — cycle ${days(point.cycle)}, lead ${days(point.lead)}, delivered ${shortDate(point.resolvedAt)}`}
            </title>
          </circle>
        ))}

        <text x={plot.left} y={height - 4} fontSize={9} fill="#64748b">
          {shortDate(from)}
        </text>
        <text x={plot.right} y={height - 4} textAnchor="end" fontSize={9} fill="#64748b">
          {shortDate(to)}
        </text>
      </svg>

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

function Measure({ label, value, name }: { label: string; value: string; name?: string }) {
  return (
    <div>
      <div className="text-micro uppercase tracking-wide text-slate-600">{label}</div>
      <div data-littles-value={name} className="text-title font-semibold tabular-nums text-slate-800">
        {value}
      </div>
    </div>
  )
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
