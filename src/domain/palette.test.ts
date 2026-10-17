import { describe, expect, it } from 'vitest'
import { fuzzyMatch, rankEntries, type PaletteEntry } from './palette'

/** The score of a match that is expected to exist. */
const score = (q: string, text: string) => fuzzyMatch(q, text)!

const entry = (id: string, label: string, patch: Partial<PaletteEntry> = {}): PaletteEntry => ({
  id,
  kind: 'item',
  label,
  ...patch,
})

describe('command palette matching', () => {
  it('matches a subsequence, in order, whatever the case', () => {
    expect(fuzzyMatch('nsf', 'New signup flow')).toBeGreaterThan(0)
    expect(fuzzyMatch('NSF', 'new signup flow')).toBeGreaterThan(0)
    expect(fuzzyMatch('signup', 'New signup flow')).toBeGreaterThan(0)
    // Out of order is not a match, and neither is a character that is not there.
    expect(fuzzyMatch('fsn', 'New signup flow')).toBeUndefined()
    expect(fuzzyMatch('signupz', 'New signup flow')).toBeUndefined()
    expect(fuzzyMatch('', 'anything')).toBe(0)
    expect(fuzzyMatch('   ', 'anything')).toBe(0)
  })

  it('scores a typed run and a word start above scattered letters', () => {
    // "sig" consecutive at a word start beats s-i-g scattered through the label.
    expect(score('sig', 'Signup flow')).toBeGreaterThan(score('sig', 'Sailing in Greece'))
    // A start-of-word hit beats a mid-word one.
    expect(score('flow', 'Flow rate')).toBeGreaterThan(score('flow', 'Overflow'))
    // And a tight match beats the same query inside a longer label.
    expect(score('rate', 'Rate limit')).toBeGreaterThan(score('rate', 'Rate limiting and messaging policy'))
  })

  it('keeps an empty query exactly as it was given', () => {
    const entries = [entry('a', 'Zebra'), entry('b', 'Apple')]
    expect(rankEntries(entries, '').map((e) => e.id)).toEqual(['a', 'b'])
    expect(rankEntries(entries, '   ').map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('ranks the best match first and drops what does not match at all', () => {
    const entries = [
      entry('flow', 'New signup flow'),
      entry('signup', 'Signup form'),
      entry('other', 'Retire legacy auth endpoint'),
      entry('ref', 'Something else', { keywords: 'INIT8 signup' }),
    ]
    const ranked = rankEntries(entries, 'signup')
    expect(ranked[0].id).toBe('signup') // the label that *is* the query wins
    expect(ranked.map((e) => e.id)).toContain('flow')
    expect(ranked.map((e) => e.id)).toContain('ref') // matched on a keyword
    expect(ranked.map((e) => e.id)).not.toContain('other')
  })

  it('prefers a label hit to a hint or keyword hit of the same text', () => {
    const entries = [
      entry('hinted', 'Something else', { hint: 'gateway' }),
      entry('labelled', 'Gateway contract'),
    ]
    expect(rankEntries(entries, 'gateway').map((e) => e.id)).toEqual(['labelled', 'hinted'])
  })

  it('is deterministic for equal scores, so a list does not shuffle under the pointer', () => {
    // Same score, different labels: alphabetical, so two runs of the same query agree.
    const byLabel = [entry('b', 'Same two'), entry('a', 'Same one')]
    expect(rankEntries(byLabel, 'same').map((e) => e.id)).toEqual(['a', 'b'])
    // Same score *and* the same label: the order it was given — which is how the caller's
    // "recents first, then boards, then actions" survives a query that matches them all.
    const identical = [entry('first', 'Same one'), entry('second', 'Same one')]
    expect(rankEntries(identical, 'same').map((e) => e.id)).toEqual(['first', 'second'])
  })
})
