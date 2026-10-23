import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { considerImport, copyToAccount, declineImport, useWorkspaceSync } from './workspaceSync'

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
const workspaces = (boards: unknown[], status = 200) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/import')) return new Response(JSON.stringify({ imported: { boards: 1, items: 1 } }), { status })
    return new Response(JSON.stringify({ boards }), { status })
  })

describe('copying a workspace to the account', () => {
  beforeEach(() => {
    data.clear()
    useWorkspaceSync.setState({ offer: false, busy: false, error: undefined })
  })

  afterEach(() => {
    vi.stubGlobal('fetch', realFetch)
  })

  it('offers only when there is something to bring and the account has nothing', async () => {
    const fetchMock = workspaces([])
    vi.stubGlobal('fetch', fetchMock)

    await considerImport('u-ada', 3)
    expect(useWorkspaceSync.getState().offer).toBe(true)
  })

  it('says nothing when the account already has a workspace', async () => {
    vi.stubGlobal('fetch', workspaces([{ id: 'b-1' }]))
    await considerImport('u-ada', 3)
    expect(useWorkspaceSync.getState().offer).toBe(false)
  })

  it('asks nothing at all when this browser has no boards', async () => {
    const fetchMock = workspaces([])
    vi.stubGlobal('fetch', fetchMock)

    await considerImport('u-ada', 0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('remembers an answer, so the question is asked once', async () => {
    vi.stubGlobal('fetch', workspaces([]))
    await considerImport('u-ada', 3)
    declineImport('u-ada')

    const fetchMock = workspaces([])
    vi.stubGlobal('fetch', fetchMock)
    await considerImport('u-ada', 3)

    expect(useWorkspaceSync.getState().offer).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('copies the workspace, and stops offering', async () => {
    const fetchMock = workspaces([])
    vi.stubGlobal('fetch', fetchMock)
    await considerImport('u-ada', 3)

    expect(await copyToAccount('u-ada', { boards: [{ id: 'b-1' }] })).toBe(true)
    expect(useWorkspaceSync.getState().offer).toBe(false)
    expect(data.get('flowline-import-asked:u-ada')).toBe('1')
  })

  it('keeps the offer, and says why, when the server refuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'this workspace already has boards' }), { status: 409 })),
    )

    expect(await copyToAccount('u-ada', { boards: [] })).toBe(false)
    expect(useWorkspaceSync.getState().offer).toBe(false)
    expect(useWorkspaceSync.getState().error).toBe('This account already has a workspace.')
  })
})
