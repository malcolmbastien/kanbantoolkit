import { describe, expect, it } from 'vitest'
import { moveCard, moveInitiative, wipBreach, type MoveContext, type MoveSlice } from './move'
import type { Board, BoardFlow, Item, Lane, Placement } from './types'

/**
 * The move rule, tested where it lives.
 *
 * These are the cases the three doors share: the app's drag, `POST …/move` on `/api/v1`, and an
 * agent's `move_item`. If a test here fails, two of the three surfaces are lying — which is exactly
 * why the rule is not in a route.
 */

let n = 0
const context: MoveContext = { at: 1_700_000_000_000, by: 'u-ada', id: () => `x-${++n}` }

const CARDS = 'f-cards'
const INIT = 'f-initiatives'

const lane = (id: string, extra: Partial<Lane> = {}): Lane => ({
  id,
  boardId: 'b',
  parentId: null,
  order: 0,
  name: id,
  flowId: CARDS,
  stage: 'inProgress',
  ...extra,
})

const board = (extra: Partial<Board> = {}): Board => ({ id: 'b', name: 'Board', band: 'team', description: '', ...extra })

const item = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  title: `Card ${id}`,
  typeId: 't-card',
  createdAt: 0,
  ...extra,
})

const place = (itemId: string, laneId: string, rank = 0): Placement => ({
  id: `p-${itemId}-${laneId}`,
  boardId: 'b',
  itemId,
  laneId,
  laneEnteredAt: 0,
  rank,
})

const slice = (over: Partial<MoveSlice> = {}): MoveSlice => ({
  items: [item('i-1'), item('i-2'), item('i-3')],
  placements: [place('i-1', 'backlog'), place('i-2', 'backlog', 1), place('i-3', 'doing')],
  lanes: [
    lane('backlog', { stage: 'backlog' }),
    lane('doing', { stage: 'inProgress' }),
    lane('done', { stage: 'done' }),
    // A split column: the limit is on the container, the cards are in a cell.
    lane('review', { parentId: null, stage: 'inProgress', wipLimit: 1, orientation: 'columns' }),
    lane('review-a', { parentId: 'review', stage: 'inProgress' }),
    // The initiatives workflow, with its own four sections.
    lane('sec-backlog', { flowId: INIT, stage: 'backlog' }),
    lane('sec-doing', { flowId: INIT, stage: 'inProgress' }),
  ],
  boards: [board()],
  flows: [
    { id: CARDS, boardId: 'b', kind: 'cards', name: 'Cards', order: 0 },
    { id: INIT, boardId: 'b', kind: 'initiatives', name: 'Initiatives', order: 0 },
  ],
  edges: [],
  links: [],
  ...over,
})

describe('a card move', () => {
  it('lands in the target lane, records the journey in stages, and stamps Done', () => {
    const outcome = moveCard(slice(), { itemId: 'i-1', boardId: 'b', laneId: 'done' }, context)
    expect(outcome.kind).toBe('moved')
    if (outcome.kind !== 'moved') return

    const moved = outcome.placements.find((p) => p.itemId === 'i-1')!
    expect(moved.laneId).toBe('done')

    const entry = outcome.items.find((i) => i.id === 'i-1')!.log!.at(-1)!
    expect(entry.kind).toBe('moved')
    // The cells *and* the stages: a lane renamed tomorrow must not rewrite the history.
    expect(entry).toMatchObject({ fromLaneId: 'backlog', toLaneId: 'done', fromStage: 'backlog', toStage: 'done', by: 'u-ada' })
    // Done is a clock: entering starts it…
    expect(outcome.items.find((i) => i.id === 'i-1')!.resolvedAt).toBe(context.at)
  })

  it('clears the Done clock when it leaves', () => {
    const before = slice({ items: [item('i-1', { resolvedAt: 5 }), item('i-2'), item('i-3')] })
    const outcome = moveCard(before, { itemId: 'i-1', boardId: 'b', laneId: 'doing' }, context)
    expect(outcome.kind).toBe('moved')
    if (outcome.kind !== 'moved') return
    expect(outcome.items.find((i) => i.id === 'i-1')!.resolvedAt).toBeNull()
  })

  it('answers yes without writing or narrating when the card is already there', () => {
    const outcome = moveCard(slice(), { itemId: 'i-1', boardId: 'b', laneId: 'backlog' }, context)
    expect(outcome.kind).toBe('moved')
    if (outcome.kind !== 'moved') return
    expect(outcome.positionOnly).toBe(true)
    // No history for a same-cell drop: a log of every drag is noise, not a journey.
    expect(outcome.items.find((i) => i.id === 'i-1')!.log).toBeUndefined()
  })

  it('refuses a cell of the other workflow, and says which', () => {
    const outcome = moveCard(slice(), { itemId: 'i-1', boardId: 'b', laneId: 'sec-doing' }, context)
    expect(outcome.kind).toBe('refused')
    if (outcome.kind !== 'refused') return
    expect(outcome.refusal.code).toBe('wrong_workflow')
    expect(outcome.refusal.message).toContain('cards flow')
  })

  it('refuses a lane and an item that are not there', () => {
    expect(moveCard(slice(), { itemId: 'i-1', boardId: 'b', laneId: 'nope' }, context)).toMatchObject({
      kind: 'refused',
      refusal: { code: 'not_found' },
    })
    expect(moveCard(slice(), { itemId: 'nope', boardId: 'b', laneId: 'doing' }, context)).toMatchObject({
      kind: 'refused',
      refusal: { code: 'not_found' },
    })
  })
})

describe('what a WIP limit does to a move', () => {
  const crowded = () =>
    slice({
      lanes: [lane('backlog', { stage: 'backlog' }), lane('doing', { stage: 'inProgress', wipLimit: 1 })],
      placements: [place('i-1', 'backlog'), place('i-3', 'doing')],
    })

  it('reads the target lane and its limited ancestors', () => {
    const state = slice({
      lanes: [lane('review', { stage: 'inProgress', wipLimit: 1, orientation: 'columns' }), lane('review-a', { parentId: 'review' })],
      placements: [place('i-1', 'review-a')],
    })
    // One card in the subtree, whose limit is one: another card would overfill it.
    expect(wipBreach(state.lanes, state.placements, 'b', 'review-a', 'backlog')?.id).toBe('review')
    // …and a card already inside it moving within does not add to the count.
    expect(wipBreach(state.lanes, state.placements, 'b', 'review-a', 'review-a')).toBeUndefined()
  })

  it('refuses under `block`, with the domain’s sentence', () => {
    const state = { ...crowded(), boards: [board({ wipEnforcement: 'block' as const })] }
    const outcome = moveCard(state, { itemId: 'i-1', boardId: 'b', laneId: 'doing' }, context)
    expect(outcome.kind).toBe('refused')
    if (outcome.kind !== 'refused') return
    expect(outcome.refusal).toMatchObject({
      code: 'wip_blocked',
      message: 'doing is at its limit of 1.',
      details: { laneId: 'doing', laneName: 'doing', limit: 1 },
    })
  })

  it('holds under `justify` until a reason arrives, and carries the position', () => {
    const state = { ...crowded(), boards: [board({ wipEnforcement: 'justify' as const })] }

    const held = moveCard(state, { itemId: 'i-1', boardId: 'b', laneId: 'doing', index: 0 }, context)
    expect(held).toMatchObject({ kind: 'held', code: 'wip_justify', laneName: 'doing', limit: 1, index: 0 })
    // Held means held: nothing was written.
    expect(held.kind === 'held' && held.message).toContain('a reason is needed')

    const landed = moveCard(state, { itemId: 'i-1', boardId: 'b', laneId: 'doing', reason: 'Signed off', index: 0 }, context)
    expect(landed.kind).toBe('moved')
    if (landed.kind !== 'moved') return
    expect(landed.justified).toBe(true)
    // The reason is on the card and in its history, and the place it was offered is where it landed.
    const card = landed.items.find((i) => i.id === 'i-1')!
    expect(card.lastMoveReason).toBe('Signed off')
    expect(card.log!.map((e) => e.kind)).toEqual(['limit', 'moved'])
    expect(landed.placement.rank).toBe(0)
  })

  it('lets a person move freely when the board only visualizes', () => {
    const state = { ...crowded(), boards: [board({ wipEnforcement: 'visualize' as const })] }
    expect(moveCard(state, { itemId: 'i-1', boardId: 'b', laneId: 'doing' }, context).kind).toBe('moved')
  })
})

describe('a position in a lane', () => {
  it('lands at the index the caller named, and renumbers the lane densely', () => {
    const state = slice({
      placements: [place('i-1', 'backlog', 0), place('i-2', 'backlog', 1), place('i-3', 'doing', 0)],
    })
    const outcome = moveCard(state, { itemId: 'i-3', boardId: 'b', laneId: 'backlog', index: 1 }, context)
    expect(outcome.kind).toBe('moved')
    if (outcome.kind !== 'moved') return

    const backlog = outcome.placements
      .filter((p) => p.laneId === 'backlog')
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      .map((p) => p.itemId)
    expect(backlog).toEqual(['i-1', 'i-3', 'i-2'])
    expect(outcome.placements.filter((p) => p.laneId === 'backlog').map((p) => p.rank).sort()).toEqual([0, 1, 2])
  })

  it('clamps a position past the end rather than appending past it', () => {
    const state = slice()
    const outcome = moveCard(state, { itemId: 'i-3', boardId: 'b', laneId: 'backlog', index: 99 }, context)
    expect(outcome.kind).toBe('moved')
    if (outcome.kind !== 'moved') return
    const backlog = outcome.placements.filter((p) => p.laneId === 'backlog').sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    expect(backlog.map((p) => p.itemId)).toEqual(['i-1', 'i-2', 'i-3'])
  })
})

describe('a move between two cards flows', () => {
  const support: BoardFlow = { id: 'f-support', boardId: 'b', kind: 'cards', name: 'Support', order: 1 }

  /** The fixture's cards flow, plus a second one with its own limited cell. */
  const twoFlows = (enforcement: Board['wipEnforcement']) => {
    const base = slice()
    return slice({
      boards: [board({ wipEnforcement: enforcement })],
      flows: [...base.flows, support],
      lanes: [
        ...base.lanes,
        lane('support-gate', { flowId: 'f-support', stage: 'inProgress', wipLimit: 1 }),
        lane('support-cell', { flowId: 'f-support', parentId: 'support-gate', stage: 'inProgress' }),
        lane('support-open', { flowId: 'f-support', stage: 'inProgress' }),
      ],
      // The second flow already has work in the limited cell.
      placements: [...base.placements, place('i-2', 'support-cell')],
    })
  }

  it('lands in the other tree as one placement, with no rule of its own', () => {
    const outcome = moveCard(twoFlows('visualize'), { itemId: 'i-1', boardId: 'b', laneId: 'support-open' }, context)
    expect(outcome.kind).toBe('moved')
    if (outcome.kind !== 'moved') return
    const mine = outcome.placements.filter((p) => p.itemId === 'i-1')
    expect(mine).toHaveLength(1)
    expect(mine[0].laneId).toBe('support-open')
    // The history says it changed trees, so it does not read as a local move.
    expect(outcome.items.find((i) => i.id === 'i-1')!.log!.at(-1)!.note).toBe('Cards: backlog → Support: support-open')
  })

  it('is judged by the target flow’s own WIP, not by the one it came from', () => {
    const blocked = moveCard(twoFlows('block'), { itemId: 'i-1', boardId: 'b', laneId: 'support-cell' }, context)
    expect(blocked).toMatchObject({ kind: 'refused', refusal: { code: 'wip_blocked' } })

    const held = moveCard(twoFlows('justify'), { itemId: 'i-1', boardId: 'b', laneId: 'support-cell' }, context)
    expect(held.kind).toBe('held')
  })
})

describe('an initiative move', () => {
  const initiative = (id: string) => item(id, { typeId: 't-initiative' })

  it('arranges within a section, and records it', () => {
    const state = slice({
      items: [initiative('i-init')],
      placements: [place('i-init', 'sec-backlog')],
      lanes: slice().lanes,
    })
    const outcome = moveInitiative(state, { itemId: 'i-init', boardId: 'b', laneId: 'sec-backlog' }, context)
    expect(outcome.kind).toBe('moved')
    if (outcome.kind !== 'moved') return
    expect(outcome.positionOnly).toBe(true)
  })

  it('refuses a cell of the cards workflow', () => {
    const state = slice({ items: [initiative('i-init')], placements: [place('i-init', 'sec-backlog')] })
    const outcome = moveInitiative(state, { itemId: 'i-init', boardId: 'b', laneId: 'doing' }, context)
    expect(outcome.kind).toBe('refused')
    if (outcome.kind !== 'refused') return
    expect(outcome.refusal.code).toBe('wrong_workflow')
    expect(outcome.refusal.message).toContain('initiatives flow')
  })

  it('refuses to cross a section once work is below it', () => {
    // A child in Backlog makes the initiative's section Backlog, and a cell in Not Started is
    // another section: arrangement within a section is a person's, crossing one is not.
    const state = slice({
      items: [initiative('i-init'), item('i-kid')],
      placements: [place('i-init', 'sec-backlog'), place('i-kid', 'backlog')],
      edges: [{ id: 'e', kind: 'decomposition', from: 'i-init', to: 'i-kid' }],
    })
    const outcome = moveInitiative(state, { itemId: 'i-init', boardId: 'b', laneId: 'sec-doing' }, context)
    expect(outcome.kind).toBe('refused')
    if (outcome.kind !== 'refused') return
    expect(outcome.refusal.code).toBe('section_fixed')
    expect(outcome.refusal.message).toContain('cannot cross one')
    expect('details' in outcome.refusal && outcome.refusal.details).toMatchObject({
      section: 'inProgress',
      itemSection: 'backlog',
    })
  })
})
