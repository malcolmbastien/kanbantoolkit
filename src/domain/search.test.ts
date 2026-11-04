import { describe, expect, it } from 'vitest'
import { matchOf, noteMatch, searchHits, searchItems } from './search'
import type { Item, ItemLogEntry } from './types'

describe('search — a card is found by all the words on it', () => {
  const card = (id: string, title: string, extra: Partial<Item> = {}): Item => ({
    id,
    title,
    typeId: 't-story',
    createdAt: 0,
    ...extra,
  })
  const note = (id: string, at: number, text: string): ItemLogEntry => ({ id, at, kind: 'noted', note: text })

  const items = [
    card('title-first', 'Gateway timeout in billing'),
    card('description-second', 'Billing retry policy', {
      description: 'When the gateway refuses a card we retry it twice before asking a person.',
    }),
    card('note-third', 'Triage the inbound request', {
      log: [note('l1', 1, 'Older gateway note'), note('l2', 2, 'Newer gateway note')],
    }),
    card('link-fourth', 'Rework the drop target', {
      externalLabel: 'ATLAS-431',
      externalUrl: 'https://jira.example.com/browse/ATLAS-431',
    }),
  ]

  it('finds the link label, and never the address it opens', () => {
    // A ticket key is a word somebody types; the URL is not searched.
    const hit = matchOf(items.find((i) => i.id === 'link-fourth')!, 'atlas-431')
    expect(hit).toMatchObject({ field: 'link', matched: 'ATLAS-431' })
    expect(matchOf(items.find((i) => i.id === 'link-fourth')!, 'jira.example.com')).toBeUndefined()
  })

  it('finds a title before a description, and a description before a note', () => {
    expect(searchHits(items, 'gateway').map((hit) => hit.item.id)).toEqual([
      'title-first',
      'description-second',
      'note-third',
    ])
    expect(searchHits(items, 'gateway').map((hit) => hit.match.field)).toEqual(['title', 'description', 'note'])
  })

  it('returns the matching line with the hit in the middle', () => {
    const hit = matchOf(items[1], 'GATEWAY')
    expect(hit).toMatchObject({ field: 'description', matched: 'gateway' })
    expect(`${hit?.before}${hit?.matched}${hit?.after}`).toContain('When the gateway refuses')
  })

  it('shows the newest note that matches, not the first', () => {
    expect(matchOf(items[2], 'gateway')).toMatchObject({
      field: 'note',
      matched: 'gateway',
      after: expect.stringContaining('note'),
    })
    expect(matchOf(items[2], 'gateway')?.before).not.toContain('Older')
  })

  it('clips a long field around the hit and marks the cut', () => {
    const long = card('long', 'Long body', {
      description: `${'a '.repeat(80)}needle${' b'.repeat(80)}`,
    })
    const hit = matchOf(long, 'needle')!
    expect(hit.before.startsWith('…')).toBe(true)
    expect(hit.after.endsWith('…')).toBe(true)
    expect(hit.before.length).toBeLessThan(100)
    expect(hit.after.length).toBeLessThan(100)
  })

  it('is case-insensitive and treats a blank query as no search', () => {
    expect(searchItems(items, '  GaTeWaY  ').map((item) => item.id)).toContain('title-first')
    expect(searchItems(items, '   ')).toEqual([])
    expect(searchItems(items, 'zzzzz')).toEqual([])
  })

  it('does not search a move or an edit as if it were a comment', () => {
    const moved = card('moved', 'A move', {
      log: [{ id: 'l', at: 1, kind: 'moved', note: 'Backlog → Done' }],
    })
    expect(matchOf(moved, 'Backlog')).toBeUndefined()
  })

  it('finds the line in a note that came without its card', () => {
    const entry = { id: 'n1', at: 1, kind: 'noted' as const, note: 'The retries need a budget' }
    expect(noteMatch(entry, 'RETRIES')).toMatchObject({ field: 'note', matched: 'retries' })
    expect(noteMatch(entry, 'nothing')).toBeUndefined()
    // Only a comment is searched: a move is not a note, even when the words match.
    expect(noteMatch({ id: 'm1', at: 1, kind: 'moved', note: 'Backlog → Done' }, 'Backlog')).toBeUndefined()
  })
})
