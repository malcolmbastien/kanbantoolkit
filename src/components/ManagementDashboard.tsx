import { useEffect, useState } from 'react'
import {
  AlarmClock,
  CalendarClock,
  CircleAlert,
  CircleDashed,
  Download,
  Flag,
  Layers,
  SquareArrowOutUpRight,
  Target,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { BAND_STYLES } from './BandBadge'
import { blockedBelow, decompositionChildren, rollupOf, type Graph } from '@/domain/derive'
import { boardInitiatives, initiativeTypeById, tagsOf } from '@/domain/board'
import { ATTENTION_TILES, boardAttention, type AttentionKey } from '@/domain/attention'
import { HEALTH_META, initiativeHealth } from '@/domain/health'
import { csvFilename, dashboardCsv } from '@/domain/csv'
import { STAGE_LABELS, subtreeIds, topLevelLanes } from '@/domain/lanes'
import { laneAges, medianOf, STALE_AFTER_DAYS } from '@/domain/filters'
import { BAND_ACCENT, FLAG_BADGE, FLAG_BADGE_SHAPE, STAGE_COLOR, stageChip } from '@/lib/colors'
import { downloadText } from '@/lib/download'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import type { IssueType, Stage } from '@/domain/types'
import { cardsFlows } from '@/domain/flows'

const barColor = (pct: number) => (pct >= 100 ? '#10b981' : pct > 0 ? '#6366f1' : '#cbd5e1')

/** Each tile's mark, and the accent it reads in. Only overdue and stale raise their voice. */
const ATTENTION_ICON: Record<AttentionKey, LucideIcon> = {
  unfinished: CircleDashed,
  overdue: CircleAlert,
  stale: AlarmClock,
  unassigned: UserRound,
  noPriority: Flag,
}

const ATTENTION_ACCENT: Record<AttentionKey, string> = {
  unfinished: 'text-slate-500',
  overdue: 'text-rose-600',
  stale: 'text-amber-600',
  unassigned: 'text-slate-500',
  noPriority: 'text-slate-500',
}

const ATTENTION_HINT: Record<AttentionKey, string> = {
  unfinished: 'Every unfinished item on this board — the population each count below is taken from',
  overdue: 'Past its target date and not done',
  stale: `Committed work past ${STALE_AFTER_DAYS} days in its lane with nothing moving`,
  unassigned: 'Nobody is assigned to it',
  noPriority: 'No priority is set',
}

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
  const flows = useStore((s) => s.flows)
  const issueTypes = useStore((s) => s.issueTypes)
  const boards = useStore((s) => s.boards)
  const openItem = useStore((s) => s.openItem)
  const setView = useStore((s) => s.setView)
  const selectedItemId = useStore((s) => s.selectedItemId)
  // Narrowing the review list is view state: it never touches the board's saved filters, and it
  // belongs to this board, so switching boards starts from "all signals" again.
  const [attentionFilter, setAttentionFilter] = useState<AttentionKey | null>(null)
  useEffect(() => setAttentionFilter(null), [boardId])

  const graph: Graph = { items, edges, links, placements, lanes }
  // The cards workflow's columns, each reading how long its work has sat still — derived
  // from the placements' lane stamps, never stored, never acting on anything.
  const done = new Set(items.filter((i) => i.archived).map((i) => i.id))
  const boardPlacements = placements.filter((p) => p.boardId === boardId && !done.has(p.itemId))
  // One group per cards flow: "Backlog" is only half an answer when a board carries several, and a
  // dashboard that read only the first would hide the rest of the board's work.
  const flowColumns = cardsFlows(flows, boardId).map((flow) => ({
    flow,
    columns: topLevelLanes(lanes, flow.id).map((c) => {
      const ids = new Set(subtreeIds(lanes, c.id))
      const cards = boardPlacements.filter((p) => ids.has(p.laneId)).length
      const ages = laneAges(lanes, boardPlacements, c.id)
      return { lane: c, cards, oldest: ages.length ? Math.max(...ages) : undefined, median: medianOf(ages) }
    }),
  }))
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

  // The dashboard's first question — what is at risk of being forgotten — read from the work the
  // board renders. Team boards read their cards; coordination boards read their own initiatives.
  const attention = boardAttention(graph, boardId, issueTypes, flows, { boards })
  const signalRows = attention.rows.filter((r) => r.signals.length > 0)
  const attentionTiles = ATTENTION_TILES
  const visibleRows =
    attentionFilter === null
      ? signalRows
      : attentionFilter === 'unfinished'
        ? attention.rows
        : attention.rows.filter((r) => r.signals.some((s) => s.key === attentionFilter))
  // The summary is what ties the tiles to the table: it says, in words, what the selection is
  // currently doing — and it is announced when the selection changes.
  const activeTileLabel = ATTENTION_TILES.find((tile) => tile.key === attentionFilter)?.label ?? 'Signal'
  const attentionSummary =
    attentionFilter === null
      ? `${signalRows.length} item${signalRows.length === 1 ? '' : 's'} ${signalRows.length === 1 ? 'needs' : 'need'} a look`
      : attentionFilter === 'unfinished'
        ? `Unfinished · ${attention.rows.length} item${attention.rows.length === 1 ? '' : 's'}`
        : `${activeTileLabel} · ${visibleRows.length} of ${signalRows.length} item${signalRows.length === 1 ? '' : 's'}`

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
              onClick={() => downloadText(csvFilename(board?.name ?? 'board', 'initiatives'), dashboardCsv(rows, issueTypes))}
              className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-meta font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
              title="Export these initiative rows as a CSV file — progress, target dates, status and blocked work"
            >
              <Download size={11} /> Export CSV
            </button>
          </div>
        </div>

        {/* Time in column — the board's high-level shape: how many cards sit in each column,
            and how long they have been there. Laid out as the board itself: four cells, left to
            right, one per typed column. The count leads; the oldest age still speaks at the same
            staleness threshold the card's own aging cue does. */}
        <section className="mb-4">
          <div className="mb-2 flex flex-wrap items-end gap-x-4 gap-y-1">
            <div>
              <h2 className="text-heading font-semibold text-slate-800">Time in column</h2>
              <p className="text-meta text-slate-600">How many cards sit in each column, and how long they have been there.</p>
            </div>
            <span className="ml-auto text-meta text-slate-500">Stale after {STALE_AFTER_DAYS}+ days</span>
          </div>

          {flowColumns.length === 0 ? (
            <div className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-meta text-slate-600 shadow-sm">
              This board has no cards flow to read.
            </div>
          ) : (
            flowColumns.map(({ flow, columns }) => (
              <div key={flow.id} className="mb-3 last:mb-0">
                <h3 className="mb-1.5 text-meta font-bold uppercase tracking-wide text-slate-600">{flow.name}</h3>
                {columns.length === 0 ? (
                  <div className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-meta text-slate-600 shadow-sm">
                    This flow has no columns yet.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-slate-300 shadow-sm">
                    <div className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-4">
                      {columns.map(({ lane, cards, oldest, median }) => {
                        const stage = lane.stage ?? 'inProgress'
                        const name = lane.name || STAGE_LABELS[stage]
                        const stale = oldest !== undefined && oldest >= STALE_AFTER_DAYS
                        return (
                          <div key={lane.id} className="bg-white px-4 py-2.5">
                            <span className="flex items-center gap-1.5 text-meta text-slate-600">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: STAGE_COLOR[stage] }} />
                              <span className="truncate">{name}</span>
                            </span>
                            <div
                              className="mt-0.5 flex items-baseline gap-1.5"
                              title={`${cards} card${cards === 1 ? '' : 's'} in ${name}`}
                            >
                              <span
                                className={cn(
                                  'text-heading font-bold leading-none tabular-nums',
                                  cards === 0 ? 'text-slate-400' : 'text-slate-800',
                                )}
                              >
                                {cards}
                              </span>
                              <span className="text-micro text-slate-500">cards</span>
                            </div>
                            <div className="mt-1 flex items-center gap-1.5 text-micro text-slate-600">
                              <span
                                className={cn(stale && 'font-semibold text-amber-700')}
                                title={
                                  stale
                                    ? 'A card has sat still past the staleness threshold — the same moment a card starts showing its age'
                                    : undefined
                                }
                              >
                                oldest {daysLabel(oldest)}
                              </span>
                              <span className="text-slate-400">·</span>
                              <span>median {daysLabel(median)}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          <p className="mt-2 text-micro text-slate-600">
            Read from each placement's lane stamp — never stored on the item and never acting: nothing is auto-moved or
            flagged. The clock starts when a card enters its lane, so splitting a column re-stamps the cards it reshapes.
          </p>
        </section>

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
                    data-item-row={item.id}
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

        {/* Needs attention — the board's own first question, and the filter for the list below.
            Tiles and table share one card, so a number reads as a way into the items it counts
            rather than as a separate report. */}
        <section className="mb-4 mt-4">
          <div className="mb-2 flex flex-wrap items-end gap-x-4 gap-y-1">
            <div>
              <h2 className="text-heading font-semibold text-slate-800">Needs attention</h2>
              <p className="text-meta text-slate-600">Unfinished work on this board. Select a signal to filter the items below.</p>
            </div>
            <span className="ml-auto text-meta text-slate-500">Stale after {STALE_AFTER_DAYS}+ days</span>
          </div>

          {signalRows.length === 0 ? (
            <div className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-meta text-slate-600 shadow-sm">
              Nothing needs attention here — no unfinished item carries a signal.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
              <div
                className={cn(
                  'grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-3',
                  attentionTiles.length === 6 ? 'xl:grid-cols-6' : 'xl:grid-cols-5',
                )}
              >
                {attentionTiles.map((tile) => {
                  const Icon = ATTENTION_ICON[tile.key]
                  const active = attentionFilter === tile.key
                  const count = attention.counts[tile.key]
                  return (
                    <button
                      key={tile.key}
                      type="button"
                      aria-pressed={active}
                      title={ATTENTION_HINT[tile.key]}
                      onClick={() => setAttentionFilter(active ? null : tile.key)}
                      className={cn(
                        'flex flex-col items-start gap-0.5 bg-white px-4 py-2.5 text-left transition hover:bg-slate-50',
                        active && 'bg-slate-100 ring-2 ring-inset ring-slate-400',
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-meta text-slate-600">
                        <Icon size={13} className={ATTENTION_ACCENT[tile.key]} />
                        {tile.label}
                      </span>
                      <span
                        className={cn(
                          'text-heading font-bold leading-none tabular-nums',
                          count === 0 ? 'text-slate-400' : 'text-slate-800',
                        )}
                      >
                        {count}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* The line that makes the relationship explicit: the same card, and a summary
                  that says what the tiles are currently doing to the table beneath them. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-y border-slate-200 bg-slate-50 px-4 py-2">
                <span className="text-micro font-semibold uppercase tracking-wide text-slate-600">Items to review</span>
                <span className="text-meta text-slate-600" aria-live="polite" data-attention-summary>
                  {attentionSummary}
                </span>
                {attentionFilter && (
                  <button
                    type="button"
                    onClick={() => setAttentionFilter(null)}
                    className="ml-auto rounded border border-slate-300 bg-white px-2 py-0.5 text-micro font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
                  >
                    Clear filter
                  </button>
                )}
              </div>

              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-100 text-micro uppercase tracking-wide text-slate-600">
                    <th className="px-4 py-2 font-semibold">Item</th>
                    <th className="px-4 py-2 font-semibold">Status</th>
                    <th className="px-4 py-2 font-semibold">Age</th>
                    <th className="px-4 py-2 font-semibold">Signals</th>
                    <th className="w-16 px-2 py-2 font-semibold">
                      Open<span className="sr-only"> on board</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(({ item, status, ageDays: age, signals }) => {
                    const type = typeOf(item.typeId)
                    return (
                      <tr
                        key={item.id}
                        data-item-row={item.id}
                        onClick={() => openItem(item.id)}
                        className={cn(
                          'cursor-pointer border-b border-slate-100 transition last:border-0 hover:bg-slate-50',
                          selectedItemId === item.id && 'bg-indigo-50',
                        )}
                      >
                        <td className="max-w-[320px] px-4 py-2">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="shrink-0 rounded px-1 py-px text-micro font-bold uppercase tracking-wide"
                              style={{ backgroundColor: type.color, color: '#fff' }}
                            >
                              {type.name}
                            </span>
                            <span className="truncate text-body font-semibold text-slate-800" title={item.title}>
                              {item.title}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-meta text-slate-600">{status}</td>
                        <td
                          className="px-4 py-2 text-meta tabular-nums text-slate-600"
                          title={
                            age === undefined
                              ? 'This placement predates the lane stamp, so its age is unknown'
                              : `${age} days in its current lane`
                          }
                        >
                          {age === undefined ? '—' : `${age}d`}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap items-center gap-1">
                            {signals.length === 0 ? (
                              <span className="text-meta text-slate-400">—</span>
                            ) : (
                              signals.map((signal) => (
                                <span
                                  key={signal.key}
                                  title={signal.why}
                                  className={cn(FLAG_BADGE_SHAPE, FLAG_BADGE[signal.tone])}
                                >
                                  {signal.label}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="w-16 px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              setView('board')
                              openItem(item.id)
                            }}
                            title={`Open on ${board?.name ?? 'the board'}`}
                            aria-label={`Open ${item.title} on ${board?.name ?? 'the board'}`}
                            className="rounded p-1.5 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
                          >
                            <SquareArrowOutUpRight size={13} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-meta text-slate-600">
                        No item carries this signal.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
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
