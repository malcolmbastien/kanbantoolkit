import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decompositionChildren, decompositionParent, checklistProgress, descendants, openDependenciesOf, rollupOf, statusOf } from './domain/derive'
import { boardCardTypeId, boardInitiativeTypes, boardInitiatives, buildRefs, cardTypes, defaultDropLane, defaultCardTypeId, descendantBoards, initiativeCellOf, initiativeRanks, initiativeTypeById, initiativesCarrying, searchItems } from './domain/board'
import { childrenOf, effectiveStage, isLeaf, laneCardCount, leafLanes, placementsInOrder, rootLane, topLevelLanes } from './domain/lanes'
import type { Board, Item, Lane, Placement, Stage, Workflow } from './domain/types'
import { hasActiveFilters, NO_FILTERS, type SavedFilter } from './domain/filters'
import { cumulativeFlow, flowRecord, flowSummary, throughput, weeklyBuckets } from './domain/metrics'
import { STRESS_BOARD_ID, STRESS_PREFIX } from './domain/stressBoard'
import { initiativeHealth } from './domain/health'
import { isBoardSurface, migratePersisted, migrateState, persistedSlice, useStore, PERSIST_VERSION } from './store'
import { BUILT_IN_TEMPLATES } from './domain/seed'
import { createFixture } from './domain/fixture'

vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
})

const s = () => useStore.getState()

/**
 * Back to a known world: the store's own default view, with the *fixture's* work in it. The demo
 * dataset (`seed.ts`) is for people to look at and will change as the story does; the assertions
 * below name specific cards, so they run against the fixture, which is the same boards with a
 * world built to be asserted about.
 */
const resetToFixture = () => {
  s().resetDemo()
  useStore.setState({ ...createFixture() })
}
const graph = () => {
  const st = s()
  return { items: st.items, edges: st.edges, links: st.links, placements: st.placements, lanes: st.lanes }
}
const laneByName = (boardId: string, name: string, workflow: Workflow = 'cards') =>
  s().lanes.find((l) => l.boardId === boardId && l.name === name && l.workflow === workflow)!

describe('store actions', () => {
  beforeEach(() => resetToFixture())

  it('one parent: setParent replaces any existing parent', () => {
    s().setParent('st-signup-form', 'init-welcome')
    expect(decompositionParent('st-signup-form', s().edges)).toBe('init-welcome')
    s().setParent('st-signup-form', 'init-signup')
    expect(decompositionParent('st-signup-form', s().edges)).toBe('init-signup')
  })

  it('splitting a leaf into a container moves its cards into the first sub-lane', () => {
    const ns = laneByName('b-atlas', 'Not Started')
    const before = s().placements.filter((p) => p.laneId === ns.id).length
    s().splitLane(ns.id, 'rows')
    const kids = childrenOf(s().lanes, ns.id)
    expect(kids.length).toBe(2)
    expect(isLeaf(s().lanes, ns.id)).toBe(false)
    expect(s().placements.filter((p) => p.laneId === kids[0].id).length).toBe(before)
  })

  it('an initiative\'s section is derived from its work; its cell is the user\'s arrangement', () => {
    const g = () => graph()
    // Seeded in b-nova's Not Started, but its work has started — the rollup wins, so
    // the placement is stale and the initiative falls back to the section's first cell.
    expect(rollupOf('init-welcome', g()).bucket).toBe('inProgress')
    const ip = topLevelLanes(s().lanes, 'b-nova', 'initiatives').find((l) => l.stage === 'inProgress')!
    const seeded = s().placements.find((p) => p.itemId === 'init-welcome' && p.boardId === 'b-nova')!.laneId
    expect(effectiveStage(s().lanes, seeded)).toBe('notStarted') // stale, and ignored

    const cell = initiativeCellOf('init-welcome', 'b-nova', g())!
    expect(cell.sectionId).toBe(ip.id)
    expect(cell.cellId).toBe(childrenOf(s().lanes, ip.id)[0]?.id ?? ip.id)
  })

  it('an initiative is rearranged within its section, never across one', () => {
    const g = () => graph()
    const section = (stage: Stage) =>
      topLevelLanes(s().lanes, 'b-nova', 'initiatives').find((l) => l.stage === stage)!
    const ip = section('inProgress')
    // The initiatives flow starts standard; refining it is the initiatives flow's own
    // business — splitting a section here gives initiatives cells to arrange within.
    s().splitLane(ip.id, 'columns')
    const cells = childrenOf(s().lanes, ip.id)
    expect(cells.length).toBe(2)

    s().moveInitiative('init-welcome', 'b-nova', cells[1].id)
    expect(initiativeCellOf('init-welcome', 'b-nova', g())?.cellId).toBe(cells[1].id)
    expect(initiativeCellOf('init-welcome', 'b-nova', g())?.sectionId).toBe(ip.id)

    // Crossing into another section is refused: the section is derived, not chosen.
    s().moveInitiative('init-welcome', 'b-nova', section('done').id)
    expect(initiativeCellOf('init-welcome', 'b-nova', g())?.cellId).toBe(cells[1].id)
    expect(initiativeCellOf('init-welcome', 'b-nova', g())?.sectionId).toBe(ip.id)
  })

  it('an initiative rolls up with the card below it, instead of vanishing from the flow', () => {
    // The report: an initiative in Backlog, a card in Backlog, the card made its child — then
    // the card moves to Not Started. The initiative belongs to Not Started by rollup, but its
    // placement still named the Backlog cell, and the flow read placements — so it was in no
    // cell of any section and disappeared altogether.
    const boardId = 'b-atlas'
    const section = (stage: Stage) => topLevelLanes(s().lanes, boardId, 'initiatives').find((l) => l.stage === stage)!
    const ranksOf = (stage: Stage) =>
      [...initiativeRanks(graph(), boardId, section(stage).id, boardInitiatives(graph(), boardId, s().issueTypes)).values()]
        .flat()
        .map((i) => i.id)
    s().addCard({ boardId, typeId: 't-initiative', laneId: section('backlog').id, title: 'Rolling initiative' })
    s().addCard({ boardId, typeId: 't-story', laneId: laneByName(boardId, 'Backlog').id, title: 'Rolling card' })
    const ini = s().items.find((i) => i.title === 'Rolling initiative')!.id
    const card = s().items.find((i) => i.title === 'Rolling card')!.id
    s().setParent(card, ini)
    expect(ranksOf('backlog')).toContain(ini)

    s().moveCard(card, boardId, laneByName(boardId, 'Not Started').id)

    expect(rollupOf(ini, graph()).bucket).toBe('notStarted')
    expect(ranksOf('notStarted')).toContain(ini)
    expect(ranksOf('backlog')).not.toContain(ini)
  })

  it('a nested container can gain a child; the top level is fixed', () => {
    const ip = laneByName('b-atlas', 'In Progress') // a columns container
    const before = childrenOf(s().lanes, ip.id).length
    s().addLane(ip.id)
    expect(childrenOf(s().lanes, ip.id).length).toBe(before + 1)

    const root = rootLane(s().lanes, 'b-atlas', 'cards')!
    const topBefore = childrenOf(s().lanes, root.id).length
    s().addLane(root.id) // top-level columns are fixed
    expect(childrenOf(s().lanes, root.id).length).toBe(topBefore)
    expect(topBefore).toBe(4)
  })

  it('dependency self-cleans when the dependency moves to a done lane', () => {
    const done = laneByName('b-nova', 'Done')
    expect(statusOf('st-email', graph()).resolved).toBe(false)
    s().moveCard('init-gateway', 'b-nova', done.id)
    expect(statusOf('init-gateway', graph()).resolved).toBe(true)
  })

  it('WIP limits are visual only — they never block a move', () => {
    const done = laneByName('b-nova', 'Done')
    s().setLaneWip(done.id, 1)
    s().moveCard('st-ratelimit', 'b-nova', done.id)
    s().moveCard('st-gateway-contract', 'b-nova', done.id) // over the limit, still allowed
    expect(s().placements.find((p) => p.itemId === 'st-gateway-contract' && p.boardId === 'b-nova')?.laneId).toBe(done.id)
  })

  it('custom types can be added, renamed and recoloured', () => {
    const before = s().issueTypes.length
    s().addIssueType('Risk', '#ef4444')
    const added = s().issueTypes[s().issueTypes.length - 1]
    expect(s().issueTypes.length).toBe(before + 1)
    s().updateIssueType(added.id, { name: 'Threat' })
    expect(s().issueTypes.find((t) => t.id === added.id)?.name).toBe('Threat')
  })

  it('an aggregating board links the boards chosen for it, and refuses cycles', () => {
    const vstream = () => s().boards.find((b) => b.id === 'b-portfolio')!
    expect(vstream().linkedBoardIds).toContain('b-atlas')
    s().removeLinkedBoard('b-portfolio', 'b-atlas')
    expect(vstream().linkedBoardIds ?? []).not.toContain('b-atlas')
    s().addLinkedBoard('b-portfolio', 'b-atlas')
    expect(vstream().linkedBoardIds).toContain('b-atlas')

    // A cycle is refused: the strategy board already aggregates (transitively) the
    // value stream, so the value stream cannot link it back.
    s().addLinkedBoard('b-portfolio', 'b-strategy')
    expect(s().boards.find((b) => b.id === 'b-portfolio')?.linkedBoardIds ?? []).not.toContain('b-strategy')
    // Self-links are refused too.
    s().addLinkedBoard('b-portfolio', 'b-portfolio')
    expect(s().boards.find((b) => b.id === 'b-portfolio')?.linkedBoardIds ?? []).not.toContain('b-portfolio')
  })

  it('descendantBoards walks the aggregation graph transitively', () => {
    expect(descendantBoards(s().boards, 'b-strategy').map((b) => b.id).sort()).toEqual([
      'b-atlas',
      'b-delivery',
      'b-lob',
      'b-nova',
      'b-portfolio',
    ])
  })

  it('links a team initiative under a management initiative', () => {
    const before = s().items.length
    s().linkTeamInitiative('init-onboarding', 'b-nova', 'Linked initiative')
    expect(s().items.length).toBe(before + 1)
    const created = s().items[s().items.length - 1]
    expect(s().edges.some((e) => e.kind === 'decomposition' && e.from === 'init-onboarding' && e.to === created.id)).toBe(true)
    expect(s().placements.some((p) => p.itemId === created.id && p.boardId === 'b-nova')).toBe(true)
  })

  it('can build a custom layout from the standard typed columns', () => {
    s().addBoard('Sketch')
    const boardId = s().boardId
    const root = rootLane(s().lanes, boardId, 'cards')!
    const cols = () => childrenOf(s().lanes, root.id)
    expect(cols().map((c) => c.name)).toEqual(['Backlog', 'Not Started', 'In Progress', 'Done'])
    expect(cols().map((c) => c.stage)).toEqual(['backlog', 'notStarted', 'inProgress', 'done'])

    s().renameLane(cols()[2].id, 'Doing')
    s().splitLane(cols()[2].id, 'rows', 2)
    const rows = childrenOf(s().lanes, cols()[2].id)
    s().splitLane(rows[0].id, 'columns', 3)
    expect(childrenOf(s().lanes, rows[0].id).length).toBe(3)
    expect(effectiveStage(s().lanes, childrenOf(s().lanes, rows[0].id)[0].id)).toBe('inProgress')
    expect(leafLanes(s().lanes, boardId, 'cards').length).toBeGreaterThanOrEqual(7)
  })

  it('renames a typed column without changing its stage or moving anything', () => {
    const root = rootLane(s().lanes, 'b-atlas', 'cards')!
    const columns = () => topLevelLanes(s().lanes, 'b-atlas', 'cards')
    const before = columns().map((c) => ({ id: c.id, stage: c.stage }))
    const status = () => s().items.map((i) => statusOf(i.id, graph()))
    const counts = () =>
      leafLanes(s().lanes, 'b-atlas', 'cards').map((l) => laneCardCount(s().lanes, s().placements, l.id))
    const statusBefore = status()
    const countsBefore = counts()

    // The label is the team's own — 'In flight' is still the in-progress column.
    const ip = laneByName('b-atlas', 'In Progress')
    s().renameLane(ip.id, 'In flight')

    const renamed = laneByName('b-atlas', 'In flight')
    expect(renamed.id).toBe(ip.id)
    expect(renamed.stage).toBe('inProgress')
    expect(childrenOf(s().lanes, root.id).map((c) => ({ id: c.id, stage: c.stage }))).toEqual(before)
    // Nothing moved: status comes from the column's stage, never from its name.
    expect(status()).toEqual(statusBefore)
    expect(counts()).toEqual(countsBefore)
  })

  it('boards carry a flight-level band that can be changed', () => {
    expect(s().boards.find((b) => b.id === 'b-strategy')?.band).toBe('portfolio')
    expect(s().boards.find((b) => b.id === 'b-portfolio')?.band).toBe('program')
    expect(s().boards.find((b) => b.id === 'b-atlas')?.band).toBe('team')
    s().setBoardBand('b-atlas', 'program')
    expect(s().boards.find((b) => b.id === 'b-atlas')?.band).toBe('program')
    const before = s().boards.length
    s().addBoard('Fresh')
    expect(s().boards.length).toBe(before + 1)
    expect(s().boards[s().boards.length - 1].band).toBe('team')
  })

  it('a new board takes an explicit band, and only opens when asked', () => {
    const before = s().boards.length
    s().addBoard('Value stream', 'program')
    expect(s().boards.length).toBe(before + 1)
    const created = s().boards[s().boards.length - 1]
    expect(created.band).toBe('program')
    expect(created.linkedBoardIds).toEqual([]) // a coordination board can aggregate others
    expect(s().boardId).toBe(created.id) // the TopBar's create opens it…
    expect(s().editMode).toBe(true) // …in edit mode

    // Every board starts as the standard typed columns.
    const root = rootLane(s().lanes, created.id, 'cards')!
    const cols = childrenOf(s().lanes, root.id)
    expect(cols.map((c) => c.name)).toEqual(['Backlog', 'Not Started', 'In Progress', 'Done'])
    expect(cols.map((c) => c.stage)).toEqual(['backlog', 'notStarted', 'inProgress', 'done'])

    // A team board carries no linkedBoardIds.
    s().addBoard('Squad', 'team')
    expect(s().boards[s().boards.length - 1].linkedBoardIds).toBeUndefined()

    // The board workspace creates without leaving the board it is browsing.
    s().cancelEdit()
    const current = s().boardId
    s().addBoard('Another stream', 'program', false)
    expect(s().boards[s().boards.length - 1].band).toBe('program')
    expect(s().boardId).toBe(current)
    expect(s().editMode).toBe(false)
  })

  it('archiving a board retires it without touching anything it holds', () => {
    const lanes = s().lanes.filter((l) => l.boardId === 'b-atlas').length
    const placements = s().placements.filter((p) => p.boardId === 'b-atlas').length

    s().archiveBoard('b-atlas')
    const archived = s().boards.find((b) => b.id === 'b-atlas')!
    expect(archived.archived).toBe(true)
    expect(typeof archived.archivedAt).toBe('number')
    // Nothing is destroyed: lanes, placements and the aggregation edges all survive, so
    // unarchiving restores the graph with nothing to repair.
    expect(s().lanes.filter((l) => l.boardId === 'b-atlas').length).toBe(lanes)
    expect(s().placements.filter((p) => p.boardId === 'b-atlas').length).toBe(placements)
    expect(s().boards.find((b) => b.id === 'b-portfolio')?.linkedBoardIds).toContain('b-atlas')

    s().unarchiveBoard('b-atlas')
    const restored = s().boards.find((b) => b.id === 'b-atlas')!
    expect(restored.archived).toBeUndefined()
    expect(restored.archivedAt).toBeUndefined()
    expect('archived' in restored).toBe(false)
  })

  it('entering the board workspace leaves the board section behind', () => {
    s().selectBoard('b-atlas')
    s().toggleFilters()
    s().openItem('st-email')
    expect(s().showFilters).toBe(false) // opening a card dismissed the panel

    s().toggleBoards()
    expect(s().showBoards).toBe(true)
    // The workspace is organisation-level, so no board panel survives into it.
    expect(s().showFilters).toBe(false)
    expect(s().selectedItemId).toBe(null)

    // Opening a board puts you back in the board section.
    s().selectBoard('b-nova')
    expect(s().showBoards).toBe(false)
    expect(s().boardId).toBe('b-nova')
  })

  it('saves a board as a template and instantiates it without the work', () => {
    const placementsBefore = s().placements.length
    const templatesBefore = s().boardTemplates.length

    s().saveBoardAsTemplate('b-atlas', 'Team flow')
    const template = s().boardTemplates[s().boardTemplates.length - 1]
    expect(s().boardTemplates.length).toBe(templatesBefore + 1)
    expect(template.name).toBe('Team flow')
    expect(template.lanes.map((l) => l.name)).toEqual(['Backlog', 'Not Started', 'In Progress', 'Dev', 'Test', 'Done'])
    expect(JSON.stringify(template)).not.toMatch(/linkedBoardIds|itemId|placement/)

    s().addBoard('Squad', undefined, false, template.id)
    const created = s().boards[s().boards.length - 1]
    const root = rootLane(s().lanes, created.id, 'cards')!
    expect(childrenOf(s().lanes, root.id).map((l) => l.name)).toEqual(['Backlog', 'Not Started', 'In Progress', 'Done'])
    const ip = childrenOf(s().lanes, root.id).find((l) => l.name === 'In Progress')!
    expect(childrenOf(s().lanes, ip.id).map((l) => l.name)).toEqual(['Dev', 'Test'])
    // Its own lanes, and no work copied across.
    const atlasRoot = rootLane(s().lanes, 'b-atlas', 'cards')!
    expect(childrenOf(s().lanes, root.id)[0].id).not.toBe(childrenOf(s().lanes, atlasRoot.id)[0].id)
    expect(s().placements.length).toBe(placementsBefore)
    // The template is unchanged and still usable.
    expect(template.lanes).toHaveLength(6)

    // A template's band is the fallback when none is given — and a coordination board
    // still starts with an empty linkedBoardIds.
    s().saveBoardAsTemplate('b-portfolio', 'Program flow')
    const program = s().boardTemplates[s().boardTemplates.length - 1]
    expect(program.band).toBe('program')
    s().addBoard('Program two', undefined, false, program.id)
    const created2 = s().boards[s().boards.length - 1]
    expect(created2.band).toBe('program')
    expect(created2.linkedBoardIds).toEqual([])

    // An explicit band still wins over the template's.
    s().addBoard('Explicit', 'team', false, program.id)
    expect(s().boards[s().boards.length - 1].band).toBe('team')
  })

  it('a template can be started from scratch, with a board type', () => {
    s().newBoardTemplate('Squad flow', 'program')
    const t = s().boardTemplates[s().boardTemplates.length - 1]
    expect(t.name).toBe('Squad flow')
    expect(t.band).toBe('program')
    expect(t.lanes.map((l) => l.name)).toEqual(['Backlog', 'Not Started', 'In Progress', 'Done'])
    expect(t.lanes.map((l) => l.stage)).toEqual(['backlog', 'notStarted', 'inProgress', 'done'])
    expect(t.lanes.every((l) => l.parentKey === null)).toBe(true)

    // A blank name is refused.
    const before = s().boardTemplates.length
    s().newBoardTemplate('   ', 'team')
    expect(s().boardTemplates.length).toBe(before)

    // Ids are unique, so two templates never collide.
    const count = s().boardTemplates.length
    s().newBoardTemplate('Squad flow', 'team')
    expect(s().boardTemplates).toHaveLength(count + 1)
    expect(new Set(s().boardTemplates.map((x) => x.id)).size).toBe(count + 1)
  })

  it('duplicates a board without duplicating its work', () => {
    const boardsBefore = s().boards.length
    const placementsBefore = s().placements.length

    s().duplicateBoard('b-atlas')
    expect(s().boards.length).toBe(boardsBefore + 1)
    const copy = s().boards[s().boards.length - 1]
    expect(copy.name).toBe('Team Atlas copy')

    // The design came across…
    const root = rootLane(s().lanes, copy.id, 'cards')!
    expect(childrenOf(s().lanes, root.id).map((l) => l.name)).toEqual(['Backlog', 'Not Started', 'In Progress', 'Done'])
    const ip = childrenOf(s().lanes, root.id).find((l) => l.name === 'In Progress')!
    expect(childrenOf(s().lanes, ip.id).map((l) => l.name)).toEqual(['Dev', 'Test'])
    // …and the work did not.
    expect(s().placements.length).toBe(placementsBefore)
    expect(s().placements.some((p) => p.boardId === copy.id)).toBe(false)

    // Editing the copy cannot disturb the original.
    s().renameLane(childrenOf(s().lanes, root.id)[0].id, 'Icebox')
    expect(childrenOf(s().lanes, rootLane(s().lanes, 'b-atlas', 'cards')!.id)[0].name).toBe('Backlog')

    // A coordination board brings its links with it.
    s().duplicateBoard('b-portfolio')
    const program = s().boards[s().boards.length - 1]
    expect(program.band).toBe('program')
    expect(program.linkedBoardIds).toEqual(['b-atlas', 'b-nova'])
  })

  it('keeps the two workflows independent', () => {
    const boardId = 'b-atlas'
    const section = (workflow: Workflow, stage: Stage) =>
      topLevelLanes(s().lanes, boardId, workflow).find((l) => l.stage === stage)!
    const cardsNs = section('cards', 'notStarted')
    const initNs = section('initiatives', 'notStarted')

    // Splitting a cards column gives the initiatives flow nothing…
    expect(childrenOf(s().lanes, cardsNs.id)).toEqual([])
    s().splitLane(cardsNs.id, 'columns')
    expect(childrenOf(s().lanes, cardsNs.id).length).toBe(2)
    expect(childrenOf(s().lanes, initNs.id)).toEqual([])

    // …and splitting an initiatives section leaves the cards flow alone.
    s().splitLane(initNs.id, 'columns', 3)
    expect(childrenOf(s().lanes, initNs.id).length).toBe(3)
    expect(childrenOf(s().lanes, cardsNs.id).length).toBe(2)

    // Renaming one side never renames the other.
    s().renameLane(cardsNs.id, 'Ready')
    expect(section('initiatives', 'notStarted').name).toBe('Not Started')

    // And the two trees never share a lane.
    const cardsIds = new Set(s().lanes.filter((l) => l.workflow === 'cards').map((l) => l.id))
    expect(s().lanes.filter((l) => l.workflow === 'initiatives').some((l) => cardsIds.has(l.id))).toBe(false)
  })

  it('a template designs the cards flow only — the initiatives flow starts standard', () => {
    const before = s().boards.length
    s().addBoard('Sprint board', 'team', false, 'tpl-scrum')
    const board = s().boards[before]

    // The template's design is the cards workflow…
    expect(topLevelLanes(s().lanes, board.id, 'cards').map((l) => l.name)).toEqual([
      'Product Backlog',
      'Ready to Start',
      'In Progress',
      'Done',
    ])
    // …and the initiatives workflow is the standard four, one cell each.
    const init = topLevelLanes(s().lanes, board.id, 'initiatives')
    expect(init.map((l) => l.name)).toEqual(['Backlog', 'Not Started', 'In Progress', 'Done'])
    expect(init.every((l) => childrenOf(s().lanes, l.id).length === 0)).toBe(true)
  })

  it('templates are managed and round-trip through persistence', () => {
    const before = s().boardTemplates.length
    s().saveBoardAsTemplate('b-atlas', 'Team flow')
    expect(persistedSlice(s()).boardTemplates).toHaveLength(before + 1)

    const id = s().boardTemplates[s().boardTemplates.length - 1].id
    s().renameBoardTemplate(id, 'Renamed flow')
    expect(s().boardTemplates.find((t) => t.id === id)?.name).toBe('Renamed flow')

    s().removeBoardTemplate(id)
    expect(s().boardTemplates.some((t) => t.id === id)).toBe(false)
    expect(s().boardTemplates).toHaveLength(before)

    // Older state simply has no collection; the migration supplies the built-ins.
    const migrated = migrateState({ boards: [] }) as { boardTemplates: { id: string }[] }
    expect(migrated.boardTemplates.map((t) => t.id)).toEqual(['tpl-feature-flow', 'tpl-scrum'])
  })

  it('the migration adds built-in templates without duplicating them', () => {
    // State from before templates existed gets them.
    const fresh = migrateState({ boards: [] }) as { boardTemplates: { id: string }[] }
    expect(fresh.boardTemplates.map((t) => t.id)).toContain('tpl-scrum')

    // State that already has them is left alone — no second copy on every rehydrate.
    const again = migrateState({ boards: [], boardTemplates: fresh.boardTemplates }) as {
      boardTemplates: { id: string }[]
    }
    expect(again.boardTemplates.filter((t) => t.id === 'tpl-scrum')).toHaveLength(1)

    // A user's own template survives alongside the built-in.
    const withOwn = migrateState({
      boards: [],
      boardTemplates: [{ id: 'mine', name: 'Mine', band: 'team', lanes: [] }],
    }) as { boardTemplates: { id: string }[] }
    expect(withOwn.boardTemplates.map((t) => t.id).sort()).toEqual(['mine', 'tpl-feature-flow', 'tpl-scrum'])

    // A built-in whose definition has changed since it was stored is brought up to date.
    const stale = migrateState({
      boards: [],
      boardTemplates: [{ ...BUILT_IN_TEMPLATES[0], lanes: [] }],
    }) as { boardTemplates: { id: string; lanes: unknown[] }[] }
    expect(stale.boardTemplates.find((t) => t.id === 'tpl-scrum')?.lanes.length).toBeGreaterThan(0)
  })

  it('migrateState normalises the archived flags and leaves older boards working', () => {
    const migrated = migrateState({
      boards: [
        { id: 'x', name: 'X', band: 'team' }, // written before boards could be archived
        { id: 'y', name: 'Y', band: 'program', archived: false, archivedAt: 1 }, // stale falsy flags
        { id: 'z', name: 'Z', band: 'program', archived: true, archivedAt: 5 },
      ],
    }) as { boards: { id: string; archived?: boolean; archivedAt?: number }[] }
    expect('archived' in migrated.boards[0]).toBe(false)
    expect('archived' in migrated.boards[1]).toBe(false)
    expect('archivedAt' in migrated.boards[1]).toBe(false)
    expect(migrated.boards[2].archived).toBe(true)
    expect(migrated.boards[2].archivedAt).toBe(5)
  })

  it('blocking is an explicit status recorded in the item log', () => {    expect(s().items.find((i) => i.id === 'st-email')?.blocked ?? false).toBe(false)
    s().blockItem('st-email', 'Waiting on gateway')
    const b = s().items.find((i) => i.id === 'st-email')!
    expect(b.blocked).toBe(true)
    expect(b.blockedReason).toBe('Waiting on gateway')
    expect(b.log?.some((e) => e.kind === 'blocked' && e.note === 'Waiting on gateway')).toBe(true)

    s().unblockItem('st-email')
    const u = s().items.find((i) => i.id === 'st-email')!
    expect(u.blocked).toBe(false)
    expect(u.blockedReason).toBeUndefined()
    expect(u.log?.some((e) => e.kind === 'unblocked')).toBe(true)

    s().addLogNote('st-email', 'note text')
    expect(s().items.find((i) => i.id === 'st-email')!.log?.some((e) => e.kind === 'noted' && e.note === 'note text')).toBe(true)
  })

  it('links are the only item-to-item dependency relationships', () => {
    const before = s().links.length
    s().addDependency('st-signup-form', 'st-signup-design')
    expect(s().links.length).toBe(before + 1)
    const link = s().links[s().links.length - 1]
    expect(link).toMatchObject({ from: 'st-signup-form', to: 'st-signup-design' })
    expect('status' in link).toBe(false) // links are immediate — no approval state
    // Duplicates are ignored.
    s().addDependency('st-signup-form', 'st-signup-design')
    expect(s().links.length).toBe(before + 1)
  })

  it('migrateState moves legacy dependency edges into links, dropping rejected ones', () => {
    const legacy = {
      boards: [],
      edges: [
        { id: 'e1', kind: 'decomposition', from: 'p', to: 'c' },
        { id: 'e2', kind: 'dependency', from: 'a', to: 'b', dep: { status: 'confirmed', reason: 'r' } },
        { id: 'e3', kind: 'attribution', from: 'o', to: 'c' },
        { id: 'e4', kind: 'dependency', from: 'x', to: 'y', dep: { status: 'rejected' } },
      ],
    }
    const migrated = migrateState(legacy) as {
      edges: { id: string }[]
      links: { id: string; from: string; to: string; reason?: string }[]
    }
    expect(migrated.edges.map((e) => e.id)).toEqual(['e1', 'e3'])
    expect(migrated.links).toHaveLength(1)
    expect(migrated.links[0]).toMatchObject({ id: 'e2', from: 'a', to: 'b', reason: 'r' })
    expect('status' in migrated.links[0]).toBe(false)
  })

  it('migrateState strips the removed link status from existing links', () => {
    const state = {
      links: [
        { id: 'l1', from: 'a', to: 'b', status: 'confirmed', reason: 'r' },
        { id: 'l2', from: 'c', to: 'd', status: 'rejected' },
      ],
    }
    const migrated = migrateState(state) as { links: { id: string; from: string; to: string; reason?: string }[] }
    expect(migrated.links.map((l) => l.id)).toEqual(['l1'])
    expect(migrated.links[0]).toMatchObject({ from: 'a', to: 'b', reason: 'r' })
    expect('status' in migrated.links[0]).toBe(false)
  })

  it('migrateState splits the old shared tree into two independent workflows', () => {
    // A pre-v24 board: one lane tree with no `workflow`, initiatives placed inside it.
    const cardsOnly = s()
      .lanes.filter((l) => l.workflow === 'cards')
      .map(({ workflow: _w, ...rest }) => rest)
    const ns = laneByName('b-nova', 'Not Started', 'cards')
    const legacy = {
      boards: s().boards,
      issueTypes: s().issueTypes,
      items: s().items,
      edges: s().edges,
      links: s().links,
      lanes: cardsOnly,
      placements: s().placements.map((p) => (p.itemId === 'init-welcome' ? { ...p, laneId: ns.id } : p)),
    }

    const migrated = migrateState(structuredClone(legacy) as never) as {
      boards: Board[]
      lanes: Lane[]
      placements: Placement[]
    }

    // Every lane that existed is the cards workflow now…
    expect(migrated.lanes.filter((l) => l.workflow === 'cards')).toHaveLength(cardsOnly.length)
    // …and each board gained the standard initiatives workflow: a root and four sections.
    for (const b of migrated.boards) {
      const init = migrated.lanes.filter((l) => l.boardId === b.id && l.workflow === 'initiatives')
      expect(init).toHaveLength(5)
      expect(init.filter((l) => l.parentId !== null).map((l) => l.stage)).toEqual([
        'backlog',
        'notStarted',
        'inProgress',
        'done',
      ])
      // One cell each — the default, not a copy of whatever the team did to its cards.
      expect(init.every((l) => l.parentId !== null || init.some((c) => c.parentId === l.id))).toBe(true)
    }
    // An initiative that named a card lane now names a section of its own workflow.
    const placed = migrated.placements.find((p) => p.itemId === 'init-welcome')!
    expect(migrated.lanes.find((l) => l.id === placed.laneId)?.workflow).toBe('initiatives')

    // Idempotent — a second pass adds nothing.
    const again = migrateState(structuredClone(migrated) as never) as { lanes: Lane[] }
    expect(again.lanes).toHaveLength(migrated.lanes.length)
  })

  it('archiving a parent cascades to its subtree and keeps the data linked', () => {
    const before = rollupOf('init-signup', graph()).percent
    s().archiveItem('init-signup')
    for (const id of ['init-signup', 'st-signup-design', 'st-signup-form', 'st-email', 'st-sso', 'df-signup']) {
      expect(s().items.find((i) => i.id === id)?.archived).toBe(true)
    }
    // Still in the hierarchy (so it appears in linked-issue lists), and rollup is unaffected.
    expect(decompositionChildren('init-signup', s().edges).length).toBe(5)
    expect(rollupOf('init-signup', graph()).percent).toBe(before)
    expect(s().items.find((i) => i.id === 'init-signup')!.log?.some((e) => e.kind === 'archived')).toBe(true)

    s().unarchiveItem('init-signup')
    expect(s().items.find((i) => i.id === 'init-signup')?.archived).toBe(false)
    expect(s().items.find((i) => i.id === 'st-email')?.archived).toBe(false)
    expect(s().items.find((i) => i.id === 'init-signup')!.log?.some((e) => e.kind === 'unarchived')).toBe(true)
  })

  it('moving into Done stamps resolvedAt; moving out clears it', () => {
    const done = laneByName('b-atlas', 'Done')
    const ns = laneByName('b-atlas', 'Not Started')
    s().moveCard('st-email', 'b-atlas', done.id)
    expect(typeof s().items.find((i) => i.id === 'st-email')?.resolvedAt).toBe('number')
    s().moveCard('st-email', 'b-atlas', ns.id)
    expect(s().items.find((i) => i.id === 'st-email')?.resolvedAt ?? null).toBeNull()
  })

  it('Archive done archives the board\'s resolved cards', () => {
    s().archiveDoneOnBoard('b-atlas')
    expect(s().items.find((i) => i.id === 'st-signup-design')?.archived).toBe(true)
    // a card that is not Done is untouched
    expect(s().items.find((i) => i.id === 'st-email')?.archived ?? false).toBe(false)
  })

  it('auto-archive files Done items older than the threshold', () => {
    const done = laneByName('b-atlas', 'Done')
    s().moveCard('st-email', 'b-atlas', done.id)
    s().setItemFields('st-email', { resolvedAt: Date.now() - 40 * 86_400_000 })
    s().setAutoArchiveDays(30)
    s().runAutoArchive()
    expect(s().items.find((i) => i.id === 'st-email')?.archived).toBe(true)
    // a Done item without an old resolvedAt is left alone
    expect(s().items.find((i) => i.id === 'st-signup-design')?.archived ?? false).toBe(false)
  })

  it('moves sub-lanes within their top-level parent; top-level columns are fixed', () => {
    const root = rootLane(s().lanes, 'b-atlas', 'cards')!
    const topNames = () => childrenOf(s().lanes, root.id).map((l) => l.name)
    // Top-level columns cannot move.
    expect(topNames()).toEqual(['Backlog', 'Not Started', 'In Progress', 'Done'])
    s().moveLane(laneByName('b-atlas', 'Not Started').id, -1)
    expect(topNames()).toEqual(['Backlog', 'Not Started', 'In Progress', 'Done'])

    // Sub-columns move within their top-level parent.
    const ip = laneByName('b-atlas', 'In Progress')
    const colNames = () => childrenOf(s().lanes, ip.id).map((l) => l.name)
    expect(colNames()).toEqual(['Dev', 'Test'])
    s().moveLane(laneByName('b-atlas', 'Dev').id, 1) // right
    expect(colNames()).toEqual(['Test', 'Dev'])
    s().moveLane(laneByName('b-atlas', 'Dev').id, 1) // already last → no-op
    expect(colNames()).toEqual(['Test', 'Dev'])
  })

  it('adds a column to a column split and a row to a row split', () => {
    const ip = laneByName('b-atlas', 'In Progress')
    const before = childrenOf(s().lanes, ip.id).length
    s().addLane(ip.id)
    const cols = childrenOf(s().lanes, ip.id)
    expect(cols.length).toBe(before + 1)
    expect(cols[cols.length - 1].name).toBe('Column 3')

    const ns = laneByName('b-atlas', 'Not Started')
    s().splitLane(ns.id, 'rows')
    expect(childrenOf(s().lanes, ns.id).map((r) => r.name)).toEqual(['Row 1', 'Row 2'])
    s().addLane(ns.id)
    expect(childrenOf(s().lanes, ns.id).map((r) => r.name)).toEqual(['Row 1', 'Row 2', 'Row 3'])
  })

  it('inserts a lane after a sibling and duplicates a subtree', () => {
    const ip = laneByName('b-atlas', 'In Progress')
    const colNames = () => childrenOf(s().lanes, ip.id).map((l) => l.name)
    expect(colNames()).toEqual(['Dev', 'Test'])

    s().insertLaneAfter(laneByName('b-atlas', 'Dev').id)
    expect(colNames()).toEqual(['Dev', 'Column 3', 'Test'])

    s().duplicateLane(laneByName('b-atlas', 'Dev').id)
    expect(colNames()).toEqual(['Dev', 'Dev copy', 'Column 3', 'Test'])

    // top-level columns are neither insertable nor cloneable
    const root = rootLane(s().lanes, 'b-atlas', 'cards')!
    const topBefore = childrenOf(s().lanes, root.id).map((l) => l.name)
    s().insertLaneAfter(laneByName('b-atlas', 'Not Started').id)
    s().duplicateLane(laneByName('b-atlas', 'Not Started').id)
    expect(childrenOf(s().lanes, root.id).map((l) => l.name)).toEqual(topBefore)
  })

  it('duplicates a container with its sub-lanes (structure, not cards)', () => {
    const ns = laneByName('b-atlas', 'Not Started')
    s().splitLane(ns.id, 'columns')
    const c1 = childrenOf(s().lanes, ns.id)[0]
    s().splitLane(c1.id, 'rows')
    const sub = childrenOf(s().lanes, c1.id).length

    s().duplicateLane(c1.id)
    const cols = childrenOf(s().lanes, ns.id)
    expect(cols.length).toBe(3)
    const clone = cols[1]
    expect(clone.name).toBe(`${c1.name} copy`)
    expect(clone.id).not.toBe(c1.id)
    expect(childrenOf(s().lanes, clone.id).length).toBe(sub)
  })

  it('toggles container collapse (view state)', () => {
    const ip = laneByName('b-atlas', 'In Progress')
    expect(s().collapsedLanes[ip.id] ?? false).toBe(false)
    s().toggleCollapse(ip.id)
    expect(s().collapsedLanes[ip.id]).toBe(true)
    s().toggleCollapse(ip.id)
    expect(s().collapsedLanes[ip.id]).toBe(false)
  })

  it('a new card gets a non-initiative type (cards workflow, not initiatives)', () => {
    const typeId = defaultCardTypeId(s().issueTypes)!
    const lane = laneByName('b-atlas', 'Backlog')
    s().addCard({ boardId: 'b-atlas', typeId, laneId: lane.id, title: 'New card' })
    const created = s().items[s().items.length - 1]
    expect(s().issueTypes.find((t) => t.id === created.typeId)?.name).not.toBe('Initiative')
    expect(s().placements.some((p) => p.itemId === created.id && p.boardId === 'b-atlas' && p.laneId === lane.id)).toBe(true)
  })

  it('default card type is a board property; Initiative is never a card type', () => {
    const types = s().issueTypes
    expect(cardTypes(types).some((t) => t.name === 'Initiative')).toBe(false)
    expect(boardCardTypeId(s().boards.find((b) => b.id === 'b-atlas'), types)).toBe('t-story')

    s().setBoardDefaultCardType('b-atlas', 't-bug')
    expect(boardCardTypeId(s().boards.find((b) => b.id === 'b-atlas'), types)).toBe('t-bug')

    // Initiative is rejected as a default → falls back to the first card type
    s().setBoardDefaultCardType('b-atlas', 't-initiative')
    expect(boardCardTypeId(s().boards.find((b) => b.id === 'b-atlas'), types)).toBe('t-story')
  })

  it('OKRs attach to strategic initiatives only', () => {
    // A card can't be attributed…
    s().setAttribution('st-signup-form', 'obj-efficiency', true)
    expect(s().edges.some((e) => e.kind === 'attribution' && e.to === 'st-signup-form')).toBe(false)
    // …nor a team or value-stream initiative (they inherit through the decomposition).
    s().setAttribution('init-signup', 'obj-efficiency', true)
    expect(s().edges.some((e) => e.kind === 'attribution' && e.to === 'init-signup')).toBe(false)
    s().setAttribution('init-onboarding', 'obj-efficiency', true)
    expect(s().edges.some((e) => e.kind === 'attribution' && e.to === 'init-onboarding')).toBe(false)
    // …but a strategic initiative (an Initiative on a portfolio board) can.
    s().setAttribution('init-explore', 'obj-efficiency', true)
    expect(s().edges.some((e) => e.kind === 'attribution' && e.from === 'obj-efficiency' && e.to === 'init-explore')).toBe(true)
  })

  it('deleting a card removes its placements, parent edge, links and attribution', () => {
    s().deleteItem('st-signup-form')
    expect(s().items.some((i) => i.id === 'st-signup-form')).toBe(false)
    expect(s().placements.some((p) => p.itemId === 'st-signup-form')).toBe(false)
    // its parent edge and its attribution edges are gone
    expect(s().edges.some((e) => e.to === 'st-signup-form' || e.from === 'st-signup-form')).toBe(false)
    // its link (st-signup-form → st-tour) is gone, but the other endpoint survives
    expect(s().links.some((l) => l.from === 'st-signup-form' || l.to === 'st-signup-form')).toBe(false)
    expect(s().items.some((i) => i.id === 'st-tour')).toBe(true)
  })

  it('deleting a parent leaves its children parentless', () => {
    s().deleteItem('init-signup')
    expect(s().items.some((i) => i.id === 'init-signup')).toBe(false)
    expect(decompositionParent('st-signup-form', s().edges)).toBeUndefined()
    expect(decompositionParent('st-email', s().edges)).toBeUndefined()
    expect(decompositionChildren('init-onboarding', s().edges)).not.toContain('init-signup')
  })

  it('WIP enforcement mode is a board property; block rejects a move that would exceed', () => {
    expect(s().boards.find((b) => b.id === 'b-atlas')?.wipEnforcement ?? 'visualize').toBe('visualize')
    s().setBoardWipEnforcement('b-atlas', 'block')
    expect(s().boards.find((b) => b.id === 'b-atlas')?.wipEnforcement).toBe('block')

    // Not Started has a WIP limit of 1 and already holds one card.
    const ns = laneByName('b-atlas', 'Not Started')
    const before = s().placements.find((p) => p.itemId === 'st-signup-form')?.laneId
    s().moveCard('st-signup-form', 'b-atlas', ns.id)
    expect(s().placements.find((p) => p.itemId === 'st-signup-form')?.laneId).toBe(before) // blocked

    // Visualize allows the same move.
    s().setBoardWipEnforcement('b-atlas', 'visualize')
    s().moveCard('st-signup-form', 'b-atlas', ns.id)
    expect(s().placements.find((p) => p.itemId === 'st-signup-form')?.laneId).toBe(ns.id)
  })

  it('global search matches by title or ref, and nothing on an empty query', () => {
    const refs = buildRefs(s().items, s().issueTypes)
    expect(searchItems(s().items, refs, 'gateway').map((i) => i.id)).toContain('init-gateway')
    const ref = refs.get('st-email')!
    expect(searchItems(s().items, refs, ref.toLowerCase()).map((i) => i.id)).toContain('st-email')
    expect(searchItems(s().items, refs, '   ')).toEqual([])
    expect(searchItems(s().items, refs, 'zzzzzz')).toEqual([])
  })

  it('filters: the panel and the item panel share one slot; type toggles are additive', () => {
    s().openItem('st-email')
    expect(s().selectedItemId).toBe('st-email')

    s().toggleFilters()
    expect(s().showFilters).toBe(true)
    expect(s().selectedItemId).toBe(null) // opening filters dismissed the card

    s().toggleFilterType('t-bug')
    s().toggleFilterType('t-spike')
    expect([...s().filters.typeIds].sort()).toEqual(['t-bug', 't-spike'])
    s().toggleFilterType('t-bug')
    expect(s().filters.typeIds).toEqual(['t-spike'])

    s().setFilters({ blocked: true, unassigned: true })
    expect(s().filters).toMatchObject({ typeIds: ['t-spike'], blocked: true, overdue: false, unassigned: true })

    s().openItem('st-email')
    expect(s().showFilters).toBe(false) // opening a card dismissed the panel
    expect(s().selectedItemId).toBe('st-email')

    s().clearFilters()
    expect(s().filters).toEqual(NO_FILTERS)
  })

  it('checklists live inside a card and never count as work', () => {
    const done = laneByName('b-atlas', 'Done')
    const before = laneCardCount(s().lanes, s().placements, done.id)
    const rollBefore = rollupOf('init-signup', graph()).total
    const placementsBefore = s().placements.length
    const check = (id: string) => s().items.find((i) => i.id === id)!.checklist!

    s().addChecklistItem('st-signup-design', 'Write copy')
    s().addChecklistItem('st-signup-design', 'Wire the API')
    expect(check('st-signup-design').map((c) => c.text)).toEqual(['Write copy', 'Wire the API'])

    // A blank add is ignored.
    s().addChecklistItem('st-signup-design', '   ')
    expect(check('st-signup-design').length).toBe(2)

    // Check/uncheck.
    s().toggleChecklistItem('st-signup-design', check('st-signup-design')[0].id)
    expect(check('st-signup-design')[0].done).toBe(true)
    expect(checklistProgress(s().items.find((i) => i.id === 'st-signup-design'))).toEqual({ done: 1, total: 2 })

    // Reorder.
    s().moveChecklistItem('st-signup-design', check('st-signup-design')[0].id, 1)
    expect(check('st-signup-design').map((c) => c.text)).toEqual(['Wire the API', 'Write copy'])

    // Delete.
    s().removeChecklistItem('st-signup-design', check('st-signup-design')[0].id)
    expect(check('st-signup-design').map((c) => c.text)).toEqual(['Write copy'])

    // Never schedulable: lane counts, rollup and placements are unchanged.
    expect(laneCardCount(s().lanes, s().placements, done.id)).toBe(before)
    expect(rollupOf('init-signup', graph()).total).toBe(rollBefore)
    expect(s().placements.length).toBe(placementsBefore)
  })

  it('duplicating a card copies its shape, never its state', () => {
    s().selectBoard('b-atlas')
    const src = s().items.find((i) => i.id === 'st-signup-form')!
    // Everything a copy must not inherit, put on the original first.
    s().setItemFields(src.id, {
      description: 'Prompt: who is exposed, and to what?',
      priority: 'high',
      targetStartDate: '2026-10-01',
      targetEndDate: '2026-11-30',
      blocked: true,
      blockedReason: 'waiting on legal',
      resolvedAt: Date.now(),
    })
    s().setParent(src.id, 'init-signup')
    s().addDependency('st-sso', src.id)

    const copyId = s().duplicateCard(src.id)!
    const copy = s().items.find((i) => i.id === copyId)!

    // A distinct record of the same shape.
    expect(copyId).not.toBe(src.id)
    expect(copy.title).toBe('Build signup form copy')
    expect(copy.typeId).toBe(src.typeId)
    expect(copy.size).toBe(src.size)
    expect(copy.description).toBe('Prompt: who is exposed, and to what?')

    // None of the original's commitments come with it.
    const absent: (keyof Item)[] = ['assignees', 'priority', 'blocked', 'blockedReason', 'targetStartDate', 'targetEndDate', 'resolvedAt', 'lastMoveReason', 'archived', 'archivedAt']
    for (const key of absent) expect(copy[key]).toBeUndefined()

    // A copied checklist is a fresh set of steps, never a set already ticked.
    expect(src.checklist!.some((c) => c.done)).toBe(true)
    expect(copy.checklist!.map((c) => c.text)).toEqual(src.checklist!.map((c) => c.text))
    expect(copy.checklist!.every((c) => !c.done)).toBe(true)
    expect(copy.checklist!.some((c) => src.checklist!.some((o) => o.id === c.id))).toBe(false)

    // A new record: its creation and nothing else, no parent, no dependency, one placement.
    expect(copy.log!.map((l) => l.kind)).toEqual(['created'])
    expect(decompositionParent(copyId, s().edges)).toBeUndefined()
    expect(s().links.some((l) => l.from === copyId || l.to === copyId)).toBe(false)
    expect(s().placements.filter((p) => p.itemId === copyId).length).toBe(1)
  })

  it('a copy lands in the original\'s cell, directly below it — and nowhere when there is no cell', () => {
    s().selectBoard('b-atlas')
    const lane = s().placements.find((p) => p.itemId === 'st-signup-form' && p.boardId === 'b-atlas')!.laneId
    const before = placementsInOrder(s().placements, lane).map((p) => p.itemId)

    const copyId = s().duplicateCard('st-signup-form')!
    const ordered = placementsInOrder(s().placements, lane)
    expect(ordered.map((p) => p.itemId).indexOf(copyId)).toBe(ordered.map((p) => p.itemId).indexOf('st-signup-form') + 1)
    // The lane's order is otherwise untouched, and its ranks are a clean 0..n-1.
    expect(ordered.map((p) => p.itemId).filter((id) => id !== copyId)).toEqual(before)
    expect(ordered.map((p) => p.rank)).toEqual(ordered.map((_, i) => i))

    // Nothing copied is left half-made: no cell means no record at all.
    const items = s().items.length
    expect(s().duplicateCard('nothing-like-this')).toBeUndefined()
    // An initiative is not a card: its section is derived from the work below, so a copied
    // one would be placed in a cell it cannot read in.
    expect(s().duplicateCard('init-signup')).toBeUndefined()
    s().selectBoard('b-nova')
    expect(s().duplicateCard('st-signup-form')).toBeUndefined()
    // And not while the board is being designed: Cancel would drop the placement the copy
    // landed in and leave the card itself behind.
    s().selectBoard('b-atlas')
    s().beginEdit()
    expect(s().duplicateCard('st-signup-form')).toBeUndefined()
    s().cancelEdit()
    expect(s().items.length).toBe(items)
  })

  it('a copy is created rather than moved: landing in Done does not tick it resolved', () => {
    s().selectBoard('b-atlas')
    // Seeded in Atlas' Done column, with no checklist.
    expect(effectiveStage(s().lanes, s().placements.find((p) => p.itemId === 'st-signup-design')!.laneId)).toBe('done')
    const copyId = s().duplicateCard('st-signup-design')!
    const copy = s().items.find((i) => i.id === copyId)!
    expect(copy.resolvedAt).toBeUndefined()
    expect(copy.checklist).toBeUndefined()
  })

  it('boundary: toggling selects an external dependency; changing board clears it', () => {
    s().toggleBoundary('init-gateway')
    expect(s().boundaryId).toBe('init-gateway')
    s().toggleBoundary('init-gateway')
    expect(s().boundaryId).toBe(null)

    s().toggleBoundary('init-gateway')
    s().selectBoard('b-nova')
    expect(s().boundaryId).toBe(null)
  })

  it('multi-select: shift+click seeds from the open card; bulk actions apply', () => {
    s().selectBoard('b-atlas')
    // A card is open; shift+click a second → group of two, panel closed.
    s().openItem('st-email')
    s().toggleMultiSelect('st-sso')
    expect([...s().multiSelect].sort()).toEqual(['st-email', 'st-sso'])
    expect(s().selectedItemId).toBe(null)

    // Shift+click again removes it from the group.
    s().toggleMultiSelect('st-email')
    expect(s().multiSelect).toEqual(['st-sso'])

    // Bulk: type, assign (additive), move.
    s().setItemsType(['st-sso'], 't-bug')
    expect(s().items.find((i) => i.id === 'st-sso')?.typeId).toBe('t-bug')
    s().addItemsAssignee(['st-sso'], 'Zoe Zimmer')
    s().addItemsAssignee(['st-sso'], 'Zoe Zimmer') // deduped, same person
    s().addItemsAssignee(['st-sso'], 'Riley Kim') // an existing user, reused
    const st = () => s().items.find((i) => i.id === 'st-sso')!
    const names = (st().assignees ?? []).map((id) => s().users.find((u) => u.id === id)?.name)
    expect(names).toEqual(['Zoe Zimmer', 'Riley Kim'])
    s().clearItemsAssignees(['st-sso'])
    expect(st().assignees).toBeUndefined()

    const done = laneByName('b-atlas', 'Done')
    s().moveCardsToLane(['st-sso'], done.id)
    expect(s().placements.find((p) => p.itemId === 'st-sso' && p.boardId === 'b-atlas')?.laneId).toBe(done.id)
    expect(s().items.find((i) => i.id === 'st-sso')?.resolvedAt).toBeTruthy() // entering Done starts the clock

    // Initiative is never a card type.
    s().setItemsType(['st-sso'], 't-initiative')
    expect(s().items.find((i) => i.id === 'st-sso')?.typeId).toBe('t-bug')

    // Opening a card clears the group.
    s().openItem('st-email')
    expect(s().multiSelect).toEqual([])
  })

  it('a lane is ordered by rank, and reordering renumbers it cleanly', () => {
    const dev = laneByName('b-atlas', 'Dev')
    const done = laneByName('b-atlas', 'Done')
    const order = () => placementsInOrder(s().placements, dev.id).map((p) => p.itemId)

    s().moveCard('st-email', 'b-atlas', dev.id)
    s().moveCard('st-sso', 'b-atlas', dev.id)
    // Arriving ranks last, including past the seed card that predates rank.
    expect(order()).toEqual(['st-signup-form', 'st-email', 'st-sso'])

    // Reordering renumbers the whole lane to a clean sequence.
    s().moveCardToIndex('st-sso', 'b-atlas', dev.id, 1)
    expect(order()).toEqual(['st-signup-form', 'st-sso', 'st-email'])
    const ranks = placementsInOrder(s().placements, dev.id).map((p) => p.rank)
    expect(ranks).toEqual([0, 1, 2])

    // A cross-lane move appends to the target lane.
    s().moveCard('st-email', 'b-atlas', done.id)
    expect(placementsInOrder(s().placements, dev.id).map((p) => p.itemId)).toEqual(['st-signup-form', 'st-sso'])
    const doneOrder = placementsInOrder(s().placements, done.id).map((p) => p.itemId)
    expect(doneOrder[doneOrder.length - 1]).toBe('st-email')

  })

  it('a card lands at the position it was dropped in', () => {
    s().selectBoard('b-atlas')
    const dev = laneByName('b-atlas', 'Dev')
    const done = laneByName('b-atlas', 'Done')
    const devOrder = () => placementsInOrder(s().placements, dev.id).map((p) => p.itemId)

    s().moveCard('st-email', 'b-atlas', dev.id)
    s().moveCard('st-sso', 'b-atlas', dev.id)
    expect(devOrder()).toEqual(['st-signup-form', 'st-email', 'st-sso'])

    // The index counts the cards already there, without the one being placed.
    s().moveCardToIndex('st-sso', 'b-atlas', dev.id, 0)
    expect(devOrder()).toEqual(['st-sso', 'st-signup-form', 'st-email'])

    // The gaps either side of a card are one place, so they are one index — not a drop
    // 'below A' that renders differently from a drop 'above B'.
    s().moveCardToIndex('st-sso', 'b-atlas', dev.id, 1)
    expect(devOrder()).toEqual(['st-signup-form', 'st-sso', 'st-email'])
    s().moveCardToIndex('st-sso', 'b-atlas', dev.id, 2)
    expect(devOrder()).toEqual(['st-signup-form', 'st-email', 'st-sso'])

    // The end of the lane is reachable, which it was not when a drop could only ever insert
    // before a card.
    s().moveCardToIndex('st-signup-form', 'b-atlas', dev.id, 2)
    expect(devOrder()).toEqual(['st-email', 'st-sso', 'st-signup-form'])
    // Past the end is the end, not an error.
    s().moveCardToIndex('st-signup-form', 'b-atlas', dev.id, 99)
    expect(devOrder()).toEqual(['st-email', 'st-sso', 'st-signup-form'])

    // A card dropped into another lane lands there, at that position.
    s().moveCardToIndex('st-email', 'b-atlas', done.id, 0)
    expect(devOrder()).toEqual(['st-sso', 'st-signup-form'])
    expect(placementsInOrder(s().placements, done.id).map((p) => p.itemId)[0]).toBe('st-email')
  })

  it('a bulk move keeps the selection in its relative order', () => {
    // Bulk move acts on the current board, so the test has to be on it.
    s().selectBoard('b-atlas')
    const done = laneByName('b-atlas', 'Done')
    s().moveCardsToLane(['st-email', 'st-sso'], done.id)
    const order = placementsInOrder(s().placements, done.id).map((p) => p.itemId)
    expect(order).toContain('st-email')
    expect(order).toContain('st-sso')
    expect(order.indexOf('st-email')).toBeLessThan(order.indexOf('st-sso'))
  })

  it('every path that moves a card stamps when it arrived', () => {
    const stamp = (id: string) => s().placements.find((p) => p.itemId === id && p.boardId === 'b-atlas')?.laneEnteredAt
    const dev = laneByName('b-atlas', 'Dev')
    const done = laneByName('b-atlas', 'Done')

    // Most seeded placements predate the clock, so they carry no age — which is the honest
    // 'unknown', not zero. The few the seed backdates carry real stamps: Not Started has
    // held Email verification for about a month.
    expect(stamp('df-signup')).toBeUndefined()
    expect(stamp('st-email')).toBeTruthy()

    // A move stamps.
    s().moveCard('st-email', 'b-atlas', dev.id)
    const moved = stamp('st-email')
    expect(moved).toBeTruthy()

    // And a later move re-stamps. Two moves in the same millisecond share a timestamp, so
    // this asserts the stamp is refreshed rather than that it differs.
    s().moveCard('st-email', 'b-atlas', done.id)
    expect(stamp('st-email')!).toBeGreaterThanOrEqual(moved!)

    // Removing a lane relocates its cards, and they are stamped on arrival too.
    const ns = laneByName('b-atlas', 'Not Started')
    s().splitLane(ns.id, 'rows')
    expect(stamp('st-email')).toBeTruthy()

    // A new card is stamped at birth.
    s().addCard({ boardId: 'b-atlas', typeId: 't-story', laneId: done.id, title: 'Fresh' })
    const fresh = s().items[s().items.length - 1]
    expect(stamp(fresh.id)).toBeTruthy()
  })

  it('a card keeps the history of its journey: a move is recorded where it happened', () => {
    s().selectBoard('b-atlas')
    const moved = (id: string) => (s().items.find((i) => i.id === id)!.log ?? []).filter((e) => e.kind === 'moved')
    const laneId = (name: string) => laneByName('b-atlas', name).id
    const ns = laneId('Not Started')
    const dev = laneId('Dev')

    // A card carrying no log at all still records: the history starts where the card is.
    expect(s().items.find((i) => i.id === 'df-signup')!.log).toBeUndefined()
    s().moveCard('df-signup', 'b-atlas', ns)
    expect(moved('df-signup').map((e) => e.note)).toEqual(['Test → Not Started'])
    expect(moved('df-signup')[0]).toMatchObject({ fromLaneId: laneId('Test'), toLaneId: ns })

    // Landing where it already is is an arrangement, not a move: nothing is written.
    s().moveCard('df-signup', 'b-atlas', ns)
    s().moveCardToIndex('df-signup', 'b-atlas', ns, 0)
    expect(moved('df-signup').length).toBe(1)

    // A drag into another cell is a move, and the entry names both ends as they were then.
    s().moveCardToIndex('df-signup', 'b-atlas', dev, 0)
    expect(moved('df-signup').map((e) => e.note)).toEqual(['Test → Not Started', 'Not Started → Dev'])

    // History is what was true then: renaming the lane afterwards does not rewrite it.
    s().renameLane(dev, 'Development')
    expect(moved('df-signup').at(-1)!.note).toBe('Not Started → Dev')
    expect(s().lanes.find((l) => l.id === dev)!.name).toBe('Development')

    // A bulk move is a journey for each card in it.
    s().moveCardsToLane(['df-signup', 'st-sso'], ns)
    expect(moved('df-signup').at(-1)!.note).toBe('Development → Not Started')
    expect(moved('st-sso').at(-1)!.note).toBe('Test → Not Started')
  })

  it('an initiative records its moves within its section too', () => {
    s().selectBoard('b-nova')
    const moved = () => (s().items.find((i) => i.id === 'init-welcome')!.log ?? []).filter((e) => e.kind === 'moved')
    const seeded = s().placements.find((p) => p.itemId === 'init-welcome' && p.boardId === 'b-nova')!.laneId
    const ip = topLevelLanes(s().lanes, 'b-nova', 'initiatives').find((l) => l.stage === 'inProgress')!
    s().splitLane(ip.id, 'columns')
    const cells = childrenOf(s().lanes, ip.id)

    s().moveInitiative('init-welcome', 'b-nova', cells[1].id)
    expect(moved()).toHaveLength(1)
    expect(moved()[0]).toMatchObject({ fromLaneId: seeded, toLaneId: cells[1].id })
    expect(moved()[0].note).toBe('Not Started → Column 2')

    // A rank within the same cell arranges; it does not move.
    s().moveInitiativeToIndex('init-welcome', 'b-nova', cells[1].id, 0)
    expect(moved()).toHaveLength(1)

    // And a move the model refuses is not a move to record.
    const done = topLevelLanes(s().lanes, 'b-nova', 'initiatives').find((l) => l.stage === 'done')!
    s().moveInitiative('init-welcome', 'b-nova', done.id)
    expect(moved()).toHaveLength(1)
  })

  it('a lane removed records where its cards went, though that lane is gone', () => {
    s().selectBoard('b-atlas')
    const ns = laneByName('b-atlas', 'Not Started')
    s().splitLane(ns.id, 'rows')
    const [row1] = childrenOf(s().lanes, ns.id)

    // The board changed under the card: nobody moved it, so the entry says what did.
    const afterSplit = (s().items.find((i) => i.id === 'st-email')!.log ?? []).at(-1)!
    expect(afterSplit.kind).toBe('moved')
    expect(afterSplit.note).toBe('Not Started → Row 1 · lane split')
    expect(afterSplit).toMatchObject({ fromLaneId: ns.id, toLaneId: row1.id })

    // Removing the row folds the split and relocates its cards.
    s().removeLane(row1.id)
    const entry = (s().items.find((i) => i.id === 'st-email')!.log ?? []).at(-1)!
    expect(entry.note).toBe('Row 1 → Not Started · lane removed')
    // The lane it names is gone — the note still reads, and the placement agrees with the ids.
    expect(s().lanes.find((l) => l.id === row1.id)).toBeUndefined()
    expect(s().lanes.find((l) => l.id === entry.fromLaneId)).toBeUndefined()
    expect(s().placements.find((p) => p.itemId === 'st-email')!.laneId).toBe(entry.toLaneId)
  })

  it('the demo board carries a history the flow view can read', () => {
    // The view's scope: the cards this board carries in its cards workflow, filed-away ones
    // included — a board's throughput does not stop at the archive.
    const laneOf = new Map(s().placements.filter((p) => p.boardId === 'b-atlas').map((p) => [p.itemId, p.laneId]))
    const records = [...laneOf.keys()]
      .filter((id) => s().lanes.find((l) => l.id === laneOf.get(id))?.workflow === 'cards')
      .map((id) => s().items.find((i) => i.id === id)!)
      .map((i) => flowRecord(i, effectiveStage(s().lanes, laneOf.get(i.id)!)))
    const summary = flowSummary(records, Date.now())

    // Eight delivered (one of them this week, seven filed away), four still moving.
    expect(records.length).toBe(12)
    expect(summary.delivered).toBe(8)
    expect(summary.inFlight).toBe(4)
    // Lead time includes the wait in Backlog; cycle time starts at the first commit, so it is
    // shorter for the cards that queued — and the slowest card is the outlier the p85 names.
    expect(summary.lead.median).toBe(15.5)
    expect(summary.lead.p85).toBe(17)
    expect(summary.cycle.median).toBe(14)
    expect(summary.cycle.p85).toBe(16)
    expect(summary.lead.count).toBe(8)

    // And the history is a real shape over weeks, not a flat line: the flow diagram is neither
    // empty at the start of its window nor unchanged from the first week to the last.
    const buckets = weeklyBuckets(Date.now(), 8)
    const flow = cumulativeFlow(records, buckets)
    expect(flow.every((c) => c.backlog + c.notStarted + c.inProgress + c.done > 0)).toBe(true)
    expect(flow[flow.length - 1].done).toBeGreaterThan(flow[0].done)
    expect(throughput(records, buckets).reduce((a, b) => a + b, 0)).toBe(8)
  })

  it('renaming or splitting a column later leaves the history in stages alone', () => {
    s().selectBoard('b-atlas')
    const dev = laneByName('b-atlas', 'Dev')
    const movedOf = (id: string) => (s().items.find((i) => i.id === id)!.log ?? []).filter((e) => e.kind === 'moved')
    const before = movedOf('st-signup-form')

    s().renameLane(dev.id, 'Development')
    s().splitLane(dev.id, 'rows')
    const after = movedOf('st-signup-form')

    // What was recorded stays recorded: the entry names the cell as it was, with its stage.
    expect(after.slice(0, before.length).map((e) => [e.note, e.toStage, e.boardId])).toEqual(
      before.map((e) => [e.note, e.toStage, e.boardId]),
    )
    // A split rehomes the card into a row, and the entry still records the *stage* it was in —
    // so the flow view reads the same journey through a board redesign.
    const split = after[after.length - 1]
    expect(split.toStage).toBe('inProgress')
    expect(split.note).toContain('lane split')
    const record = flowRecord(s().items.find((i) => i.id === 'st-signup-form')!, effectiveStage(s().lanes, dev.id))
    expect(record.moves.map((m) => m.to)).toEqual(['notStarted', 'inProgress', 'inProgress'])
  })

  it('a move entry written before stages were recorded still loads, and is not a move flow reads', () => {
    const migrated = migrateState({
      items: [
        {
          id: 'x',
          title: 'X',
          typeId: 't-story',
          createdAt: 1,
          log: [
            { id: 'l1', at: 2, kind: 'created' },
            { id: 'l2', at: 3, kind: 'moved', toLaneId: 'lane-1', note: 'Somewhere → Elsewhere' },
          ],
        },
      ],
    }) as { items: { log: unknown[] }[] }
    // The entry is left exactly as it was — additive fields, nothing to backfill.
    expect(migrated.items[0].log).toEqual([
      { id: 'l1', at: 2, kind: 'created' },
      { id: 'l2', at: 3, kind: 'moved', toLaneId: 'lane-1', note: 'Somewhere → Elsewhere' },
    ])
    // It is skipped rather than guessed at: the stage it landed in was never recorded.
    expect(flowRecord(migrated.items[0] as never, 'inProgress').moves).toEqual([])
  })

  it('filter presets belong to the board they were saved on', () => {
    s().selectBoard('b-atlas')
    s().setFilters({ priorities: ['urgent'] })
    s().saveFilter('Urgent here')
    s().selectBoard('b-nova')
    s().setFilters({ blocked: true })
    s().saveFilter('Blocked here')

    expect(s().savedFilters.map((p) => [p.name, p.boardId])).toEqual([
      ['Urgent here', 'b-atlas'],
      ['Blocked here', 'b-nova'],
    ])

    // Applying one adopts it whole; clearing afterwards leaves no residue.
    const atlas = s().savedFilters.find((p) => p.name === 'Urgent here')!
    s().applySavedFilter(atlas.id)
    expect(s().filters.priorities).toEqual(['urgent'])
    expect(s().filters.blocked).toBe(false)
    s().clearFilters()
    expect(hasActiveFilters(s().filters)).toBe(false)

    // A saved set never aliases the live filter state: toggling a box later cannot edit the past.
    s().selectBoard('b-atlas')
    s().setFilters({ priorities: ['low'] })
    expect(s().savedFilters.find((p) => p.id === atlas.id)!.filters.priorities).toEqual(['urgent'])

    s().removeSavedFilter(atlas.id)
    expect(s().savedFilters.map((p) => p.name)).toEqual(['Blocked here'])
  })

  it('a preset round-trips through persistence, and an old one stays available everywhere', () => {
    s().selectBoard('b-atlas')
    s().setFilters({ priorities: ['high'], unassigned: true })
    s().saveFilter('Unassigned high')

    const persisted = persistedSlice(s()) as { savedFilters: SavedFilter[] }
    const rehydrated = migrateState({ ...persisted }) as { savedFilters: SavedFilter[] }
    expect(rehydrated.savedFilters).toHaveLength(1)
    expect(rehydrated.savedFilters[0]).toMatchObject({ name: 'Unassigned high', boardId: 'b-atlas' })
    expect(rehydrated.savedFilters[0].filters).toMatchObject({ priorities: ['high'], unassigned: true })

    // A set saved before presets belonged to a board has no board, and nothing invents one:
    // it stays available everywhere rather than being claimed for a board after the fact.
    const old = { id: 'sf-old', name: 'Old', filters: NO_FILTERS }
    const migrated = migrateState({ savedFilters: [old] }) as { savedFilters: SavedFilter[] }
    expect(migrated.savedFilters[0]).toEqual(old)
    expect(migrated.savedFilters[0].boardId).toBeUndefined()
  })

  it('the seeded initiative is at risk, and the flags clear when the state behind them does', () => {
    const health = () => initiativeHealth('init-signup', graph())

    // Team Atlas' initiative: a blocked card below it, a card waiting on work that is not done
    // (both risks — someone else can see them), nothing moved below for twelve days, one committed
    // card nobody owns, and work that adds up to more than the initiative estimates (15 points
    // below against a claim of 13).
    const before = health()
    expect(before.level).toBe('atRisk')
    expect(before.flags.map((f) => f.flag)).toEqual(['blocked', 'waiting', 'stale', 'unowned', 'oversized'])
    expect(before.flags.at(-1)!.why).toContain('15 points')
    expect(before.flags[0].label).toBe('1 blocked')
    expect(before.flags[1].why).toContain('wait on work that is not done')
    expect(before.flags[2].tone).toBe('watch')

    // Unblocking one card clears one flag and no more: each rule answers for itself.
    s().unblockItem('st-sso')
    expect(health().flags.map((f) => f.flag)).toEqual(['waiting', 'stale', 'unowned', 'oversized'])

    // Deliver the two cards that were waiting (the seed links the gateway to both): the
    // dependency risk goes with them. The staleness is still there — nothing *else* below has
    // moved, and the rule reads the newest arrival, not the loudest one.
    const done = laneByName('b-atlas', 'Done').id
    s().moveCard('st-email', 'b-atlas', done)
    s().moveCard('st-sso', 'b-atlas', done)
    expect(health().flags.map((f) => f.flag)).toEqual(['stale', 'unowned', 'oversized'])

    // Move the last card still sitting there, and the stale flag clears too.
    s().moveCard('st-signup-form', 'b-atlas', done)
    const after = health()
    expect(after.flags.map((f) => f.flag)).toEqual(['unowned', 'oversized'])
    expect(after.level).toBe('watch')

    // And an initiative with nothing under it has nothing to roll up.
    expect(initiativeHealth('init-explore', graph()).flags.map((f) => f.flag)).toEqual(['unplanned'])
  })

  it('the log is the item\'s own history: comments, and the changes that were decisions', () => {
    s().selectBoard('b-atlas')
    const log = (id: string) => s().items.find((i) => i.id === id)!.log ?? []
    const editedNotes = (id: string) => log(id).filter((e) => e.kind === 'edited').map((e) => e.note)

    // A comment: one entry, and only on the card it was left on.
    s().addLogNote('st-email', 'Waiting on **legal** before this can move.')
    expect(log('st-email').at(-1)).toMatchObject({ kind: 'noted', note: 'Waiting on **legal** before this can move.' })
    expect(log('df-signup')).toEqual([])

    // The decisions, each in its own words — and in the order they were made.
    s().setItemFields('st-email', { size: 5, priority: 'urgent', targetEndDate: '2026-12-01' })
    expect(editedNotes('st-email')).toEqual(['size: 3 → 5', 'priority: none → urgent', 'target end: none → 2026-12-01'])
    s().setItemFields('st-email', { assignees: ['u-mb'] })
    expect(editedNotes('st-email').at(-1)).toBe('assignees: nobody → Maya Blake')
    // A retype is named by what the types are called…
    s().setItemFields('st-email', { typeId: 't-bug' })
    expect(editedNotes('st-email').at(-1)).toBe('type: User Story → Bug')
    // …and a retype the model refuses changed nothing, so it says nothing.
    s().setItemFields('init-signup', { typeId: 't-story' })
    expect(log('init-signup')).toEqual([])

    // Free text is logged once, when the field is left — never a letter at a time.
    s().setItemFields('st-email', { title: 'Email verificatio' })
    s().setItemFields('st-email', { title: 'Email verification done right' })
    expect(editedNotes('st-email').at(-1)).toBe('type: User Story → Bug')
    s().logTextEdit('st-email', 'title', 'Email verification')
    expect(editedNotes('st-email').at(-1)).toBe('title: "Email verification" → "Email verification done right"')
    // Leaving the field without changing anything says nothing.
    const count = log('st-email').length
    s().logTextEdit('st-email', 'title', 'Email verification done right')
    s().logTextEdit('st-email', 'description', '')
    expect(log('st-email').length).toBe(count)

    // A dependency is in the dependent's history, both ways; the other end keeps its own story.
    s().addDependency('st-sso', 'st-email')
    expect(log('st-email').at(-1)).toMatchObject({ kind: 'linked' })
    expect(log('st-email').at(-1)!.note).toBe('waits on SSO buttons')
    s().removeDependency('st-sso', 'st-email')
    expect(log('st-email').at(-1)).toMatchObject({ kind: 'unlinked', note: 'no longer waits on SSO buttons' })
    expect(log('st-sso').map((e) => e.kind)).not.toContain('linked')
    expect(s().links.some((l) => l.from === 'st-sso' && l.to === 'st-email')).toBe(false)
  })

  it('the load-test board is built on request, and rebuilt rather than doubled', () => {
    s().addStressBoard(120)
    const stressLanes = () => s().lanes.filter((l) => l.boardId === STRESS_BOARD_ID)
    expect(s().boards.filter((b) => b.id === STRESS_BOARD_ID)).toHaveLength(1)
    expect(s().boardId).toBe(STRESS_BOARD_ID)
    expect(s().items.filter((i) => i.id.startsWith(`${STRESS_PREFIX}card-`))).toHaveLength(120)
    expect(stressLanes().length).toBeGreaterThan(20) // typed columns, cells and containers
    // It opens as the board itself, with nothing in front of it.
    expect(s().selectedItemId).toBe(null)
    expect(s().filters).toEqual(NO_FILTERS)
    expect([s().showDashboard, s().showTimeline, s().showMetrics, s().showBoards, s().showMyWork]).toEqual([false, false, false, false, false])

    // Asking for a different size replaces it — one board, and the old cards are gone.
    s().addStressBoard(40)
    expect(s().boards.filter((b) => b.id === STRESS_BOARD_ID)).toHaveLength(1)
    expect(s().items.filter((i) => i.id.startsWith(`${STRESS_PREFIX}card-`))).toHaveLength(40)
    expect(s().placements.filter((p) => p.boardId === STRESS_BOARD_ID)).toHaveLength(40 + 9) // cards and initiatives
    expect(s().items.filter((i) => i.id.startsWith(`${STRESS_PREFIX}card-`) && s().placements.every((p) => p.itemId !== i.id))).toEqual([])

    // And a real board is untouched: its cards, its people, its links.
    expect(s().boards.some((b) => b.id === 'b-atlas')).toBe(true)
    expect(s().items.find((i) => i.id === 'st-signup-form')?.title).toBe('Build signup form')
    expect(s().users.some((u) => u.id === 'u-mb')).toBe(true)
    expect(s().links.some((l) => l.from === 'init-gateway')).toBe(true)
    // The people the load test references come with it, and only once.
    expect(s().users.filter((u) => u.id.startsWith(STRESS_PREFIX))).toHaveLength(8)
    expect(new Set(s().users.map((u) => u.id)).size).toBe(s().users.length)

    // Reset takes it with everything else — it was never part of the demo.
    s().resetDemo()
    expect(s().boards.some((b) => b.id === STRESS_BOARD_ID)).toBe(false)
    expect(s().items.some((i) => i.id.startsWith(STRESS_PREFIX))).toBe(false)
    expect(s().users.some((u) => u.id.startsWith(STRESS_PREFIX))).toBe(false)
  })

  it('the board is the surface only when no view sits over it', () => {
    const base = { showDashboard: false, showTimeline: false, showArchive: false, showObjectives: false, showBoards: false, showMyWork: false, showMetrics: false }
    expect(isBoardSurface(base)).toBe(true)
    // Every view counts, including the ones added later — a flag this list forgets would put the
    // board's own controls in front of a view that reports on work.
    for (const flag of Object.keys(base) as (keyof typeof base)[]) {
      expect(isBoardSurface({ ...base, [flag]: true }), flag).toBe(false)
    }
  })

  it('an initiative with nothing below it is its own leaf: it can be committed before it is broken down', () => {
    s().selectBoard('b-strategy')
    const section = (stage: Stage) => topLevelLanes(s().lanes, 'b-strategy', 'initiatives').find((l) => l.stage === stage)!
    const laneOf = (id: string, boardId = 'b-strategy') => s().placements.find((p) => p.itemId === id && p.boardId === boardId)!.laneId
    // The fixture's unplanned initiative: no descendants at all.
    expect(descendants('init-explore', graph())).toEqual([])
    expect(laneOf('init-explore')).toBe(section('backlog').id)

    // It moves between sections, and back — the section is the only fact there is.
    s().moveInitiative('init-explore', 'b-strategy', section('notStarted').id)
    expect(laneOf('init-explore')).toBe(section('notStarted').id)
    s().moveInitiativeToIndex('init-explore', 'b-strategy', section('inProgress').id, 0)
    expect(laneOf('init-explore')).toBe(section('inProgress').id)
    s().moveInitiative('init-explore', 'b-strategy', section('backlog').id)
    expect(laneOf('init-explore')).toBe(section('backlog').id)
    // And it records where it went, like any other move.
    expect((s().items.find((i) => i.id === 'init-explore')!.log ?? []).at(-1)).toMatchObject({ kind: 'moved', toStage: 'backlog' })

    // An initiative with work below still may not cross a section: the derivation governs.
    expect(descendants('init-signup', graph()).length).toBeGreaterThan(0)
    s().selectBoard('b-atlas')
    const before = laneOf('init-signup', 'b-atlas')
    const atlasSection = (stage: Stage) => topLevelLanes(s().lanes, 'b-atlas', 'initiatives').find((l) => l.stage === stage)!
    s().moveInitiative('init-signup', 'b-atlas', atlasSection('done').id)
    expect(laneOf('init-signup', 'b-atlas')).toBe(before)
    // …but it may still be rearranged within its own section.
    s().moveInitiative('init-signup', 'b-atlas', atlasSection('inProgress').id)
    expect(laneOf('init-signup', 'b-atlas')).toBe(atlasSection('inProgress').id)
  })

  it('initiative kinds belong to a board, and None is the absence of one', () => {
    s().selectBoard('b-atlas')
    const kinds = () => s().boards.find((b) => b.id === 'b-atlas')!.initiativeTypes ?? []

    // Nothing to start with: an empty list, and None is not an entry in it to delete.
    expect(kinds()).toEqual([])
    expect(boardInitiativeTypes(s().boards.find((b) => b.id === 'b-atlas'))).toEqual([])

    s().addInitiativeType('b-atlas', '  Bet  ', '#0ea5e9')
    s().addInitiativeType('b-atlas', 'Programme', '#8b5cf6')
    expect(kinds().map((k) => k.name)).toEqual(['Bet', 'Programme']) // trimmed on the way in
    // Nothing may be called None — it would be a second thing meaning the same.
    s().addInitiativeType('b-atlas', 'none', '#000000')
    expect(kinds()).toHaveLength(2)
    const bet = kinds()[0]

    // A kind is given to an initiative, and to nothing else.
    s().setInitiativeKind('init-signup', bet.id)
    expect(s().items.find((i) => i.id === 'init-signup')!.initiativeTypeId).toBe(bet.id)
    expect(s().items.find((i) => i.id === 'init-signup')!.typeId).toBe('t-initiative') // typeId is untouched
    s().setInitiativeKind('st-email', bet.id)
    expect(s().items.find((i) => i.id === 'st-email')!.initiativeTypeId).toBeUndefined()
    // A kind from another board is allowed and resolves: an initiative can be placed on more than
    // one board while its kind is item-level, so a label has to be readable wherever it is defined.
    s().addInitiativeType('b-nova', 'Nova-only', '#22c55e')
    const novaKind = s().boards.find((b) => b.id === 'b-nova')!.initiativeTypes![0].id
    s().setInitiativeKind('init-signup', novaKind)
    expect(initiativeTypeById(s().boards, s().items.find((i) => i.id === 'init-signup')!.initiativeTypeId)?.name).toBe('Nova-only')
    s().setInitiativeKind('init-signup', bet.id)

    // An id no board defines is refused: labels that cannot be read back are not labels.
    s().setInitiativeKind('init-signup', 'kind-that-does-not-exist')
    expect(s().items.find((i) => i.id === 'init-signup')!.initiativeTypeId).toBe(bet.id)
    // None is the absence of a value, so clearing it is setting nothing.
    s().setInitiativeKind('init-signup', undefined)
    expect(s().items.find((i) => i.id === 'init-signup')!.initiativeTypeId).toBeUndefined()

    // Renaming and recolouring show everywhere at once: nothing is copied onto the item.
    s().setInitiativeKind('init-signup', bet.id)
    s().updateInitiativeType('b-atlas', bet.id, { name: 'Bet on growth', color: '#f43f5e' })
    expect(initiativeTypeById(s().boards, s().items.find((i) => i.id === 'init-signup')!.initiativeTypeId)?.name).toBe('Bet on growth')
    s().updateInitiativeType('b-atlas', bet.id, { name: 'None' })
    expect(initiativeTypeById(s().boards, bet.id)?.name).toBe('Bet on growth') // refused

    // Removing a kind in use is refused, and the count says why.
    expect(initiativesCarrying(s().items, bet.id)).toBe(1)
    s().removeInitiativeType('b-atlas', bet.id)
    expect(kinds().map((k) => k.name)).toEqual(['Bet on growth', 'Programme'])
    s().setInitiativeKind('init-signup', undefined)
    s().removeInitiativeType('b-atlas', bet.id)
    expect(kinds().map((k) => k.name)).toEqual(['Programme'])
  })

  it('a kind changes nothing else: the same rollup, WIP, health and flow either way', () => {
    const snapshot = () => {
      const g = graph()
      return JSON.stringify({
        rollup: rollupOf('init-signup', g),
        lane: laneCardCount(s().lanes, s().placements, laneByName('b-atlas', 'Not Started').id),
        health: initiativeHealth('init-signup', g),
        deps: openDependenciesOf('st-email', g).map((d) => d.state),
        flow: flowSummary([flowRecord(s().items.find((i) => i.id === 'st-signup-form')!, 'inProgress')], Date.now()),
      })
    }
    s().selectBoard('b-atlas')
    const before = snapshot()
    s().addInitiativeType('b-atlas', 'Bet', '#0ea5e9')
    s().setInitiativeKind('init-signup', s().boards.find((b) => b.id === 'b-atlas')!.initiativeTypes![0].id)
    expect(snapshot()).toBe(before)
  })

  it('a kind belongs to a board: duplicated with it, never carried by a template', () => {
    s().selectBoard('b-atlas')
    s().addInitiativeType('b-atlas', 'Bet', '#0ea5e9')
    const kindId = s().boards.find((b) => b.id === 'b-atlas')!.initiativeTypes![0].id

    // A copy of a board is a board: the kinds come across, with ids of their own, so renaming one
    // board's Bet cannot rename the other's.
    s().duplicateBoard('b-atlas', 'Atlas two')
    const copy = s().boards.find((b) => b.name === 'Atlas two')!
    expect(copy.initiativeTypes!.map((k) => k.name)).toEqual(['Bet'])
    expect(copy.initiativeTypes![0].id).not.toBe(kindId)
    s().updateInitiativeType(copy.id, copy.initiativeTypes![0].id, { name: 'Bet (copy)' })
    expect(s().boards.find((b) => b.id === 'b-atlas')!.initiativeTypes![0].name).toBe('Bet')

    // A template designs a flow and nothing else, so the kinds do not travel with it.
    s().saveBoardAsTemplate('b-atlas', 'Atlas flow')
    const template = s().boardTemplates.find((t) => t.name === 'Atlas flow')!
    expect(template).not.toHaveProperty('initiativeTypes')

    // Old state: a board without the field reads as no kinds at all.
    const migrated = migrateState({ boards: [{ id: 'x', name: 'X', band: 'team' }] }) as { boards: Board[] }
    expect(boardInitiativeTypes(migrated.boards[0])).toEqual([])

    // The kind filter is view state, and it goes with the board it was set on.
    s().setInitiativeKindFilter(kindId)
    expect(s().initiativeKindFilter).toBe(kindId)
    expect(persistedSlice(s())).not.toHaveProperty('initiativeKindFilter')
    s().selectBoard('b-nova')
    expect(s().initiativeKindFilter).toBe(null)
  })

  it('a filter narrows what you see, never the load a column carries', () => {
    const ns = laneByName('b-atlas', 'Not Started')
    const before = laneCardCount(s().lanes, s().placements, ns.id)
    const placementsBefore = JSON.stringify(s().placements)

    // The most restrictive filter there is: nothing on this board qualifies.
    s().setFilters({ priorities: ['urgent'], minAgeDays: 365, assigneeIds: ['nobody'] })

    // Counts read the column, not the view — the rule the filter panel must not break.
    expect(laneCardCount(s().lanes, s().placements, ns.id)).toBe(before)
    expect(JSON.stringify(s().placements)).toBe(placementsBefore)
    expect(s().filters.minAgeDays).toBe(365)

    s().clearFilters()
    expect(laneCardCount(s().lanes, s().placements, ns.id)).toBe(before)
  })

  it('priority is set and cleared, singly and in bulk, and moves nothing else', () => {
    const item = (id: string) => s().items.find((i) => i.id === id)!
    const ns = laneByName('b-atlas', 'Not Started')
    const before = {
      status: statusOf('st-sso', graph()),
      rollup: rollupOf('st-sso', graph()).percent,
      wip: laneCardCount(s().lanes, s().placements, ns.id),
    }

    s().setItemFields('st-sso', { priority: 'urgent' })
    expect(item('st-sso').priority).toBe('urgent')

    // The bulk path the card menu uses: one call per selected card.
    s().setItemFields('st-email', { priority: 'low' })
    expect(item('st-email').priority).toBe('low')

    // Cleared, not set to a sentinel.
    s().setItemFields('st-sso', { priority: undefined })
    expect(item('st-sso').priority).toBeUndefined()

    // Priority is a judgement, not a derivation — so nothing downstream moves.
    expect(statusOf('st-sso', graph())).toEqual(before.status)
    expect(rollupOf('st-sso', graph()).percent).toBe(before.rollup)
    expect(laneCardCount(s().lanes, s().placements, ns.id)).toBe(before.wip)

    // Round-trips through the persisted slice.
    s().setItemFields('st-sso', { priority: 'high' })
    expect(persistedSlice(s()).items?.find((i) => i.id === 'st-sso')?.priority).toBe('high')

    // And an item that predates the field rehydrates cleanly.
    const migrated = migrateState({ items: [{ id: 'x', title: 't', typeId: 't-story', createdAt: 0 }] }) as {
      items: { priority?: string }[]
    }
    expect(migrated.items[0].priority).toBeUndefined()
  })

  it('an initiative is never retyped, and nothing becomes an initiative', () => {
    const typeOf = (id: string) => s().items.find((i) => i.id === id)?.typeId

    // An initiative cannot become a card type — by bulk or through the panel.
    s().setItemsType(['init-signup'], 't-bug')
    expect(typeOf('init-signup')).toBe('t-initiative')
    s().setItemFields('init-signup', { typeId: 't-story' })
    expect(typeOf('init-signup')).toBe('t-initiative')

    // And a card cannot become one.
    s().setItemsType(['st-sso'], 't-initiative')
    expect(typeOf('st-sso')).toBe('t-story')
    s().setItemFields('st-sso', { typeId: 't-initiative' })
    expect(typeOf('st-sso')).toBe('t-story')

    // A card's type still changes normally…
    s().setItemFields('st-sso', { typeId: 't-bug' })
    expect(typeOf('st-sso')).toBe('t-bug')

    // …a mixed selection retypes the cards and leaves the initiative alone…
    s().setItemsType(['st-sso', 'init-signup'], 't-task')
    expect(typeOf('st-sso')).toBe('t-task')
    expect(typeOf('init-signup')).toBe('t-initiative')

    // …and the rest of a patch still applies to an initiative.
    s().setItemFields('init-signup', { typeId: 't-bug', title: 'Renamed' })
    expect(s().items.find((i) => i.id === 'init-signup')?.title).toBe('Renamed')
    expect(typeOf('init-signup')).toBe('t-initiative')
  })

  it('bulk delete and archive act on the whole selection', () => {
    s().toggleMultiSelect('st-email')
    s().toggleMultiSelect('st-sso')
    s().deleteItems(['st-email', 'st-sso'])
    expect(s().items.some((i) => i.id === 'st-email')).toBe(false)
    expect(s().items.some((i) => i.id === 'st-sso')).toBe(false)
    expect(s().multiSelect).toEqual([])
    expect(s().links.some((l) => l.from === 'st-email' || l.to === 'st-email')).toBe(false)

    s().toggleMultiSelect('st-signup-form')
    s().archiveItems(['st-signup-form'])
    expect(s().items.find((i) => i.id === 'st-signup-form')?.archived).toBe(true)
    expect(s().multiSelect).toEqual([])
  })

  it('confirm requests are held in view state until resolved', () => {
    let confirmed = false
    s().askConfirm({ title: 'Delete?', confirmLabel: 'Delete', danger: true, onConfirm: () => { confirmed = true } })
    expect(s().confirm?.title).toBe('Delete?')
    s().confirm!.onConfirm()
    s().closeConfirm()
    expect(confirmed).toBe(true)
    expect(s().confirm).toBe(null)
  })

  it('lane policy (description) is stored on the lane', () => {
    const ns = laneByName('b-atlas', 'Not Started')
    s().setLaneDescription(ns.id, 'Pull one at a time.')
    expect(s().lanes.find((l) => l.id === ns.id)?.description).toBe('Pull one at a time.')
    s().setLaneDescription(ns.id, undefined)
    expect(s().lanes.find((l) => l.id === ns.id)?.description).toBeUndefined()
  })

  it('persists collapsed columns, while selection/filters stay view-only', () => {
    const ip = laneByName('b-atlas', 'In Progress')
    s().toggleCollapse(ip.id)
    expect(persistedSlice(s()).collapsedLanes).toEqual({ [ip.id]: true })
    expect(persistedSlice(s()).lanes).toBeDefined() // the design is persisted

    s().setSearch('x')
    s().openItem('st-email')
    s().toggleMultiSelect('st-sso')
    const slice = persistedSlice(s())
    expect(slice.search).toBeUndefined()
    expect(slice.selectedItemId).toBeUndefined()
    expect(slice.multiSelect).toBeUndefined()
  })

  it('migrateState splits the old targetDate into a target end date', () => {
    const legacy = { items: [{ id: 'x', targetDate: '2026-05-01' }, { id: 'y' }] }
    const migrated = migrateState(legacy) as { items: { id: string; targetEndDate?: string; targetDate?: string }[] }
    expect(migrated.items[0].targetEndDate).toBe('2026-05-01')
    expect('targetDate' in migrated.items[0]).toBe(false)
    expect(migrated.items[1].targetEndDate).toBeUndefined()
  })

  it('migrateState turns a single assignee into a user-backed list', () => {
    const legacy = { items: [{ id: 'x', assignee: 'Maya Blake' }, { id: 'y' }] }
    const migrated = migrateState(legacy) as {
      items: { id: string; assignees?: string[]; assignee?: string }[]
      users: { id: string; name: string }[]
    }
    expect(migrated.users).toEqual([{ id: 'u-maya-blake', name: 'Maya Blake' }])
    expect(migrated.items[0].assignees).toEqual(['u-maya-blake'])
    expect('assignee' in migrated.items[0]).toBe(false)
    expect(migrated.items[1].assignees).toBeUndefined()
  })

  it('removing one cell of a split folds the split away rather than stranding its cards', () => {
    s().selectBoard('b-atlas')
    const backlog = laneByName('b-atlas', 'Backlog')
    s().splitLane(backlog.id, 'columns')
    const cells = childrenOf(s().lanes, backlog.id)
    expect(cells).toHaveLength(2)
    s().moveCard('st-email', 'b-atlas', cells[1].id)

    s().removeLane(cells[0].id)

    // One child is not a split: the survivor folds away and the section holds the card itself,
    // which is the cell the surface looks in. Before this the card sat in a cell nothing drew.
    expect(childrenOf(s().lanes, backlog.id)).toHaveLength(0)
    expect(s().placements.find((x) => x.itemId === 'st-email' && x.boardId === 'b-atlas')?.laneId).toBe(backlog.id)
  })

  it('a parent is always an initiative', () => {
    const parentOf = (id: string) => decompositionParent(id, s().edges)
    // A card rolls up to an initiative.
    s().setParent('st-email', 'init-signup')
    expect(parentOf('st-email')).toBe('init-signup')

    // ...and not to another card, which is the edge that would let a loop start.
    s().setParent('st-email', 'st-signup-form')
    expect(parentOf('st-email')).toBe('init-signup')

    // An initiative's parent is another initiative, for the same reason.
    s().setParent('init-signup', 'init-onboarding')
    expect(parentOf('init-signup')).toBe('init-onboarding')
    s().setParent('init-signup', 'st-email')
    expect(parentOf('init-signup')).toBe('init-onboarding')

    // One parent, always: setting another replaces rather than adding.
    s().setParent('st-email', 'init-onboarding')
    expect(parentOf('st-email')).toBe('init-onboarding')
    expect(s().edges.filter((e) => e.kind === 'decomposition' && e.to === 'st-email')).toHaveLength(1)

    // And removing leaves it a root.
    s().setParent('st-email', null)
    expect(parentOf('st-email')).toBeUndefined()
  })

  it('a selection moves to another board, into that board\u2019s own drop cell', () => {
    s().selectBoard('b-atlas')
    const nova = leafLanes(s().lanes, 'b-nova', 'cards')
    s().setBoardDefaultDropLane('b-nova', nova[1].id)

    s().moveCardsToBoard(['st-email', 'st-signup-form'], 'b-nova')

    const on = (boardId: string, itemId: string) => s().placements.filter((p) => p.boardId === boardId && p.itemId === itemId)
    // Gone from the board it left, and there exactly once on the one it arrived at.
    expect(on('b-atlas', 'st-email')).toHaveLength(0)
    expect(on('b-atlas', 'st-signup-form')).toHaveLength(0)
    expect(on('b-nova', 'st-email')).toHaveLength(1)
    expect(on('b-nova', 'st-email')[0].laneId).toBe(nova[1].id)
    expect(on('b-nova', 'st-signup-form')[0].laneId).toBe(nova[1].id)
    // They are on another board now, so they are not selected on this one.
    expect(s().multiSelect).toEqual([])

    // There and back again: one placement per board, never two.
    s().selectBoard('b-nova')
    s().moveCardsToBoard(['st-email'], 'b-atlas')
    expect(on('b-nova', 'st-email')).toHaveLength(0)
    expect(on('b-atlas', 'st-email')).toHaveLength(1)
  })

  it('a move keeps the auto-archive clock in step with the stage it lands in', () => {
    s().selectBoard('b-atlas')
    const done = laneByName('b-nova', 'Done')
    s().setBoardDefaultDropLane('b-nova', done.id)
    s().moveCardsToBoard(['st-email'], 'b-nova')
    // Landing in a Done cell resolves it.
    expect(s().items.find((i) => i.id === 'st-email')?.resolvedAt).toBeTruthy()

    const backlog = laneByName('b-nova', 'Backlog')
    s().setBoardDefaultDropLane('b-nova', backlog.id)
    s().moveCardsToBoard(['st-email'], 'b-atlas') // back, then out again into Backlog
    s().selectBoard('b-atlas')
    s().moveCardsToBoard(['st-email'], 'b-nova')
    // ...and landing somewhere uncommitted un-resolves it, rather than leaving a stale stamp.
    expect(s().items.find((i) => i.id === 'st-email')?.resolvedAt).toBeFalsy()
  })

  it('a card lands in the cell the board named, and falls back when that cell is gone', () => {
    const atlas = () => s().boards.find((b) => b.id === 'b-atlas')
    const leaves = () => leafLanes(s().lanes, 'b-atlas', 'cards')
    // Unnamed: the first leaf, which is where it went before a board could say.
    expect(defaultDropLane(atlas(), s().lanes, 'b-atlas')?.id).toBe(leaves()[0].id)

    const chosen = leaves()[leaves().length - 1]
    s().setBoardDefaultDropLane('b-atlas', chosen.id)
    expect(atlas()?.defaultDropLaneId).toBe(chosen.id)
    expect(defaultDropLane(atlas(), s().lanes, 'b-atlas')?.id).toBe(chosen.id)

    // A named cell that has been deleted — or split away — is not a reason to refuse a card.
    s().setBoardDefaultDropLane('b-atlas', 'lane-that-is-gone')
    expect(defaultDropLane(atlas(), s().lanes, 'b-atlas')?.id).toBe(leaves()[0].id)

    // Clearing it goes back to the first leaf.
    s().setBoardDefaultDropLane('b-atlas', undefined)
    expect(atlas()?.defaultDropLaneId).toBeUndefined()
  })

  it('a new card gets the board default, or a sane one if that is not a card type', () => {
    const atlas = () => s().boards.find((b) => b.id === 'b-atlas')
    // Every card type is on every board — a type is a workspace-wide label, so there is no
    // per-board subset to restrict it with, only a choice of which one a new card starts as.
    expect(cardTypes(s().issueTypes).map((t) => t.id)).toEqual(['t-story', 't-epic', 't-bug', 't-spike', 't-task'])
    expect(boardCardTypeId(atlas(), s().issueTypes)).toBe('t-story')

    s().setBoardDefaultCardType('b-atlas', 't-bug')
    expect(boardCardTypeId(atlas(), s().issueTypes)).toBe('t-bug')

    // A default that is not a card type — the reserved Initiative — falls back to the first.
    s().setBoardDefaultCardType('b-atlas', 't-initiative')
    expect(boardCardTypeId(atlas(), s().issueTypes)).toBe('t-story')
  })

  it('justify mode holds a move until a reason is given, then records it', () => {
    const ns = laneByName('b-atlas', 'Not Started') // limit 1, already holds a card
    s().setBoardWipEnforcement('b-atlas', 'justify')
    s().moveCard('st-signup-form', 'b-atlas', ns.id)
    // Held: no move yet, but a prompt was raised.
    expect(s().placements.find((p) => p.itemId === 'st-signup-form' && p.boardId === 'b-atlas')?.laneId).not.toBe(ns.id)
    expect(s().wipPrompt?.laneName).toBe('Not Started')
    expect(s().wipPrompt?.limit).toBe(1)

    s().confirmWipPrompt('Signed off by the PO')
    expect(s().wipPrompt).toBe(null)
    expect(s().placements.find((p) => p.itemId === 'st-signup-form' && p.boardId === 'b-atlas')?.laneId).toBe(ns.id)
    const item = s().items.find((i) => i.id === 'st-signup-form')!
    expect(item.lastMoveReason).toBe('Signed off by the PO')
    expect(item.log?.some((e) => e.kind === 'limit' && e.note === 'Signed off by the PO')).toBe(true)
  })

  it('justify mode: cancelling the prompt drops the move', () => {
    const ns = laneByName('b-atlas', 'Not Started')
    s().setBoardWipEnforcement('b-atlas', 'justify')
    const before = s().placements.find((p) => p.itemId === 'st-signup-form' && p.boardId === 'b-atlas')?.laneId
    s().moveCard('st-signup-form', 'b-atlas', ns.id)
    s().cancelWipPrompt()
    expect(s().wipPrompt).toBe(null)
    expect(s().placements.find((p) => p.itemId === 'st-signup-form' && p.boardId === 'b-atlas')?.laneId).toBe(before)
  })

  it('bulk size, target dates, block/unblock and assignee removal', () => {
    s().setItemsSize(['st-email', 'st-sso'], 8)
    expect(s().items.find((i) => i.id === 'st-email')?.size).toBe(8)
    expect(s().items.find((i) => i.id === 'st-sso')?.size).toBe(8)

    s().setItemsTargetStart(['st-email'], '2026-01-05')
    s().setItemsTargetEnd(['st-email'], '2026-02-05')
    expect(s().items.find((i) => i.id === 'st-email')?.targetStartDate).toBe('2026-01-05')
    expect(s().items.find((i) => i.id === 'st-email')?.targetEndDate).toBe('2026-02-05')
    s().setItemsTargetEnd(['st-email'], undefined)
    expect(s().items.find((i) => i.id === 'st-email')?.targetEndDate).toBeUndefined()

    s().blockItems(['st-email', 'st-sso'], 'Waiting on legal')
    expect(s().items.find((i) => i.id === 'st-email')?.blocked).toBe(true)
    expect(s().items.find((i) => i.id === 'st-email')?.blockedReason).toBe('Waiting on legal')
    expect(s().items.find((i) => i.id === 'st-email')?.log?.some((e) => e.kind === 'blocked')).toBe(true)
    s().unblockItems(['st-email', 'st-sso'])
    expect(s().items.find((i) => i.id === 'st-sso')?.blocked).toBe(false)

    s().addItemsAssignee(['st-email'], 'Maya Blake')
    const uid = s().users.find((u) => u.name === 'Maya Blake')!.id
    expect(s().items.find((i) => i.id === 'st-email')?.assignees).toEqual([uid])
    s().removeItemsAssignee(['st-email'], uid)
    expect(s().items.find((i) => i.id === 'st-email')?.assignees).toBeUndefined()
  })

  it('migrateState turns the old board level into a band', () => {
    const migrated = migrateState({
      boards: [
        { id: 'x', name: 'X' }, // no level → operational
        { id: 'y', name: 'Y', level: 'portfolio', teamBoardIds: ['x'] }, // → coordination
        { id: 'z', name: 'Z', level: 'project' }, // → coordination (it was inert)
        { id: 't', name: 'T', level: 'team' }, // → operational
      ],
    }) as { boards: { id: string; band: string; level?: string; linkedBoardIds?: string[] }[] }
    expect(migrated.boards.map((b) => b.band)).toEqual(['team', 'program', 'program', 'team'])
    expect(migrated.boards[1].linkedBoardIds).toEqual(['x'])
    expect('level' in migrated.boards[1]).toBe(false)
  })

  it('migrateState drops the per-board card type subset (v27)', () => {
    const stale = {
      boards: [{ id: 'b', name: 'B', cardTypeIds: ['t-bug'] }],
      boardTemplates: [{ id: 't', name: 'T', lanes: [], cardTypeIds: ['t-bug'] }],
    }
    const migrated = migrateState(stale) as unknown as { boards: Record<string, unknown>[]; boardTemplates: Record<string, unknown>[] }
    expect('cardTypeIds' in migrated.boards[0]).toBe(false)
    expect('cardTypeIds' in migrated.boardTemplates[0]).toBe(false)
  })

  it('migratePersisted reseeds boards for a schema change (v<9)', () => {
    const stale = { boards: [{ id: 'b-portfolio', name: 'P', level: 'portfolio' }], lanes: [], placements: [] }
    const reseeded = migratePersisted(stale, 8) as { boards: { id: string }[]; lanes: unknown[] }
    expect(reseeded.boards.length).toBeGreaterThanOrEqual(3)
    expect(reseeded.boards.some((b) => b.id === 'b-atlas')).toBe(true)
    expect(reseeded.lanes.length).toBeGreaterThan(0)
    // v9+ keeps the persisted boards
    const kept = migratePersisted(stale, 9) as { boards: { id: string }[] }
    expect(kept.boards.length).toBe(1)
  })
})

describe('timeline view state', () => {
  beforeEach(() => resetToFixture())

  it('setTimeline(true) selects the timeline and closes the other views', () => {
    s().setDashboard(true)
    s().setTimeline(true)
    expect(s().showTimeline).toBe(true)
    expect(s().showDashboard).toBe(false)
    expect(s().showObjectives).toBe(false)
    expect(s().showArchive).toBe(false)
    expect(s().showBoards).toBe(false)
  })

  it('tabs select — selecting the same tab twice stays on it', () => {
    s().setTimeline(true)
    s().setTimeline(true)
    expect(s().showTimeline).toBe(true)
  })

  it('the Board tab is the board itself — every view flag clears, the workspace with it', () => {
    s().setTimeline(true)
    s().setBoards(true)
    s().setBoard()
    expect(s().showTimeline).toBe(false)
    expect(s().showBoards).toBe(false)
    expect(s().showDashboard).toBe(false)
    expect(s().showArchive).toBe(false)
    expect(s().showObjectives).toBe(false)
  })

  it('opening another view closes the timeline', () => {
    s().setTimeline(true)
    s().setObjectives(true)
    expect(s().showTimeline).toBe(false)
    expect(s().showObjectives).toBe(true)
  })

  it('selecting a board leaves the timeline', () => {
    s().setTimeline(true)
    s().selectBoard('b-atlas')
    expect(s().showTimeline).toBe(false)
  })

  it('the timeline flag is view state — never persisted', () => {
    s().setTimeline(true)
    expect(persistedSlice(s())).not.toHaveProperty('showTimeline')
  })
})

describe('initiative rank within a cell', () => {
  beforeEach(() => resetToFixture())

  it('moveInitiativeToIndex reorders within the cell, rewriting the ranks', () => {
    // Two backlog initiatives in one cell: init-explore joins init-platform on b-portfolio.
    const cellId = s().placements.find((p) => p.itemId === 'init-platform' && p.boardId === 'b-portfolio')!.laneId
    s().moveInitiative('init-explore', 'b-portfolio', cellId)
    const order = () => placementsInOrder(s().placements, cellId).map((p) => p.itemId)
    expect(order()).toEqual(['init-platform', 'init-explore'])
    s().moveInitiativeToIndex('init-platform', 'b-portfolio', cellId, 1)
    expect(order()).toEqual(['init-explore', 'init-platform'])
    // The rewrite is dense: the ranks are 0..n-1, not the old numbers with a gap.
    expect(s().placements.filter((p) => p.laneId === cellId).map((p) => p.rank ?? 0).sort((a, b) => a - b)).toEqual([0, 1])
  })

  it('another section\u2019s cell and a container are refused', () => {
    // init-efficiency has work below it (init-delivery, sitting in Not Started), so its section
    // is derived and Done is another section entirely. A childless initiative is its own leaf and
    // *may* cross — that carve-out has its own test.
    const doneCell = topLevelLanes(s().lanes, 'b-strategy', 'initiatives').find((l) => l.stage === 'done')!.id
    expect(descendants('init-efficiency', graph()).length).toBeGreaterThan(0)
    expect(rollupOf('init-efficiency', graph()).bucket).toBe('notStarted')
    const before = JSON.stringify(s().placements)
    s().moveInitiativeToIndex('init-efficiency', 'b-strategy', doneCell, 0)
    expect(JSON.stringify(s().placements)).toBe(before)
  })
})

describe('saved filters', () => {
  beforeEach(() => resetToFixture())

  it('saves the active set, replaces the live filters on apply, and clears without residue', () => {
    s().setFilters({ blocked: true, text: ' onboarding ' })
    s().saveFilter('Blocked onboarding')
    const saved = s().savedFilters[0]
    // The name is trimmed, the text query normalised on the way in.
    expect(saved.name).toBe('Blocked onboarding')
    expect(saved.filters.blocked).toBe(true)
    expect(saved.filters.text).toBe('onboarding')
    // Editing the live filters must never write into the past.
    s().setFilters({ overdue: true })
    expect(saved.filters.overdue).toBe(false)

    s().clearFilters()
    expect(s().savedFilters).toHaveLength(1)
    s().applySavedFilter(saved.id)
    const f = s().filters
    expect(f.blocked).toBe(true)
    expect(f.text).toBe('onboarding')
    // A full replacement, not a merge: the overdue toggle that came after saving is gone.
    expect(f.overdue).toBe(false)
    expect(f.priorities).toEqual([])
    expect(hasActiveFilters(f)).toBe(true)
    // Clearing after applying lands on the empty set — no residue of either source.
    s().clearFilters()
    expect(s().filters).toEqual(NO_FILTERS)
    // Forgetting a set leaves the active filters alone.
    s().applySavedFilter(saved.id)
    s().removeSavedFilter(saved.id)
    expect(s().savedFilters).toHaveLength(0)
    expect(s().filters.blocked).toBe(true)
  })

  it('refuses an unnamed set and an unnamed empty set', () => {
    s().saveFilter('   ')
    expect(s().savedFilters).toHaveLength(0)
    s().saveFilter('Not yet narrowed')
    // An empty set is "show everything" — nothing worth a name.
    expect(s().savedFilters).toHaveLength(0)
    s().setFilters({ unassigned: true })
    s().saveFilter('Ownerless')
    expect(s().savedFilters).toHaveLength(1)
    // An unknown id is a silent no-op, not a crash.
    const before = JSON.stringify(s().filters)
    expect(() => s().applySavedFilter('nope')).not.toThrow()
    expect(JSON.stringify(s().filters)).toBe(before)
  })

  it('migratePersisted backfills the saved-filter collection for pre-bump state', () => {
    const slice = persistedSlice(s()) as Record<string, unknown>
    expect(slice.savedFilters).toEqual([])
    // States from before v28 carry no collection at all; the migration outfit them with
    // the empty one rather than reading undefined.
    const pre = { ...slice }
    delete pre.savedFilters
    const out = migratePersisted(pre, 27) as Record<string, unknown>
    expect(out.savedFilters).toEqual([])
  })
})

describe('one side panel at a time', () => {
  beforeEach(() => resetToFixture())

  it('the legend, the filters and an open card take the same drawer', () => {
    s().openItem('st-email')
    s().toggleLegend()
    expect(s().showLegend).toBe(true)
    expect(s().selectedItemId).toBeNull()
    expect(s().showFilters).toBe(false)
    s().toggleFilters()
    expect(s().showFilters).toBe(true)
    expect(s().showLegend).toBe(false)
    s().toggleLegend()
    expect(s().showLegend).toBe(true)
    expect(s().showFilters).toBe(false)
  })

  it('the legend stays a view choice, never persisted data', () => {
    const slice = persistedSlice(s()) as Record<string, unknown>
    expect('showLegend' in slice).toBe(false)
  })
})

describe('board description', () => {
  beforeEach(() => resetToFixture())

  it('edits in place and duplicates carry it across', () => {
    s().setBoardDescription('b-atlas', 'Where Atlas lands its work.')
    expect(s().boards.find((b) => b.id === 'b-atlas')!.description).toBe('Where Atlas lands its work.')
    s().renameBoard('b-atlas', 'Atlas')
    expect(s().boards.find((b) => b.id === 'b-atlas')!.description).toBe('Where Atlas lands its work.')
  })

  it('migratePersisted backfills a missing description and preserves an existing one', () => {
    const slice = persistedSlice(s()) as Record<string, unknown>
    const stripped = [...((slice.boards as Record<string, unknown>[]) ?? [])]
    delete stripped[0].description
    // A pre-bump state carries boards without the field at all; the migration outfits
    // each with the empty string, which the legend then prompts about.
    const out = migratePersisted({ ...slice, boards: stripped }, 28) as { boards: { description: string }[] }
    expect(out.boards[0].description).toBe('')
    // And one already written keeps its own words.
    const kept = { ...slice }
    ;(kept.boards as Record<string, unknown>[])[1].description = 'our own words go here'
    const out2 = migratePersisted(kept, 28) as { boards: { description: string }[] }
    expect(out2.boards[1].description).toBe('our own words go here')
  })
})

describe('workspace import', () => {
  beforeEach(() => resetToFixture())

  /** The current workspace as an export would write it. */
  const exportOf = () => ({ app: 'flowline', exportedAt: '2026-10-16T09:00:00.000Z', version: PERSIST_VERSION, state: { ...persistedSlice(s()) } })

  it('the exported file restores exactly what it carried, and what a file omits starts empty', () => {
    const backup = exportOf()
    // The state drifts away from the backup.
    s().renameBoard('b-atlas', 'Renamed Atlas')
    s().addCard({ boardId: 'b-atlas', typeId: s().issueTypes[0].id, laneId: laneByName('b-atlas', 'Done').id, title: 'Stray' })
    expect(s().boards.find((b) => b.id === 'b-atlas')!.name).toBe('Renamed Atlas')

    s().importWorkspace(backup.state, backup.version)
    // The backup's data comes back untouched...
    expect(s().boards.find((b) => b.id === 'b-atlas')!.name).toBe('Team Atlas')
    expect(s().items.some((i) => i.title === 'Stray')).toBe(false)
    // ...and the shape agrees with what was exported.
    const restored = persistedSlice(s())
    expect(JSON.stringify(restored.boards)).toBe(JSON.stringify(backup.state.boards))
    expect(JSON.stringify(restored.items)).toBe(JSON.stringify(backup.state.items))

    // An entity the file does not mention starts empty rather than keeping the old state.
    // (Users are the one exception a migrate may re-derive from item assignees.)
    const headless = { ...backup.state }
    delete headless.objectives
    s().importWorkspace(headless as Record<string, unknown>, backup.version)
    expect(s().objectives).toEqual([])
  })

  it('imports a minimal file, winning a usable board, and lands on a real board', () => {
    s().importWorkspace(
      {
        boards: [{ id: 'bx', name: 'Imported', band: 'team', description: '' }],
        lanes: [],
        items: [{ id: 'ix', title: 'One card', typeId: 't-story', createdAt: 0 }],
        placements: [{ id: 'px', boardId: 'bx', itemId: 'ix', laneId: 'lx' }],
        issueTypes: [{ id: 't-story', name: 'User Story', color: '#6366f1' }],
      },
      PERSIST_VERSION,
    )
    expect(s().boards.map((b) => b.id)).toEqual(['bx'])
    // A board the file names in boardId wins; a dangling one does not strand the app.
    expect(s().boardId).toBe('bx')
    expect(s().selectedItemId).toBeNull()
    expect(s().editMode).toBe(false)
    expect(s().showLegend).toBe(false)
    // Whatever surface the import was started from keeps showing.
    s().setBoards(true)
    s().importWorkspace(
      { boards: [{ id: 'bx', name: 'Imported again', band: 'team', description: '' }], lanes: [], items: [], placements: [], issueTypes: [] },
      PERSIST_VERSION,
    )
    expect(s().showBoards).toBe(true)
  })

  it('lands on the imported workspace\'s own board when it exists there', () => {
    s().importWorkspace(
      {
        boardId: 'bz',
        boards: [
          { id: 'by', name: 'First', band: 'team', description: '' },
          { id: 'bz', name: 'Second', band: 'team', description: '' },
        ],
        lanes: [],
        items: [],
        placements: [],
        issueTypes: [],
      },
      PERSIST_VERSION,
    )
    expect(s().boardId).toBe('bz')
  })

  it('an import of an older shape migrates through the same backfills a reload would', () => {
    // A v15-era shape: boards without descriptions (the backfills run unconditionally,
    // exactly as an on-load rehydrate does).
    const legacy = {
      boards: [{ id: 'b-og', name: 'Old Shape', band: 'team' }],
      lanes: [],
      items: [],
      placements: [],
      issueTypes: [],
    }
    s().importWorkspace(legacy, PERSIST_VERSION)
    expect(s().boards[0].description).toBe('')
  })
})
