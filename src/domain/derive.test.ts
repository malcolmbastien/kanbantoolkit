import { describe, expect, it } from 'vitest'
import {
  applicableLimit,
  attributedObjectives,
  blockingDeps,
  blockingSummary,
  computeLevel,
  dependencyState,
  descendants,
  openDescendants,
  outgoingDependencies,
  portfolioStatus,
} from './derive'
import { createSeed } from './seed'
import type { Edge, Item } from './types'

const find = (items: Item[], id: string) => items.find((i) => i.id === id)!

describe('level is derived, never stored', () => {
  const s = createSeed()
  const g = { items: s.items, edges: s.edges }

  it('initiative is L1, epics are L2, stories are L3', () => {
    expect(computeLevel(find(s.items, 'init-onboarding'), g).level).toBe('L1')
    expect(computeLevel(find(s.items, 'ep-signup'), g).level).toBe('L2')
    expect(computeLevel(find(s.items, 'st-signup-form'), g).level).toBe('L3')
  })

  it('changes when children change — a story that decomposes into stories becomes L2', () => {
    const child: Item = {
      id: 'child-x',
      title: 'sub-story',
      type: 'story',
      valueStreamId: 'vs-core',
      teamId: 'team-alpha',
      state: 'Backlog',
      createdAt: 0,
    }
    const edge: Edge = { id: 'dec-x', kind: 'decomposition', from: 'st-signup-form', to: 'child-x' }
    const g2 = { items: [...s.items, child], edges: [...s.edges, edge] }
    expect(computeLevel(find(s.items, 'st-signup-form'), g).level).toBe('L3')
    expect(computeLevel(child, g2).level).toBe('L3')
    expect(computeLevel(find(g2.items, 'st-signup-form'), g2).level).toBe('L2')
  })
})

describe('dependency state is computed from both endpoints', () => {
  const s = createSeed()
  const g = { items: s.items, edges: s.edges }
  const blocked = find(s.items, 'st-profile-schema')
  const blocker = find(s.items, 'ep-api')

  it('unresolved blocker + not-started dependent = Open / planning risk', () => {
    expect(dependencyState(blocker, blocked)).toBe('OpenPlanningRisk')
  })

  it('flips to Satisfied once the blocker resolves — with nobody touching the dependent', () => {
    const resolvedBlocker = { ...blocker, state: 'Done', resolvedAt: Date.now() }
    expect(dependencyState(resolvedBlocker, blocked)).toBe('Satisfied')
  })

  it('shows one blocker badge on the dependent', () => {
    expect(blockingDeps('st-profile-schema', g).length).toBe(1)
  })

  it('the healthy-looking blocker carries a cross-stream badge: 3 across 2 streams', () => {
    const sum = blockingSummary('ep-api', g, s.scopes)
    expect(sum.count).toBe(3)
    expect(sum.streams).toBe(2)
  })

  it('proposed dependencies are not yet binding', () => {
    const deps = outgoingDependencies('ep-analytics', g)
    expect(deps[0].edge.dep?.status).toBe('proposed')
  })
})

describe('composition pressure and attribution', () => {
  const s = createSeed()
  const g = { items: s.items, edges: s.edges }

  it('ep-signup shows its open descendants against the deeper flow', () => {
    expect(openDescendants('ep-signup', g).length).toBe(19)
    expect(descendants('ep-signup', g).length).toBe(20)
  })

  it('a story attributed to two objectives is one unit of work', () => {
    const objs = attributedObjectives('st-signup-form', s.edges, s.objectives)
    expect(objs.map((o) => o.id).sort()).toEqual(['obj-activation', 'obj-ttv'])
  })
})

describe('portfolio rollup + sponsor recommendation', () => {
  const s = createSeed()
  const g = { items: s.items, edges: s.edges }

  it('computes status from committed work and recommends, without auto-approving', () => {
    const status = portfolioStatus(find(s.items, 'init-onboarding'), g)
    expect(status.label).toBe('Committed')
    expect(status.recommendation).toBe('committed')
    expect(status.total).toBe(5)
    // The initiative itself is still typed 'Bet' — the human has not confirmed.
    expect(find(s.items, 'init-onboarding').state).toBe('Bet')
  })
})

describe('limits', () => {
  const s = createSeed()

  it('resolves the epics-per-stream policy and sees the stream is over', () => {
    const policy = applicableLimit(s.limits, 'L2', 'epic', 'vs-core')
    expect(policy?.limit).toBe(4)
    const count = s.items.filter((i) => i.type === 'epic' && i.valueStreamId === 'vs-core').length
    expect(count).toBe(5)
  })
})
