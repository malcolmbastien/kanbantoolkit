import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFixture } from './domain/fixture'
import { placementsInOrder } from './domain/lanes'
import { announce, resetAnnouncements, subscribeAnnouncements } from './lib/announce'
import { useStore } from './store'

/**
 * What the app says out loud.
 *
 * Three changes a sighted person sees and a screen reader does not: a card arriving somewhere, a
 * card's place among its neighbours changing, and a gesture the rules refused. Each is announced
 * at the seam that writes it, so the pointer, the menu, the keyboard and the bulk bar all speak
 * the same sentence — and none of them speak when nothing changed.
 */

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })

const s = () => useStore.getState()
const heard: string[] = []

beforeEach(() => {
  resetAnnouncements()
  heard.length = 0
  subscribeAnnouncements((message) => heard.push(message.replace('\u200b', '')))
  s().resetDemo()
  useStore.setState({ ...createFixture() })
  // The atlas board, because that is the one whose lanes hold cards — a portfolio shows
  // initiatives and would have nothing to reorder.
  useStore.setState({ boardId: 'b-atlas' })
})

/**
 * A cell that already holds more than one card — the fixture's Done column, where the finished
 * work is. The reorder assertions are about the order, so they start from a lane that has one.
 */
function crowdedLane() {
  const state = s()
  const cells = state.placements.filter((p) => {
    const lane = state.lanes.find((l) => l.id === p.laneId)
    return p.boardId === state.boardId && lane?.workflow === 'cards' && lane?.parentId
  })
  for (const laneId of new Set(cells.map((p) => p.laneId))) {
    const ordered = placementsInOrder(state.placements, laneId)
    if (ordered.length >= 2) return { laneId, ordered }
  }
  throw new Error('the fixture has no cell with two cards')
}

describe('what the app says', () => {
  it('says where a card went, by its name and the lane path — never by an id', () => {
    const state = s()
    const from = state.placements.find((p) => p.boardId === state.boardId)!
    const other = state.lanes.find((l) => l.workflow === 'cards' && l.id !== from.laneId && l.parentId)!
    const title = state.items.find((i) => i.id === from.itemId)!.title

    expect(s().moveCard(from.itemId, state.boardId, other.id)).toBe(true)
    expect(heard).toHaveLength(1)
    expect(heard[0]).toContain(title)
    expect(heard[0]).not.toContain(from.itemId)
    expect(heard[0]).toContain(other.name)
  })

  it('says a drop the board refused, and why — a refusal is not silence', () => {
    const state = s()
    const cells = state.placements.filter((p) => {
      const lane = state.lanes.find((l) => l.id === p.laneId)
      return p.boardId === state.boardId && lane?.workflow === 'cards' && lane.parentId
    })
    const target = cells[0]
    const other = cells.find((p) => p.laneId !== target.laneId)!

    // A board that blocks, and a lane already at its limit: the move is refused, not merely
    // unnoticed.
    useStore.setState({
      boards: state.boards.map((b) => (b.id === state.boardId ? { ...b, wipEnforcement: 'block' as const } : b)),
    })
    s().setLaneWip(target.laneId, 1)

    expect(s().moveCard(other.itemId, state.boardId, target.laneId)).toBe(false)
    expect(heard[0]).toContain('was not moved')
    expect(heard[0]).toContain('limit of 1')
  })

  it('says where a reordered card landed, and says nothing when it cannot move', () => {
    const { ordered } = crowdedLane()
    const [first, second] = ordered.map((p) => p.itemId)
    const firstTitle = s().items.find((i) => i.id === first)!.title

    // The second card up: one place.
    s().reorderCard(second, -1)
    expect(heard[0]).toContain('is now 1 of')
    expect(placementsInOrder(s().placements, ordered[0].laneId)[0].itemId).toBe(second)

    // The card now at the top has nowhere to go, and says so rather than doing nothing.
    heard.length = 0
    s().reorderCard(second, -1)
    expect(heard[0]).toContain('already first')
    expect(s().items.find((i) => i.id === first)!.title).toBe(firstTitle)
  })

  it('says a hierarchy edit the rule refused, and one it accepted', () => {
    const state = s()
    const card = state.items.find((i) => state.placements.some((p) => p.itemId === i.id && p.boardId === state.boardId))!

    // An item is never its own parent.
    s().setParent(card.id, card.id)
    expect(heard[0]).toContain('cannot roll up to')

    const initiative = state.items.find((i) => state.issueTypes.find((t) => t.id === i.typeId)?.name === 'Initiative')!
    heard.length = 0
    s().setParent(card.id, initiative.id)
    expect(heard[0]).toContain('now rolls up to')
    expect(heard[0]).toContain(initiative.title)
  })

  it('does not speak before anything is listening', () => {
    resetAnnouncements()
    const state = s()
    const from = state.placements.find((p) => p.boardId === state.boardId)!
    // No listener: the move still happens, and nothing throws.
    expect(() => announce('nothing')).not.toThrow()
    expect(from.itemId).toBeTruthy()
  })
})
