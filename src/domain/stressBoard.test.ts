import { describe, expect, it } from 'vitest'
import { STRESS_BOARD_ID, STRESS_PREFIX, stressBoard } from './stressBoard'
import { childrenOf, effectiveStage, isLeaf, laneCardCount, leafLanes, placementsInOrder, topLevelLanes } from './lanes'
import { rollupOf, type Graph } from './derive'
import { kindOf } from './flows'
import { createFixture } from './fixture'
import type { Stage } from './types'


const flow = (flows: { boardId: string; kind: string; id: string }[], boardId: string, kind: 'cards' | 'initiatives' = 'cards') =>
  flows.find((f) => f.boardId === boardId && f.kind === kind)!.id

const NOW = Date.UTC(2026, 9, 17, 12)
const types = createFixture().issueTypes
const built = stressBoard(300, types, NOW)
const { board, lanes, items, placements, edges, links } = built

const cards = items.filter((i) => i.id.startsWith(`${STRESS_PREFIX}card-`))
const graph: Graph = { items, edges, links, placements, lanes }
const stageOfLane = (laneId: string) => effectiveStage(lanes, laneId)

describe('the load-test board', () => {
  it('builds the number of cards it was asked for, and nothing that is not its own', () => {
    expect(cards).toHaveLength(300)
    expect(board.id).toBe(STRESS_BOARD_ID)
    // Every id it makes is prefixed, which is how a rebuild can remove exactly this board.
    for (const id of [...lanes.map((l) => l.id), ...items.map((i) => i.id), ...placements.map((p) => p.id)]) {
      expect(id.startsWith(STRESS_PREFIX)).toBe(true)
    }
    // The people it references come with it, so a workspace without them still reads names.
    expect(built.users.length).toBeGreaterThanOrEqual(4)
    expect(cards.every((c) => (c.assignees ?? []).every((a) => built.users.some((u) => u.id === a)))).toBe(true)
  })

  it('refines the cards workflow three levels deep, into the swim-lane grid', () => {
    const columns = topLevelLanes(lanes, flow(built.flows, board.id))
    expect(columns.map((c) => c.stage)).toEqual(['backlog', 'notStarted', 'inProgress', 'done'])

    // The grid: a columns split whose children are rows splits that have children of their own —
    // the shape that makes a board expensive to draw.
    const progress = columns.find((c) => c.stage === 'inProgress')!
    expect(progress.orientation).toBe('columns')
    const inside = childrenOf(lanes, progress.id)
    expect(inside.length).toBeGreaterThanOrEqual(2)
    expect(inside.every((l) => l.orientation === 'rows')).toBe(true)
    expect(inside.every((l) => childrenOf(lanes, l.id).length > 0)).toBe(true)

    // Done is two cells, because a programme needs accepted and released to differ.
    const done = columns.find((c) => c.stage === 'done')!
    expect(childrenOf(lanes, done.id).map((l) => l.name)).toEqual(['Accepted', 'Released'])

    // The initiatives flow is refined too: cells to arrange work in, per section.
    const sections = topLevelLanes(lanes, flow(built.flows, board.id, 'initiatives'))
    const progressSection = sections.find((s) => s.stage === 'inProgress')!
    expect(childrenOf(lanes, progressSection.id).map((l) => l.name)).toEqual(['Atlas', 'Nova', 'Data'])
  })

  it('carries a second cards flow, with real work in it', () => {
    const support = built.flows.find((f) => f.kind === 'cards' && f.name === 'Support')!
    const cells = leafLanes(lanes, support.id)
    expect(cells.map((c) => c.stage)).toEqual(['backlog', 'notStarted', 'inProgress', 'done'])
    const inSupport = placements.filter((p) => cells.some((c) => c.id === p.laneId))
    expect(inSupport.length).toBeGreaterThan(0)
    // Same stage, other tree: the card's history still says what it walked.
    for (const placement of inSupport.slice(0, 5)) {
      const card = items.find((i) => i.id === placement.itemId)!
      const last = card.log?.at(-1)?.toStage
      if (last) expect(effectiveStage(lanes, placement.laneId)).toBe(last)
    }
  })

  it('places every card in a cell of its own workflow, at the stage that cell inherits', () => {
    for (const card of cards) {
      const at = placements.find((p) => p.itemId === card.id)!
      expect(at.boardId).toBe(board.id)
      expect(isLeaf(lanes, at.laneId)).toBe(true)
      expect(stageOfLane(at.laneId)).toBeDefined()
      // The card's own log ends where it sits: the history and the placement agree.
      const moves = (card.log ?? []).filter((e) => e.kind === 'moved')
      expect(moves.at(-1)?.toStage ?? 'backlog').toBe(stageOfLane(at.laneId))
      // Resolved exactly when it is done, and filed away only if it was delivered.
      expect(Boolean(card.resolvedAt)).toBe(stageOfLane(at.laneId) === 'done')
      expect(Boolean(card.archived)).toBe(Boolean(card.resolvedAt) && Boolean(card.archivedAt))
    }
  })

  it('gives each card a history in order, with moves that name the stages they crossed', () => {
    const withHistory = cards.filter((c) => (c.log ?? []).length > 1)
    expect(withHistory.length).toBeGreaterThan(cards.length / 3)
    for (const card of withHistory) {
      const log = card.log!
      const times = log.map((e) => e.at)
      expect([...times].sort((a, b) => a - b)).toEqual(times)
      for (const entry of log.filter((e) => e.kind === 'moved')) {
        expect(entry.boardId).toBe(board.id)
        expect(entry.toStage).toBeDefined()
        expect(entry.note).toContain('→')
      }
    }
  })

  it('rolls work up into initiatives that sit in the section their own rollup names', () => {
    const initiatives = items.filter((i) => i.typeId === types.find((t) => t.name === 'Initiative')!.id)
    expect(initiatives.length).toBeGreaterThanOrEqual(8)
    const withWork = initiatives.filter((i) => rollupOf(i.id, graph).total > 0)
    expect(withWork.length).toBeGreaterThan(0)

    for (const init of initiatives) {
      const at = placements.find((p) => p.itemId === init.id)!
      expect(at.boardId).toBe(board.id)
      // It sits in a cell of the initiatives flow, never in a card lane…
      expect(kindOf(built.flows, lanes.find((l) => l.id === at.laneId)!.flowId)).toBe('initiatives')
      expect(isLeaf(lanes, at.laneId)).toBe(true)
      // …and a section is derived, so the placement's stage *is* the rollup's bucket.
      expect(stageOfLane(at.laneId)).toBe(rollupOf(init.id, graph).bucket)
    }
    // And the hierarchy is a tree: every non-programme initiative has a parent initiative.
    const parentOf = (id: string) => edges.find((e) => e.kind === 'decomposition' && e.to === id)?.from
    expect(initiatives.filter((i) => !parentOf(i.id)).length).toBe(1)
  })

  it('sets WIP limits the columns are actually over, which is what a full board looks like', () => {
    const limited = lanes.filter((l) => l.wipLimit !== undefined)
    expect(limited.length).toBeGreaterThanOrEqual(3)
    const over = limited.filter((l) => laneCardCount(lanes, placements, l.id) > l.wipLimit!)
    expect(over.length).toBeGreaterThan(0)
    expect(lanes.some((l) => l.description)).toBe(true)
  })

  it('adds the things a board is read for: priorities, blockers, dates, checks and dependencies', () => {
    expect(cards.filter((c) => c.priority).length).toBeGreaterThan(cards.length / 4)
    expect(cards.filter((c) => c.blocked).length).toBeGreaterThan(0)
    expect(cards.filter((c) => c.targetEndDate).length).toBeGreaterThan(cards.length / 4)
    expect(cards.filter((c) => (c.checklist ?? []).length > 0).length).toBeGreaterThan(cards.length / 6)
    expect(cards.filter((c) => c.archived).length).toBeGreaterThan(0)
    expect(links.length).toBeGreaterThan(0)
    const ids = new Set(cards.map((c) => c.id))
    for (const link of links) {
      expect(link.from).not.toBe(link.to)
      expect(ids.has(link.from) && ids.has(link.to)).toBe(true)
    }
  })

  it('is deterministic, so a board that looks wrong can be looked at twice', () => {
    const again = stressBoard(300, types, NOW)
    expect(again.items.map((i) => i.title)).toEqual(items.map((i) => i.title))
    expect(again.placements.map((p) => p.laneId)).toEqual(placements.map((p) => p.laneId))
    expect(stressBoard(12, types, NOW).items.filter((i) => i.id.startsWith(`${STRESS_PREFIX}card-`))).toHaveLength(12)
  })

  it('keeps every cell in a tree: each lane answers to a typed column of its own workflow', () => {
    for (const lane of lanes) {
      if (lane.parentId === null) continue
      const parent = lanes.find((l) => l.id === lane.parentId)!
      expect(parent.flowId).toBe(lane.flowId)
      expect(parent.boardId).toBe(lane.boardId)
    }
    // No orphan placements, and a rank per cell that starts at zero.
    for (const lane of lanes.filter((l) => isLeaf(lanes, l.id))) {
      const ordered = placementsInOrder(placements, lane.id)
      expect(ordered.map((p) => p.rank)).toEqual(ordered.map((_, i) => i))
    }
    // Every stage the model has is somewhere in the cards workflow.
    const stages = new Set(topLevelLanes(lanes, flow(built.flows, board.id)).map((c) => c.stage as Stage))
    expect([...stages].sort()).toEqual(['backlog', 'done', 'inProgress', 'notStarted'])
  })
})
