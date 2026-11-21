/**
 * Comment notifications a person has dismissed in My work.
 *
 * A mention is derived from a comment; dismissing it is a reading choice, not a change to the
 * comment. It belongs to the person and this browser, so it lives in `localStorage` and never in the
 * workspace: one person hiding a note must not hide it for anybody else.
 */

const PREFIX = 'kanbantoolkit-dismissed-mentions:'

/** The stable key of one mention: the card and the note on it. */
export function mentionEntryKey(itemId: string, entryId: string): string {
  return `${itemId}:${entryId}`
}

const storageKey = (userId: string | undefined) => `${PREFIX}${userId ?? 'anonymous'}`

/** The mentions this person has dismissed on this browser. */
export function dismissedMentionKeys(userId: string | undefined): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [])
  } catch {
    // A browser with storage turned off still reads My work; it just forgets the dismissals.
    return new Set()
  }
}

/** Dismiss one mention on this browser, keeping every earlier one. */
export function dismissMentionKey(userId: string | undefined, key: string): void {
  try {
    const keys = dismissedMentionKeys(userId)
    keys.add(key)
    localStorage.setItem(storageKey(userId), JSON.stringify([...keys]))
  } catch {
    // The in-memory set still hides it for this session.
  }
}
