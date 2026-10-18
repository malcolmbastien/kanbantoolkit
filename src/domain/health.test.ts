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

  it('names the cards each flag found, and the number in the badge is that list’s length', () => {
    // One card for each rule that is about particular cards: blocked, waiting, unowned, and still
    // in Backlog under a committed initiative.
    const graph = healthy()
    graph.items.push(card('d', { assignees: ['u-1'] }))
    graph.edges.push(edge('init', 'd'))
    graph.placements.push(at('d', 'backlog', NOW - DAY))
    graph.lanes = [...graph.lanes, lane('backlog', 'backlog')]
    graph.items[2] = { ...graph.items[2], blocked: true } // b
    graph.items[3] = { ...graph.items[3], assignees: [] } // c — nobody on it
    graph.items.push(card('gate', { typeId: 't-initiative' }))
    graph.placements.push(at('gate', 'ns', NOW - DAY))
    graph.links = [link('gate', 'a')] // a waits on the gate, which is not done

    const flags = initiativeHealth('init', graph, NOW).flags
    const by = Object.fromEntries(flags.map((f) => [f.flag, f]))
    expect(by.blocked.items).toEqual(['b'])
    expect(by.waiting.items).toEqual(['a'])
    expect(by.unowned.items).toEqual(['c'])
    expect(by.uncommitted.items).toEqual(['d'])
    // The count in the badge and the cards it points at are the same fact, so they cannot drift.
    for (const f of flags) {
      if (!f.items) continue
      expect(f.label.startsWith(String(f.items.length)), f.flag).toBe(true)
    }
  })

  it('names no cards for the rules about the shape of the whole, or about there being none', () => {
    // "Nothing has moved for nine days" is a statement about all the work below, not a list of it;
    // and an initiative with nothing under it has nothing to point at.
    const graph = healthy()
    graph.items[0] = { ...graph.items[0], size: 1 }
    graph.placements = graph.placements.map((p) => ({ ...p, laneEnteredAt: NOW - 9 * DAY }))
    const shaped = initiativeHealth('init', graph, NOW).flags
    expect(shaped.map((f) => f.flag)).toEqual(['stale'])
    for (const f of shaped) expect(f.items).toBeUndefined()

    const empty = initiativeHealth('init', { ...healthy(), edges: [], placements: [] }, NOW).flags
    expect(empty.map((f) => f.flag)).toEqual(['unplanned'])
    expect(empty[0].items).toBeUndefined()
  })

  it('says when the work below is due after the initiative is due', () => {
    const graph = healthy()
    // An initiative has no estimate of its own, so there is nothing to compare the work below
    // against: the size warning has no input and no rule. The date warning is the one left.
    graph.items[0] = { ...graph.items[0], targetEndDate: '2026-10-30' }
    graph.items[1] = { ...graph.items[1], targetEndDate: '2026-11-15' }
    const late = initiativeHealth('init', graph, NOW)
    expect(late.flags.map((f) => f.flag)).toEqual(['outlasted'])
    expect(late.flags[0].why).toBe('1 card below is due after this initiative')

    // Push the initiative's own deadline past it and that clears too.
    graph.items[0] = { ...graph.items[0], targetEndDate: '2026-12-31' }
    expect(initiativeHealth('init', graph, NOW).flags).toEqual([])

    // Work that is already delivered is not "due after" anything — even when it is the only
    // dated card below.
    graph.items[1] = { ...graph.items[1], resolvedAt: NOW - DAY }
    graph.placements = graph.placements.map((p) => (p.itemId === 'a' ? { ...p, laneId: 'done' } : p))
    expect(initiativeHealth('init', graph, NOW).flags).toEqual([])

    // Neither rule fires on an initiative with nothing below it.
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
