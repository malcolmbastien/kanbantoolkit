import { useLayoutEffect, useRef } from 'react'
import { ChartNoAxesGantt, Minus, Plus } from 'lucide-react'
import { Card } from './Card'
import { PersonAvatar } from './PersonAvatar'
import { boardInitiatives, isPortfolio, portfolioInitiatives } from '@/domain/board'
import { blockedBelow, checklistProgress, decompositionChildren, dependenciesOf, isComplete, openDependenciesOf, openDescendants, rollupOf, uncommittedBelow, type Graph } from '@/domain/derive'
import { layoutTimeline, type TimelineDay } from '@/domain/timelineLayout'
import { TIMELINE_DAY_PX, TIMELINE_ZOOM_LABELS, TIMELINE_ZOOMS, zoomIn, zoomOut } from '@/domain/timelineZoom'
import { peopleOf } from '@/domain/users'
import { parseDay } from '@/domain/filters'
import { STAGE_LABELS } from '@/domain/lanes'
import { useStore } from '@/store'
import { chipColors, STAGE_ACCENT } from '@/lib/colors'
import { cn } from '@/lib/utils'
import type { IssueType, Item } from '@/domain/types'

/**
 * How much room a bar needs before its people are drawn *inside* it: a title's worth and a face or
 * two. Measured in pixels because that is what a bar has — a span of days times the day's own
 * width — and the zoom steps change that width, so the same days earn a face at every step but the
 * narrowest. Below it the bar keeps its title, and the names are still in the block's tooltip and
 * its panel: a two-day bar with three faces and no words would say less, not more.
 */
const PEOPLE_MIN_PX = 140
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
 * A block's people, as a short row of faces.
 *
 * The chart is a chart, so a face is initials and a count — never a name in the flow of a bar. The
 * names are not lost, though: they are in the stack's own name, in the block's title, and in the
 * bar's accessible name, so the initials are decoration over a fact the block states in words. A
 * removed account keeps its place and reads as `Former member` in those words, with the mark the
 * card uses for it.
 *
 * The faces sit **beside each other**, not overlapped: the chart has the room the card's tight
 * footer does not, and an overlap reads as one muddled face at this size rather than as a group.
 */
function PeopleStack({ people, className }: { people: ReturnType<typeof peopleOf>; className?: string }) {
  if (people.length === 0) return null
  const names = people.map((person) => person.name).join(', ')
  return (
    <span
      data-timeline-people={people.length}
      role="img"
      aria-label={names}
      title={names}
      className={cn('flex shrink-0 items-center gap-1', className)}
    >
      {people.slice(0, 3).map((person) => (
        <PersonAvatar key={person.id} user={person} gone={person.gone} small />
      ))}
      {people.length > 3 && (
        <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-slate-200 text-micro font-semibold text-slate-600">
          +{people.length - 3}
        </span>
      )}
    </span>
  )
}

/**
 * The axis's rhythm: one line per day boundary, and a stronger one where a week or a month begins.
 *
 * Drawn as lines at the *left* edge of each day rather than as a border on each cell. A per-cell
 * border puts one line on a day's right edge and, at a month's first day, a second on its left —
 * so the boundary that names a month was twice as thick as every other, and the columns read
 * unevenly exactly where the eye is looking for the scale. One line at one x is one column.
 */
function GridLines({ days, dayPx }: { days: TimelineDay[]; dayPx: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {days.map((day) =>
        day.offset === 0 ? null : (
          <span
            key={day.offset}
            data-timeline-line={day.monthStart ? 'month' : day.weekStart ? 'week' : 'day'}
            className={cn('absolute inset-y-0 w-px', day.monthStart || day.weekStart ? 'bg-slate-300' : 'bg-slate-200')}
            style={{ left: day.offset * dayPx }}
          />
        ),
      )}
    </div>
  )
}

/**
 * The board's initiatives laid out over time.
 *
 * The same view idea as the dashboard — the board's initiatives, one computation — but
 * arranged by their target dates instead of listed. The geometry comes from the domain's
 * `layoutTimeline`; this surface only draws what it returns, so nothing here can invent a
 * date, a row or a colour. Read-only by design: no drag-to-reschedule — moving a date is a write,
 * and writes belong to an explicit action. What a reader does choose is how wide a day is drawn:
 * `timelineZoom` supplies the one number every piece of geometry multiplies, and the layout itself
 * never learns about pixels.
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
  const openItemDependencies = useStore((s) => s.openItemDependencies)
  const timelineZoom = useStore((s) => s.timelineZoom)
  const setTimelineZoom = useStore((s) => s.setTimelineZoom)

  const graph: Graph = { items, edges, links, placements, lanes }
  const typeOf = (typeId: string): IssueType =>
    issueTypes.find((t) => t.id === typeId) ?? { id: typeId, name: 'Item', color: '#64748b' }
  const board = boards.find((b) => b.id === boardId)
  // A portfolio holds no initiatives of its own: its timeline reads the outcomes in its remit and
  // those linked to its objectives, wherever their board sits.
  const initiatives = isPortfolio(board)
    ? portfolioInitiatives(graph, boards, boardId, issueTypes)
    : boardInitiatives(graph, boardId, issueTypes)
  const layout = layoutTimeline(
    initiatives.map((i) => ({
      id: i.id,
      title: i.title,
      targetStartDate: i.targetStartDate,
      targetEndDate: i.targetEndDate,
      bucket: rollupOf(i.id, graph).bucket,
    })),
  )

  // One width for the whole axis, and the people of every block resolved once for the three places
  // a block can show them.
  const dayPx = TIMELINE_DAY_PX[timelineZoom]
  const peopleByBar = new Map(initiatives.map((i) => [i.id, peopleOf(users, i.assignees)]))

  /**
   * Zooming keeps the reader's place.
   *
   * The axis is as long as the work is and is scrolled sideways, so a wider day must not throw the
   * reader back to the start. The day under the axis's left edge is `scrollLeft / dayPx`, and it
   * stays that day: the labels are sticky and take the same width at every step, so the arithmetic
   * is one ratio.
   */
  const scroller = useRef<HTMLDivElement>(null)
  const drawnAt = useRef(dayPx)
  useLayoutEffect(() => {
    const el = scroller.current
    const previous = drawnAt.current
    if (el && previous !== dayPx) el.scrollLeft = (el.scrollLeft / previous) * dayPx
    drawnAt.current = dayPx
  }, [dayPx])

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
            {/* How wide a day is drawn. Two ends and the step between them: the narrowest and the
                widest are where the control stops, so a press that would do nothing is disabled
                rather than refused. The step is announced when it changes. */}
            <div
              role="group"
              aria-label="Zoom"
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-0.5"
            >
              <button
                type="button"
                onClick={() => setTimelineZoom(zoomOut(timelineZoom))}
                disabled={timelineZoom === TIMELINE_ZOOMS[0]}
                aria-label="Zoom out"
                title="Narrower days"
                className="grid h-6 w-6 place-items-center rounded text-slate-600 transition enabled:hover:bg-slate-100 enabled:hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
              >
                <Minus size={13} />
              </button>
              <span
                data-timeline-zoom={timelineZoom}
                aria-live="polite"
                className="min-w-14 text-center text-meta font-medium text-slate-700"
              >
                {TIMELINE_ZOOM_LABELS[timelineZoom]}
              </span>
              <button
                type="button"
                onClick={() => setTimelineZoom(zoomIn(timelineZoom))}
                disabled={timelineZoom === TIMELINE_ZOOMS[TIMELINE_ZOOMS.length - 1]}
                aria-label="Zoom in"
                title="Wider days"
                className="grid h-6 w-6 place-items-center rounded text-slate-600 transition enabled:hover:bg-slate-100 enabled:hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
              >
                <Plus size={13} />
              </button>
            </div>
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
            {/* The chart. One width per day — the zoom's — and horizontally scrollable: the axis is
                as long as the work is. Nothing here drag-reschedules. The initiative column is
                frozen to the left: a bar scrolled off its own name is unreadable, so the name
                travels with the row. */}
            <div ref={scroller} data-timeline-scroll className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="relative flex" style={{ width: LABEL_PX + layout.totalDays * dayPx }}>
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
                    // The people are the block's, drawn where the work is; the column is the name
                    // and the share. The names still travel in the row's title, so a reader who
                    // wants them does not have to open the block to ask.
                    const who = (peopleByBar.get(bar.id) ?? []).map((person) => person.name).join(', ')
                    return (
                      <div
                        key={bar.id}
                        data-timeline-label-id={bar.id}
                        title={`${bar.title} \u00b7 ${shown} \u00b7 ${STAGE_LABELS[bar.bucket]}${who ? ` \u00b7 ${who}` : ''}`}
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
                        <span className="shrink-0 text-micro font-semibold tabular-nums text-slate-600" title="Share of the work below that is done">
                          {rollupOf(bar.id, graph).percent}%
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* The axis: months over days, the days' own grid down the body, and the bars. */}
                <div className="relative shrink-0" style={{ width: layout.totalDays * dayPx }}>
                  {/* Period headers — whole calendar months, positioned by the layout. */}
                  <div className="flex border-b border-slate-200" style={{ height: MONTH_PX }}>
                    {layout.months.map((m, index) => (
                      <div
                        key={`${m.year}-${m.month}`}
                        data-timeline-month={`${m.year}-${m.month + 1}`}
                        style={{ width: m.days * dayPx }}
                        // The line is drawn on the month's *first* day, which is where the day
                        // grid draws it too — a right border would put it one pixel off.
                        className={cn(
                          'flex shrink-0 items-center truncate border-slate-300 px-2 text-meta font-semibold text-slate-700',
                          index > 0 && 'border-l',
                        )}
                      >
                        {new Date(m.year, m.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                      </div>
                    ))}
                  </div>

                  {/* The tick row: a day number per column, weekends muted and the today column
                      named. Every tick is a day the domain actually contains, and its tooltip
                      spells the date out in full. */}
                  <div
                    data-timeline-days
                    className="relative flex border-b border-slate-200 bg-slate-50"
                    style={{ height: DAY_ROW_PX }}
                  >
                    {layout.days.map((d) => (
                      <div
                        key={d.offset}
                        data-timeline-day={d.dateIso}
                        title={fmtDay(d.dateIso)}
                        style={{ width: dayPx }}
                        className={cn(
                          'flex shrink-0 items-center justify-center text-micro tabular-nums',
                          // Weekends are muted by their band, never by a lighter grey: the
                          // number has to stay above the legibility floor to be readable at all.
                          d.weekend ? 'bg-slate-100 text-slate-600' : 'text-slate-600',
                          d.monthStart && 'font-semibold text-slate-800',
                          layout.today === d.offset && 'bg-rose-100 font-bold text-rose-700',
                        )}
                      >
                        {d.day}
                      </div>
                    ))}
                    <GridLines days={layout.days} dayPx={dayPx} />
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
                        className={cn('pointer-events-none absolute inset-y-0', d.weekend && 'bg-slate-50')}
                        style={{ left: d.offset * dayPx, width: dayPx }}
                      />
                    ))}
                    <GridLines days={layout.days} dayPx={dayPx} />
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
                    // The block's own people, never the children's: a bar refuses to claim a bucket
                    // it does not have, and a face is the same kind of claim.
                    const people = peopleByBar.get(bar.id) ?? []
                    const who = people.map((person) => person.name).join(', ')
                    const label = `${bar.title} \u00b7 ${shown} \u00b7 ${STAGE_LABELS[bar.bucket]}${who ? ` \u00b7 ${who}` : ''}`
                    const width = (bar.end - bar.start) * dayPx
                    return bar.kind === 'span' ? (
                      <button
                        key={bar.id}
                        data-timeline-bar-id={bar.id}
                        data-timeline-bucket={bar.bucket}
                        onClick={() => openItem(bar.id)}
                        title={label}
                        className="absolute flex items-center overflow-hidden rounded-md px-1.5 text-left shadow-sm transition hover:brightness-95"
                        style={{
                          left: bar.start * dayPx,
                          width,
                          top: bar.row * ROW_PX + 10,
                          height: ROW_PX - 20,
                          background: chip.background,
                          color: chip.color,
                        }}
                      >
                        {/* The words, then the faces directly after them — not pushed to the far
                            end of the bar: a quarter-long span is thousands of pixels wide, and a
                            face at its end would be off-screen exactly where the bar is read. The
                            wrapper is capped at the bar and the title truncates inside it, so a
                            short bar loses the face rather than overflowing. */}
                        <span className="flex min-w-0 max-w-full items-center gap-1.5">
                          <span className="flex min-w-0 flex-col justify-center leading-tight">
                            <span className="truncate text-meta font-medium">{bar.title}</span>
                            <span className="truncate text-micro">{shown}</span>
                          </span>
                          {/* A bar too narrow for a face keeps its words instead: the names travel
                              in the block's title, and opening it shows the people in the panel. */}
                          {people.length > 0 && width >= PEOPLE_MIN_PX && <PeopleStack people={people} />}
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
                        style={{ left: (bar.start + 0.5) * dayPx, top: bar.row * ROW_PX + 10, height: ROW_PX - 20 }}
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
                        <PeopleStack people={people} className="ml-1.5" />
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
                        style={{ left: (layout.today + 0.5) * dayPx }}
                      />
                      <span
                        className="absolute top-0 z-10 -translate-x-1/2 rounded-b-md bg-rose-500 px-1.5 py-px text-micro font-bold uppercase tracking-wide text-white"
                        style={{ left: (layout.today + 0.5) * dayPx }}
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
                <p className="mt-1 text-micro text-slate-600">
                  These initiatives have no start or end date, so they are not placed on the chart. Set a target date in
                  an initiative&rsquo;s panel to schedule it.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {layout.unscheduled.map((u) => {
                    const item = initiatives.find((i) => i.id === u.id)
                    if (!item) return null
                    // The direct children — archived ones included, because the rollup counts them and the count
                    // beside the pips has to be the same number the percentage is about. Filtering them out here is
                    // what made a card with one filed-away child read "nothing below" and "1 below" at once.
                    const childItems = decompositionChildren(item.id, edges)
                      .map((id) => items.find((i) => i.id === id))
                      .filter((i): i is Item => Boolean(i))
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
                          onOpen={(id) => openItem(id)}
                          onOpenDependencies={openItemDependencies}
                          openDependencies={openDependenciesOf(item.id, graph).length}
                          hasDependencies={dependenciesOf(item.id, graph).length > 0}
                          summary={{
                            childCount: decompositionChildren(item.id, edges).length,
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
