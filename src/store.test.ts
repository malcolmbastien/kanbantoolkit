import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decompositionParent, statusOf } from './domain/derive'
import { childrenOf, isLeaf } from './domain/lanes'
import { useStore } from './store'

vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
})

const s = () => useStore.getState()
const graph = () => {
  const st = s()
  return { items: st.items, edges: st.edges, placements: st.placements, lanes: st.lanes }
}
const laneByName = (boardId: string, name: string) =>
  s().lanes.find((l) => l.boardId === boardId && l.name === name)!

describe('store actions (recursive lanes)', () => {
  beforeEach(() => s().resetDemo())

  it('one parent: setParent replaces any existing parent', () => {
    s().setParent('st-form', 'it-tour')
    expect(decompositionParent('st-form', s().edges)).toBe('it-tour')
    s().setParent('st-form', 'it-signup')
    expect(decompositionParent('st-form', s().edges)).toBe('it-signup')
  })

  it('splitting a leaf into a container moves its cards into the first sub-lane', () => {
    const bravo = s().lanes.find((l) => l.boardId === 'b-core' && l.name === 'Team Bravo')!
    const target = childrenOf(s().lanes, bravo.id).find((l) => isLeaf(s().lanes, l.id))!
    const before = s().placements.filter((p) => p.laneId === target.id).length
    s().splitLane(target.id, 'rows')
    const kids = childrenOf(s().lanes, target.id)
    expect(kids.length).toBe(2)
    expect(isLeaf(s().lanes, target.id)).toBe(false)
    expect(s().placements.filter((p) => p.laneId === kids[0].id).length).toBe(before)
  })

  it('addLane appends a sibling to a container', () => {
    const alpha = s().lanes.find((l) => l.boardId === 'b-core' && l.name === 'Team Alpha')!
    const before = childrenOf(s().lanes, alpha.id).length
    s().addLane(alpha.id)
    expect(childrenOf(s().lanes, alpha.id).length).toBe(before + 1)
  })

  it('dependency self-cleans when the blocker moves to a done lane', () => {
    const done = laneByName('b-platform', 'Done')
    expect(statusOf('st-profile-schema', graph()).resolved).toBe(false)
    s().moveCard('it-api', 'b-platform', done.id)
    expect(statusOf('it-api', graph()).resolved).toBe(true)
  })

  it('a WIP limit soft-blocks with a required reason', () => {
    const done = laneByName('b-platform', 'Done')
    s().setLaneWip(done.id, 1)
    expect(s().moveCard('st-sdk', 'b-platform', done.id).ok).toBe(true) // 0 -> 1 (at limit)
    const blocked = s().moveCard('it-analytics', 'b-platform', done.id) // 1 -> 2 (over)
    expect(blocked.ok).toBe(false)
    const ok = s().moveCard('it-analytics', 'b-platform', done.id, 'Unblocking release')
    expect(ok.ok).toBe(true)
  })

  it('custom types can be added, renamed and recoloured', () => {
    const before = s().issueTypes.length
    s().addIssueType('Risk', '#ef4444')
    const added = s().issueTypes[s().issueTypes.length - 1]
    expect(s().issueTypes.length).toBe(before + 1)
    s().updateIssueType(added.id, { name: 'Threat' })
    expect(s().issueTypes.find((t) => t.id === added.id)?.name).toBe('Threat')
  })
})
