import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendHistory, fetchItemLog, fetchWholeItemLog, fetchMovements, fetchNoteHits, mergeLog, movesOf } from './history'
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

  it('follows every page, because a reading from the first page alone would be short', async () => {
    useAuth.setState({ providers: [], user: signedIn, dev: false, loaded: true })
    const pages: Record<string, { entries: ItemLogEntry[]; nextCursor: string | null; total: number }> = {
      '/api/workspace/items/i-1/log': { entries: [entry('c', 3)], nextCursor: 'cursor-1', total: 3 },
      '/api/workspace/items/i-1/log?cursor=cursor-1': {
        entries: [entry('b', 2)],
        nextCursor: 'cursor-2',
        total: 3,
      },
      '/api/workspace/items/i-1/log?cursor=cursor-2': {
        entries: [entry('a', 1)],
        nextCursor: null,
        total: 3,
      },
    }
    const fetchMock = vi.fn(async (path: string) => new Response(JSON.stringify(pages[path]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchWholeItemLog('i-1')).toEqual({
      entries: [entry('a', 1), entry('b', 2), entry('c', 3)],
      nextCursor: null,
      total: 3,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('answers the pages it has and the cursor to continue when a later page fails', async () => {
    useAuth.setState({ providers: [], user: signedIn, dev: false, loaded: true })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [entry('b', 2)], nextCursor: 'cursor-1', total: 2 }), { status: 200 }))
      .mockResolvedValueOnce(new Response('no', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchWholeItemLog('i-1')).toEqual({
      entries: [entry('b', 2)],
      nextCursor: 'cursor-1',
      total: 2,
    })
  })

  it('reads only moves that landed in a stage, in order', () => {
    const moves = movesOf([
      { id: 'x', at: 2, kind: 'moved', toStage: 'done', fromStage: 'inProgress' },
      { id: 'y', at: 1, kind: 'created' },
      { id: 'z', at: 3, kind: 'moved' },
    ])
    expect(moves).toEqual([{ at: 2, to: 'done', from: 'inProgress' }])
  })

  it('appends a move without asking a static deployment to take it', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const entry = { id: 'l-1', at: 1, kind: 'moved' as const, toStage: 'done' as const }
    expect(await appendHistory('i-1', [entry])).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()

    useAuth.setState({ providers: [], user: signedIn, dev: false, loaded: true })
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ appended: 1 }), { status: 200 }))
    expect(await appendHistory('i-1', [entry])).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/items/i-1/log',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ entries: [entry] }) }),
    )

    // A server that cannot take it is not an error: the local log still has the entry.
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await appendHistory('i-1', [entry])).toBe(false)
    expect(await appendHistory('i-1', [])).toBe(false)
  })
})
