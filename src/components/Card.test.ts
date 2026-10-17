import { describe, expect, it } from 'vitest'
import { cardPropsEqual } from './Card'
import type { Item, IssueType } from '@/domain/types'

/**
 * The comparison behind `memo(Card)` — pure, so it can be tested without a browser. What matters
 * is that it is *narrow enough* (a card that changed re-renders) and *wide enough* (a card that
 * did not, does not — which is the whole point of having it).
 */
type CardProps = Parameters<typeof cardPropsEqual>[0]

const type: IssueType = { id: 't-story', name: 'User Story', color: '#0ea5e9' }
const item = (patch: Partial<Item> = {}): Item => ({ id: 'a', title: 'A card', typeId: 't-story', createdAt: 0, ...patch })
const summary = {
  childCount: 0,
  dependentsCount: 0,
  linksCount: 0,
  blockedBelow: 0,
  openDescendants: 0,
  done: false,
  ageDays: 1,
  checklist: { done: 1, total: 2 },
}
/** The same references the board hands every card: an item is immutable, so the store's own
 * object is what arrives, and the type and the people directory are the store's arrays. */
const sharedItem = item()
const props = (patch: Partial<CardProps> = {}): CardProps => ({
  item: sharedItem,
  type,
  ref_: 'USER1',
  summary,
  onOpen: () => {},
  ...patch,
})

describe('card memo', () => {
  it('skips a card nothing has changed about', () => {
    // Fresh objects every time — the summaries and the parent chips are built per render — and
    // still equal, which is the case the board is made of.
    expect(cardPropsEqual(props(), props())).toBe(true)
    expect(cardPropsEqual(props({ parent: { id: 'p', ref_: 'INIT1', title: 'P', type } }), props({ parent: { id: 'p', ref_: 'INIT1', title: 'P', type } }))).toBe(true)
  })

  it('re-renders when anything the card draws has changed', () => {
    expect(cardPropsEqual(props(), props({ selected: true }))).toBe(false)
    expect(cardPropsEqual(props(), props({ multi: true }))).toBe(false)
    expect(cardPropsEqual(props(), props({ dimmed: true }))).toBe(false)
    expect(cardPropsEqual(props(), props({ boundary: true }))).toBe(false)
    expect(cardPropsEqual(props(), props({ locked: true }))).toBe(false)
    expect(cardPropsEqual(props(), props({ lens: 'out' }))).toBe(false)
    expect(cardPropsEqual(props(), props({ ref_: 'USER2' }))).toBe(false)
    expect(cardPropsEqual(props(), props({ item: item({ title: 'Renamed' }) }))).toBe(false)
    expect(cardPropsEqual(props(), props({ summary: { ...summary, blockedBelow: 1 } }))).toBe(false)
    expect(cardPropsEqual(props(), props({ summary: { ...summary, checklist: { done: 2, total: 2 } } }))).toBe(false)
    expect(cardPropsEqual(props(), props({ summary: { ...summary, ageDays: undefined } }))).toBe(false)
    expect(cardPropsEqual(props(), props({ parent: { id: 'p', ref_: 'INIT1', title: 'P', type } }))).toBe(false)
  })

  it('ignores the callbacks on purpose, and says why', () => {
    // They are rebuilt every render, and the ones that could go stale — the drag gesture and
    // where it lands — read the newest state through a ref (see `dragRef` in BoardCanvas), so a
    // card keeping the callback it was first given cannot act on an old board.
    expect(cardPropsEqual(props(), props({ onOpen: () => {}, onLift: () => {}, onContextMenu: () => {} }))).toBe(true)
  })
})
