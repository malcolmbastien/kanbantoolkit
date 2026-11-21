import { describe, expect, it } from 'vitest'
import {
  canRemoveFlow,
  canRenameFlow,
  canReorderFlow,
  cardsFlows,
  copyCardsFlow,
  flowLaneIds,
  flowOf,
  flowsOf,
  initiativesFlow,
  kindOf,
  nextFlowName,
} from './flows'
import { leafLanes, rootLane, topLevelLanes } from './lanes'
import type { BoardFlow, Lane, Placement } from './types'

/**
 * A board's flows are its lane trees, named and ordered. The old model had no such record: a lane
 * carried a two-value kind, and "the cards tree" was whichever root came back first. These are the
 * facts that make several cards flows on one board possible — and the ones that make a missing flow
 * fail loudly instead of quietly answering with a sibling.
 */

const flow = (id: string, kind: BoardFlow['kind'], name: string, order = 0): BoardFlow => ({
  id,
  boardId: 'b',
  kind,
  name,
  order,
})

const flows: BoardFlow[] = [
  flow('f-delivery', 'cards', 'Delivery', 0),
  flow('f-support', 'cards', 'Support', 1),
  flow('f-initiatives', 'initiatives', 'Initiatives'),
]

const lane = (id: string, flowId: string, parentId: string | null = null, order = 0): Lane => ({
  id,
  boardId: 'b',
  parentId,
  order,
  name: id,
  flowId,
  ...(parentId ? {} : { orientation: 'columns' as const }),
})

const placed = (itemId: string, laneId: string): Placement => ({ id: `p-${itemId}`, boardId: 'b', itemId, laneId })

describe('a board’s flows', () => {
  it('lists each tree, in the order the board shows them, told apart by kind', () => {
    expect(cardsFlows(flows, 'b').map((f) => f.name)).toEqual(['Delivery', 'Support'])
    expect(initiativesFlow(flows, 'b')?.id).toBe('f-initiatives')
    expect(flowsOf(flows, 'b', 'cards')).toHaveLength(2)
    expect(flowsOf(flows, 'another-board', 'cards')).toEqual([])
  })

  it('resolves a flow by id, never by kind', () => {
    expect(flowOf(flows, 'f-support')?.name).toBe('Support')
    // `'cards'` is a kind, not an id: asking for a tree by kind is what this model removed.
    expect(flowOf(flows, 'cards')).toBeUndefined()
    expect(kindOf(flows, 'f-support')).toBe('cards')
    expect(kindOf(flows, 'f-initiatives')).toBe('initiatives')
  })

  it('a lane whose flow is not there is not classified, and never resolves to another tree', () => {
    const lanes = [lane('x', 'f-gone')]
    // No guess: a lane whose flow is missing has no kind, which is how a broken tree reads as broken.
    expect(kindOf(flows, 'f-gone')).toBeUndefined()
    // It is *that* flow's root by id — and no other flow can reach it.
    expect(rootLane(lanes, 'f-gone')?.id).toBe('x')
    expect(rootLane(lanes, 'f-delivery')).toBeUndefined()
    expect(leafLanes(lanes, 'f-delivery')).toEqual([])
  })

  it('copies a cards flow’s columns and description, with fresh ids and Copy in the name', () => {
    const source: BoardFlow = { ...flow('f-support', 'cards', 'Support', 1), description: 'Tickets from customers.' }
    const lanes = [
      lane('s-root', 'f-support'),
      { ...lane('s-backlog', 'f-support', 's-root', 0), stage: 'backlog' as const, wipLimit: 3, description: 'Not picked up.' },
      { ...lane('s-doing', 'f-support', 's-root', 1), stage: 'inProgress' as const, orientation: 'rows' as const },
      { ...lane('s-doing-a', 'f-support', 's-doing', 0), stage: 'inProgress' as const },
    ]
    let n = 0
    const copied = copyCardsFlow(source, flows, lanes, () => `copy${++n}`)!

    expect(copied.flow).toMatchObject({
      boardId: 'b',
      kind: 'cards',
      name: 'Support Copy',
      description: 'Tickets from customers.',
      order: 2,
    })
    expect(copied.flow.id).not.toBe(source.id)
    // Only its own columns come across: the other flow's lanes and the initiatives flow's do not.
    expect(copied.lanes).toHaveLength(4)
    expect(copied.lanes.every((l) => l.flowId === copied.flow.id)).toBe(true)
    expect(new Set(copied.lanes.map((l) => l.id)).size).toBe(4)
    // The tree keeps its shape and its column design, under fresh ids.
    const byName = new Map(copied.lanes.map((l) => [l.name, l]))
    expect(byName.get('s-backlog')).toMatchObject({ stage: 'backlog', wipLimit: 3, description: 'Not picked up.' })
    expect(byName.get('s-doing')).toMatchObject({ orientation: 'rows' })
    expect(byName.get('s-doing-a')?.parentId).toBe(byName.get('s-doing')?.id)
    expect(copied.lanes.find((l) => l.parentId === null)?.id).toBe(byName.get('s-root')?.id)
    // The source is untouched, and an initiatives flow is not the team's to copy.
    expect(flows.find((f) => f.id === 'f-support')?.name).toBe('Support')
    expect(copyCardsFlow(flows[2], flows, lanes, () => 'x')).toBeUndefined()
    // A second copy of the same name gets a number rather than colliding with the first.
    expect(copyCardsFlow(source, [...flows, copied.flow], lanes, () => 'y')?.flow.name).toBe('Support Copy 2')
  })

  it('keeps two cards flows apart: a walk from one root never reaches the other', () => {
    const lanes = [
      lane('d-root', 'f-delivery'),
      lane('d-backlog', 'f-delivery', 'd-root'),
      lane('d-done', 'f-delivery', 'd-root', 1),
      lane('s-root', 'f-support'),
      lane('s-triage', 'f-support', 's-root'),
      lane('i-root', 'f-initiatives'),
    ]
    expect(rootLane(lanes, 'f-delivery')?.id).toBe('d-root')
    expect(rootLane(lanes, 'f-support')?.id).toBe('s-root')
    expect(topLevelLanes(lanes, 'f-delivery').map((l) => l.id)).toEqual(['d-backlog', 'd-done'])
    expect(leafLanes(lanes, 'f-support').map((l) => l.id)).toEqual(['s-triage'])
    // The ids are what "a card is in this flow" is asked about, so they must not overlap.
    expect([...flowLaneIds(lanes, 'f-delivery')].sort()).toEqual(['d-backlog', 'd-done', 'd-root'])
  })

  it('lets the team name, order and remove a cards flow — and never the initiatives one', () => {
    expect(canRenameFlow(flows, 'f-support')).toBe(true)
    expect(canReorderFlow(flows, 'f-support')).toBe(true)
    expect(canRenameFlow(flows, 'f-initiatives')).toBe(false)
    expect(canReorderFlow(flows, 'f-initiatives')).toBe(false)
    expect(canRemoveFlow(flows, 'f-initiatives', [], [])).toBe(false)
  })

  it('keeps the last cards flow, and refuses one that still holds a card', () => {
    const only: BoardFlow[] = [flow('f-only', 'cards', 'Cards'), flow('f-initiatives', 'initiatives', 'Initiatives')]
    expect(canRemoveFlow(only, 'f-only', [lane('only-root', 'f-only')], [])).toBe(false)

    // The board's own first flow is a flow like any other: empty, with another there, it can go.
    expect(canRemoveFlow(flows, 'f-delivery', [lane('d-root', 'f-delivery')], [])).toBe(true)

    const lanes = [lane('s-root', 'f-support'), lane('s-cell', 'f-support', 's-root')]
    expect(canRemoveFlow(flows, 'f-support', lanes, [placed('i-1', 's-cell')])).toBe(false)
    // Nothing in it, and two cards flows exist: it can go.
    expect(canRemoveFlow(flows, 'f-support', lanes, [placed('i-1', 'd-cell')])).toBe(true)
  })

  it('names a new cards flow without colliding with one already there', () => {
    expect(nextFlowName(flows, 'b')).toBe('Cards Workflow 1')
    expect(nextFlowName([flow('f-1', 'cards', 'Cards')], 'b')).toBe('Cards Workflow 2')
    expect(
      nextFlowName([flow('f-1', 'cards', 'Cards'), flow('f-2', 'cards', 'Cards Workflow 2')], 'b'),
    ).toBe('Cards Workflow 3')
  })
})
