/**
 * Reporting a failure, without sending the workspace with it.
 *
 * The app holds everything in the browser: card titles, client names, plans. An error report is
 * about the *code*, so what leaves here is the message, the stack, the page, the view, the build
 * and the browser — and never a place's query, which is where board and item ids live.
 *
 * Nothing is reported in development, and nothing is reported twice: the first ten distinct
 * failures of a page are enough to know what is wrong.
 */

export interface ErrorDetails {
  message: string
  stack: string
}

/** An error as plain strings. Anything thrown that is not an Error is described without guessing. */
export function describeError(error: unknown): ErrorDetails {
  if (error instanceof Error) {
    return { message: (error.message || error.name || 'Error').slice(0, 300), stack: (error.stack ?? '').slice(0, 4000) }
  }
  if (typeof error === 'string') return { message: error.slice(0, 300), stack: '' }
  try {
    return { message: JSON.stringify(error).slice(0, 300), stack: '' }
  } catch {
    return { message: 'Unknown error', stack: '' }
  }
}

/**
 * The place, as far as a report is concerned: the path and the view. The query is where the board
 * and the open card are named, and neither belongs in an error report.
 */
export function placeOf(location: { pathname: string; search: string }): { url: string; view: string } {
  const view = new URLSearchParams(location.search).get('view') ?? 'board'
  return { url: location.pathname.slice(0, 300), view: view.slice(0, 40) }
}

const LIMIT = 10
let sent = 0
const seen = new Set<string>()

/**
 * Report one failure. Silent in development, capped per page, and never awaited.
 *
 * The whole body is guarded: this runs *from* an error handler, so anything thrown here would be
 * a new error, which the same handler would report, which could throw again — a loop that fills
 * the log with the reporter rather than the bug.
 */
export function reportError(error: unknown): void {
  try {
    if (!import.meta.env.PROD || sent >= LIMIT) return
    const { message, stack } = describeError(error)
    const key = `${message}|${stack}`
    if (seen.has(key)) return
    seen.add(key)
    sent += 1
    const { url, view } = placeOf(window.location)
    void fetch('/api/errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // A report is worth sending while the page is going away.
      keepalive: true,
      body: JSON.stringify({ message, stack, url, view, release: __RELEASE__, ua: navigator.userAgent }),
    }).catch(() => {
      /* A report that cannot be sent is not a second error. */
    })
  } catch {
    /* Reporting must never be the thing that breaks. */
  }
}

/** Every uncaught error and every rejected promise, once each. */
export function installErrorHandlers(): void {
  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message)
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason)
  })
}
