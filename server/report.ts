/**
 * What the error endpoint accepts — an error, not a workspace.
 *
 * The rules here are the task's R4 made mechanical: every field is a string with a ceiling, the
 * URL loses its query (which carries board ids, item ids and search terms), and a report with no
 * message is refused rather than stored empty.
 */

export interface ErrorReport {
  message: string
  stack: string
  url: string
  view: string
  release: string
  ua: string
}

const LIMITS = { message: 300, stack: 4000, url: 300, view: 40, release: 40, ua: 200 } as const

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.slice(0, limit) : ''
}

/**
 * The path alone. A place is a query string in this app, so the query is where the board and the
 * open card live — an error report is not the place for either.
 */
export function pathOnly(value: unknown): string {
  const raw = text(value, LIMITS.url)
  if (!raw) return ''
  try {
    return new URL(raw, 'https://placeholder.invalid').pathname.slice(0, LIMITS.url)
  } catch {
    return ''
  }
}

export function parseReport(input: unknown): ErrorReport | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const message = text(raw.message, LIMITS.message).trim()
  if (!message) return null
  return {
    message,
    stack: text(raw.stack, LIMITS.stack),
    url: pathOnly(raw.url),
    view: text(raw.view, LIMITS.view),
    release: text(raw.release, LIMITS.release),
    ua: text(raw.ua, LIMITS.ua),
  }
}
