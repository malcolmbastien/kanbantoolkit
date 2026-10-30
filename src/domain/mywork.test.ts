import { describe, expect, it } from 'vitest'
import { myWork, type MyWorkGroup } from './mywork'
import type { Board, BoardFlow, Item, Lane, Placement } from './types'

const DAY = 86_400_000
const now = Date.UTC(2026, 9, 15, 9, 0, 0)

const board = (id: string, name: string, band: Board['band'] = 'team'): Board => ({ id, name, band, description: '' })
const lane = (id: string, name: string, stageOrWf: Lane['stage']): Lane => ({
  id,
  boardId: 'shared',
  parentId: null,
  order: 0,
  name,
  flowId: 'f-shared',
  stage: stageOrWf,
})
/** One cards flow per board the fixture names, all called Cards. */
const flowsOf = (...boards: Board[]): BoardFlow[] =>
  boards.map((b) => ({ id: `f-${b.id}`, boardId: b.id, kind: 'cards' as const, name: 'Cards', order: 0 }))
const identity = (id: string): BoardFlow[] => [{ id: `f-${id}`, boardId: id, kind: 'cards', name: 'Cards', order: 0 }]

const item = (id: string, assignees?: string[], extra: Partial<Item> = {}): Item => ({
  id,
  title: id,
  typeId: 't-story',
  createdAt: 0,
  ...extra,
  ...(assignees ? { assignees } : {}),
})
const placed = (itemId: string, boardId: string, laneId: string): Placement => ({ id: `p-${itemId}-${boardId}`, boardId, itemId, laneId, laneEnteredAt: now - DAY })

/** Run the query and flatten to (board, item, cell) triplets for readable assertions. */
const flat = (groups: MyWorkGroup[]) =>
  groups.flatMap((g) => g.entries.map((e) => `${g.boardName}/${e.item.title}@${e.cellName}`))

describe('my work — everything assigned to one person, wherever it sits', () => {
  const bTeam = board('b-t', 'Team Atlas')
  const bProg = board('b-p', 'Signup program', 'program')
  const cols: Lane[] = [lane('l-b', 'Backlog', 'backlog'), lane('l-d', 'Dev', 'inProgress'), lane('l-done', 'Done', 'done')]

  it('names the flow in the cell when its board carries more than one cards flow', () => {
    const flows: BoardFlow[] = [
      { id: 'f-delivery', boardId: 'b-t', kind: 'cards', name: 'Delivery', order: 0 },
      { id: 'f-support', boardId: 'b-t', kind: 'cards', name: 'Support', order: 1 },
    ]
    const twoFlows: Lane[] = [
      { ...lane('l-delivery', 'Backlog', 'backlog'), flowId: 'f-delivery' },
      { ...lane('l-support', 'Backlog', 'backlog'), flowId: 'f-support' },
    ]
    const items = [item('i-1', ['u-me'], { title: 'Mine' })]
    const placements = [placed('i-1', 'b-t', 'l-support')]

    // Two Backlogs on one board: the cell says which.
    expect(flat(myWork(items, placements, twoFlows, [bTeam], flows, 'u-me', now))).toEqual([
      'Team Atlas/Mine@Support / Backlog',
    ])
    // One flow is unambiguous, and the drawer does not repeat "Cards" on every row.
    expect(flat(myWork(items, placements, twoFlows, [bTeam], flows.slice(0, 1), 'u-me', now))).toEqual([
      'Team Atlas/Mine@Backlog',
    ])
  })

  it('an item assigned on two boards appears twice with the right contexts', () => {
    const items = [item('i-1', ['u-me'], { title: 'Shared task' })]
    const placements = [placed('i-1', 'b-t', 'l-d'), placed('i-1', 'b-p', 'l-b')]
    const groups = myWork(items, placements, cols, [bTeam, bProg], flowsOf(bTeam, bProg), 'u-me', now)
    expect(flat(groups)).toEqual(['Team Atlas/Shared task@Dev', 'Signup program/Shared task@Backlog'])
  })

  it('other people and the unassigned never appear; archived work stays filed', () => {
    const items = [item('i-mine', ['u-me'], { title: 'Mine' }), item('i-other', ['u-them'], { title: 'Theirs' }), item('i-none', undefined, { title: "Nobody's" }), item('i-old', ['u-me'], { title: 'Filed', archived: true })]
    const placements = [placed('i-mine', 'b-t', 'l-b'), placed('i-other', 'b-t', 'l-b'), placed('i-none', 'b-t', 'l-b'), placed('i-old', 'b-t', 'l-b')]
    expect(flat(myWork(items, placements, cols, [bTeam], identity('shared'), 'u-me', now))).toEqual(['Team Atlas/Mine@Backlog'])
  })

  it('overdue leads, then due soon, then the undated; resolved work has no urgency', () => {
    const overdue = item('o', ['u-me'], { title: 'Overdue', targetEndDate: '2026-10-01' })
    const soon = item('s', ['u-me'], { title: 'Due soon', targetEndDate: '2026-10-18' })
    const future = item('f', ['u-me'], { title: 'Future', targetEndDate: '2027-01-01' })
    const undated = item('u', ['u-me'], { title: 'Undated' })
    const settled = item('r', ['u-me'], { title: 'Done but dated', targetEndDate: '2020-01-01' })
    const items = [settled, future, undated, soon, overdue]
    const placements = [
      placed('u', 'b-t', 'l-b'),
      placed('f', 'b-t', 'l-b'),
      placed('s', 'b-t', 'l-b'),
      placed('o', 'b-t', 'l-b'),
      placed('r', 'b-t', 'l-done'),
    ]
    const flat2 = myWork(items, placements, cols, [bTeam], identity('shared'), 'u-me', now).flatMap((g) => g.entries.map((e) => `${e.item.title}${e.isOverdue ? '!' : e.isDueSoon ? '~' : ''}`))
    expect(flat2).toEqual(['Overdue!', 'Due soon~', 'Future', 'Undated', 'Done but dated'])
    // And the resolved entry is marked — it is finished, however dated it was.
    expect(myWork(items, placements, cols, [bTeam], identity('shared'), 'u-me', now).flatMap((g) => g.entries.filter((x) => x.isResolved).map((x) => x.item.title))).toEqual(['Done but dated'])
  })

  it('the same person on more cards than one board groups by board, boards in order', () => {
    const bA = board('b-a', 'A Crew')
    const bB = board('b-b', 'B Crew')
    const items = [item('x', ['u-me'], { title: 'On A' }), item('y', ['u-me'], { title: 'On B' })]
    const placements = [placed('y', 'b-b', 'l-b'), placed('x', 'b-a', 'l-b')]
    const names = myWork(items, placements, cols, [bA, bB], identity('shared'), 'u-me', now).map((g) => g.boardName)
    expect(names).toEqual(['A Crew', 'B Crew'])
  })

  it('a stale placement (lane gone) is not a place', () => {
    const items = [item('z', ['u-me'], { title: 'Dangling' })]
    const placements = [{ id: 'p-z', boardId: 'b-t', itemId: 'z', laneId: 'l-missing', enteredAt: now }]
    expect(myWork(items, placements, cols, [bTeam], identity('shared'), 'u-me', now)).toEqual([])
  })

  it('no person picked — no view', () => {
    const items = [item('q', ['u-me'])]
    expect(myWork(items, [placed('q', 'b-t', 'l-b')], cols, [bTeam], identity('shared'), undefined, now)).toEqual([])
  })
})
