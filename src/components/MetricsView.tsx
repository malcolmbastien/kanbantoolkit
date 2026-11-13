import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Download, TrendingUp } from 'lucide-react'
import {
  aging,
  bucketsFor,
  cumulativeFlow,
  cycleByWeek,
  cycleTimes,
  dailyBuckets,
  deliveredSince,
  firstRecordedMove,
  flowRecord,
  flowRecordFromMoves,
  flowSummary,
  forecastBy,
  forecastWhen,
  histogram,
  leadTimes,
  MIN_FORECAST_DELIVERED,
  MIN_FORECAST_WEEKS,
  MIN_SAMPLE,
  moveCoverage,
  openScope,
  percentile,
  sampleStats,
  scatterPoints,
  serviceLevelOf,
  shareWithinDays,
  throughput,
  throughputStability,
  WEEK_MS,
  windowStart,
  wipAgeSeries,
  type CycleWeek,
  type FlowRecord,
  type ScatterPoint,
  type StageMove,
  type WipAgeBucket,
} from '@/domain/metrics'
import { isInitiativeItem } from '@/domain/board'
import { effectiveStage, STAGE_LABELS, STAGES } from '@/domain/lanes'
import { chipColors, STAGE_PILL, STAGE_STACK } from '@/lib/colors'
import { csvFilename, flowCsv, type FlowCsvRow } from '@/domain/csv'
import { downloadText } from '@/lib/download'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { IssueType, Stage } from '@/domain/types'
import type { Item } from '@/domain/types'
import { cardsFlows, kindOf } from '@/domain/flows'
import { FLOW_WINDOWS, type FlowWindow } from '@/domain/flowWindow'
import { fetchMovements, type BoardMove } from '@/lib/history'
import { isDemoWorkspace } from '@/lib/demo'
import { SEED_TODAY } from '@/domain/seed'

const DAY_MS = 86_400_000
/** The confidences offered as one-click readings; any other value is custom. */
const SERVICE_PRESETS = [50, 85, 90, 95] as const

/** The WIP age bands, youngest first, with the labels and tones the chart uses. */
const WIP_AGE_ORDER: WipAgeBucket[] = ['le1', 'le7', 'le14', 'gt14']
const WIP_AGE_LABELS: Record<WipAgeBucket, string> = {
  le1: '≤1 day',
  le7: '≤7 days',
  le14: '≤14 days',
  gt14: '>14 days',
}
const WIP_AGE_ACCENTS: Record<WipAgeBucket, string> = {
  le1: '#c7d2fe',
  le7: '#818cf8',
  le14: '#6366f1',
  gt14: '#4338ca',
}

/** Days, quiet: a whole number, or one decimal for an in-between median. */
const days = (n: number | undefined) => (n === undefined ? '—' : `${Number.isInteger(n) ? n : n.toFixed(1)}d`)
/** A confidence, with a decimal only when the day-first input produced one. */
const shareLabel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`
const shortDate = (at: number) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const calendarDate = (at: number | undefined) =>
  at === undefined
    ? '—'
    : new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

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
  const serviceBasis = useStore((s) => s.metricsServiceBasis)
  const serviceShare = useStore((s) => s.metricsServiceShare)
  const setServiceBasis = useStore((s) => s.setMetricsServiceBasis)
  const setServiceShare = useStore((s) => s.setMetricsServiceShare)
  const [customShare, setCustomShare] = useState(false)
  const [dayDraft, setDayDraft] = useState<string | null>(null)
  const [cycleWeekFocus, setCycleWeekFocus] = useState<number | null>(null)
  const [includeBacklog, setIncludeBacklog] = useState(false)
  const [byDate, setByDate] = useState(() => new Date(Date.now() + 8 * 7 * DAY_MS).toISOString().slice(0, 10))
  const [atLeast, setAtLeast] = useState('')
  const flowWindow = useStore((s) => s.flowWindow)
  const metricsFlowId = useStore((s) => s.metricsFlowId)
  const metricsTypeId = useStore((s) => s.metricsTypeId)
  const setFlowWindow = useStore((s) => s.setFlowWindow)
  const setMetricsFlow = useStore((s) => s.setMetricsFlow)
  const setMetricsType = useStore((s) => s.setMetricsType)

  // A focused week belongs to one reading. Changing the window, flow or type is a different
  // sample, so the pick is cleared rather than left pointing at a week that is no longer drawn.
  useEffect(() => setCycleWeekFocus(null), [flowWindow, metricsFlowId, metricsTypeId])

  /**
   * The board's moves, fetched once when the view opens.
   *
   * `undefined` means "still asking", `null` means "this deployment has no history to ask for" —
   * a static build, or a server that could not answer. Both read the local copy; a server answer
   * replaces it. A move made in this tab after the fetch is merged in, so the chart is not stale.
   */
  const [remoteMoves, setRemoteMoves] = useState<{ moves: BoardMove[]; truncated: boolean } | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    setRemoteMoves(undefined)
    void fetchMovements(boardId).then((answer) => {
      if (live) setRemoteMoves(answer ?? null)
    })
    return () => {
      live = false
    }
  }, [boardId])

  const board = boards.find((b) => b.id === boardId)
  const boardFlows = cardsFlows(flows, boardId)
  // A flow the board no longer has — a link from when it did, or a flow removed in another tab —
  // is not a reading: the screen shows every flow and the URL is normalised on the next write.
  const selectedFlow = boardFlows.find((f) => f.id === metricsFlowId) ?? null
  const typeFor = (id: string): IssueType => {
    const item = items.find((candidate) => candidate.id === id)
    return issueTypes.find((type) => type.id === item?.typeId) ?? { id: 'no-type', name: 'No type', color: '#64748b' }
  }
  const typeNameOf = (id: string) => typeFor(id).name

  // The cards this board carries in its cards workflow — archived ones included, because filing
  // a delivered card away must not erase it from the board's throughput.
  const laneOf = new Map(placements.filter((p) => p.boardId === boardId).map((p) => [p.itemId, p.laneId]))
  const flowOfCard = (id: string) => lanes.find((l) => l.id === laneOf.get(id))?.flowId
  const boardCards = [...laneOf.keys()]
    .filter((id) => {
      const flowId = flowOfCard(id)
      return Boolean(flowId) && kindOf(flows, flowId!) === 'cards'
    })
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is Item => Boolean(i) && !isInitiativeItem(i, issueTypes))

  // The type choices are the board's own — every card it carries, across its cards flows — so
  // changing the flow never removes the type that was selected from the list.
  const typeOrder = new Map(issueTypes.map((type, index) => [type.id, index]))
  const boardTypeChoices = issueTypes
    .filter((type) => boardCards.some((card) => card.typeId === type.id))
    .sort((a, b) => (typeOrder.get(a.id) ?? 999) - (typeOrder.get(b.id) ?? 999) || a.name.localeCompare(b.name))
  // A type the board no longer carries — a link from when it did, or a card retyped in another tab
  // — is not a reading: the screen shows every type rather than an empty chart under a stale control.
  const selectedType = boardTypeChoices.find((type) => type.id === metricsTypeId) ?? null

  const cards = boardCards
    .filter((card) => selectedFlow === null || flowOfCard(card.id) === selectedFlow.id)
    .filter((card) => selectedType === null || card.typeId === selectedType.id)

  const now = useMemo(() => {
    // The demo is a fixed snapshot: its work, its history and its dates are all placed relative to
    // the demo's own today. A window measured from the wall clock falls off the end of that history
    // as the weeks pass, so an untouched demo is read at `SEED_TODAY`. A real workspace is read now
    // — and the demo stops being the demo the moment anybody edits it.
    const demo = isDemoWorkspace({ boards, flows, lanes, items, placements })
    return demo ? SEED_TODAY : Date.now()
  }, [boards, flows, lanes, items, placements])
  /** One card's moves: the board's read, and anything this tab recorded after it. */
  const movesOfCard = (card: Item): StageMove[] => {
    const merged = new Map<string, StageMove>()
    for (const move of remoteMoves?.moves ?? []) {
      if (move.itemId !== card.id) continue
      merged.set(move.id, {
        at: move.at,
        to: move.toStage,
        ...(move.fromStage ? { from: move.fromStage } : {}),
      })
    }
    for (const entry of card.log ?? []) {
      if (entry.kind !== 'moved' || !entry.toStage) continue
      merged.set(entry.id, {
        at: entry.at,
        to: entry.toStage,
        ...(entry.fromStage ? { from: entry.fromStage } : {}),
      })
    }
    return [...merged.entries()].sort((a, b) => a[1].at - b[1].at || a[0].localeCompare(b[0])).map(([, move]) => move)
  }
  const records: FlowRecord[] = cards.map((c) =>
    remoteMoves
      ? flowRecordFromMoves(c, effectiveStage(lanes, laneOf.get(c.id)!), movesOfCard(c))
      : flowRecord(c, effectiveStage(lanes, laneOf.get(c.id)!)),
  )
  const since = windowStart(flowWindow, now)
  const buckets = bucketsFor(flowWindow, records, now)
  const summary = flowSummary(records, now, since)
  const flow = cumulativeFlow(records, buckets)
  const delivered = throughput(records, buckets)
  // The delivered cards in the window: drawn as dots, and the rows of the CSV export. Computed
  // once so the screen and the file cannot disagree about what was delivered.
  const flowPoints = scatterPoints(records, since)
  const cycles = flowPoints.map((point) => point.cycle)
  const cycleCap = Math.max(1, Math.ceil(percentile(cycles, 98) ?? 1))
  const firstMove = firstRecordedMove(records)
  const coverage = moveCoverage(records)
  const deliveredTotal = delivered.reduce((sum, n) => sum + n, 0)

  // Throughput read by type: the same weekly buckets as the bars, split by the card's type. The
  // order is the board's own type order, so each board keeps its own vocabulary.
  const deliveredRecords = deliveredSince(records, since)
  const throughputTypes = (() => {
    const seen = new Map<string, IssueType>()
    for (const record of deliveredRecords) {
      const type = typeFor(record.id)
      if (!seen.has(type.id)) seen.set(type.id, type)
    }
    return [...seen.values()].sort(
      (a, b) => (typeOrder.get(a.id) ?? 999) - (typeOrder.get(b.id) ?? 999) || a.name.localeCompare(b.name),
    )
  })()
  const weekTypeCounts = buckets.map((bucket) => {
    const counts = new Map<string, number>()
    for (const record of deliveredRecords) {
      if (record.resolvedAt !== undefined && record.resolvedAt > bucket - WEEK_MS && record.resolvedAt <= bucket) {
        const id = typeFor(record.id).id
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }
    }
    return counts
  })

  const serviceSample = serviceBasis === 'lead' ? leadTimes(deliveredRecords) : cycleTimes(deliveredRecords)
  const sle = serviceLevelOf(serviceSample, serviceShare)
  const openCommitted = openScope(records, now, false)
  // What the shared scope control would add: the cards still in play *because* they are in Backlog.
  const backlogCards = Math.max(0, openScope(records, now, true) - openCommitted)
  const remaining = openScope(records, now, includeBacklog)
  const scopeName = `${selectedFlow ? `the ${selectedFlow.name} flow` : 'all flows'}${
    selectedType ? ` (${selectedType.name} only)` : ''
  }`
  const forecast = forecastWhen(remaining, delivered, now)
  const atLeastCount = atLeast.trim() === '' ? remaining : Math.max(0, Math.min(remaining, Number(atLeast) || 0))
  const byDateAt = new Date(`${byDate}T12:00:00`).getTime()
  const by = forecastBy(remaining, delivered, now, byDateAt, { atLeast: atLeastCount })

  // The service level is read both ways: a confidence gives a duration, and a duration the reader
  // types gives back the share of the sample that finished within it.
  const serviceShareRounded = Math.round(serviceShare * 10) / 10
  const servicePreset = SERVICE_PRESETS.some((preset) => preset === serviceShareRounded)
  const showCustomShare = customShare || !servicePreset
  const serviceDayValue = sle.days === undefined ? '' : String(Math.round(sle.days * 10) / 10)
  const applyServiceDay = () => {
    if (dayDraft === null) return
    const value = Number(dayDraft)
    if (Number.isFinite(value) && value >= 0) {
      const share = shareWithinDays(serviceSample, value)
      if (share !== undefined) {
        setServiceShare(share)
        setCustomShare(!SERVICE_PRESETS.some((preset) => preset === Math.round(share)))
      }
    }
    setDayDraft(null)
  }
  // The scatter and the distribution are cycle-time charts, so the chosen line belongs on them
  // only when the reading is cycle time. A lead-time line on a cycle plot would compare two clocks.
  const serviceLine =
    serviceBasis === 'cycle' && sle.days !== undefined ? { share: sle.share, days: sle.days } : undefined

  // Each diagram has its own scale: a flow column is as tall as the most work the board carried at
  // a week's end, a throughput bar as tall as the busiest week in the window.
  const tallest = Math.max(1, ...flow.map((counts) => STAGES.reduce((sum, s) => sum + counts[s], 0)))
  const busiest = Math.max(1, ...delivered)

  const exportFlow = () => {
    const rows: FlowCsvRow[] = flowPoints.map((point) => ({
      title: point.title,
      type: typeNameOf(point.id),
      createdAt: point.createdAt,
      committedAt: point.committedAt,
      resolvedAt: point.resolvedAt,
      leadDays: point.lead,
      cycleDays: point.cycle,
    }))
    downloadText(
      csvFilename(
        `${board?.name ?? 'board'}${selectedFlow ? ` ${selectedFlow.name}` : ''}${selectedType ? ` ${selectedType.name}` : ''}`,
        'flow',
      ),
      flowCsv(rows),
    )
  }

  return (
    <div data-flow-view className="flex h-full min-h-0 flex-col overflow-auto bg-slate-200 p-4">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-3 rounded-lg border border-slate-300 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 pt-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1 text-micro font-bold uppercase tracking-wide text-slate-500">
                <TrendingUp size={12} /> Flow
              </div>
              <div className="text-heading font-semibold text-slate-900">{board?.name ?? 'Board'}</div>
              <div className="mt-0.5 text-micro text-slate-500">
                Read from the cards' own moves{selectedFlow ? ` · ${selectedFlow.name}` : ''}{selectedType ? ` · ${selectedType.name}` : ''}
              </div>
              <div data-flow-history className="mt-1 flex flex-wrap items-center gap-x-1.5 text-micro text-slate-500">
                {firstMove === undefined ? (
                  'No moves recorded yet. The history starts with the first move.'
                ) : (
                  <>
                    <span>Moves recorded since {shortDate(firstMove)}</span>
                    <span aria-hidden>·</span>
                    <span
                      title={
                        coverage.total > coverage.withMoves
                          ? 'The rest have no history and start where they sit.'
                          : undefined
                      }
                    >
                      {coverage.withMoves} of {coverage.total} cards have move history
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Four readings in four equal columns. The strip used to size itself to its
                contents, so a number gaining a digit or a sample note gaining "thin sample"
                moved the block — and a narrow card broke it into an uneven wrap, with the last
                reading alone on a second row. Equal tracks mean the figures change inside
                their cells and the card's shape does not: two columns when the card is narrow,
                four when there is room, notes wrapping within their own cell. */}
            <div className="ml-auto grid w-full min-w-0 shrink grid-cols-2 gap-x-6 gap-y-2 rounded-lg bg-slate-50/80 px-4 py-2 ring-1 ring-slate-200/70 sm:w-auto sm:basis-[34rem] sm:grid-cols-4">
              <Stat label="In flight" value={summary.inFlight} />
              <Stat label="Delivered" value={summary.delivered} tone="emerald" />
              <Stat
                label="Lead time"
                value={days(summary.lead.p50)}
                note={`p85 ${days(summary.lead.p85)} · p95 ${days(summary.lead.p95)} · ${summary.lead.n} cards${
                  summary.lead.n > 0 && summary.lead.n < MIN_SAMPLE ? ' · thin sample' : ''
                }`}
                hint="Created to done. p85 and p95 are the tail: that share finished within this long."
              />
              <Stat
                label="Cycle time"
                value={days(summary.cycle.p50)}
                note={`p85 ${days(summary.cycle.p85)} · p95 ${days(summary.cycle.p95)} · ${summary.cycle.n} cards${
                  summary.cycle.n > 0 && summary.cycle.n < MIN_SAMPLE ? ' · thin sample' : ''
                }`}
                hint="Leaving Backlog to done. p85 and p95 are the tail."
              />
            </div>
          </div>

          {/* The reading is part of the place: both controls write the URL, so a quarter of one
              flow can be sent to somebody rather than described over a call. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-2">
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
            {boardTypeChoices.length > 1 && (
              <label className="flex items-center gap-1.5 text-meta text-slate-600">
                Card type
                <select
                  aria-label="Card type"
                  value={selectedType?.id ?? ''}
                  onChange={(event) => setMetricsType(event.target.value || null)}
                  className="rounded border border-slate-200 bg-white px-1.5 py-1 text-meta text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300"
                >
                  <option value="">All card types</option>
                  {boardTypeChoices.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="ml-auto flex items-center gap-3">
              <span className="text-micro text-slate-500">In flight and delivered are as of now.</span>
              <button
                type="button"
                onClick={exportFlow}
                disabled={flowPoints.length === 0}
                title={
                  flowPoints.length === 0
                    ? 'Nothing delivered in this window.'
                    : 'Every card delivered in this window: dates, lead and cycle'
                }
                className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-micro font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-40"
              >
                <Download size={11} /> Export CSV
              </button>
            </div>
          </div>
        </div>

        {/* The definitions the charts depend on, before the charts that use them. A reader who
            only knows "lead" and "cycle" by name cannot tell which clock a number is on; four
            lines fix that without sending them to the docs. */}
        <Panel title="How times are measured" note="Calendar time between the moments the board records. Done means the card reached Done.">
          <dl data-flow-glossary className="grid gap-x-6 gap-y-2 text-meta text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="font-semibold text-slate-800">Created</dt>
              <dd>When the card was made.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Committed</dt>
              <dd>The first time it leaves Backlog. A card made into a committed column counts from its creation.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Lead time</dt>
              <dd>Created → Done, including any time it waited in Backlog.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Cycle time</dt>
              <dd>Committed → Done: the work after the card was taken on.</dd>
            </div>
          </dl>
        </Panel>

        {records.length === 0 ? (
          <div className="rounded-lg border border-slate-300 bg-white px-4 py-6 text-meta text-slate-600 shadow-sm">
            This board has no cards yet. Flow is read from the moves, so there is nothing to show.
          </div>
        ) : (
          <>
            <CycleScatter
              records={records}
              since={since}
              openItem={openItem}
              selectedItemId={selectedItemId}
              typeFor={typeFor}
              typeOrder={typeOrder}
              service={serviceLine}
              focusWeek={cycleWeekFocus}
            />

            <WeeklyCycleRange
              weeks={cycleByWeek(records, buckets)}
              cap={cycleCap}
              median={summary.cycle.p50}
              focus={cycleWeekFocus}
              onFocus={setCycleWeekFocus}
            />

            <CycleHistogram cycles={cycles} p50={summary.cycle.p50} p85={summary.cycle.p85} service={serviceLine} />

            <AgingWork
              records={records}
              now={now}
              placements={placements}
              boardId={boardId}
              laneOf={laneOf}
              lanes={lanes}
              items={items}
              issueTypes={issueTypes}
              p85={summary.cycle.p85}
              openItem={openItem}
            />

            <WipAging records={records} since={since} flowWindow={flowWindow} buckets={buckets} now={now} />

            <Panel
              title="Cumulative flow"
              note="Where the work stood at the end of each week. A rejected card shows as work moving back."
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
                                  backgroundColor: STAGE_STACK[stage],
                                  // A hairline between bands, so a thin stage stays a band rather
                                  // than dissolving into the one above it.
                                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.65)',
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
                    <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: STAGE_STACK[stage] }} />
                    {STAGE_LABELS[stage]}
                  </span>
                ))}
              </div>
            </Panel>

            <Panel
              title="Throughput"
              note={`Cards that reached Done in each week: delivery, not activity. ${deliveredTotal} in ${delivered.length} week${delivered.length === 1 ? '' : 's'}; the busiest week had ${Math.max(...delivered)}.`}
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
                        className="flex w-full flex-col-reverse overflow-hidden rounded-sm"
                        style={{ height: `${Math.max(3, (n / busiest) * 100)}%` }}
                        title={`${n} delivered in the week ending ${shortDate(buckets[i])}`}
                      >
                        {n === 0 ? (
                          <div className="h-full w-full bg-slate-200" />
                        ) : (
                          throughputTypes.map((type) => {
                            const count = weekTypeCounts[i].get(type.id) ?? 0
                            if (count === 0) return null
                            return (
                              <div
                                key={type.id}
                                data-throughput-type={type.id}
                                style={{ height: `${(count / n) * 100}%`, backgroundColor: type.color }}
                                title={`${count} ${type.name}${count === 1 ? '' : 's'} in the week ending ${shortDate(buckets[i])}`}
                              />
                            )
                          })
                        )}
                      </div>
                    </div>
                    <div className="truncate text-center text-micro text-slate-600">{shortDate(buckets[i])}</div>
                  </div>
                ))}
              </div>
              )}
              <TypeLegend types={throughputTypes} />
            </Panel>

            <FlowStability records={records} buckets={buckets} />

            {/* One planning row, not three stacked sections: the past reading (service level) sits
                beside the two questions about the future, and they share a window and a model. */}
            <Panel title="Planning" note="The same window and throughput, read three ways.">
              <div className="grid gap-3 lg:grid-cols-3">
                <section data-sle className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 lg:row-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-micro font-semibold uppercase tracking-wide text-slate-600">
                      Service level
                    </div>
                    <div className="flex items-center gap-1">
                      <select
                        aria-label="Service level share"
                        value={servicePreset ? String(serviceShareRounded) : 'custom'}
                        onChange={(event) => {
                          if (event.target.value === 'custom') {
                            setCustomShare(true)
                            return
                          }
                          setCustomShare(false)
                          setServiceShare(Number(event.target.value))
                        }}
                        className="rounded border border-slate-200 bg-white px-1 py-0.5 text-micro text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300"
                      >
                        {SERVICE_PRESETS.map((share) => (
                          <option key={share} value={share}>
                            {share}%
                          </option>
                        ))}
                        <option value="custom">Custom</option>
                      </select>
                      {showCustomShare && (
                        <input
                          type="number"
                          aria-label="Custom service level share"
                          min={1}
                          max={99}
                          step={1}
                          value={serviceShareRounded}
                          onChange={(event) => setServiceShare(Number(event.target.value))}
                          className="w-12 rounded border border-slate-200 bg-white px-1 py-0.5 text-micro text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                      )}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-micro text-slate-600">
                    <span>Measured</span>
                    <div
                      role="group"
                      aria-label="Service level basis"
                      className="inline-flex overflow-hidden rounded border border-slate-200 bg-white"
                    >
                      {(['cycle', 'lead'] as const).map((basis) => (
                        <button
                          key={basis}
                          type="button"
                          aria-pressed={serviceBasis === basis}
                          onClick={() => setServiceBasis(basis)}
                          className={cn(
                            'px-1.5 py-0.5 transition',
                            serviceBasis === basis ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50',
                          )}
                        >
                          {basis === 'cycle' ? 'Cycle' : 'Lead'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <input
                      type="number"
                      aria-label="Service level days"
                      data-sle-days
                      min={0}
                      step={0.5}
                      value={dayDraft ?? serviceDayValue}
                      placeholder="—"
                      onFocus={() => setDayDraft(serviceDayValue)}
                      onChange={(event) => setDayDraft(event.target.value)}
                      onBlur={applyServiceDay}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        applyServiceDay()
                      }}
                      className="w-20 rounded border border-slate-200 bg-white px-1 py-0.5 text-heading font-semibold tabular-nums text-slate-900 outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                    <span className="text-meta text-slate-600">days or less</span>
                  </div>
                  <div
                    data-sle-line
                    className="mt-1 text-micro text-slate-600"
                    title={
                      serviceBasis === 'lead'
                        ? 'Created to done, for the cards finished in this window'
                        : 'Leaving Backlog to done, for the cards finished in this window'
                    }
                  >
                    {sle.days === undefined
                      ? 'No cards finished in this window.'
                      : `${shareLabel(sle.share)} of the ${sle.n} card${sle.n === 1 ? '' : 's'} finished here took this long or less ${
                          serviceBasis === 'lead' ? 'from creation' : 'from leaving Backlog'
                        }.`}
                  </div>
                  <div className="mt-1 text-micro text-slate-500">
                    {serviceBasis === 'lead' ? 'Lead time: created → done.' : 'Cycle time: committed → done.'}{' '}
                    Type a duration to read the share, or choose a confidence to read the duration.
                  </div>
                  {sle.n > 0 && sle.n < MIN_SAMPLE && (
                    <div className="mt-1 inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-micro font-medium text-amber-800">
                      Thin sample
                    </div>
                  )}
                </section>

                {/* The scope of both forecast questions, above the two cards it decides. It used
                    to sit inside the first one, which made it look like that card's own setting —
                    but it changes the open count both answers are read from. Service level does
                    not read it, so it is not part of this bar. */}
                <div
                  data-forecast-scope
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 lg:col-span-2"
                >
                  <div className="min-w-0">
                    <div className="text-micro font-semibold uppercase tracking-wide text-slate-600">
                      Forecast scope
                    </div>
                    <p className="text-micro text-slate-600">
                      Both questions count the cards still in play in {scopeName}, excluding Backlog. Ticking
                      Backlog moves both answers and leaves the service level alone.
                    </p>
                  </div>
                  <label className="flex shrink-0 items-center gap-1.5 text-meta text-slate-700">
                    <input
                      type="checkbox"
                      checked={includeBacklog}
                      disabled={backlogCards === 0}
                      onChange={(event) => setIncludeBacklog(event.target.checked)}
                      title={
                        backlogCards === 0
                          ? 'Nothing is in Backlog to add.'
                          : `Count the ${backlogCards} uncommitted card${backlogCards === 1 ? '' : 's'} in Backlog in both questions`
                      }
                      className="accent-indigo-600 disabled:opacity-40"
                    />
                    {backlogCards === 0
                      ? 'No cards in Backlog'
                      : `Include ${backlogCards} card${backlogCards === 1 ? '' : 's'} in Backlog`}
                  </label>
                </div>

                <section data-forecast className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-micro font-semibold uppercase tracking-wide text-slate-600">
                      When all open cards are done
                    </div>
                  </div>
                  <div data-forecast-scope-line className="mt-0.5 text-micro text-slate-500">
                    {remaining} open card{remaining === 1 ? '' : 's'} in {scopeName} ·{' '}
                    {flowWindow === 'all' ? 'all recorded history' : `${flowWindow} weeks of history`}
                  </div>
                  <div
                    data-forecast-date={forecast.ok ? 'p85' : undefined}
                    className="mt-2 text-heading font-semibold tabular-nums text-slate-900"
                  >
                    {forecast.ok ? calendarDate(forecast.dates.p85) : '—'}
                  </div>
                  {forecast.ok ? (
                    <>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-micro text-slate-600">
                        <span>
                          50% <span data-forecast-date="p50">{calendarDate(forecast.dates.p50)}</span>
                        </span>
                        <span>
                          95% <span data-forecast-date="p95">{calendarDate(forecast.dates.p95)}</span>
                        </span>
                      </div>
                      <div className="mt-1 text-micro text-slate-500">
                        {forecast.trials.toLocaleString()} trials over {forecast.sampledWeeks} weeks.
                        Throughput is assumed weekly; dependencies are not modelled.
                      </div>
                    </>
                  ) : (
                    <p data-forecast-refusal className="mt-1 text-micro text-slate-600">
                      {forecastRefusal(forecast.reason, forecast.weeks, forecast.delivered)}
                    </p>
                  )}
                </section>

                <section data-forecast-by className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className="text-micro font-semibold uppercase tracking-wide text-slate-600">
                    Chance all open cards are done by a date
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-slate-600">
                    <input
                      type="date"
                      aria-label="Forecast date"
                      value={byDate}
                      onChange={(event) => setByDate(event.target.value)}
                      className="rounded border border-slate-200 bg-white px-1 py-0.5 text-micro text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                    <span>at least</span>
                    <input
                      type="number"
                      aria-label="At least cards"
                      min={0}
                      max={remaining}
                      value={atLeast}
                      placeholder={String(remaining)}
                      onChange={(event) => setAtLeast(event.target.value)}
                      className="w-12 rounded border border-slate-200 bg-white px-1 py-0.5 text-micro text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                  </div>
                  <div className="mt-2 text-heading font-semibold tabular-nums text-slate-900">
                    {by.ok ? `${Math.round(by.share * 100)}%` : '—'}
                  </div>
                  {by.ok ? (
                    <>
                      <div className="text-micro text-slate-500">
                        {by.atLeast === remaining
                          ? `chance all ${remaining} open card${remaining === 1 ? '' : 's'} are done by then`
                          : `chance of at least ${by.atLeast} of ${remaining} open card${remaining === 1 ? '' : 's'} by then`}
                      </div>
                      <div className="mt-1 text-micro text-slate-500">
                        50% {countAtMost(by.counts.p50)} · 85% {countAtMost(by.counts.p85)} · 95%{' '}
                        {countAtMost(by.counts.p95)}
                      </div>
                    </>
                  ) : (
                    <p data-forecast-by-refusal className="text-micro text-slate-600">
                      {by.reason === 'past-date'
                        ? 'Choose a date after today.'
                        : forecastRefusal(by.reason, by.weeks, by.delivered)}
                    </p>
                  )}
                </section>
              </div>
            </Panel>

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
function CycleHistogram({
  cycles,
  p50,
  p85,
  service,
}: {
  cycles: number[]
  p50?: number
  p85?: number
  service?: { share: number; days: number }
}) {
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
  const medianIndex = marker(p50)
  const p85Index = marker(p85)
  const serviceIndex = marker(service?.days)
  const serviceMarkerKind = service?.share === 85 ? 'p85' : 'service'

  return (
    <Panel
      title="Cycle time distribution"
      note={`Delivered cards in one-day buckets. Most finished in ${peakLabel}; the longest took ${days(longest)}.${
        cycles.length < MIN_SAMPLE ? ` Only ${cycles.length} card${cycles.length === 1 ? '' : 's'} — a thin sample.` : ''
      }`}
    >
      <div data-cycle-histogram className="relative">
        {/* The markers belong to the plot, not the axis: a 2px line through the labels would be
            a second chart. */}
        <div className="relative h-24">
        <div className="flex h-full items-end gap-px">
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
        {medianIndex !== undefined && service?.share !== 50 && (
          <span
            data-cycle-marker="p50"
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-slate-600 shadow-[0_0_0_1px_rgba(255,255,255,0.85)]"
            style={{ left: `${((medianIndex + 0.5) / buckets.length) * 100}%` }}
            title={`p50: ${days(p50)}`}
          />
        )}
        {serviceIndex !== undefined && service !== undefined ? (
          <span
            data-cycle-marker={serviceMarkerKind}
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-rose-600 shadow-[0_0_0_1px_rgba(255,255,255,0.85)]"
            style={{ left: `${((serviceIndex + 0.5) / buckets.length) * 100}%` }}
            title={`${shareLabel(service.share)} service level: ${days(service.days)}`}
          />
        ) : (
          p85Index !== undefined && (
            <span
              data-cycle-marker="p85"
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-rose-600 shadow-[0_0_0_1px_rgba(255,255,255,0.85)]"
              style={{ left: `${((p85Index + 0.5) / buckets.length) * 100}%` }}
              title={`p85: ${days(p85)}`}
            />
          )
        )}
        </div>
        <div className="mt-1 flex justify-between text-micro text-slate-600">
          <span>0d</span>
          <span>{buckets.length > 1 ? `${buckets[buckets.length - 1].tail ? `${buckets[buckets.length - 1].from}+` : `${buckets[buckets.length - 1].to - 1}`}d` : '1d'}</span>
        </div>
        <div className="mt-0.5 text-center text-micro text-slate-500">Calendar days</div>
        <div className="mt-0.5 flex flex-wrap gap-3 text-micro text-slate-600">
          {service === undefined ? (
            <>
              <span className="flex items-center gap-1">
                <span className="h-2 w-0.5 bg-slate-600" /> p50
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-0.5 bg-rose-600" /> p85
              </span>
            </>
          ) : (
            <>
              {service.share !== 50 && (
                <span className="flex items-center gap-1">
                  <span className="h-2 w-0.5 bg-slate-600" /> median
                </span>
              )}
              <span className="flex items-center gap-1">
                <span className="h-2 w-0.5 bg-rose-600" /> {shareLabel(service.share)} service level
              </span>
            </>
          )}
        </div>
      </div>

      <div className="mt-2 border-t border-slate-100 pt-2 text-micro text-slate-600">
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
 * The cycle-time shape of each week, under the scatter.
 *
 * The scatter shows every delivery; this shows whether the middle and the tail are moving together.
 * A week with fewer than MIN_SAMPLE deliveries is drawn faintly rather than as a confident box. The
 * panel is descriptive, with no trend line: a straight line over a week's cloud would promise more
 * than the history can.
 */
function WeeklyCycleRange({
  weeks,
  cap,
  median,
  focus,
  onFocus,
}: {
  weeks: CycleWeek[]
  cap: number
  median?: number
  focus: number | null
  onFocus: (at: number | null) => void
}) {
  const drawn = weeks.some((week) => week.n > 0)
  const labelEvery = Math.max(1, Math.ceil(weeks.length / 12))
  const clipped = weeks.filter((week) => week.max !== undefined && week.max > cap).length

  return (
    <Panel
      title="Cycle time by week"
      note={`Each week: the whisker is the range, the box the middle half, the line the median. The axis stops at p98 (${days(cap)})${
        clipped > 0 ? `, so ${clipped} week${clipped === 1 ? '' : 's'} draw at the top` : ''
      }. A week with fewer than ${MIN_SAMPLE} cards is faint. Click a week to pick it out on the scatter.`}
    >
      {!drawn ? (
        <div className="text-meta text-slate-600">No cards finished in this window.</div>
      ) : (
        <div data-cycle-week-range className="mt-5">
          <div className="flex gap-2">
            <div className="flex h-40 w-7 shrink-0 flex-col justify-between text-right text-micro tabular-nums text-slate-500">
              <span>{cap}d</span>
              <span>{Math.round(cap / 2)}d</span>
              <span>0d</span>
            </div>
            <div className="relative h-40 min-w-0 flex-1">
            <div className="flex h-full items-end gap-1">
              {weeks.map((week, index) => {
                const min = week.min === undefined ? 0 : Math.min(week.min, cap)
                const max = week.max === undefined ? 0 : Math.min(week.max, cap)
                return (
                  <button
                    key={week.at}
                    type="button"
                    data-cycle-week={week.at}
                    data-cycle-week-n={week.n}
                    aria-pressed={focus === week.at}
                    aria-label={`Week ending ${shortDate(week.at)}: ${week.n} card${week.n === 1 ? '' : 's'}${
                      week.p50 === undefined ? '' : `, median ${days(week.p50)}`
                    }`}
                    onClick={() => onFocus(focus === week.at ? null : week.at)}
                    className={cn(
                      'relative h-full min-w-0 flex-1 rounded-sm outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-400',
                      focus === week.at ? 'bg-indigo-50 ring-1 ring-indigo-300' : 'hover:bg-slate-50',
                    )}
                  >
                    {week.n > 0 && (
                      <>
                        <span
                          data-cycle-week-whisker
                          className="absolute left-1/2 w-px -translate-x-1/2 bg-slate-400"
                          style={{
                            bottom: `${(min / cap) * 100}%`,
                            height: `${Math.max(0, ((max - min) / cap) * 100)}%`,
                          }}
                        />
                        <span
                          data-cycle-week-cap
                          className="absolute left-1/2 h-px w-2.5 -translate-x-1/2 bg-slate-400"
                          style={{ bottom: `${(min / cap) * 100}%` }}
                        />
                        <span
                          data-cycle-week-cap
                          className="absolute left-1/2 h-px w-2.5 -translate-x-1/2 bg-slate-400"
                          style={{ bottom: `${(max / cap) * 100}%` }}
                        />
                        <span
                          data-cycle-week-box
                          className={cn(
                            'absolute left-1/2 w-3/5 -translate-x-1/2 rounded-sm bg-indigo-300/70',
                            week.n < MIN_SAMPLE && 'opacity-40',
                          )}
                          style={{
                            bottom: `${((week.p25 ?? 0) / cap) * 100}%`,
                            height: `${Math.max(1, (((week.p75 ?? 0) - (week.p25 ?? 0)) / cap) * 100)}%`,
                          }}
                        />
                        <span
                          data-cycle-week-median
                          className="absolute left-1/2 w-3/5 -translate-x-1/2 border-t-2 border-slate-700"
                          style={{ bottom: `${((week.p50 ?? 0) / cap) * 100}%` }}
                        />
                      </>
                    )}
                    {week.n > 0 && week.n < MIN_SAMPLE && (
                      <span
                        data-cycle-week-dot
                        className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500 opacity-50"
                        style={{ bottom: `${((week.p50 ?? 0) / cap) * 100}%` }}
                      />
                    )}
                    {week.n > 0 && (index % labelEvery === 0 || index === weeks.length - 1) && (
                      <span className="absolute inset-x-0 -top-4 text-center text-micro font-bold tabular-nums text-slate-600">
                        {week.n}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {median !== undefined && (
              <span
                data-cycle-week-overall
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-400"
                style={{ bottom: `${Math.min(100, (median / cap) * 100)}%` }}
              >
                <span className="absolute right-0 -top-2 bg-white px-1 text-micro tabular-nums text-slate-600">
                  median {days(median)}
                </span>
              </span>
            )}
            </div>
          </div>
          <div className="mt-1 flex gap-1 pl-9 text-micro text-slate-500">
            {weeks.map((week, index) => (
              <span key={week.at} className="min-w-0 flex-1 text-center">
                {index % labelEvery === 0 || index === weeks.length - 1 ? shortDate(week.at) : ''}
              </span>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-slate-600">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-indigo-300/70" /> middle half
            </span>
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-2 bg-slate-700" /> median
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-px bg-slate-400" /> range
            </span>
            {focus !== null && (
              <button
                type="button"
                onClick={() => onFocus(null)}
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-micro text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Clear week
              </button>
            )}
          </div>
          {weeks.some((week) => week.n > 0 && week.n < MIN_SAMPLE) && (
            <div className="mt-1 text-micro text-slate-500">
              Faint weeks have fewer than {MIN_SAMPLE} delivered cards.
            </div>
          )}

          <details data-cycle-week-details className="mt-2 border-t border-slate-100 pt-2 text-micro text-slate-600">
            <summary className="cursor-pointer select-none">All {weeks.length} weeks</summary>
            <table data-cycle-week-table className="mt-1 w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 uppercase tracking-wide text-slate-600">
                  <th className="py-1 pr-2 font-semibold">Week</th>
                  <th className="px-1 py-1 text-right font-semibold">Cards</th>
                  <th className="px-1 py-1 text-right font-semibold">Min</th>
                  <th className="px-1 py-1 text-right font-semibold">p25</th>
                  <th className="px-1 py-1 text-right font-semibold">Median</th>
                  <th className="px-1 py-1 text-right font-semibold">p75</th>
                  <th className="px-1 py-1 text-right font-semibold">Max</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr key={week.at} className="border-b border-slate-100 last:border-0">
                    <td className="py-1 pr-2">{shortDate(week.at)}</td>
                    <td className="px-1 py-1 text-right tabular-nums">{week.n}</td>
                    {([week.min, week.p25, week.p50, week.p75, week.max] as (number | undefined)[]).map(
                      (value, index) => (
                        <td key={index} className="px-1 py-1 text-right tabular-nums">
                          {value === undefined ? '—' : days(value)}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </Panel>
  )
}

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
  laneOf,
  lanes,
  items,
  issueTypes,
  p85,
  openItem,
}: {
  records: FlowRecord[]
  now: number
  placements: ReturnType<typeof useStore.getState>['placements']
  boardId: string
  laneOf: Map<string, string>
  lanes: ReturnType<typeof useStore.getState>['lanes']
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
  const allAged = aging(records, now, (record) => entered.get(record.id))
  // Backlog is inventory, not work in flight, so it is off until asked for. The other two are the
  // committed stages, and Done is never here: delivering is what leaves the aging list.
  const [stages, setStages] = useState<ReadonlySet<Stage>>(() => new Set<Stage>(['notStarted', 'inProgress']))
  const toggleStage = (stage: Stage) =>
    setStages((current) => {
      const next = new Set(current)
      if (next.has(stage)) next.delete(stage)
      else next.add(stage)
      return next
    })
  const aged = allAged.filter((entry) => stages.has(entry.stage))
  const shown = aged.slice(0, MAX_AGING_ROWS)
  const itemById = new Map(items.map((item) => [item.id, item]))
  const typeById = new Map(issueTypes.map((type) => [type.id, type]))
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]))
  const tallest = Math.max(1, p85 ?? 1, ...aged.map((entry) => entry.daysSinceCommit ?? entry.daysInColumn))

  return (
    <Panel
      title="Aging work"
      note="Open cards, oldest commitment first. Past the p85 line, a card has been in flight longer than 85% of what this window delivered."
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-slate-600">
        <span className="font-semibold uppercase tracking-wide">Columns</span>
        {(['backlog', 'notStarted', 'inProgress'] as const).map((stage) => (
          <label key={stage} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={stages.has(stage)}
              onChange={() => toggleStage(stage)}
              className="accent-indigo-600"
            />
            {STAGE_LABELS[stage]}
          </label>
        ))}
      </div>
      {allAged.length === 0 ? (
        <div className="text-meta text-slate-600">No work in flight.</div>
      ) : aged.length === 0 ? (
        <div className="text-meta text-slate-600">No cards in the selected columns.</div>
      ) : (
        <>
          <div
            data-flow-aging
            className="-mx-4 -mb-3 mt-1 overflow-hidden rounded-b-lg border-t border-slate-200"
          >
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100 text-micro uppercase tracking-wide text-slate-600">
                  <th className="px-4 py-2 font-semibold">Card</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">In column</th>
                  <th className="px-4 py-2 text-right font-semibold">
                    Age
                    {p85 !== undefined && (
                      <span className="ml-1 font-normal normal-case text-slate-600">· p85 {days(p85)}</span>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((entry) => {
                  const item = itemById.get(entry.id)
                  const type = item ? typeById.get(item.typeId) : undefined
                  const lane = laneById.get(laneOf.get(entry.id) ?? '')
                  const column = lane?.name?.trim() || STAGE_LABELS[entry.stage]
                  const age = entry.daysSinceCommit ?? entry.daysInColumn
                  return (
                    <tr
                      key={entry.id}
                      data-flow-aging-row
                      data-card-id={entry.id}
                      onClick={() => openItem(entry.id)}
                      className="cursor-pointer border-b border-slate-100 transition last:border-0 hover:bg-slate-50"
                    >
                      <td className="max-w-[340px] px-4 py-2.5">
                        <span
                          className="inline-flex items-center rounded px-1 py-px text-micro font-bold uppercase tracking-wide"
                          style={chipColors(type?.color ?? '#64748b')}
                        >
                          {type?.name ?? 'No type'}
                        </span>
                        <button
                          type="button"
                          data-flow-aging-title
                          onClick={(event) => {
                            event.stopPropagation()
                            openItem(entry.id)
                          }}
                          className="mt-0.5 block w-full truncate text-left text-body font-medium text-slate-800 transition hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                        >
                          {entry.title}
                        </button>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            'inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-micro font-bold',
                            STAGE_PILL[entry.stage],
                          )}
                        >
                          {STAGE_LABELS[entry.stage]}
                        </span>
                      </td>
                      <td className="max-w-[160px] truncate px-4 py-2.5 text-meta text-slate-600">{column}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          <span className="relative h-2 w-40 shrink-0 rounded bg-slate-100">
                            <span
                              className="absolute inset-y-0 left-0 rounded bg-indigo-400"
                              style={{ width: `${Math.min(100, (age / tallest) * 100)}%` }}
                            />
                            {p85 !== undefined && (
                              <span
                                data-aging-p85
                                className="absolute inset-y-[-2px] w-0.5 bg-rose-600 shadow-[0_0_0_1px_rgba(255,255,255,0.85)]"
                                style={{ left: `${Math.min(100, (p85 / tallest) * 100)}%` }}
                                title={`Cycle p85: ${days(p85)}`}
                              />
                            )}
                          </span>
                          <span className="w-12 shrink-0 text-right text-meta tabular-nums text-slate-700">
                            {days(age)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
 * Started versus finished each week, with the stability reading that follows.
 *
 * The Throughput panel above answers how much was delivered; this answers whether the team is
 * finishing what it starts and whether the pace is even. A quiet week is left out of the sample
 * rather than counted as a success. The reading is descriptive: no target, no grade.
 */
function FlowStability({ records, buckets }: { records: FlowRecord[]; buckets: number[] }) {
  const stability = throughputStability(records, buckets)
  const { started, completed, net } = stability
  const maxAbs = Math.max(1, ...net.map((value) => Math.abs(value)))
  const startedTotal = started.reduce((sum, value) => sum + value, 0)
  const completedTotal = completed.reduce((sum, value) => sum + value, 0)
  const netTotal = completedTotal - startedTotal
  const empty = stability.weeksWithMovement === 0
  const showNetValues = buckets.length <= 26

  return (
    <Panel
      title="Flow stability"
      note="Net flow each week: finished minus started. A week counts toward predictability only when something moved."
    >
      {empty ? (
        <div className="text-meta text-slate-600">No work started or finished in this window.</div>
      ) : (
        <div data-flow-stability>
          <div data-flow-net className="mt-1 flex gap-2">
            <div className="flex h-24 w-7 shrink-0 flex-col justify-between text-right text-micro tabular-nums text-slate-500">
              <span>+{maxAbs}</span>
              <span>0</span>
              <span>-{maxAbs}</span>
            </div>
            <div className="relative flex h-24 flex-1 items-stretch gap-2">
              <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-slate-300" />
              {net.map((value, index) => (
                <div
                  key={buckets[index]}
                  data-stability-net={value}
                  className="relative flex h-full min-w-0 flex-1"
                  title={`Week ending ${shortDate(buckets[index])}: ${started[index]} started, ${completed[index]} finished, net ${
                    value >= 0 ? '+' : ''
                  }${value}`}
                >
                  {value > 0 && (
                    <span
                      className="absolute bottom-1/2 left-1/2 w-4 max-w-full -translate-x-1/2 rounded-t-sm bg-emerald-500"
                      style={{ height: `${(value / maxAbs) * 50}%` }}
                    />
                  )}
                  {value < 0 && (
                    <span
                      className="absolute left-1/2 top-1/2 w-4 max-w-full -translate-x-1/2 rounded-b-sm bg-rose-400"
                      style={{ height: `${(Math.abs(value) / maxAbs) * 50}%` }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          {showNetValues && (
            <div className="mt-1 flex gap-2 text-micro tabular-nums">
              <span className="w-7 shrink-0 text-right text-slate-500">net</span>
              {net.map((value, index) => (
                <span
                  key={buckets[index]}
                  className={cn(
                    'min-w-0 flex-1 text-center font-semibold',
                    value > 0 ? 'text-emerald-700' : value < 0 ? 'text-rose-700' : 'text-slate-400',
                  )}
                >
                  {value > 0 ? '+' : ''}
                  {value}
                </span>
              ))}
            </div>
          )}
          <div className="mt-1 flex justify-between text-micro text-slate-500">
            <span>{shortDate(buckets[0])}</span>
            <span>{shortDate(buckets[buckets.length - 1])}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-slate-600">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-emerald-500" /> above the line: clearing
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-rose-400" /> below: accumulating
            </span>
            <span data-stability-summary>
              {stability.completedAtLeastStarted} of {stability.weeksWithMovement} week
              {stability.weeksWithMovement === 1 ? '' : 's'} with movement finished at least as much as
              they started.
            </span>
          </div>
          <div className="mt-1 text-micro text-slate-500">
            Net flow over the window: {netTotal >= 0 ? '+' : ''}
            {netTotal} ({completedTotal} finished, {startedTotal} started). Throughput per week: median{' '}
            {stability.median ?? '—'} · p85 {stability.p85 ?? '—'} · min {stability.min ?? '—'} · max{' '}
            {stability.max ?? '—'} · mean {stability.mean.toFixed(1)}.
          </div>
        </div>
      )}
    </Panel>
  )
}

/**
 * Work in flight at each day of the window, split by age since commitment.
 *
 * The aging table answers "what is old right now"; this is the same clock over time, so a rising
 * pile of old work is visible before it becomes a row somebody has to notice. Backlog is inventory,
 * not in flight, and Done or filed work has left the flow. The 12-week window is drawn daily;
 * longer windows are drawn weekly so the columns stay readable.
 */
function WipAging({
  records,
  since,
  flowWindow,
  buckets,
  now,
}: {
  records: FlowRecord[]
  since: number | undefined
  flowWindow: FlowWindow
  buckets: number[]
  now: number
}) {
  const daily = since !== undefined && flowWindow !== 'all' && flowWindow <= 12
  const grain = daily ? 'day' : 'week'
  const boundaries = daily && since !== undefined ? dailyBuckets(since, now) : buckets
  const points = wipAgeSeries(records, boundaries)
  const totals = points.map((point) => point.total)
  const tallest = Math.max(1, ...totals)
  const average = points.length === 0 ? 0 : totals.reduce((sum, n) => sum + n, 0) / points.length
  const empty = totals.every((total) => total === 0)
  const labelEvery = Math.max(1, Math.ceil(points.length / 12))
  const middle = points[Math.floor((points.length - 1) / 2)]

  return (
    <Panel
      title="WIP and age"
      note={`Work in flight, aged from commitment. ${
        grain === 'day' ? 'Each column is a day' : 'Each column is a week'
      }; Backlog, Done and filed work are not counted.`}
    >
      {empty ? (
        <div className="text-meta text-slate-600">No work was in flight in this window.</div>
      ) : (
        <>
          <div data-wip-age data-wip-age-grain={grain} className="relative">
            <div className="flex gap-px text-center text-micro font-bold tabular-nums text-slate-600">
              {points.map((point, index) => (
                <div key={point.at} className="min-w-0 flex-1">
                  {index % labelEvery === 0 || index === points.length - 1 ? point.total : ''}
                </div>
              ))}
            </div>
            <div className="relative mt-1 h-36">
              <div className="flex h-full items-end gap-px">
                {points.map((point) => (
                  <div
                    key={point.at}
                    data-wip-age-column
                    className="flex h-full min-w-0 flex-1 flex-col justify-end"
                    title={`${shortDate(point.at)}: ${point.total} in flight · ${WIP_AGE_ORDER.map(
                      (bucket) => `${WIP_AGE_LABELS[bucket]} ${point.counts[bucket]}`,
                    ).join(' · ')}`}
                  >
                    {point.total > 0 &&
                      WIP_AGE_ORDER.map((bucket) =>
                        point.counts[bucket] === 0 ? null : (
                          <div
                            key={bucket}
                            data-wip-age-bucket={bucket}
                            style={{
                              height: `${(point.counts[bucket] / tallest) * 100}%`,
                              backgroundColor: WIP_AGE_ACCENTS[bucket],
                            }}
                          />
                        ),
                      )}
                  </div>
                ))}
              </div>
              {average > 0 && (
                <span
                  data-wip-age-average
                  className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-500"
                  style={{ bottom: `${(average / tallest) * 100}%` }}
                >
                  <span className="absolute right-0 -top-2 bg-white px-1 text-micro tabular-nums text-slate-600">
                    avg {average.toFixed(1)}
                  </span>
                </span>
              )}
            </div>
            <div className="mt-1 flex justify-between text-micro text-slate-500">
              <span>{shortDate(points[0].at)}</span>
              {middle && middle !== points[0] && middle !== points[points.length - 1] && (
                <span>{shortDate(middle.at)}</span>
              )}
              <span>{shortDate(points[points.length - 1].at)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-slate-600">
              {WIP_AGE_ORDER.map((bucket) => (
                <span key={bucket} className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: WIP_AGE_ACCENTS[bucket] }} />
                  {WIP_AGE_LABELS[bucket]}
                </span>
              ))}
            </div>
          </div>

          <details data-wip-age-details className="mt-2 border-t border-slate-100 pt-2 text-micro text-slate-600">
            <summary className="cursor-pointer select-none">All {points.length} {grain}{points.length === 1 ? '' : 's'}</summary>
            <table data-wip-age-table className="mt-1 w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 uppercase tracking-wide text-slate-600">
                  <th className="py-1 pr-2 font-semibold">{grain === 'day' ? 'Day' : 'Week'}</th>
                  {WIP_AGE_ORDER.map((bucket) => (
                    <th key={bucket} className="px-1 py-1 text-right font-semibold">
                      {WIP_AGE_LABELS[bucket]}
                    </th>
                  ))}
                  <th className="px-1 py-1 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.at} className="border-b border-slate-100 last:border-0">
                    <td className="py-1 pr-2">{shortDate(point.at)}</td>
                    {WIP_AGE_ORDER.map((bucket) => (
                      <td key={bucket} className="px-1 py-1 text-right tabular-nums">
                        {point.counts[bucket]}
                      </td>
                    ))}
                    <td className="px-1 py-1 text-right font-semibold tabular-nums">{point.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </Panel>
  )
}

/**
 * Cycle time against the date work was delivered.
 *
 * One dot per card, so the shape and the outliers are visible rather than collapsed into a median.
 * The y axis stops at the 98th percentile: a handful of very long cards would otherwise squash the
 * bulk into a thin band. Cards above the cap are still drawn — at the top, in the tail colour — and
 * their real value is in the tooltip; the CSV export carries every card. The percentile lines are
 * calculated from every card in the window, not from what the axis happens to show.
 */
function CycleScatter({
  records,
  since,
  openItem,
  selectedItemId,
  typeFor,
  typeOrder,
  service,
  focusWeek,
}: {
  records: FlowRecord[]
  since: number | undefined
  openItem: (id: string | null) => void
  selectedItemId: string | null
  typeFor: (id: string) => IssueType
  typeOrder: Map<string, number>
  service?: { share: number; days: number }
  focusWeek: number | null
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ point: ScatterPoint; left: number; top: number; below: boolean } | null>(null)
  const points = scatterPoints(records, since)
  if (points.length === 0) {
    return (
      <Panel title="Cycle time by delivery" note="One dot per delivered card in the window.">
        <div className="text-meta text-slate-600">
          Nothing finished in this window. Widen it, or move a card to Done.
        </div>
      </Panel>
    )
  }

  const stats = sampleStats(points.map((point) => point.cycle))
  const types = [
    ...new Map(
      points.map((point) => {
        const type = typeFor(point.id)
        return [type.id, type] as const
      }),
    ).values(),
  ].sort(
    (a, b) => (typeOrder.get(a.id) ?? 999) - (typeOrder.get(b.id) ?? 999) || a.name.localeCompare(b.name),
  )
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
  const lines: { label: string; value: number; service: boolean }[] = service
    ? [
        ...(stats.p50 !== undefined && service.share !== 50
          ? [{ label: 'p50', value: stats.p50, service: false }]
          : []),
        { label: shareLabel(service.share), value: service.days, service: true },
      ]
    : [
        { label: 'p50', value: stats.p50 },
        { label: 'p85', value: stats.p85 },
        { label: 'p95', value: stats.p95 },
      ].flatMap((line) => (line.value === undefined ? [] : [{ ...line, value: line.value, service: false }]))

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
        above > 0 ? `, so ${above} card${above === 1 ? '' : 's'} sit on the top line` : ''
      }. ${
        service
          ? 'The rose line is the chosen service level; the grey line is the median. Both use every card.'
          : 'The percentile lines use every card.'
      }${
        points.length < MIN_SAMPLE ? ` Only ${points.length} delivered card${points.length === 1 ? '' : 's'} — read the lines as a hint.` : ''
      }`}
    >
      {focusWeek !== null && (
        <div data-scatter-focus className="mb-1 text-micro text-slate-600">
          Week ending {shortDate(focusWeek)} is picked out; the rest of the window stays as context.
        </div>
      )}
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
          <g key={line.label} data-scatter-line={line.service ? 'service' : undefined}>
            <line
              x1={plot.left}
              x2={plot.right}
              y1={y(line.value)}
              y2={y(line.value)}
              stroke={line.service ? '#e11d48' : '#94a3b8'}
              strokeWidth={line.service ? 1.5 : 1}
              strokeDasharray={line.service ? undefined : '4 3'}
            />
            <text
              x={plot.right}
              y={y(line.value) - 3}
              textAnchor="end"
              fontSize={9}
              fill={line.service ? '#be123c' : '#64748b'}
            >
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
            aria-label={`${point.title} (${typeFor(point.id).name}): ${days(point.cycle)} cycle time, delivered ${shortDate(point.resolvedAt)}`}
            style={{ fill: typeFor(point.id).color }}
            className={cn(
              'cursor-pointer transition-opacity hover:opacity-75 focus:outline-none focus-visible:stroke-2 focus-visible:stroke-slate-900',
              // The tail keeps a rose ring rather than a rose fill: the type is the colour now.
              point.cycle > cap && 'stroke-rose-500 stroke-2',
              selectedItemId === point.id && 'stroke-2 stroke-slate-900',
              // A picked week stays fully drawn; the rest of the window is quiet context.
              focusWeek !== null &&
                !(point.resolvedAt > focusWeek - WEEK_MS && point.resolvedAt <= focusWeek) &&
                'opacity-20',
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
            {typeFor(hover.point.id).name} · delivered {shortDate(hover.point.resolvedAt)}
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
      <TypeLegend types={types} />
    </Panel>
  )
}

/**
 * Who a colour belongs to. Both charts colour by card type, and a type's colour is the board's
 * own vocabulary — so the legend names every type the reading contains rather than assuming a
 * fixed palette. Text, not colour alone: the name is what a reader can rely on.
 */
function TypeLegend({ types }: { types: IssueType[] }) {
  if (types.length === 0) return null
  return (
    <div data-flow-type-legend className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-slate-600">
      {types.map((type) => (
        <span key={type.id} className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: type.color }} />
          {type.name}
        </span>
      ))}
    </div>
  )
}

const countAtMost = (value: number | undefined) => (value === undefined ? '—' : String(Math.round(value)))

/** The same refusal sentence wherever a forecast is refused, so the two panels cannot disagree. */
function forecastRefusal(
  reason: 'no-scope' | 'no-throughput' | 'thin-history',
  weeks: number,
  delivered: number,
): string {
  if (reason === 'no-scope') return 'No open work in this scope.'
  if (reason === 'no-throughput') return 'No deliveries in this window.'
  return `Not enough history: ${weeks} week${weeks === 1 ? '' : 's'} and ${delivered} delivered. Needs ${MIN_FORECAST_WEEKS} weeks and ${MIN_FORECAST_DELIVERED} cards.`
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
    <div data-flow-stat={label} title={hint} className="min-w-0">
      <div className="text-micro uppercase tracking-wide text-slate-600">{label}</div>
      <div data-flow-stat-value className={cn('text-title font-semibold tabular-nums', tone === 'emerald' ? 'text-emerald-700' : 'text-slate-800')}>
        {value}
      </div>
      {/* The note wraps inside its own column: a longer sample line makes the strip taller,
          never wider. */}
      {note && <div className="text-micro leading-tight text-slate-600">{note}</div>}
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
