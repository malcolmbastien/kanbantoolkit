/**
 * The timeline's zoom: how wide one day is drawn.
 *
 * The geometry itself is the domain's (`layoutTimeline` answers days and offsets); what a reader
 * chooses is how much room a day gets on screen. Three steps, because a chart of a quarter and a
 * chart of a fortnight are two readings of the same data, and a control that offers five is a
 * control nobody tries.
 *
 * The narrowest step is bounded by **legibility, not by how small the chart can get**: the tick row
 * still prints one day number per column, so a step whose day column cannot say "28" is a step the
 * axis would have to lie about (dropping numbers, or overlapping them). Two digits at `text-micro`
 * are about twelve pixels, and the app's scale has no size below that — so the column has to be wide
 * enough to hold them *with air*, not merely to hold them. Twenty pixels is that width: at sixteen
 * the numbers touch their neighbours. The floor is why a "whole year" step does not exist.
 *
 * This module is small and separate from the view for the reason `flowWindow` is: the store, the
 * URL and the chart's own control all need the valid set and the default, and the chart is a lazy
 * chunk. Importing the view from any of them would pull a chart into the first download for the
 * sake of three words.
 */

/** The steps, narrowest first. */
export const TIMELINE_ZOOMS = ['compact', 'normal', 'wide'] as const

export type TimelineZoom = (typeof TIMELINE_ZOOMS)[number]

/** Today's width, so a fresh visit and every existing link look exactly as they did. */
export const DEFAULT_TIMELINE_ZOOM: TimelineZoom = 'normal'

/** What each step draws: the width of one day, in pixels. */
export const TIMELINE_DAY_PX: Record<TimelineZoom, number> = {
  compact: 20,
  normal: 28,
  wide: 56,
}

/** Whether a string from a URL or a control is a step this build understands. */
export function isTimelineZoom(value: unknown): value is TimelineZoom {
  return typeof value === 'string' && (TIMELINE_ZOOMS as readonly string[]).includes(value)
}

/** A step as a URL parameter: `compact`, `normal`, `wide`. */
export const timelineZoomParam = (zoom: TimelineZoom): string => zoom

/** The step after this one, or the same when it is already the widest. */
export function zoomIn(zoom: TimelineZoom): TimelineZoom {
  const index = TIMELINE_ZOOMS.indexOf(zoom)
  return TIMELINE_ZOOMS[Math.min(index + 1, TIMELINE_ZOOMS.length - 1)]
}

/** The step before this one, or the same when it is already the narrowest. */
export function zoomOut(zoom: TimelineZoom): TimelineZoom {
  const index = TIMELINE_ZOOMS.indexOf(zoom)
  return TIMELINE_ZOOMS[Math.max(index - 1, 0)]
}

/** What the control calls each step. */
export const TIMELINE_ZOOM_LABELS: Record<TimelineZoom, string> = {
  compact: 'Compact',
  normal: 'Normal',
  wide: 'Wide',
}
