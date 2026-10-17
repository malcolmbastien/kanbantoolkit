import { describe, expect, it } from 'vitest'
import { initiativeHealth, HEALTH_META } from './health'
import type { Graph } from './derive'
import type { Edge, Item, ItemLink, Lane, Placement, Stage } from './types'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 17, 12)

const card = (id: string, patch: Partial<Item> = {}): Item => ({
  id,
  title: id,
  typeId: 't-story',
  createdAt: NOW - 60 * DAY,
  ...patch,
})

const edge = (from: string, to: string): Edge => ({ id: `${from}-${to}`, kind: 'decomposition', from, to })
const link = (from: string, to: string): ItemLink => ({ id: `${from}->${to}`, from, to })

/** A board whose cards workflow has one cell per stage, so a card's stage is its lane's. */
const lane = (id: string, stage: Stage): Lane => ({ id, boardId: 'b', parentId: 'root', order: 0, name: id, stage, workflow: 'cards' })
const at = (itemId: string, laneId: string, enteredAt?: number): Placement => ({
  id: `p-${itemId}`,
  boardId: 'b',
  itemId,
  laneId,
  ...(enteredAt ? { laneEnteredAt: enteredAt } : {}),
})

/**
 * An initiative with three cards below it, all committed and owned, last moved yesterday — the
 * shape that should raise nothing at all.
 */
function healthy(): Graph {
  return {
    items: [
      card('init', { typeId: 't-initiative', assignees: ['u-1'] }),
      card('a', { assignees: ['u-1'] }),
      card('b', { assignees: ['u-2'] }),
      card('c', { assignees: ['u-2'] }),
    ],
    edges: [edge('init', 'a'), edge('init', 'b'), edge('init', 'c')],
    links: [],
    placements: [at('a', 'ip', NOW - DAY), at('b', 'ip', NOW - 2 * DAY), at('c', 'ns', NOW - 3 * DAY)],
    lanes: [lane('ip', 'inProgress'), lane('ns', 'notStarted'), lane('done', 'done')],
  }
}

describe('initiative health', () => {
  it('finds nothing to say about work that is moving, owned and unblocked', () => {
    const h = initiativeHealth('init', healthy(), NOW)
    expect(h.level).toBe('healthy')
    expect(h.flags).toEqual([])
    expect(HEALTH_META.healthy.label).toBe('On track')
  })

  it('raises a risk for blocked work below, and clears it when the block goes', () => {
    const graph = healthy()
    graph.items[2] = { ...graph.items[2], blocked: true, blockedReason: 'waiting on legal' }
    const h = initiativeHealth('init', graph, NOW)
    expect(h.level).toBe('atRisk')
    expect(h.flags.map((f) => f.flag)).toEqual(['blocked'])
    expect(h.flags[0].label).toBe('1 blocked')
    expect(h.flags[0].why).toBe('1 card below is explicitly blocked')

    // The block lifted: the rule stops speaking, because the state it reads stopped saying so.
    graph.items[2] = { ...graph.items[2], blocked: false }
    expect(initiativeHealth('init', graph, NOW).flags).toEqual([])
  })

  it('raises a risk for work waiting on something not done', () => {
    const graph = healthy()
    graph.links = [link('init-gateway', 'b')]
    // A dependency is judged by the *dependency's* own cell — the same rule the board reads when
    // it decides whether a waiting pin is a planning risk or a live blockage.
    graph.items.push(card('init-gateway', { typeId: 't-initiative' }))
    graph.placements.push(at('init-gateway', 'ns', NOW - DAY))

    const h = initiativeHealth('init', graph, NOW)
    expect(h.flags.map((f) => f.flag)).toEqual(['waiting'])
    expect(h.flags[0].label).toBe('1 waiting')
    expect(h.level).toBe('atRisk')

    // The dependency delivered: nothing waits any more.
    graph.placements = graph.placements.map((p) => (p.itemId === 'init-gateway' ? { ...p, laneId: 'done' } : p))
    expect(initiativeHealth('init', graph, NOW).flags.map((f) => f.flag)).toEqual([])
  })

  it('calls committed work stale only when the clock says nothing has moved, and never guesses', () => {
    const graph = healthy()
    graph.placements = graph.placements.map((p) => ({ ...p, laneEnteredAt: NOW - 30 * DAY }))
    const stale = initiativeHealth('init', graph, NOW)
    expect(stale.flags.map((f) => f.flag)).toEqual(['stale'])
    expect(stale.flags[0].label).toBe('still 30d')
    expect(stale.level).toBe('watch') // a watch, not a hard stop: nobody has said it is stuck

    // One card moving resets it: the newest arrival governs, not the oldest.
    graph.placements = graph.placements.map((p) => (p.itemId === 'b' ? { ...p, laneEnteredAt: NOW - DAY } : p))
    expect(initiativeHealth('init', graph, NOW).flags).toEqual([])

    // No stamps at all is unknown, not stale — the clock is optional on purpose.
    graph.placements = graph.placements.map((p) => ({ ...p, laneEnteredAt: undefined }))
    expect(initiativeHealth('init', graph, NOW).flags).toEqual([])

    // And a delivered initiative is not "still" anything, however long ago it stopped.
    graph.placements = graph.placements.map((p) => ({ ...p, laneEnteredAt: NOW - 30 * DAY, laneId: 'done' }))
    expect(initiativeHealth('init', graph, NOW).flags).toEqual([])
  })

  it('raises uncovered work, an empty initiative, and committed-over-uncommitted', () => {
    // Nobody on the committed cards below.
    const unowned = healthy()
    unowned.items = unowned.items.map((i) => ({ ...i, assignees: [] }))
    expect(initiativeHealth('init', unowned, NOW).flags.map((f) => f.flag)).toEqual(['unowned'])
    expect(initiativeHealth('init', unowned, NOW).flags[0].label).toBe('3 unowned')

    // Nothing underneath at all.
    const empty: Graph = { ...healthy(), edges: [], placements: [] }
    const h = initiativeHealth('init', empty, NOW)
    expect(h.flags.map((f) => f.flag)).toEqual(['unplanned'])
    expect(h.level).toBe('watch')

    // Committed over uncommitted inventory — the anomaly the card warns about, said once.
    const over = healthy()
    over.placements = over.placements.map((p) => (p.itemId === 'c' ? { ...p, laneId: 'backlog' } : p))
    over.lanes = [...over.lanes, lane('backlog', 'backlog')]
    const flags = initiativeHealth('init', over, NOW).flags
    expect(flags.map((f) => f.flag)).toEqual(['uncommitted'])
    expect(flags[0].label).toBe('1 backlog')
    expect(flags[0].why).toContain('still in Backlog')
  })

  it('says when the work below is bigger than the initiative claims, or due after it is due', () => {
    const graph = healthy()
    // The initiative claims 2 points; the three unsized cards below it add up to 3.
    graph.items[0] = { ...graph.items[0], size: 2, targetEndDate: '2026-10-30' }
    const big = initiativeHealth('init', graph, NOW)
    expect(big.flags.map((f) => f.flag)).toEqual(['oversized'])
    expect(big.flags[0].label).toBe('3 pts below')
    expect(big.flags[0].why).toBe('The work below adds up to 3 points; this initiative estimates 2')
    expect(big.flags[0].tone).toBe('watch') // a watch: the numbers are surfaced, never enforced

    // Raise the claim to cover the work and it clears.
    graph.items[0] = { ...graph.items[0], size: 3 }
    expect(initiativeHealth('init', graph, NOW).flags).toEqual([])

    // A card due after the initiative is due.
    graph.items[1] = { ...graph.items[1], targetEndDate: '2026-11-15' }
    const late = initiativeHealth('init', graph, NOW)
    expect(late.flags.map((f) => f.flag)).toEqual(['outlasted'])
    expect(late.flags[0].why).toBe('1 card below is due after this initiative')

    // Push the initiative's own deadline past it and that clears too.
    graph.items[0] = { ...graph.items[0], targetEndDate: '2026-12-31' }
    expect(initiativeHealth('init', graph, NOW).flags).toEqual([])

    // Work that is already delivered is not "due after" anything — even when it is the only
    // dated card below. The size warning is unaffected: it is about the work, not the claim.
    graph.items[0] = { ...graph.items[0], size: 2, targetEndDate: '2026-10-30' }
    graph.items[1] = { ...graph.items[1], resolvedAt: NOW - DAY }
    graph.placements = graph.placements.map((p) => (p.itemId === 'a' ? { ...p, laneId: 'done' } : p))
    expect(initiativeHealth('init', graph, NOW).flags.map((f) => f.flag)).toEqual(['oversized'])

    // Neither fires on an initiative with nothing below it, whatever it claims.
    const empty: Graph = { ...graph, edges: [], placements: [] }
    expect(initiativeHealth('init', empty, NOW).flags.map((f) => f.flag)).toEqual(['unplanned'])
  })

  it('lists the risks before the things to watch, and counts both in the level', () => {
    const graph = healthy()
    graph.items[2] = { ...graph.items[2], blocked: true }
    graph.placements = graph.placements.map((p) => ({ ...p, laneEnteredAt: NOW - 40 * DAY }))
    const h = initiativeHealth('init', graph, NOW)
    expect(h.flags.map((f) => f.flag)).toEqual(['blocked', 'stale'])
    expect(h.flags.map((f) => f.tone)).toEqual(['risk', 'watch'])
    expect(h.level).toBe('atRisk')
  })
})
