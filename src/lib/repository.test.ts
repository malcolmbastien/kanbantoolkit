import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Item } from '@/domain/types'
import { useAuth } from './auth'
import { chooseRepository, httpRepository, localRepository } from './repository'
import { useStorageStatus } from './storage'
import { useTabSync } from './tabSync'

// The two ways a browser fails to save, so the adapter can be shown to be the shipped one rather
// than merely something that compiles.
const data = new Map<string, string>()
let throwing = false

vi.stubGlobal('localStorage', {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (throwing) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    data.set(key, value)
  },
  removeItem: (key: string) => {
    data.delete(key)
  },
})

const NAME = 'kanbantoolkit-state-v3'
const envelope = (state: Record<string, unknown>) => JSON.stringify({ state, version: 33 })

describe('where the workspace lives', () => {
  beforeEach(() => {
    data.clear()
    throwing = false
    useStorageStatus.setState({ failed: false, persisted: null, usage: null, quota: null })
    useTabSync.setState({ stale: false })
  })

  it('is decided in one place, and today that place answers the browser', () => {
    expect(chooseRepository().kind).toBe('local')
  })

  it('carries the persisted slice exactly as it is, with the revision beside it', () => {
    const repository = localRepository()
    repository.storage.getItem(NAME)
    repository.storage.setItem(NAME, envelope({ boards: [{ id: 'b-atlas' }] }))

    const stored = JSON.parse(data.get(NAME)!) as { state: unknown; version: number; rev: number }
    // The slice is not reshaped on the way through: the adapter is a door, not a second model.
    expect(stored.state).toEqual({ boards: [{ id: 'b-atlas' }] })
    expect(stored.version).toBe(33)
    // Still revisioned, so one tab still cannot overwrite another's work.
    expect(stored.rev).toBe(1)
  })

  it('publishes a failed write rather than throwing, as it did before the boundary', () => {
    const repository = localRepository()
    repository.storage.getItem(NAME)
    throwing = true

    expect(() => repository.storage.setItem(NAME, envelope({ boards: [] }))).not.toThrow()
    expect(useStorageStatus.getState().failed).toBe(true)
  })
})

const realFetch = globalThis.fetch
const card: Item = { id: 'i-card', title: 'A card', typeId: 't-card', createdAt: 1_700_000_000_000, rev: 2 }

const answer = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }))

afterEach(() => {
  vi.stubGlobal('fetch', realFetch)
  useAuth.setState({ providers: [], user: null, dev: false, loaded: false })
})

describe('sending a change', () => {
  it('sends nothing when the workspace is only this browser\'s', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await localRepository().commitItem(card, 1)
    expect(result).toEqual({ kind: 'kept', item: card })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the version the server answers with', async () => {
    const stored = { ...card, rev: 2, title: 'Renamed' }
    vi.stubGlobal('fetch', answer(200, { item: stored }))

    const result = await httpRepository().commitItem({ ...card, title: 'Renamed' }, 1)
    expect(result).toEqual({ kind: 'kept', item: stored })
  })

  it('says which revision it was based on', async () => {
    const fetchMock = answer(200, { item: card })
    vi.stubGlobal('fetch', fetchMock)

    await httpRepository().commitItem(card, 1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/workspace/items/i-card')
    expect(JSON.parse(init.body as string)).toEqual({ baseRev: 1, item: card })
  })

  it('takes the server\'s card when the workspace has moved past the change', async () => {
    const theirs = { ...card, rev: 9, title: 'Theirs' }
    vi.stubGlobal('fetch', answer(409, { error: 'moved past', item: theirs }))

    const result = await httpRepository().commitItem(card, 1)
    expect(result).toEqual({ kind: 'refused', reason: 'changed', item: theirs })
  })

  it('treats a refusal with no card as a refusal, not a connection problem', async () => {
    vi.stubGlobal('fetch', answer(401, { error: 'sign in to use this workspace' }))
    expect(await httpRepository().commitItem(card, 1)).toEqual({ kind: 'refused', reason: 'other', item: null })
  })

  it('distinguishes a server that cannot be reached from one that said no', async () => {
    vi.stubGlobal('fetch', answer(500, { error: 'boom' }))
    expect(await httpRepository().commitItem(card, 1)).toEqual({ kind: 'unreachable' })

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await httpRepository().commitItem(card, 1)).toEqual({ kind: 'unreachable' })
  })

  it('is the browser\'s own until somebody is signed in', () => {
    expect(chooseRepository().kind).toBe('local')

    useAuth.setState({ providers: [], user: { id: 'u-1', name: 'Ada', email: 'a@example.com', role: 'admin', instanceRole: 'admin' }, dev: false, loaded: true })
    expect(chooseRepository().kind).toBe('http')
  })

  it('sends through the chosen adapter once there is a session', async () => {
    const fetchMock = answer(200, { item: card })
    vi.stubGlobal('fetch', fetchMock)
    useAuth.setState({ providers: [], user: { id: 'u-1', name: 'Ada', email: 'a@example.com', role: 'admin', instanceRole: 'admin' }, dev: false, loaded: true })

    await chooseRepository().commitItem(card, 1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('a refusal says which refusal it was', () => {
  it('names the holder when the card is taken', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'someone else is editing this card', holder: { holderName: 'Grace' } }), {
          status: 423,
        }),
      ),
    )

    expect(await httpRepository().commitItem(card, 1)).toEqual({
      kind: 'refused',
      reason: 'held',
      item: null,
      holderName: 'Grace',
    })
  })
})
