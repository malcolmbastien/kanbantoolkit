import { describe, expect, it } from 'vitest'
import { canPromoteToInitiative, promoteToInitiative, type PromotionContext, type PromotionSlice } from './promote'
import type { Board, BoardFlow, Item, IssueType, Lane, Placement } from './types'

/**
 * The conversion, tested where the rule lives.
 *
 * The card menu and `/api/v1` both ask this; if a test here fails, one of them is promising
 * something the other refuses. The cases are the item's identity, the type it gives up, and the
 * section its stage puts it in — plus every refusal a menu must not offer.
 */

let n = 0
const context: PromotionContext = { at: 1_700_000_000_000, by: 'u-ada', id: () => `x-${++n}` }

const CARDS = 'f-cards'
const INIT = 'f-initiatives'

const TYPES: IssueType[] = [
  { id: 't-none', name: 'None', color: '#64748b' },
  { id: 't-story', name: 'User Story', color: '#0ea5e9' },
  { id: 't-init', name: 'Initiative', color: '#8b5cf6' },
]

const board = (extra: Partial<Board> = {}): Board => ({ id: 'b', name: 'Board', band: 'team', description: '', ...extra })

const lane = (id: string, stage: Lane['stage'], flowId: string, parentId: string | null = null, order = 0): Lane => ({
  id,
  boardId: 'b',
  parentId,
  order,
  name: id,
  flowId,
  ...(stage ? { stage } : {}),
})

const lanes: Lane[] = [
  lane('cards-root', undefined, CARDS),
  lane('c-backlog', 'backlog', CARDS, 'cards-root', 0),
  lane('c-not-started', 'notStarted', CARDS, 'cards-root', 1),
  lane('c-doing', 'inProgress', CARDS, 'cards-root', 2),
  lane('c-done', 'done', CARDS, 'cards-root', 3),
  lane('init-root', undefined, INIT),
  lane('s-backlog', 'backlog', INIT, 'init-root', 0),
  lane('s-not-started', 'notStarted', INIT, 'init-root', 1),
  lane('s-doing', 'inProgress', INIT, 'init-root', 2),
  lane('s-done', 'done', INIT, 'init-root', 3),
]

const flows: BoardFlow[] = [
  { id: CARDS, boardId: 'b', kind: 'cards', name: 'Cards', order: 0 },
  { id: INIT, boardId: 'b', kind: 'initiatives', name: 'Initiatives', order: 0 },
]

const item = (extra: Partial<Item> = {}): Item => ({
  id: 'i-card',
  title: 'Add SSO',
  typeId: 't-story',
  description: 'The whole story',
  assignees: ['u-ada'],
  tagIds: ['g-security'],
  priority: 'high',
  targetStartDate: '2026-11-01',
  targetEndDate: '2026-11-30',
  dueDate: '2026-11-20',
  externalLabel: 'ATLAS-12',
  externalUrl: 'https://example.com/ATLAS-12',
  checklist: [{ id: 'ch-1', text: 'Draft', done: true }],
  blocked: true,
  blockedReason: 'Waiting on the identity contract',
  createdAt: 10,
  createdById: 'u-ada',
  log: [{ id: 'l-1', at: 10, kind: 'created' }],
  ...extra,
})

const place = (itemId: string, laneId: string, rank = 0, id = `p-${itemId}-${laneId}`): Placement => ({
  id,
  boardId: 'b',
  itemId,
  laneId,
  laneEnteredAt: 5,
  rank,
})

const slice = (over: Partial<PromotionSlice> = {}): PromotionSlice => ({
  items: [item()],
  boards: [board()],
  placements: [place('i-card', 'c-doing', 2)],
  lanes,
  flows,
  issueTypes: TYPES,
  ...over,
})

const refused = (outcome: ReturnType<typeof promoteToInitiative>): string => {
  expect(outcome.kind).toBe('refused')
  return outcome.kind === 'refused' ? outcome.message : ''
}

describe('a card becoming an initiative', () => {
  it('keeps the item and its whole record, and gives up only its card type', () => {
    const before = item({ initiativeTypeId: 'k-legacy' })
    const outcome = promoteToInitiative('i-card', 'b', slice({ items: [before] }), context)
    expect(outcome.kind).toBe('promoted')
    if (outcome.kind !== 'promoted') return

    const { item: after } = outcome
    expect(after.id).toBe('i-card')
    expect(after.typeId).toBe('t-init')
    expect(after.initiativeTypeId).toBeUndefined()
    expect(after).toMatchObject({
      title: before.title,
      description: before.description,
      assignees: before.assignees,
      tagIds: before.tagIds,
      priority: before.priority,
      targetStartDate: before.targetStartDate,
      targetEndDate: before.targetEndDate,
      dueDate: before.dueDate,
      externalLabel: before.externalLabel,
      externalUrl: before.externalUrl,
      checklist: before.checklist,
      blocked: before.blocked,
      blockedReason: before.blockedReason,
      createdAt: before.createdAt,
      createdById: before.createdById,
    })
    // The old type is not lost: it is named in the history, once, with who and when.
    expect(after.log?.at(-1)).toMatchObject({
      kind: 'edited',
      note: 'Converted from a card (was User Story)',
      at: context.at,
      by: 'u-ada',
    })
    expect(after.log?.[0]).toEqual(before.log![0])
  })

  it('leaves the cards flow for the initiatives section of the same stage', () => {
    const outcome = promoteToInitiative('i-card', 'b', slice(), context)
    expect(outcome.kind).toBe('promoted')
    if (outcome.kind !== 'promoted') return
    // A childless card's stage is its own, so In Progress lands in the In Progress section.
    expect(outcome.placement).toMatchObject({
      id: 'p-i-card-c-doing',
      boardId: 'b',
      itemId: 'i-card',
      laneId: 's-doing',
      laneEnteredAt: context.at,
      rank: 0,
    })
    expect(outcome.fromLaneId).toBe('c-doing')
    expect(outcome.toLaneId).toBe('s-doing')
  })

  it('maps all four stages to their own section', () => {
    const pairs: Array<[string, string]> = [
      ['c-backlog', 's-backlog'],
      ['c-not-started', 's-not-started'],
      ['c-doing', 's-doing'],
      ['c-done', 's-done'],
    ]
    for (const [from, to] of pairs) {
      const outcome = promoteToInitiative('i-card', 'b', slice({ placements: [place('i-card', from)] }), context)
      expect(outcome.kind, from).toBe('promoted')
      if (outcome.kind !== 'promoted') continue
      expect(outcome.placement.laneId).toBe(to)
    }
  })

  it('appends past the initiatives already in the section, and imports nothing else', () => {
    const base = slice({
      items: [item(), item({ id: 'i-other', title: 'Other', typeId: 't-init' })],
      placements: [place('i-card', 'c-doing', 1), place('i-other', 's-doing', 0), place('i-other', 'c-done', 0, 'p-other')],
    })
    const outcome = promoteToInitiative('i-card', 'b', base, context)
    expect(outcome.kind).toBe('promoted')
    if (outcome.kind !== 'promoted') return
    // Arriving means arriving at the bottom, not above the work already arranged there.
    expect(outcome.placement.rank).toBe(1)
    // Only the promoted item and its placement are answered; the rest of the slice is untouched.
    expect(base.items[1]).toBe(base.items[1])
    expect(base.placements[0].laneId).toBe('c-doing')
  })

  it('says why it will not: an initiative, an archived card, a portfolio, or no initiatives cell', () => {
    expect(refused(promoteToInitiative('i-card', 'b', slice({ items: [item({ typeId: 't-init' })] }), context))).toMatch(
      /already an initiative/,
    )
    expect(refused(promoteToInitiative('i-card', 'b', slice({ items: [item({ archived: true })] }), context))).toMatch(
      /filed-away/,
    )
    expect(
      refused(promoteToInitiative('i-card', 'b', slice({ boards: [board({ band: 'portfolio' })] }), context)),
    ).toMatch(/portfolio/)
    expect(
      refused(
        promoteToInitiative(
          'i-card',
          'b',
          slice({ lanes: lanes.filter((entry) => !entry.id.startsWith('s-') && entry.id !== 'init-root') }),
          context,
        ),
      ),
    ).toMatch(/initiatives flow has no cell/)
    // A card has to be on this board, and in a cards flow, to leave one.
    expect(refused(promoteToInitiative('i-card', 'b', slice({ placements: [] }), context))).toMatch(/not on this board/)
    expect(
      refused(promoteToInitiative('i-card', 'b', slice({ placements: [place('i-card', 's-doing')] }), context)),
    ).toMatch(/only a card in a cards flow/)
    // The predicate is the same answer the act gives.
    expect(canPromoteToInitiative('i-card', 'b', slice())).toBe(true)
    expect(canPromoteToInitiative('i-card', 'b', slice({ items: [item({ archived: true })] }))).toBe(false)
  })
})
