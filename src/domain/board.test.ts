import { describe, expect, it } from 'vitest'
import {
  activeBoards,
  boardsByBand,
  canRemoveTemplateFlow,
  canRetype,
  duplicateBoard,
  lanesFromTemplate,
  templateAddFlow,
  templateAddLane,
  templateChildren,
  templateDuplicateLane,
  templateInsertLaneAfter,
  templateFromBoard,
  templateLaneIsRow,
  templateMoveFlow,
  templateMoveLane,
  templateRemoveFlow,
  templateRemoveLane,
  templateRenameFlow,
  templateRenameLane,
  templateSetLanePolicy,
  templateSetLaneWip,
  templateSetOrientation,
  templateSplitLane,
  boardInitiatives,
  initiativeCellOf,
  initiativeRanks,
} from './board'
import { rollupOf } from './derive'
import { childrenOf, placementsInOrder, rootLane } from './lanes'
import { BUILT_IN_TEMPLATES } from './demo'
import { createFixture } from './fixture'
import type { BoardFlow, Lane, TemplateLane } from './types'

const names = (groups: ReturnType<typeof boardsByBand>) => groups.flatMap((g) => g.boards.map((b) => b.name))
/** The fixture's flow id for one of a board's trees. */
const flow = (flows: BoardFlow[], boardId: string, kind: 'cards' | 'initiatives' = 'cards'): string =>
  flows.find((f) => f.boardId === boardId && f.kind === kind)!.id

describe('board workspace — grouping, ordering and the name filter', () => {
  const s = createFixture()

  it('groups by flight level top-down, then by name', () => {
    const groups = boardsByBand(s.boards)
    expect(groups.map((g) => g.band)).toEqual(['portfolio', 'program', 'team'])
    expect(groups.map((g) => g.boards.map((b) => b.name))).toEqual([
      ['Company Strategy'],
      ['Digital line of business', 'Growth value stream', 'Product Delivery'],
      ['Team Atlas', 'Team Nova'],
    ])
  })

  it('lists every board exactly once — the aggregation graph is a DAG, not a tree', () => {
    // Team Atlas is linked by two programs, so a nested rendering would have to
    // duplicate it or pick one parent.
    const ids = boardsByBand(s.boards).flatMap((g) => g.boards.map((b) => b.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(s.boards.length)
  })

  it('filters by name, ignoring case and surrounding space', () => {
    expect(names(boardsByBand(s.boards, 'team'))).toEqual(['Team Atlas', 'Team Nova'])
    expect(names(boardsByBand(s.boards, '  ATLAS '))).toEqual(['Team Atlas'])
    expect(boardsByBand(s.boards, 'zzz')).toEqual([])
  })

  it('hides archived boards', () => {
    const archived = s.boards.map((b) => (b.id === 'b-atlas' ? { ...b, archived: true } : b))
    expect(names(boardsByBand(archived))).not.toContain('Team Atlas')
    expect(names(boardsByBand(archived))).toContain('Team Nova')
  })

  it('activeBoards is the pool every board-choosing surface filters through', () => {
    const archived = s.boards.map((b) => (b.id === 'b-atlas' ? { ...b, archived: true } : b))
    expect(activeBoards(archived).map((b) => b.id)).not.toContain('b-atlas')
    expect(activeBoards(archived)).toHaveLength(s.boards.length - 1)
  })

  it('includeArchived brings retired boards back into the list', () => {
    const archived = s.boards.map((b) => (b.id === 'b-atlas' ? { ...b, archived: true } : b))
    const withArchived = names(boardsByBand(archived, '', true))
    expect(withArchived).toContain('Team Atlas')
    expect(withArchived).toHaveLength(s.boards.length)
  })
})

describe('board templates — a design, not its work', () => {
  const s = createFixture()
  const atlas = () => s.boards.find((b) => b.id === 'b-atlas')!

  it('every built-in template has exactly four top-level columns, one per stage', () => {
    // A board's root is exactly the four typed columns. A fifth would carry a stage that
    // already exists, which is how the Scrum template first came out wrong.
    for (const t of s.boardTemplates) {
      const top = templateChildren(t, null)
      expect(top.map((l) => l.stage)).toEqual(['backlog', 'notStarted', 'inProgress', 'done'])
    }
  })

  it('the seeded Scrum template keeps its four columns and their cells', () => {
    const scrum = s.boardTemplates.find((t) => t.name === 'Scrum')!
    const top = templateChildren(scrum, null)
    expect(top.map((l) => l.name)).toEqual(['Product Backlog', 'Ready to Start', 'In Progress', 'Done'])
    const kids = (key: string) => templateChildren(scrum, key).map((l) => l.name)
    expect(kids('k1')).toEqual(['Backlog Refinement', 'Current Sprint'])
    expect(kids('k4')).toEqual(['Working on', 'Ready for Review', 'Review'])
    // The reference board's two green columns are one Done column with two cells.
    expect(kids('k8')).toEqual(['Ready for Delivery', 'Done'])
    // It is a usable design: instantiating it yields those columns and nothing else.
    let n = 0
    const { flows, lanes } = lanesFromTemplate(scrum, 'b', () => `id${++n}`)
    expect(flows).toHaveLength(1)
    const root = lanes.find((l) => l.parentId === null)!
    expect(lanes.filter((l) => l.parentId === root.id)).toHaveLength(4)
    expect(lanes.filter((l) => l.stage === 'done')).toHaveLength(1)
  })

  it('captures the lane tree below the root, keyed rather than ided', () => {
    const t = templateFromBoard('t1', 'Team flow', atlas(), s.lanes, s.flows)
    // Team Atlas carries two cards flows; this reads the first one's tree.
    const first = t.flows[0].key
    const lanes = t.lanes.filter((l) => l.flowKey === first)
    expect(t.band).toBe('team')
    expect(lanes.map((l) => l.name)).toEqual(['Backlog', 'Not Started', 'In Progress', 'Dev', 'Test', 'Done'])
    // No real lane ids — they are minted per instantiation.
    expect(lanes.every((l) => Boolean(l.key) && !('id' in l))).toBe(true)
    // The root is structural: top-level columns point at it, nothing points at the root's id.
    expect(lanes.filter((l) => l.parentKey === null).map((l) => l.name)).toEqual([
      'Backlog',
      'Not Started',
      'In Progress',
      'Done',
    ])
    const ip = lanes.find((l) => l.name === 'In Progress')!
    expect(lanes.filter((l) => l.parentKey === ip.key).map((l) => l.name)).toEqual(['Dev', 'Test'])
    // Stages and WIP limits ride along.
    expect(lanes.find((l) => l.name === 'Done')?.stage).toBe('done')
    expect(lanes.find((l) => l.name === 'Not Started')?.wipLimit).toBe(1)
  })

  it('carries no work and no org-specific wiring', () => {
    const t = templateFromBoard('t1', 'Team flow', atlas(), s.lanes, s.flows)
    expect(JSON.stringify(t)).not.toMatch(/linkedBoardIds|itemId|placement/)
    expect(t).not.toHaveProperty('items')
    expect(t).not.toHaveProperty('linkedBoardIds')
  })

  it('instantiates with fresh, unique ids and the structure intact', () => {
    const t = templateFromBoard('t1', 'Team flow', atlas(), s.lanes, s.flows)
    const before = JSON.stringify(t)

    let n = 0
    const { flows, lanes } = lanesFromTemplate(t, 'new-board', () => `id-${++n}`)
    const root = lanes.find((l) => l.parentId === null)!
    expect(new Set(lanes.map((l) => l.id)).size).toBe(lanes.length)
    expect(lanes.every((l) => l.boardId === 'new-board')).toBe(true)
    expect(flows.every((f) => f.boardId === 'new-board' && f.kind === 'cards')).toBe(true)
    expect(lanes.filter((l) => l.parentId !== null).map((l) => l.name)).toEqual(t.lanes.map((l) => l.name))
    expect(lanes.filter((l) => l.parentId !== null).map((l) => l.stage)).toEqual(t.lanes.map((l) => l.stage))
    expect(lanes.filter((l) => l.parentId !== null).map((l) => l.wipLimit)).toEqual(t.lanes.map((l) => l.wipLimit))
    // The root parents the top-level columns; Dev/Test keep In Progress as their parent.
    expect(lanes.filter((l) => l.parentId === root.id).map((l) => l.name)).toEqual([
      'Backlog',
      'Not Started',
      'In Progress',
      'Done',
    ])
    const ip = lanes.find((l) => l.name === 'In Progress')!
    expect(lanes.filter((l) => l.parentId === ip.id).map((l) => l.name)).toEqual(['Dev', 'Test'])
    // The template is untouched, so it can be used again.
    expect(JSON.stringify(t)).toBe(before)
  })
})

describe('a template is a set of cards flows', () => {
  const s = createFixture()

  it('captures every cards flow, and never the initiatives flow', () => {
    const atlas = s.boards.find((b) => b.id === 'b-atlas')!
    const escalations: BoardFlow = { id: 'f-escalations', boardId: 'b-atlas', kind: 'cards', name: 'Escalations', order: 2 }
    const lanes = [
      ...s.lanes,
      { id: 'l-escalations', boardId: 'b-atlas', parentId: null, order: 0, name: '', flowId: 'f-escalations', orientation: 'columns' as const },
      { id: 'l-escalations-backlog', boardId: 'b-atlas', parentId: 'l-escalations', order: 0, name: 'Backlog', flowId: 'f-escalations', stage: 'backlog' as const },
    ]
    const template = templateFromBoard('t-two', 'Two flows', atlas, lanes, [...s.flows, escalations])

    expect(template.flows.map((f) => f.name)).toEqual(['Cards', 'Support', 'Escalations'])
    // The organisation's shape is not the team's to design: only cards flows are captured.
    expect(template.flows.every((f) => f.kind === 'cards')).toBe(true)
    expect(template.lanes.every((l) => template.flows.some((f) => f.key === l.flowKey))).toBe(true)
    // The second flow's own tree, with its own top level.
    const third = template.flows[2].key
    expect(template.lanes.filter((l) => l.flowKey === third).map((l) => l.name)).toEqual(['Backlog'])
    expect(template.lanes.filter((l) => l.flowKey === third).every((l) => l.parentKey === null)).toBe(true)
  })

  it('mints one board flow per template flow, each lane under its own root', () => {
    const atlas = s.boards.find((b) => b.id === 'b-atlas')!
    const escalations: BoardFlow = { id: 'f-escalations', boardId: 'b-atlas', kind: 'cards', name: 'Escalations', order: 2 }
    const lanes = [
      ...s.lanes,
      { id: 'l-escalations', boardId: 'b-atlas', parentId: null, order: 0, name: '', flowId: 'f-escalations', orientation: 'columns' as const },
      { id: 'l-escalations-backlog', boardId: 'b-atlas', parentId: 'l-escalations', order: 0, name: 'Backlog', flowId: 'f-escalations', stage: 'backlog' as const },
    ]
    const template = templateFromBoard('t-two', 'Two flows', atlas, lanes, [...s.flows, escalations])

    let n = 0
    const built = lanesFromTemplate(template, 'b-new', () => `id${++n}`)
    expect(built.flows.map((f) => f.name)).toEqual(['Cards', 'Support', 'Escalations'])
    const roots = built.lanes.filter((l) => l.parentId === null)
    expect(roots).toHaveLength(3)
    // Every lane's nearest root is a root of its own flow: the trees never mix.
    const rootOf = (id: string) => {
      let cur = built.lanes.find((l) => l.id === id)
      while (cur?.parentId) cur = built.lanes.find((l) => l.id === cur!.parentId)
      return cur
    }
    for (const lane of built.lanes) expect(rootOf(lane.id)?.flowId).toBe(lane.flowId)
    // And the template is untouched, so it can be used again.
    expect(template.flows).toHaveLength(3)
  })

  it('adds, names, moves and removes a flow — and keeps the last one', () => {
    const one = BUILT_IN_TEMPLATES[0]
    const added = templateAddFlow(one)
    expect(added.flows.map((f) => f.name)).toEqual(['Cards', 'Cards 2'])
    expect(added.lanes.filter((l) => l.flowKey === added.key).map((l) => l.stage)).toEqual([
      'backlog',
      'notStarted',
      'inProgress',
      'done',
    ])
    // Keys are unique across the whole template, not just inside the new flow.
    expect(new Set(added.lanes.map((l) => l.key)).size).toBe(added.lanes.length)

    const named = { ...one, flows: templateRenameFlow({ ...one, flows: added.flows }, added.key, 'Support'), lanes: added.lanes }
    expect(named.flows[1].name).toBe('Support')

    const moved = templateMoveFlow(named, added.key, -1)
    expect(moved.map((f) => f.name)).toEqual(['Support', 'Cards'])
    expect(moved.map((f) => f.order)).toEqual([0, 1])

    const removed = templateRemoveFlow({ ...named, flows: moved }, added.key)!
    expect(removed.flows.map((f) => f.name)).toEqual(['Cards'])
    expect(removed.lanes.some((l) => l.flowKey === added.key)).toBe(false)

    // A template keeps at least one cards flow, so the only one is not removable.
    expect(canRemoveTemplateFlow(one, one.flows[0].key)).toBe(false)
    expect(templateRemoveFlow(one, one.flows[0].key)).toBeNull()
  })
})

describe('duplicating a board', () => {
  const s = createFixture()
  const keys = () => {
    let n = 0
    return () => `new${++n}`
  }
  /** One flow's design, flattened: name, stage, WIP limit and orientation, in order. */
  const shape = (lanes: Lane[], flowId: string) => {
    const root = rootLane(lanes, flowId)
    const out: string[] = []
    const walk = (id: string, depth: number) => {
      for (const child of childrenOf(lanes, id)) {
        out.push(`${depth}:${child.name}:${child.stage ?? ''}:${child.wipLimit ?? ''}:${child.orientation ?? ''}`)
        walk(child.id, depth + 1)
      }
    }
    if (root) walk(root.id, 0)
    return out
  }

  it('copies the design with fresh ids, sharing nothing with the original', () => {
    const atlas = s.boards.find((b) => b.id === 'b-atlas')!
    const { board, lanes, flows } = duplicateBoard(atlas, s.lanes, s.flows, keys())

    expect(board.id).not.toBe(atlas.id)
    expect(board.name).toBe('Team Atlas copy')
    expect(board.band).toBe('team')
    // A copy is a live board, whatever the original was.
    expect('archived' in board).toBe(false)

    // Every lane is fresh, unique, and points *within* the copy.
    const originals = new Set(s.lanes.filter((l) => l.boardId === atlas.id).map((l) => l.id))
    expect(lanes.every((l) => l.boardId === board.id)).toBe(true)
    expect(lanes.some((l) => originals.has(l.id))).toBe(false)
    expect(new Set(lanes.map((l) => l.id)).size).toBe(lanes.length)
    expect(lanes.every((l) => l.parentId === null || lanes.some((x) => x.id === l.parentId))).toBe(true)

    // Every flow comes across intact…
    const copyCards = flow(flows, board.id, 'cards')
    const copyInitiatives = flow(flows, board.id, 'initiatives')
    expect(shape(lanes, copyCards)).toEqual(shape(s.lanes, flow(s.flows, atlas.id, 'cards')))
    expect(shape(lanes, copyInitiatives)).toEqual(shape(s.lanes, flow(s.flows, atlas.id, 'initiatives')))
    // …including a split and a WIP limit.
    expect(shape(lanes, copyCards)).toContain('1:Dev:::')
    expect(shape(lanes, copyCards)).toContain('0:Not Started:notStarted:1:')
    // Every tree, not one — the copy keeps the flows independent, and names them with its own ids.
    expect(lanes.filter((l) => l.parentId === null).map((l) => l.flowId).sort()).toEqual(
      flows.map((f) => f.id).sort(),
    )
    expect(flows.every((f) => f.boardId === board.id)).toBe(true)
  })

  it('carries the settings and links, and takes a name', () => {
    const portfolio = s.boards.find((b) => b.id === 'b-portfolio')!
    const copy = duplicateBoard(portfolio, s.lanes, s.flows, keys(), '  Value stream two  ')
    expect(copy.board.name).toBe('Value stream two')
    expect(copy.board.linkedBoardIds).toEqual(portfolio.linkedBoardIds)
    expect(copy.board.linkedBoardIds).not.toBe(portfolio.linkedBoardIds) // a copy, not the same array

    // A board with no links stays without them.
    const atlas = s.boards.find((b) => b.id === 'b-atlas')!
    expect('linkedBoardIds' in duplicateBoard(atlas, s.lanes, s.flows, keys()).board).toBe(false)
  })
})

describe('retyping an item', () => {
  const s = createFixture()
  const types = s.issueTypes
  const initiative = s.items.find((i) => i.id === 'init-signup')!
  const card = s.items.find((i) => i.id === 'st-sso')!

  it('refuses to move an item into or out of the reserved Initiative type', () => {
    // An initiative is defined by its type, and the initiatives workflow reads it.
    expect(canRetype(initiative, 't-bug', types)).toBe(false)
    expect(canRetype(initiative, 't-initiative', types)).toBe(false)
    // And the type is not a card type, so nothing becomes one.
    expect(canRetype(card, 't-initiative', types)).toBe(false)
    // Everything else retypes as before.
    expect(canRetype(card, 't-bug', types)).toBe(true)
  })
})

describe('editing a template’s design', () => {
  const scrum = () => createFixture().boardTemplates.find((t) => t.id === 'tpl-scrum')!
  /** Fresh keys, as the editor mints them. */
  const keys = () => {
    let n = 0
    return () => `new${++n}`
  }
  const childNames = (lanes: TemplateLane[], parentKey: string) =>
    templateChildren({ ...scrum(), lanes }, parentKey).map((l) => l.name)

  it('splits a leaf into columns or rows, and adds to an existing split', () => {
    const t = scrum()
    const split = templateSplitLane(t, 'k0', 'columns', keys())
    expect(childNames(split, 'k0')).toEqual(['Column 1', 'Column 2'])
    expect(split.find((l) => l.key === 'k0')?.orientation).toBe('columns')

    const rows = templateSplitLane(t, 'k0', 'rows', keys())
    expect(childNames(rows, 'k0')).toEqual(['Row 1', 'Row 2'])

    // A container gains a lane…
    expect(childNames(templateAddLane(t, 'k1', keys()), 'k1')).toEqual([
      'Backlog Refinement',
      'Current Sprint',
      'Column 3',
    ])
    // …and only a leaf splits.
    expect(templateSplitLane(t, 'k1', 'columns', keys())).toEqual(t.lanes)
  })

  it('renames, sets WIP and policy, and flips orientation', () => {
    const t = scrum()
    expect(templateRenameLane(t, 'k5', 'Doing').find((l) => l.key === 'k5')?.name).toBe('Doing')
    // A typed column's name is the team's own: rename the label, and the stage is untouched —
    // the template names its own flow ('Ready to Start' is a Not Started column already).
    expect(templateRenameLane(t, 'k4', 'In flight').find((l) => l.key === 'k4')).toMatchObject({
      name: 'In flight',
      stage: 'inProgress',
      parentKey: null,
    })
    expect(templateSetLaneWip(t, 'k5', 2).find((l) => l.key === 'k5')?.wipLimit).toBe(2)
    expect(templateSetLaneWip(t, 'k5', undefined).find((l) => l.key === 'k5')?.wipLimit).toBeUndefined()
    expect(templateSetLanePolicy(t, 'k5', 'One at a time.').find((l) => l.key === 'k5')?.description).toBe(
      'One at a time.',
    )
    expect(templateSetOrientation(t, 'k4', 'rows').find((l) => l.key === 'k4')?.orientation).toBe('rows')
  })

  it('knows which lanes are rows of a stack and which are columns beside their siblings', () => {
    const t = scrum()
    // Top-level typed columns sit in the root's arrangement, which is columns.
    expect(templateLaneIsRow(t, 'k0')).toBe(false)
    // 'Ready to Start' is an explicit split of columns, so its children are columns.
    expect(templateLaneIsRow(t, 'k1')).toBe(false)
    expect(templateLaneIsRow(t, 'k2')).toBe(false)

    // A cell split into rows: the two new lanes are rows of that stack…
    const rows = { ...t, lanes: templateSplitLane(t, 'k0', 'rows', keys()) }
    expect(childNames(rows.lanes, 'k0')).toEqual(['Row 1', 'Row 2'])
    expect(rows.lanes.filter((l) => l.parentKey === 'k0').map((l) => templateLaneIsRow(rows, l.key))).toEqual([true, true])

    // …and flipping a split flips the answer for its children, never for itself.
    const flipped = { ...t, lanes: templateSetOrientation(t, 'k1', 'rows') }
    expect(templateLaneIsRow(flipped, 'k2')).toBe(true)
    expect(templateLaneIsRow(flipped, 'k1')).toBe(false)
    // A lane that is not there is not a row — the editor asks this while lanes come and go.
    expect(templateLaneIsRow(t, 'nope')).toBe(false)
  })

  it('reorders sub-lanes within their parent, and leaves the columns fixed', () => {
    const t = scrum()
    expect(childNames(templateMoveLane(t, 'k5', 1), 'k4')).toEqual(['Ready for Review', 'Working on', 'Review'])
    // Already first, and already last: no-ops.
    expect(childNames(templateMoveLane(t, 'k5', -1), 'k4')).toEqual(['Working on', 'Ready for Review', 'Review'])
    expect(childNames(templateMoveLane(t, 'k7', 1), 'k4')).toEqual(['Working on', 'Ready for Review', 'Review'])
    // Top-level columns are fixed in place, as on a board.
    expect(templateMoveLane(t, 'k0', 1)).toEqual(t.lanes)
  })

  it('removes a sub-lane and its subtree, renumbering the rest', () => {
    const t = scrum()
    const next = templateRemoveLane(t, 'k6')
    expect(childNames(next, 'k4')).toEqual(['Working on', 'Review'])
    expect(templateChildren({ ...t, lanes: next }, 'k4').map((l) => l.order)).toEqual([0, 1])

    // A container takes its whole subtree with it — via a sub-lane that has one.
    const nested = templateSplitLane(t, 'k5', 'rows', keys())
    const withoutWorkingOn = templateRemoveLane({ ...t, lanes: nested }, 'k5')
    expect(withoutWorkingOn.some((l) => l.key === 'k5' || l.key === 'new1' || l.key === 'new2')).toBe(false)
    // A top-level column stays, split or not.
    expect(templateRemoveLane(t, 'k0')).toEqual(t.lanes)
    expect(templateRemoveLane(t, 'k4')).toEqual(t.lanes)
  })

  it('keeps every key unique through the edits', () => {
    const next = templateSplitLane(scrum(), 'k0', 'rows', keys())
    expect(new Set(next.map((l) => l.key)).size).toBe(next.length)
  })

  it('inserts a sub-lane after a sibling, renumbering the rest', () => {
    const t = scrum()
    const next = templateInsertLaneAfter(t, 'k5', keys())
    expect(childNames(next, 'k4')).toEqual(['Working on', 'Column 4', 'Ready for Review', 'Review'])
    expect(templateChildren({ ...t, lanes: next }, 'k4').map((l) => l.order)).toEqual([0, 1, 2, 3])
    // A typed (top-level) column refuses, exactly as the board refuses.
    expect(templateInsertLaneAfter(t, 'k0', keys())).toEqual(t.lanes)
  })

  it('duplicates a sub-lane and its subtree as "copy"', () => {
    const t = scrum()
    expect(childNames(templateDuplicateLane(t, 'k5', keys()), 'k4')).toEqual([
      'Working on',
      'Working on copy',
      'Ready for Review',
      'Review',
    ])
    // A nested split comes across whole, under fresh keys.
    const nested = templateSplitLane(t, 'k5', 'rows', keys())
    expect(childNames(templateDuplicateLane({ ...t, lanes: nested }, 'new1', keys()), 'k5')).toEqual([
      'Row 1',
      'Row 1 copy',
      'Row 2',
    ])
    // A typed (top-level) column refuses, exactly as the board refuses.
    expect(templateDuplicateLane(t, 'k4', keys())).toEqual(t.lanes)
  })

  it('folds a split left with one child, exactly as the board folds it', () => {
    const t = scrum()
    const once = templateRemoveLane(t, 'k7')
    const twice = templateRemoveLane({ ...t, lanes: once }, 'k6')
    // Two removals leave one child, and that is not a split: the last child folds
    // away and the parent becomes the cell its (would-be) cards live in.
    expect(childNames(twice, 'k4')).toEqual([])
    expect(twice.some((l) => l.key === 'k5')).toBe(false) // the folded child is gone
    expect(twice.some((l) => l.key === 'k4')).toBe(true) // the parent stays, now a cell
  })
})

describe('initiativeRanks — a section reads every initiative whose rollup put it there', () => {
  const INIT = 't-initiative'
  const STORY = 't-story'
  const types = [
    { id: INIT, name: 'Initiative', color: '#6366f1' },
    { id: STORY, name: 'Story', color: '#64748b' },
  ]
  const lane = (id: string, flowId: string, patch: Partial<Lane> = {}): Lane => ({
    id,
    boardId: 'b-mine',
    parentId: null,
    order: 0,
    name: id,
    flowId,
    ...patch,
  })
  // Two independent lane trees, as every board has: the cards flow the work sits in,
  // and the initiatives flow it rolls up through.
  const mineFlows: BoardFlow[] = [
    { id: 'flow-cards', boardId: 'b-mine', kind: 'cards', name: 'Cards', order: 0 },
    { id: 'flow-initiatives', boardId: 'b-mine', kind: 'initiatives', name: 'Initiatives', order: 0 },
  ]
  const lanes: Lane[] = [
    lane('cards-root', 'flow-cards'),
    lane('cards-backlog', 'flow-cards', { parentId: 'cards-root', name: 'Backlog', stage: 'backlog' }),
    lane('cards-ns', 'flow-cards', { parentId: 'cards-root', order: 1, name: 'Not Started', stage: 'notStarted' }),
    lane('init-root', 'flow-initiatives'),
    lane('sec-backlog', 'flow-initiatives', { parentId: 'init-root', name: 'Backlog', stage: 'backlog' }),
    lane('sec-ns', 'flow-initiatives', { parentId: 'init-root', order: 1, name: 'Not Started', stage: 'notStarted' }),
  ]
  const item = (id: string, typeId: string) => ({ id, title: id, typeId, createdAt: 0 })
  const edge = (from: string, to: string) => ({ id: `e-${from}-${to}`, kind: 'decomposition' as const, from, to })
  let seq = 0
  const at = (itemId: string, laneId: string) => ({ id: `pl-${++seq}`, itemId, boardId: 'b-mine', laneId })
  /** An initiative, the card below it, and where each of them sits. */
  const graphOf = (items: ReturnType<typeof item>[], edges: ReturnType<typeof edge>[], placements: ReturnType<typeof at>[]) =>
    ({ items, edges, links: [], placements, lanes })
  /** What a cell of a section reads, top to bottom. */
  const rankOf = (g: ReturnType<typeof graphOf>, sectionId: string, cellId: string) =>
    (initiativeRanks(g, 'b-mine', sectionId, boardInitiatives(g, 'b-mine', types), mineFlows).get(cellId) ?? []).map((i) => i.id)

  it('reads an initiative in the section its rollup names, not the cell its placement still holds', () => {
    // Arranged in Backlog, and its only card is in Backlog too — so the arrangement is honest.
    const arranged = graphOf([item('ini', INIT), item('card', STORY)], [edge('ini', 'card')], [at('ini', 'sec-backlog'), at('card', 'cards-backlog')])
    expect(rollupOf('ini', arranged).bucket).toBe('backlog')
    expect(rankOf(arranged, 'sec-backlog', 'sec-backlog')).toEqual(['ini'])

    // The card moves to Not Started. The initiative belongs to Not Started now, but its
    // placement still names the Backlog cell — a cell the new section does not hold. Reading
    // the placement alone left it in no cell of any section: it vanished from the flow.
    const moved = graphOf([item('ini', INIT), item('card', STORY)], [edge('ini', 'card')], [at('ini', 'sec-backlog'), at('card', 'cards-ns')])
    expect(rollupOf('ini', moved).bucket).toBe('notStarted')
    expect(rankOf(moved, 'sec-ns', 'sec-ns')).toEqual(['ini'])
    // The placement still names the old cell — nothing at all names the new one, which is why
    // reading placements could only ever find an initiative in the section it had left.
    expect(placementsInOrder(moved.placements, 'sec-ns')).toEqual([])
    // It reads in the cell the rollup falls back to, and in the section it belongs to only.
    expect(initiativeCellOf('ini', 'b-mine', moved, mineFlows)).toEqual({ sectionId: 'sec-ns', cellId: 'sec-ns' })
    expect(rankOf(moved, 'sec-backlog', 'sec-backlog')).toEqual([])
  })

  it('keeps the arrangement — a placed initiative holds its rank, an arrival goes last', () => {
    // `a` was arranged in the cell it reads in; `b` still names the Backlog cell. Board order
    // puts `b` first, so page order cannot be what decides the rank.
    const g = graphOf(
      [item('a', INIT), item('b', INIT), item('card-a', STORY), item('card-b', STORY)],
      [edge('a', 'card-a'), edge('b', 'card-b')],
      [at('b', 'sec-backlog'), at('a', 'sec-ns'), at('card-b', 'cards-ns'), at('card-a', 'cards-ns')],
    )
    expect(boardInitiatives(g, 'b-mine', types).map((i) => i.id)).toEqual(['b', 'a'])
    expect(rollupOf('a', g).bucket).toBe('notStarted')
    expect(rankOf(g, 'sec-ns', 'sec-ns')).toEqual(['a', 'b'])
  })
})
describe('boardInitiatives — the one set every initiative surface reads', () => {
  const INIT = 't-initiative'
  const STORY = 't-story'
  const types = [
    { id: INIT, name: 'Initiative', color: '#6366f1' },
    { id: STORY, name: 'Story', color: '#64748b' },
  ]
  const item = (id: string, typeId: string, patch: Record<string, unknown> = {}) =>
    ({ id, title: id, typeId, createdAt: 0, ...patch })
  const edge = (from: string, to: string) => ({ id: `e-${from}-${to}`, kind: 'decomposition' as const, from, to })
  let placementSeq = 0
  const graphOf = (items: ReturnType<typeof item>[], edges: ReturnType<typeof edge>[] = [], placements: Array<{ itemId: string; boardId: string; laneId: string }> = []) =>
    ({ items, edges, links: [], placements: placements.map((p) => ({ ...p, id: `pl-${++placementSeq}` })), lanes: [] })
  const on = (itemId: string, boardId = 'b-mine') => ({ itemId, boardId, laneId: 'lane-x' })

  it('keeps only Initiative-type items placed on the board, and never archived ones', () => {
    const g = graphOf(
      [item('a', INIT), item('c', STORY), item('d', INIT, { archived: true })],
      [],
      [on('a'), on('c'), on('d')],
    )
    expect(boardInitiatives(g, 'b-mine', types).map((i) => i.id)).toEqual(['a'])
  })

  it('rootsOnly hides an initiative whose parent sits on the same board', () => {
    const g = graphOf(
      [item('parent', INIT), item('child', INIT)],
      [edge('parent', 'child')],
      [on('parent'), on('child')],
    )
    expect(boardInitiatives(g, 'b-mine', types).map((i) => i.id)).toEqual(['parent'])
    expect(boardInitiatives(g, 'b-mine', types, { rootsOnly: false }).map((i) => i.id)).toEqual(['parent', 'child'])
  })

  it('an initiative parented from another board is still top-level here', () => {
    const g = graphOf(
      [item('mgr', INIT), item('team', INIT)],
      [edge('mgr', 'team')],
      [on('mgr', 'b-other'), on('team')],
    )
    expect(boardInitiatives(g, 'b-mine', types).map((i) => i.id)).toEqual(['team'])
  })

  it('follows placement order — the order the board itself keeps', () => {
    const g = graphOf(
      [item('a', INIT), item('b', INIT)],
      [],
      [on('b'), on('a')],
    )
    expect(boardInitiatives(g, 'b-mine', types).map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('with no Initiative type, having decomposition children stands in', () => {
    const g = graphOf(
      [item('parent', STORY), item('leaf', STORY), item('childless', STORY)],
      [edge('parent', 'leaf')],
      [on('parent'), on('leaf'), on('childless')],
    )
    expect(boardInitiatives(g, 'b-mine', [{ id: STORY, name: 'Story', color: '#64748b' }]).map((i) => i.id)).toEqual(['parent'])
  })
})
