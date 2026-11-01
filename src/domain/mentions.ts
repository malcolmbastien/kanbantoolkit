import type { Item, ItemLogEntry, Placement, User } from './types'

/**
 * Mentions in notes: a name in the words, and the person it means.
 *
 * A mention is part of a note, not a thread: there is no reply, no parent and no second entity.
 * The text says `@Riley Kim` because that is what a person reads, and the entry records Riley's id
 * because that is what a person remains after a rename. The two are written together and neither
 * is derived from the other at display time.
 */

/** What an `@` in the composer is offering, and where the token begins. */
export interface MentionQuery {
  /** Index of the `@` in the text. */
  start: number
  /** What has been typed after it, without the `@`. */
  query: string
  matches: User[]
}

/** Text that may sit before an `@` without making it an email address. */
const BEFORE = /[\s([{"'`]/
/** Text that ends a name in a sentence. */
const AFTER = /[\s.,!?;:()[\]{}"'`]/

/**
 * The mention being typed at `caret`, if there is one.
 *
 * The `@` must start the text or follow a space/open bracket — an email address is not a mention.
 * The query is what follows it on this line, and matching is a case-insensitive substring so typing
 * a surname finds the person too. The list is capped: a composer offers a few names, not a directory.
 */
export function mentionQueryAt(text: string, caret: number, users: User[]): MentionQuery | undefined {
  const upto = text.slice(0, caret)
  const start = upto.lastIndexOf('@')
  if (start < 0) return undefined
  if (start > 0 && !BEFORE.test(upto[start - 1])) return undefined

  const query = upto.slice(start + 1)
  if (query.includes('@') || /[\n\r]/.test(query)) return undefined

  const needle = query.trim().toLowerCase()
  const matches = users
    .filter((user) => user.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 6)
  return { start, query, matches }
}

/**
 * Put a person into the note in place of the token being typed.
 *
 * The name is followed by a space so the next word is not glued to it; the caret lands after that
 * space, which is where a person would type next.
 */
export function insertMention(
  text: string,
  caret: number,
  start: number,
  user: User,
): { text: string; caret: number } {
  const at = `@${user.name} `
  return {
    text: `${text.slice(0, start)}${at}${text.slice(caret)}`,
    caret: start + at.length,
  }
}

/**
 * The people a finished note mentions, as ids.
 *
 * Names are considered longest first, so `@Riley Kim` is not also read as a mention of somebody
 * called Riley. The `@` has to begin the text or follow whitespace/brackets, and the name has to
 * end the word — `@Riley,` is a mention, `@RileyKim` is not. Case is not a spelling of a person:
 * `@riley kim` finds Riley Kim too.
 */
export function mentionedIds(text: string, users: User[]): string[] {
  const lower = text.toLowerCase()
  const ids: string[] = []
  // The spans already read as a longer name. Without this, `@Riley Kim` would also count as a
  // mention of a person called Riley, because `@Riley` ends at the space before `Kim`.
  const spans: Array<{ at: number; end: number }> = []
  for (const user of [...users].sort((a, b) => b.name.length - a.name.length)) {
    const needle = `@${user.name}`.toLowerCase()
    let from = 0
    while (from < lower.length) {
      const at = lower.indexOf(needle, from)
      if (at < 0) break
      const end = at + needle.length
      if (spans.some((span) => at >= span.at && at < span.end)) {
        from = end
        continue
      }
      const before = text[at - 1]
      const after = text[end]
      const starts = at === 0 || BEFORE.test(before)
      const ends = after === undefined || AFTER.test(after)
      if (starts && ends && !ids.includes(user.id)) {
        ids.push(user.id)
        spans.push({ at, end })
      }
      from = end
    }
  }
  return ids
}

/** A note as a read answers it: the entry, and the card it was written on. */
export interface MentionNote {
  itemId: string
  entry: ItemLogEntry
}

/** One note that mentions a person, in the order the My work view reads it. */
export interface MentionEntry {
  item: Item
  entry: ItemLogEntry
  /** The board the item sits on, when it is placed. */
  boardId?: string
}

/**
 * Every note that mentions `userId`, newest first.
 *
 * Archived items are included: filing a card away is not deleting what was said on it, and the
 * person mentioned should still be able to find the sentence. The item opens read-only, which is
 * the same rule the archive keeps everywhere else.
 */
export function mentionsFor(items: Item[], placements: Placement[], userId: string | undefined): MentionEntry[] {
  if (!userId) return []
  const boardOf = new Map(placements.map((placement) => [placement.itemId, placement.boardId]))
  const found: MentionEntry[] = []
  for (const item of items) {
    for (const entry of item.log ?? []) {
      if (entry.kind !== 'noted' || !entry.mentions?.includes(userId)) continue
      const boardId = boardOf.get(item.id)
      found.push({ item, entry, ...(boardId ? { boardId } : {}) })
    }
  }
  return found.sort((a, b) => b.entry.at - a.entry.at || a.item.id.localeCompare(b.item.id))
}

/**
 * The mentions a note read answered with, matched to the cards and boards this browser holds.
 *
 * The read is the server's; the card and its board are this client's. A note for a card that is
 * not here cannot be opened, so it is dropped rather than listed as a dead row.
 */
export function mentionsOfNotes(notes: readonly MentionNote[], items: Item[], placements: Placement[]): MentionEntry[] {
  const itemOf = new Map(items.map((item) => [item.id, item]))
  const boardOf = new Map(placements.map((placement) => [placement.itemId, placement.boardId]))
  return notes.flatMap((note) => {
    const item = itemOf.get(note.itemId)
    if (!item) return []
    const boardId = boardOf.get(note.itemId)
    return [{ item, entry: note.entry, ...(boardId ? { boardId } : {}) }]
  })
}

/**
 * What this browser knew and what the server said, once per entry, newest first.
 *
 * The workspace document no longer carries history, so a signed-in person's mentions arrive from
 * a read; a static deployment keeps them in the cards. Either source may know an entry the other
 * does not, so the union is the answer.
 */
export function mergeMentions(...lists: MentionEntry[][]): MentionEntry[] {
  const byEntry = new Map<string, MentionEntry>()
  for (const entry of lists.flat()) byEntry.set(`${entry.item.id}:${entry.entry.id}`, entry)
  return [...byEntry.values()].sort((a, b) => b.entry.at - a.entry.at || a.item.id.localeCompare(b.item.id))
}
