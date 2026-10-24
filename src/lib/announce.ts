/**
 * Saying what happened, to somebody who cannot see it.
 *
 * A drag that lands, a drop the board refuses and a warning that appears are all visible changes:
 * the card moves, the lane flushes, a badge arrives. A screen reader gets none of it unless
 * something says so, and the thing that says so has to be a live region — text that changes while
 * the page stays where it is.
 *
 * The store is where the changes happen, and it is not a component, so it announces through this
 * module and the app mounts one `Announcer` to speak it. One voice, so two drags in a row cannot
 * talk over each other.
 */

type Listener = (message: string) => void

let listener: Listener | undefined
let last = ''

/** The one place that listens. Mounted once, by `Announcer`. */
export function subscribeAnnouncements(fn: Listener): () => void {
  listener = fn
  return () => {
    if (listener === fn) listener = undefined
  }
}

/**
 * Announce a change. Silent before the announcer mounts, which is the honest thing: there is
 * nobody listening yet.
 */
export function announce(message: string): void {
  const said = message.trim()
  if (!said || !listener) return
  // A live region that receives the same string twice may say nothing the second time, and a
  // second identical refusal is still an answer. A zero-width space makes it new text without
  // changing a word of what is read.
  listener(said === last ? `${said}\u200b` : said)
  last = said
}

/** For tests: forget the last thing said, and the listener. */
export function resetAnnouncements(): void {
  last = ''
  listener = undefined
}
