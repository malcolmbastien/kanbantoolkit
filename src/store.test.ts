import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decompositionParent, statusOf } from './domain/derive'
import { leafLanes } from './domain/lanes'
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

describe('store actions (v2)', () => {
  beforeEach(() => s().resetDemo())

  it('one parent: setParent replaces any existing parent', () => {
    s().setParent('st-form', 'it-tour')
    expect(decompositionParent('st-form', s().edges)).toBe('it-tour')
    s().setParent('st-form', 'it-signup')
    expect(decompositionParent('st-form', s().edges)).toBe('it-signup')
  })

  it('splitting a lane creates two sub-lanes and moves cards into the first', () => {
    const progress = laneByName('b-core', 'In Progress')
    const before = s().lanes.filter((l) => l.parentId === progress.id).length
    s().splitLane(progress.id)
    const kids = s().lanes.filter((l) => l.parentId === progress.id)
    expect(kids.length).toBe(before + 2)
    // no card references the now-non-leaf In Progress lane
    expect(s().placements.some((p) => p.columnLaneId === progress.id)).toBe(false)
  })

  it('dependency self-cleans when the blocker moves to a done column', () => {
    const done = laneByName('b-platform', 'Done')
    expect(statusOf('st-profile-schema', graph()).resolved).toBe(false)
    s().moveCard('it-api', 'b-platform', done.id, null)
    expect(statusOf('it-api', graph()).resolved).toBe(true)
  })

  it('a WIP limit soft-blocks with a required reason', () => {
    const backlog = leafLanes(s().lanes, 'b-core', 'vertical')[0] // Backlog
    s().setLaneWip(backlog.id, 1)
    const blocked = s().moveCard('st-email', 'b-core', backlog.id, null)
    expect(blocked.ok).toBe(false)
    const ok = s().moveCard('st-email', 'b-core', backlog.id, null, 'hotfix triage')
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

  it('raising a dependency is proposed until confirmed', () => {
    const edge = () => s().edges.find((e) => e.from === 'it-analytics' && e.to === 'st-invite-flow')!
    expect(edge().dep?.status).toBe('proposed')
    s().confirmDependency(edge().id)
    expect(edge().dep?.status).toBe('confirmed')
  })
})
