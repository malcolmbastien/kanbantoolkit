import { beforeEach, describe, expect, it, vi } from 'vitest'
import { blockingDeps } from './domain/derive'
import { useStore } from './store'

// zustand/persist touches localStorage; give Node a minimal shim.
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
})

const s = () => useStore.getState()

describe('store actions', () => {
  beforeEach(() => s().resetDemo())

  it('dependency self-cleans: resolving the blocker clears the dependent with no manual edit', () => {
    const g = () => ({ items: s().items, edges: s().edges })
    expect(blockingDeps('st-profile-schema', g()).length).toBe(1)
    s().moveItem('ep-api', 'Done')
    expect(blockingDeps('st-profile-schema', g()).length).toBe(0)
  })

  it('epics-per-stream soft block requires a reason, then allows it', () => {
    const before = s().items.length
    const blocked = s().addEpic('vs-core', null, 'Sixth epic')
    expect(blocked.ok).toBe(false)
    expect('needsReason' in blocked && blocked.needsReason).toBe(true)

    const ok = s().addEpic('vs-core', null, 'Sixth epic', 'Splitting an epic; net WIP unchanged.')
    expect(ok.ok).toBe(true)
    expect(s().items.length).toBe(before + 1)
  })

  it('raising a dependency is proposed until confirmed', () => {
    const edge = () => s().edges.find((e) => e.id === 'dep-analytics-invite')!
    expect(edge().dep?.status).toBe('proposed')
    s().confirmDependency('dep-analytics-invite')
    expect(edge().dep?.status).toBe('confirmed')
  })

  it('attribution is many-to-many and does not create work', () => {
    const before = s().items.length
    s().setAttribution('st-tour-copy', 'obj-activation', true)
    s().setAttribution('st-tour-copy', 'obj-ttv', true)
    expect(s().items.length).toBe(before)
    const attrs = s().edges.filter((e) => e.kind === 'attribution' && e.to === 'st-tour-copy')
    expect(attrs.length).toBe(2)
  })

  it('sponsor confirms the computed recommendation — human in the loop', () => {
    s().confirmSponsor('init-onboarding', 'committed', undefined)
    expect(s().items.find((i) => i.id === 'init-onboarding')?.state).toBe('Committed')
    expect(s().sponsors['init-onboarding'].decision).toBe('committed')
  })
})
