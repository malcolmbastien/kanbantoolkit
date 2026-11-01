import type { Item, ItemLogEntry } from './types'

/**
 * Search: what a query finds on an item, and the line it found it on.
 *
 * The title is not the whole of a card. Real work carries its detail in the description and in
 * notes, so a title-only search looks broken when a reader can see the word on the card and the
 * search says there is nothing. This module reads all three, and keeps the answer explainable:
 * a result says which field matched and shows the line around the hit.
 *
 * It is pure and storage-free. An item's identity is its id, which is nobody's business but the
 * app's, so a card is found by the words on it — all of them.
 */

/** Where a search found its word. A title is best, then the description, then a note. */
export type SearchField = 'title' | 'description' | 'note'

/**
 * The matching line, in three pieces so a caller can mark the hit without parsing it again.
 *
 * The words around the hit are clipped to a readable line rather than the whole field: a
 * description can be pages long, and a result is a way into the item, not a copy of it.
 */
export interface SearchMatch {
  field: SearchField
  before: string
  matched: string
  after: string
}

export interface SearchHit {
  item: Item
  match: SearchMatch
}

/** Every line break and run of spaces as one space: a hit is shown as one line. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** How much of the field a search result shows on either side of the hit. */
const EXCERPT_CONTEXT = 58

/**
 * The match inside one field, clipped around the hit. `text` is already one line.
 *
 * The returned `before` and `after` carry the ellipsis, so a renderer only has to join the three
 * pieces — the marked word is always exactly what the query found.
 */
function matchIn(text: string, query: string, field: SearchField): SearchMatch | undefined {
  const line = oneLine(text)
  if (!line) return undefined
  const at = line.toLowerCase().indexOf(query)
  if (at < 0) return undefined

  let start = Math.max(0, at - EXCERPT_CONTEXT)
  let end = Math.min(line.length, at + query.length + EXCERPT_CONTEXT)
  // Prefer a word boundary, but never move past the hit itself.
  if (start > 0) {
    const space = line.indexOf(' ', start)
    if (space >= 0 && space < at) start = space + 1
  }
  if (end < line.length) {
    const space = line.lastIndexOf(' ', end)
    if (space > at + query.length) end = space
  }

  return {
    field,
    before: `${start > 0 ? '…' : ''}${line.slice(start, at)}`,
    matched: line.slice(at, at + query.length),
    after: `${line.slice(at + query.length, end)}${end < line.length ? '…' : ''}`,
  }
}

/**
 * Where an item carries the query, if it does. The title wins over the description, which wins
 * over a note; among notes the newest match is the one shown, because that is the one a reader
 * means when a word has been said twice.
 *
 * A note is an entry of kind `noted`; the item's other history (a move, an edit) is not a comment
 * and is not searched.
 */
export function matchOf(item: Item, query: string): SearchMatch | undefined {
  const q = query.trim().toLowerCase()
  if (!q) return undefined

  const title = matchIn(item.title, q, 'title')
  if (title) return title

  const description = item.description ? matchIn(item.description, q, 'description') : undefined
  if (description) return description

  const notes = (item.log ?? []).filter((entry) => entry.kind === 'noted' && entry.note?.trim())
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = matchIn(notes[i].note ?? '', q, 'note')
    if (note) return note
  }
  return undefined
}

/** The field order a result list is read in: the title first, then the body, then the notes. */
const FIELD_ORDER: Record<SearchField, number> = { title: 0, description: 1, note: 2 }

/**
 * Global search: the items whose title, description or a note contains the query
 * (case-insensitive), each with the line that matched. An empty query returns no matches.
 *
 * Title matches are listed before body matches, and body matches before notes, so the most
 * name-like answer is first; within a field the items keep the order they were given.
 */
export function searchHits(items: Item[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []
  for (const item of items) {
    const match = matchOf(item, q)
    if (match) hits.push({ item, match })
  }
  return hits
    .map((hit, index) => ({ hit, index }))
    .sort((a, b) => FIELD_ORDER[a.hit.match.field] - FIELD_ORDER[b.hit.match.field] || a.index - b.index)
    .map(({ hit }) => hit)
}

/** The items a search finds, without the matching line. */
export function searchItems(items: Item[], query: string): Item[] {
  return searchHits(items, query).map((hit) => hit.item)
}

/**
 * The line in one note, if it carries the query.
 *
 * A note read answers with entries, not items: the note's own text is the only field to look in,
 * so this is the same match as `matchOf` would find, without an item to walk.
 */
export function noteMatch(entry: ItemLogEntry, query: string): SearchMatch | undefined {
  const q = query.trim().toLowerCase()
  if (!q || entry.kind !== 'noted' || !entry.note?.trim()) return undefined
  return matchIn(entry.note, q, 'note')
}
