import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchItemLog, fetchMovements, fetchNoteHits, mergeLog, movesOf } from './history'
import { useAuth } from './auth'
import type { ItemLogEntry } from '@/domain/types'

const signedIn = {
  id: 'u-ada',
  name: 'Ada',
  email: 'ada@example.com',
  role: 'admin',
  instanceRole: 'admin',
}
const entry = (id: string, at: number, over: Partial<ItemLogEntry> = {}): ItemLogEntry => ({
  id,
  at,
  kind: 'noted',
  note: id,
  ...over,
})

const realFetch = globalThis.fetch

afterEach(() => {
  vi.stubGlobal('fetch', realFetch)
  useAuth.setState({ providers: [], user: null, dev: false, loaded: false })
})

describe('reading a card’s history', () => {
  it('does not ask a server a static deployment does not have', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchItemLog('i-1')).toBeUndefined()
    expect(await fetchMovements('b-1')).toBeUndefined()
    expect(await fetchNoteHits('retry')).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks where it is read, and answers undefined rather than throwing', async () => {
    useAuth.setState({ providers: [], user: signedIn, dev: false, loaded: true })
    const fetchMock = vi.fn(async (path: string) =>
      path.startsWith('/api/workspace/items/')
        ? new Response(JSON.stringify({ entries: [], nextCursor: null, total: 0 }), { status: 200 })
        : new Response('<!doctype html>', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchItemLog('i-1')).toEqual({ entries: [], nextCursor: null, total: 0 })
    expect(fetchMock).toHaveBeenCalledWith('/api/workspace/items/i-1/log', expect.anything())
    // A host that answers with the app's HTML is a host with no history.
    expect(await fetchMovements('b-1')).toBeUndefined()

    fetchMock.mockResolvedValueOnce(new Response('no', { status: 401 }))
    expect(await fetchNoteHits('retry')).toBeUndefined()
  })

  it('merges what the browser knew with what the server said, once per entry', () => {
    const local = [entry('a', 1), entry('b', 3, { note: 'local' })]
    const remote = [entry('b', 3, { note: 'server' }), entry('c', 2)]

    expect(mergeLog(local, remote).map((e) => [e.id, e.note])).toEqual([
      ['a', 'a'],
      ['c', 'c'],
      ['b', 'server'],
    ])
    expect(mergeLog(undefined, undefined)).toEqual([])
    expect(mergeLog(local, undefined)).toEqual(local)
  })

  it('reads only moves that landed in a stage, in order', () => {
    const moves = movesOf([
      { id: 'x', at: 2, kind: 'moved', toStage: 'done', fromStage: 'inProgress' },
      { id: 'y', at: 1, kind: 'created' },
      { id: 'z', at: 3, kind: 'moved' },
    ])
    expect(moves).toEqual([{ at: 2, to: 'done', from: 'inProgress' }])
  })
})
