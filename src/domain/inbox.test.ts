import { describe, expect, it } from 'vitest'
import { demoInboxRows, inboxSentence, inboxWhere } from './inbox'
import type { Item, User } from './types'

const users: User[] = [
  { id: 'u-maya', name: 'Maya' },
  { id: 'u-noah', name: 'Noah' },
]

const card = (over: Partial<Item> = {}): Item => ({
  id: 'i-signup',
  title: 'Rebuild the signup form',
  typeId: 't-story',
  createdAt: 0,
  ...over,
})

describe('the inbox', () => {
  it('says what happened in one sentence, with the actor and the cell', () => {
    expect(
      inboxSentence({
        id: 'e1',
        type: 'item.moved',
        at: 1,
        read: false,
        actor: 'Maya',
        itemId: 'i-signup',
        itemTitle: 'Rebuild the signup form',
        laneName: 'Done',
        fromStage: 'inProgress',
        toStage: 'done',
      }),
    ).toBe('Maya moved Rebuild the signup form from In progress to Done')

    expect(
      inboxSentence({
        id: 'e2',
        type: 'item.blocked',
        at: 1,
        read: false,
        actor: 'Noah',
        itemId: 'i-signup',
        itemTitle: 'Rebuild the signup form',
        reason: 'Waiting on legal',
      }),
    ).toBe('Noah blocked Rebuild the signup form — Waiting on legal')

    expect(
      inboxSentence({
        id: 'e3',
        type: 'item.updated',
        at: 1,
        read: false,
        actor: 'Maya',
        itemId: 'i-signup',
        itemTitle: 'Rebuild the signup form',
        fields: ['due date', 'assignees'],
      }),
    ).toBe('Maya edited Rebuild the signup form (due date, assignees)')

    expect(
      inboxSentence({
        id: 'e4',
        type: 'initiative.health_changed',
        at: 1,
        read: false,
        itemId: 'i-signup',
        itemTitle: 'Signup',
        health: { before: 'healthy', after: 'atRisk' },
      }),
    ).toBe('Signup is now at risk (was on track)')

    // An unknown kind is still a row, because a quiet omission is worse than a vague sentence.
    expect(
      inboxSentence({
        id: 'e5',
        type: 'objective.mapped' as never,
        at: 1,
        read: false,
        itemId: 'i-signup',
        itemTitle: 'Rebuild the signup form',
        actor: undefined,
      }),
    ).toBe('Somebody mapped Rebuild the signup form to an objective')
  })

  it('puts the board and the cell beside the sentence', () => {
    expect(inboxWhere({ boardName: 'Team Atlas', laneName: 'Done' })).toBe('Team Atlas · Done')
    expect(inboxWhere({ boardName: 'Team Atlas' })).toBe('Team Atlas')
    expect(inboxWhere({})).toBeUndefined()
  })

  it('starts a watch now, not at the beginning of the card’s history', () => {
    const rows = demoInboxRows({
      users,
      boards: [{ id: 'b-atlas', name: 'Team Atlas', band: 'team', description: '' }],
      lanes: [],
      watchedItemIds: ['i-signup'],
      watchStartedAt: { 'i-signup': 35 },
      readAt: 0,
      items: [
        card({
          log: [
            { id: 'l1', at: 10, kind: 'created', by: 'u-maya' },
            { id: 'l2', at: 30, kind: 'noted', note: 'Older than the watch.', by: 'u-noah' },
            { id: 'l3', at: 40, kind: 'moved', by: 'u-maya', toStage: 'done' },
          ],
        }),
      ],
    })
    // The watch began at 35: the two earlier entries are history, and only the move is news.
    expect(rows.map((row) => row.id)).toEqual(['l3'])
  })

  it('reads a demo inbox from the histories of watched items, newest first', () => {
    const rows = demoInboxRows({
      users,
      boards: [{ id: 'b-atlas', name: 'Team Atlas', band: 'team', description: '' }],
      lanes: [{ id: 'l-done', boardId: 'b-atlas', parentId: null, order: 0, name: 'Done', flowId: 'f-cards', stage: 'done' }],
      watchedItemIds: ['i-signup'],
      readAt: 20,
      items: [
        card({
          log: [
            { id: 'l1', at: 10, kind: 'created', by: 'u-maya' },
            { id: 'l2', at: 30, kind: 'noted', note: 'Deployed to staging.', by: 'u-noah', mentions: ['u-maya'] },
            {
              id: 'l3',
              at: 40,
              kind: 'moved',
              note: 'In progress → Done',
              by: 'u-maya',
              boardId: 'b-atlas',
              toLaneId: 'l-done',
              fromStage: 'inProgress',
              toStage: 'done',
            },
          ],
        }),
        // Not watched: its history is not this person's inbox.
        card({ id: 'i-other', title: 'Something else', log: [{ id: 'l9', at: 50, kind: 'noted', note: 'x' }] }),
      ],
    })

    expect(rows.map((row) => row.id)).toEqual(['l3', 'l2', 'l1'])
    expect(rows[0]).toMatchObject({
      type: 'item.moved',
      actor: 'Maya',
      boardName: 'Team Atlas',
      laneName: 'Done',
      read: false,
    })
    expect(rows[1]).toMatchObject({ type: 'item.noted', actor: 'Noah', read: false, mentions: ['u-maya'] })
    // At or before the cursor is read; everything newer is unread.
    expect(rows[2].read).toBe(true)
    expect(inboxSentence(rows[0])).toBe('Maya moved Rebuild the signup form from In progress to Done')
  })
})
