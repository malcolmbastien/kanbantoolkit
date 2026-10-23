import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { poll, resetLive } from './live'
import { useAuth } from './auth'

const realFetch = globalThis.fetch
const signedIn = { id: 'u-ada', name: 'Ada', email: 'ada@example.com', role: 'admin', instanceRole: 'admin' }

const feed = (cursor: number, changes: unknown[] = []) =>
  vi.fn(async () => new Response(JSON.stringify({ changes, cursor }), { status: 200 }))

describe('the change feed', () => {
  beforeEach(() => {
    resetLive()
    useAuth.setState({ providers: [], user: signedIn, dev: false, loaded: true })
  })

  afterEach(() => {
    resetLive()
    vi.stubGlobal('fetch', realFetch)
    useAuth.setState({ providers: [], user: null, dev: false, loaded: false })
  })

  it('asks for everything after the cursor it has read to', async () => {
    const fetchMock = feed(5)
    vi.stubGlobal('fetch', fetchMock)

    await poll()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/workspace/changes?since=0')

    await poll()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/workspace/changes?since=5')
  })

  it('asks nothing at all without a session', async () => {
    useAuth.setState({ user: null })
    const fetchMock = feed(9)
    vi.stubGlobal('fetch', fetchMock)

    expect(await poll()).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not move the cursor when the server cannot answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    expect(await poll()).toEqual([])

    const fetchMock = feed(3)
    vi.stubGlobal('fetch', fetchMock)
    await poll()
    // Still where it was, so nothing between the two is skipped.
    expect(fetchMock).toHaveBeenLastCalledWith('/api/workspace/changes?since=0')
  })
})
