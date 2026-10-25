import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '@/store'
import { useAuth } from './auth'
import { queue } from './queue'
import {
  copyToAccount,
  declineImport,
  reflectAccount,
  useWorkspaceSync,
  WORKSPACE_SCHEMA,
} from './workspaceSync'

const data = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => {
    data.set(key, value)
  },
  removeItem: (key: string) => {
    data.delete(key)
  },
})

const realFetch = globalThis.fetch

const slice = {
  boards: [{ id: 'b-server', name: 'From the server', band: 'team', description: '' }],
  lanes: [],
  items: [],
  users: [{ id: 'u-ada', name: 'Ada' }],
  issueTypes: [],
  edges: [],
  links: [],
  objectives: [],
  keyResults: [],
  boardTemplates: [],
  savedFilters: [],
  collapsedLanes: {},
  boardId: 'b-server',
}

const answers = (body: Record<string, unknown>, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }))

describe('what this browser should show, given the account', () => {
  beforeEach(() => {
    data.clear()
    queue.clear()
    useWorkspaceSync.setState({ offer: false, busy: false, error: undefined })
    useStore.getState().resetDemo()
  })

  afterEach(() => {
    vi.stubGlobal('fetch', realFetch)
    useStore.getState().resetDemo()
  })

  it('adopts the account’s workspace when it has one', async () => {
    vi.stubGlobal('fetch', answers({ ...slice, schema: WORKSPACE_SCHEMA, meUserId: 'u_account' }))
    useAuth.setState({ providers: [], user: { id: 'u_account', name: 'Ada', email: 'ada@example.com', role: 'admin', instanceRole: 'admin' }, dev: false, loaded: true })

    expect(await reflectAccount('u_account')).toBe('adopted')
    expect(useStore.getState().boards.map((board) => board.id)).toEqual(['b-server'])
    // The server's pointer at a person is not the browser's: the session decides that.
    expect(useStore.getState().meUserId).toBe('u-ada')
  })

  it('offers to copy this one up when the account has nothing', async () => {
    vi.stubGlobal('fetch', answers({ boards: [], schema: WORKSPACE_SCHEMA }))

    expect(await reflectAccount('u_ada')).toBe('offered')
    expect(useWorkspaceSync.getState().offer).toBe(true)
    // Nothing was taken away while the question is open.
    expect(useStore.getState().boards.length).toBeGreaterThan(0)
  })

  it('does not adopt over edits that have not been sent', async () => {
    queue.add({ key: 'k', item: { id: 'i', title: 'Waiting', typeId: 't', createdAt: 1 }, baseRev: 0, at: 1 })
    const fetchMock = answers({ ...slice, schema: WORKSPACE_SCHEMA })
    vi.stubGlobal('fetch', fetchMock)

    expect(await reflectAccount('u_ada')).toBe('held')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useStore.getState().boards.map((board) => board.id)).not.toEqual(['b-server'])
  })

  it('refuses a shape it cannot read rather than half-rendering it', async () => {
    vi.stubGlobal('fetch', answers({ ...slice, schema: WORKSPACE_SCHEMA + 1 }))

    expect(await reflectAccount('u_ada')).toBe('mismatch')
    expect(useWorkspaceSync.getState().error).toContain('cannot read')
    expect(useStore.getState().boards.map((board) => board.id)).not.toContain('b-server')
  })

  it('says nothing when there is nothing to say', async () => {
    vi.stubGlobal('fetch', answers({ boards: [], schema: WORKSPACE_SCHEMA }))
    // This browser has nothing to bring either, so there is no question to ask.
    useStore.setState({ boards: [] })

    expect(await reflectAccount('u_ada')).toBe('empty')
    expect(useWorkspaceSync.getState().offer).toBe(false)
  })

  it('remembers a refusal, so the question is asked once', async () => {
    vi.stubGlobal('fetch', answers({ boards: [], schema: WORKSPACE_SCHEMA }))
    await reflectAccount('u_ada')
    declineImport('u_ada')

    // It still asks what the account holds — that is how it knows there is nothing to show —
    // but it does not ask the question again.
    vi.stubGlobal('fetch', answers({ boards: [], schema: WORKSPACE_SCHEMA }))
    expect(await reflectAccount('u_ada')).toBe('empty')
    expect(useWorkspaceSync.getState().offer).toBe(false)
  })
})

describe('copying this workspace to the account', () => {
  beforeEach(() => {
    data.clear()
    queue.clear()
    useWorkspaceSync.setState({ offer: false, busy: false, error: undefined })
  })

  afterEach(() => {
    vi.stubGlobal('fetch', realFetch)
  })

  it('copies it, and stops offering', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ imported: { boards: 1 } }), { status: 200 })))
    useWorkspaceSync.setState({ offer: true })

    expect(await copyToAccount('u-ada', { boards: [{ id: 'b-1' }] })).toBe(true)
    expect(useWorkspaceSync.getState().offer).toBe(false)
    expect(data.get('flowline-import-asked:u-ada')).toBe('1')
  })

  it('keeps the offer, and says why, when the server refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'taken' }), { status: 409 })))

    expect(await copyToAccount('u-ada', { boards: [] })).toBe(false)
    expect(useWorkspaceSync.getState().error).toBe('This workspace already has boards to import into.')
  })
})
