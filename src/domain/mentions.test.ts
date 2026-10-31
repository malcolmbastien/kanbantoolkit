import { describe, expect, it } from 'vitest'
import { insertMention, mentionedIds, mentionQueryAt, mentionsFor } from './mentions'
import type { Item, User } from './types'

const users: User[] = [
  { id: 'u-riley', name: 'Riley Kim' },
  { id: 'u-riley-s', name: 'Riley' },
  { id: 'u-maya', name: 'Maya Blake' },
]

describe('mentions in notes', () => {
  it('finds the token being typed after @, and matches a surname too', () => {
    expect(mentionQueryAt('Ask @Ri', 7, users)).toMatchObject({
      start: 4,
      query: 'Ri',
      matches: expect.arrayContaining([
        expect.objectContaining({ id: 'u-riley' }),
        expect.objectContaining({ id: 'u-riley-s' }),
      ]),
    })
    expect(mentionQueryAt('Ask @Kim', 8, users)?.matches.map((u) => u.id)).toEqual(['u-riley'])
  })

  it('does not treat an email address as a mention', () => {
    expect(mentionQueryAt('Write to ada@example.com', 22, users)).toBeUndefined()
  })

  it('puts the chosen name in place of the token and leaves the rest alone', () => {
    expect(insertMention('Ask @Ri about it', 7, 4, users[0])).toEqual({
      text: 'Ask @Riley Kim  about it',
      caret: 15,
    })
  })

  it('records a mention only when the whole @Name is a word, and the longest name wins', () => {
    expect(mentionedIds('@riley kim, can you look?', users)).toEqual(['u-riley'])
    expect(mentionedIds('@Riley can you look?', users)).toEqual(['u-riley-s'])
    expect(mentionedIds('@Riley, look', users)).toEqual(['u-riley-s'])
    expect(mentionedIds('@RileyKim is not a person', users)).toEqual([])
    expect(mentionedIds('Ada@example.com', users)).toEqual([])
    expect(mentionedIds('@Maya Blake and @riley kim', users)).toEqual(['u-maya', 'u-riley'])
  })

  it('finds notes that mention a person, newest first, archived work included', () => {
    const item = (id: string, archived: boolean, at: number, note: string): Item => ({
      id,
      title: id,
      typeId: 't-card',
      createdAt: 0,
      archived,
      log: [{ id: `${id}-l`, at, kind: 'noted', note, mentions: ['u-riley'] }],
    })
    const items = [item('old', false, 1, 'An older note'), item('new', true, 2, 'A newer note')]
    const found = mentionsFor(items, [{ id: 'p-old', boardId: 'b-1', itemId: 'old', laneId: 'l-1' }], 'u-riley')
    expect(found.map((entry) => entry.item.id)).toEqual(['new', 'old'])
    expect(found.find((entry) => entry.item.id === 'old')?.boardId).toBe('b-1')
    expect(found.find((entry) => entry.item.id === 'new')?.boardId).toBeUndefined()
  })
})
