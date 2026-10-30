/**
 * The Flow view's window.
 *
 * A window is a number of weeks back from now, or all the history the board has. It is view state,
 * not data: nothing is stored on the server, and the same board read over 4 weeks and over a year is
 * two readings of one dataset.
 *
 * Kept in its own module because three first-download modules need the type and the valid set — the
 * store, the URL and the screen's controls — while the metrics themselves stay in the lazy Flow
 * chunk. Importing `domain/metrics` from the store would pull the whole metrics module into the
 * first download for the sake of four numbers.
 */

/** The windows the Flow view offers, in weeks. */
export const FLOW_WINDOWS = [4, 8, 12, 26] as const

/** A number of weeks back, or every week the board has recorded. */
export type FlowWindow = (typeof FLOW_WINDOWS)[number] | 'all'

/** A quarter of history, unless the reader says otherwise. */
export const DEFAULT_FLOW_WINDOW: FlowWindow = 12

/** Whether a string from a URL or a control is a window this build understands. */
export function isFlowWindow(value: unknown): value is FlowWindow {
  if (value === 'all') return true
  return typeof value === 'number' && (FLOW_WINDOWS as readonly number[]).includes(value)
}

/** A window as a URL parameter: `12`, `4`, `all`. */
export const flowWindowParam = (window: FlowWindow): string => String(window)
