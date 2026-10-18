import { ChartNoAxesGantt } from 'lucide-react'
import { Card } from './Card'
import { boardInitiatives } from '@/domain/board'
import { blockedBelow, checklistProgress, decompositionChildren, dependentsOf, isComplete, openDescendants, rollupOf, statusOf, uncommittedBelow, type Graph } from '@/domain/derive'
import { layoutTimeline } from '@/domain/timelineLayout'
import { parseDay } from '@/domain/filters'
import { STAGE_LABELS } from '@/domain/lanes'
import { useStore } from '@/store'
import { chipColors, STAGE_ACCENT } from '@/lib/colors'
import { cn } from '@/lib/utils'
import type { IssueType, Item } from '@/domain/types'

/** The chart's width per day. Fixed for now — zoom is out of scope for this slice. */
const DAY_PX = 28
/** The height of one row — the bar's band, and the label beside it. */
const ROW_PX = 56
/** The initiative column: every row's own name, frozen while the axis scrolls under it. */
const LABEL_PX = 224
/**
 * The axis's two bands, and their heights. The month band names the period; the day band is the
 * tick row. They are explicit rather than font-sized, because the initiative column's header has
 * to end exactly where the body begins or every label would sit beside the wrong bar.
 */
const MONTH_PX = 28
const DAY_ROW_PX = 22
const HEADER_PX = MONTH_PX + DAY_ROW_PX

/** A single day, read at a glance — the chart's own headers carry the year. */
const fmtDay = (iso: string): string => parseDay(iso)!.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** A span, precise about what it claims: the year appears when the span crosses one. */
const fmtRange = (fromIso: string, toIso: string): string => {
  const from = parseDay(fromIso)!
  const to = parseDay(toIso)!
  const day = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return from.getFullYear() === to.getFullYear()
    ? `${day(from)} \u2013 ${day(to)}, ${from.getFullYear()}`
    : `${day(from)}, ${from.getFullYear()} \u2013 ${day(to)}, ${to.getFullYear()}`
}

/**
 * The board's initiatives laid out over time.
 *
 * The same view idea as the dashboard — the board's initiatives, one computation — but
 * arranged by their target dates instead of listed. The geometry comes from the domain's
 * `layoutTimeline`; this surface only draws what it returns, so nothing here can invent a
 * date, a row or a colour. Read-only by design: no zoom, no drag-to-reschedule — moving a
 * date is a write, and writes belong to an explicit action.
 */
export function TimelineView({ boardId }: { boardId: string }) {
  const items = useStore((s) => s.items)
  const edges = useStore((s) => s.edges)
  const links = useStore((s) => s.links)
  const placements = useStore((s) => s.placements)
  const lanes = useStore((s) => s.lanes)
  const issueTypes = useStore((s) => s.issueTypes)
  const boards = useStore((s) => s.boards)
  const users = useStore((s) => s.users)
  const openItem = useStore((s) => s.openItem)

  const graph: Graph = { items, edges, links, placements, lanes }
  const typeOf = (typeId: string): IssueType =>
    issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }
  const board = boards.find((b) => b.id === boardId)
  const initiatives = boardInitiatives(graph, boardId, issueTypes)
  const layout = layoutTimeline(
    initiatives.map((i) => ({
      id: i.id,
      title: i.title,
      targetStartDate: i.targetStartDate,
      targetEndDate: i.targetEndDate,
      bucket: rollupOf(i.id, graph).bucket,
    })),
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-slate-200 p-4">
      <div className="mx-auto w-full">
        {/* Header — the board's name, and how much of its work has dates at all. */}
        <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div>
            <div className="flex items-center gap-1.5 text-meta font-bold uppercase tracking-wide text-slate-600">
              <ChartNoAxesGantt size={12} /> Timeline
            </div>
            <div className="text-heading font-semibold text-slate-800">{board?.name ?? 'Board'}</div>
          </div>
          <div className="ml-auto flex items-center gap-4 text-meta text-slate-600">
            <span>
              <span className="font-semibold text-slate-800">{initiatives.length}</span> initiatives
            </span>
            <span>
              <span className={cn('font-semibold', layout.unscheduled.length > 0 ? 'text-amber-700' : 'text-slate-800')}>
                {layout.unscheduled.length}
              </span>{' '}
              unscheduled
            </span>
          </div>
        </div>

        {initiatives.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-white p-10 shadow-sm">
            <div className="flex max-w-sm flex-col items-center gap-2 text-center">
              <ChartNoAxesGantt size={20} className="text-slate-400" />
              <h2 className="text-title font-semibold text-slate-800">No initiatives</h2>
              <p className="text-meta text-slate-600">This board has no initiatives to lay out over time.</p>
            </div>
          </div>
        ) : (
          <>
            {/* The chart. One fixed width per day, horizontally scrollable — the axis is as
                long as the work is, and nothing here zooms or drag-reschedules. The initiative
                column is frozen to the left: a bar scrolled off its own name is unreadable, so
                the name travels with the row. */}
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="relative flex" style={{ width: LABEL_PX + layout.totalDays * DAY_PX }}>
                {/* The initiative column — one row per scheduled initiative, in the layout's
                    own order, so every label sits beside its bar. */}
                <div
                  data-timeline-labels
                  className="sticky left-0 z-20 shrink-0 border-r border-slate-200 bg-white"
                  style={{ width: LABEL_PX }}
                >
                  <div
                    style={{ height: HEADER_PX }}
                    className="flex items-center border-b border-slate-200 px-2 text-meta font-bold uppercase tracking-wide text-slate-600"
                  >
                    Initiative
                  </div>
                  {layout.bars.map((bar) => {
                    const shown = bar.kind === 'span' ? fmtRange(bar.dateIso, bar.endIso!) : fmtDay(bar.dateIso)
                    return (
                      <div
                        key={bar.id}
                        data-timeline-label-id={bar.id}
                        title={`${bar.title} \u00b7 ${shown} \u00b7 ${STAGE_LABELS[bar.bucket]}`}
                        // The hairline under each row is the chart's own row separation — the
                        // same line the Initiative column draws, continued across the axis.
                        className="flex items-center gap-1.5 border-b border-slate-100 px-2"
                        style={{ height: ROW_PX }}
                      >
                        {/* The bucket is the work's, not a setting — so it is a dot here, the
                            same fact the bar's colour carries. */}
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: chipColors(STAGE_ACCENT[bar.bucket]).background }}
                        />
                        <button
                          type="button"
                          onClick={() => openItem(bar.id)}
                          className="min-w-0 flex-1 truncate text-left text-meta font-medium text-slate-800 hover:text-indigo-700"
                        >
                          {bar.title}
                        </button>
                        <span className="shrink-0 text-micro font-semibold tabular-nums text-slate-600" title="Rollup — share of leaf work done">
                          {rollupOf(bar.id, graph).percent}%
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* The axis: months over days, the days' own grid down the body, and the bars. */}
                <div className="relative shrink-0" style={{ width: layout.totalDays * DAY_PX }}>
                  {/* Period headers — whole calendar months, positioned by the layout. */}
                  <div className="flex border-b border-slate-200" style={{ height: MONTH_PX }}>
                    {layout.months.map((m) => (
                      <div
                        key={`${m.year}-${m.month}`}
                        data-timeline-month={`${m.year}-${m.month + 1}`}
                        style={{ width: m.days * DAY_PX }}
                        className="flex shrink-0 items-center truncate border-r border-slate-200 px-2 text-meta font-semibold text-slate-700 last:border-r-0"
                      >
                        {new Date(m.year, m.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                      </div>
                    ))}
                  </div>

                  {/* The tick row: a day number per column, weekends muted and the today column
                      named. Every tick is a day the domain actually contains, and its tooltip
                      spells the date out in full. */}
                  <div data-timeline-days className="flex border-b border-slate-200 bg-slate-50" style={{ height: DAY_ROW_PX }}>
                    {layout.days.map((d) => (
                      <div
                        key={d.offset}
                        data-timeline-day={d.dateIso}
                        title={fmtDay(d.dateIso)}
                        style={{ width: DAY_PX }}
                        className={cn(
                          'flex shrink-0 items-center justify-center border-r border-slate-100 text-micro tabular-nums',
                          // Weekends are muted by their band, never by a lighter grey: the
                          // number has to stay above the legibility floor to be readable at all.
                          d.weekend ? 'bg-slate-100 text-slate-600' : 'text-slate-600',
                          d.monthStart && 'border-l border-slate-300 font-semibold text-slate-800',
                          layout.today === d.offset && 'bg-rose-100 font-bold text-rose-700',
                        )}
                      >
                        {d.day}
                      </div>
                    ))}
                  </div>

                  {/* The body: the days' grid, then the row hairlines over it, then the bars.
                      One grid, not two textures — the rows are separated by the same hairline
                      the Initiative column draws, so both sides of the chart speak the same way.
                      Day columns go underneath so a row's line is never interrupted by a
                      weekend's fill. */}
                  <div className="relative" style={{ height: Math.max(layout.rowCount * ROW_PX, 96) }} data-timeline-body>
                    {/* A column per day, so a bar can be read against the numbers above it. The
                        weekends are the only fill left: they are the days a target usually does
                        not land on, and seeing them makes a span read as weeks. */}
                    {layout.days.map((d) => (
                      <div
                        key={d.offset}
                        className={cn('pointer-events-none absolute inset-y-0 border-r border-slate-100', d.weekend && 'bg-slate-50')}
                        style={{ left: d.offset * DAY_PX, width: DAY_PX }}
                      />
                    ))}
                    {Array.from({ length: layout.rowCount }, (_, r) => (
                      <div
                        key={r}
                        className="pointer-events-none absolute inset-x-0 border-b border-slate-100"
                        style={{ top: r * ROW_PX, height: ROW_PX }}
                      />
                    ))}

                  {/* Bars and milestones — position, row and colour straight from the layout.
                      The colour is the bucket the work beneath derived: a bar cannot claim a
                      stage it does not have, because nothing here accepts a setting. */}
                  {layout.bars.map((bar) => {
                    const chip = chipColors(STAGE_ACCENT[bar.bucket])
                    const shown = bar.kind === 'span' ? fmtRange(bar.dateIso, bar.endIso!) : fmtDay(bar.dateIso)
                    const label = `${bar.title} \u00b7 ${shown} \u00b7 ${STAGE_LABELS[bar.bucket]}`
                    return bar.kind === 'span' ? (
                      <button
                        key={bar.id}
                        data-timeline-bar-id={bar.id}
                        data-timeline-bucket={bar.bucket}
                        onClick={() => openItem(bar.id)}
                        title={label}
                        className="absolute flex items-center overflow-hidden rounded-md px-1.5 text-left shadow-sm transition hover:brightness-95"
                        style={{
                          left: bar.start * DAY_PX,
                          width: (bar.end - bar.start) * DAY_PX,
                          top: bar.row * ROW_PX + 10,
                          height: ROW_PX - 20,
                          background: chip.background,
                          color: chip.color,
                        }}
                      >
                        <span className="flex min-w-0 flex-col justify-center leading-tight">
                          <span className="truncate text-meta font-medium">{bar.title}</span>
                          <span className="truncate text-micro">{shown}</span>
                        </span>
                      </button>
                    ) : (
                      <button
                        key={bar.id}
                        data-timeline-milestone-id={bar.id}
                        data-timeline-bucket={bar.bucket}
                        onClick={() => openItem(bar.id)}
                        title={label}
                        className="group absolute flex items-center transition hover:brightness-95"
                        style={{ left: (bar.start + 0.5) * DAY_PX, top: bar.row * ROW_PX + 10, height: ROW_PX - 20 }}
                      >
                        {/* Three distinct marks, centred on the day: a hollow circle where the
                            work begins, a filled diamond where it is due, a filled dot for an
                            initiative that is a single day. */}
                        <span
                          data-timeline-milestone-from={bar.from}
                          className={cn(
                            'shrink-0 -translate-x-1/2 shadow-sm',
                            bar.from === 'end' && 'h-2.5 w-2.5 rotate-45 rounded-[2px] ring-1 ring-inset ring-slate-900/20',
                            bar.from === 'both' && 'h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-slate-900/20',
                            bar.from === 'start' && 'h-3 w-3 rounded-full border-[3px] bg-white',
                          )}
                          style={bar.from === 'start' ? { borderColor: chip.background } : { background: chip.background }}
                        />
                        <span className="ml-1 flex min-w-0 max-w-44 items-baseline">
                          <span className="truncate text-meta text-slate-700 group-hover:text-slate-900">{bar.title}</span>
                          <span className="shrink-0 text-micro text-slate-600">&nbsp;· {shown}</span>
                        </span>
                      </button>
                    )
                  })}

                  {layout.rowCount === 0 && (
                    <div className="flex h-full items-center justify-center px-4">
                      <p className="text-meta text-slate-600">
                        Nothing is dated yet — every initiative here is in the tray below.
                      </p>
                    </div>
                  )}
                </div>

                  {/* Today, drawn only when the domain actually contains it — the layout answers
                      that, so the marker can never point at an invented place. It spans the
                      axis, header included, and sits above the bars: the one date here that is
                      not a target must never be hidden by the work it cuts through. It starts
                      at the axis, not the card, because the initiative column is not a date. */}
                  {layout.today !== null && (
                    <>
                      <div
                        data-timeline-today
                        className="absolute inset-y-0 z-10 w-px bg-rose-500"
                        style={{ left: (layout.today + 0.5) * DAY_PX }}
                      />
                      <span
                        className="absolute top-0 z-10 -translate-x-1/2 rounded-b-md bg-rose-500 px-1.5 py-px text-micro font-bold uppercase tracking-wide text-white"
                        style={{ left: (layout.today + 0.5) * DAY_PX }}
                      >
                        Today
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* The unscheduled tray — a place, not a position: work with no target dates is
                never invented onto the axis. These are the same initiative cards the
                initiatives workflow draws, so the tray reads as work, not as buttons. */}
            {layout.unscheduled.length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <div className="text-meta font-semibold uppercase tracking-wide text-slate-600">Unscheduled — no target dates</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {layout.unscheduled.map((u) => {
                    const item = initiatives.find((i) => i.id === u.id)
                    if (!item) return null
                    const childItems = decompositionChildren(item.id, edges)
                      .map((id) => items.find((i) => i.id === id))
                      .filter((i): i is Item => Boolean(i))
                      .filter((i) => !i.archived)
                    const symbols = childItems.map((ci) => ({ id: ci.id, bucket: rollupOf(ci.id, graph).bucket, title: ci.title }))
                    return (
                      <div key={u.id} data-timeline-unscheduled={u.id} className="w-56 shrink-0">
                        <Card
                          item={item}
                          type={typeOf(item.typeId)}
                          wide
                          users={users}
                          symbols={symbols}
                          blockedTone="aggregate"
                          onOpen={openItem}
                          summary={{
                            childCount: decompositionChildren(item.id, edges).length,
                            dependentsCount: dependentsOf(item.id, graph).filter((d) => !statusOf(d.dependent.id, graph).resolved).length,
                            blockedBelow: blockedBelow(item.id, graph),
                            uncommittedBelow: uncommittedBelow(item.id, graph),
                            openDescendants: openDescendants(item.id, graph).length,
                            rollupPercent: rollupOf(item.id, graph).percent,
                            done: isComplete(item.id, graph),
                            checklist: checklistProgress(item),
                          }}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
