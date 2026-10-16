import { ChartNoAxesGantt } from 'lucide-react'
import { Card } from './Card'
import { boardInitiatives, buildRefs } from '@/domain/board'
import { blockedBelow, checklistProgress, decompositionChildren, dependenciesOf, dependentsOf, isComplete, openDescendants, rollupOf, statusOf, uncommittedBelow, type Graph } from '@/domain/derive'
import { layoutTimeline } from '@/domain/timelineLayout'
import { parseDay } from '@/domain/filters'
import { STAGE_LABELS } from '@/domain/lanes'
import { useStore } from '@/store'
import { chipColors, STAGE_ACCENT } from '@/lib/colors'
import { cn } from '@/lib/utils'
import type { IssueType, Item } from '@/domain/types'

/** The chart's width per day. Fixed for now — zoom is out of scope for this slice. */
const DAY_PX = 28
/** The height of one packed row; bars land here in the next step. */
const ROW_PX = 56

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
  const refs = buildRefs(items, issueTypes)
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
                long as the work is, and nothing here zooms or drag-reschedules. */}
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="relative" style={{ width: layout.totalDays * DAY_PX }}>
                {/* Period headers — whole calendar months, positioned by the layout. */}
                <div className="flex border-b border-slate-200">
                  {layout.months.map((m) => (
                    <div
                      key={`${m.year}-${m.month}`}
                      data-timeline-month={`${m.year}-${m.month + 1}`}
                      style={{ width: m.days * DAY_PX }}
                      className="shrink-0 truncate border-r border-slate-200 px-2 py-1.5 text-meta font-semibold text-slate-700 last:border-r-0"
                    >
                      {new Date(m.year, m.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                    </div>
                  ))}
                </div>

                {/* The body: one band per packed row, the bars and milestones placed on them. */}
                <div className="relative" style={{ height: Math.max(layout.rowCount * ROW_PX, 96) }} data-timeline-body>
                  {Array.from({ length: layout.rowCount }, (_, r) => (
                    <div
                      key={r}
                      className={cn('absolute inset-x-0', r % 2 === 1 && 'bg-slate-50')}
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
                    that, so the marker can never point at an invented place. It spans the whole
                    chart, header included, and sits above the bars: the one date here that is
                    not a target must never be hidden by the work it cuts through. */}
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
                    const symbols = childItems.map((ci) => ({ bucket: rollupOf(ci.id, graph).bucket, title: ci.title }))
                    return (
                      <div key={u.id} data-timeline-unscheduled={u.id} className="w-56 shrink-0">
                        <Card
                          item={item}
                          type={typeOf(item.typeId)}
                          ref_={refs.get(item.id) ?? ''}
                          wide
                          users={users}
                          symbols={symbols}
                          blockedTone="aggregate"
                          onOpen={openItem}
                          summary={{
                            childCount: decompositionChildren(item.id, edges).length,
                            dependentsCount: dependentsOf(item.id, graph).filter((d) => !statusOf(d.dependent.id, graph).resolved).length,
                            linksCount: dependenciesOf(item.id, graph).length + dependentsOf(item.id, graph).length,
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
