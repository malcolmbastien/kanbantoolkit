/**
 * The command palette's matching. Pure, so the interesting part — what a query narrows to and in
 * what order — can be tested without a browser.
 *
 * The matcher is a **subsequence** match with a score, not a distance: every character of the
 * query has to appear in the text, in order. That is what makes "nsf" find "New signup flow" and
 * "sbx" find "Sandbox", while a query that is not a subsequence is simply not a match. Nothing is
 * guessed at, so nothing surprising comes back.
 */

export type PaletteKind = 'board' | 'item' | 'recent' | 'action'

export interface PaletteEntry {
  id: string
  kind: PaletteKind
  /** The line a person reads. */
  label: string
  /** The quiet second line: a ref, a board name, or what the action does. */
  hint?: string
  /** More text the query may match — a ref, a board's description, other names for an action. */
  keywords?: string
}

const WORD_BREAK = /[^a-z0-9]/

/**
 * How well `query` matches `text`, or `undefined` when it is not a subsequence of it at all.
 *
 * Points, in the order that makes a list feel right: one per matched character, a bonus for
 * adjacent characters (a typed run beats scattered letters), a bonus for landing on the start of
 * a word, and a small reward for a tight match — the same query inside a short label is a better
 * answer than inside a long one.
 */
export function fuzzyMatch(query: string, text: string): number | undefined {
  const q = query.trim().toLowerCase()
  if (q === '') return 0
  const t = text.toLowerCase()
  let score = 0
  let ti = 0
  let prevMatched = false
  for (const ch of q) {
    let found = -1
    for (let i = ti; i < t.length; i++) {
      if (t[i] === ch) {
        found = i
        break
      }
    }
    if (found === -1) return undefined
    score += 1
    if (prevMatched && found === ti) score += 3
    if (found === 0 || WORD_BREAK.test(t[found - 1])) score += 2
    prevMatched = true
    ti = found + 1
  }
  return score + (q.length / t.length) * 4
}

/**
 * The entries a query narrows to, best first.
 *
 * An empty query keeps everything in the order it was given — which is how "recently opened, then
 * boards, then actions" survives an untouched palette. A hit in the label counts for more than one
 * in a hint or a keyword, because the label is what the person is looking at.
 */
export function rankEntries(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const q = query.trim()
  if (q === '') return entries
  return entries
    .flatMap((entry) => {
      const inLabel = fuzzyMatch(q, entry.label)
      const elsewhere = [entry.hint ?? '', entry.keywords ?? '']
        .map((h) => fuzzyMatch(q, h))
        .filter((s): s is number => s !== undefined)
      if (inLabel === undefined && elsewhere.length === 0) return []
      return [{ entry, score: (inLabel ?? Math.max(...elsewhere)) + (inLabel === undefined ? 0 : 5) }]
    })
    .sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label))
    .map((x) => x.entry)
}

/** Where an entry comes from, as the palette's own small print. */
export const KIND_LABEL: Record<PaletteKind, string> = {
  board: 'Board',
  item: 'Card',
  recent: 'Recent',
  action: 'Action',
}
