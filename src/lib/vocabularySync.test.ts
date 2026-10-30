/**
 * The workspace's words, kept on the server.
 *
 * The sync is a watcher, not a save button: these tests drive the debounce directly, then check the
 * four promises the module makes — one write per settled edit, the revision adoption set, a 409 that
 * re-reads instead of overwriting, and nothing at all while nobody is signed in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '@/store'
import { useAuth } from './auth'
import { WORKSPACE_SCHEMA } from './workspaceSync'
import {
  cancelVocabularyWrite,
  noteVocabularyRev,
  scheduleVocabularyWrite,
  useVocabulary,
  vocabularyChanged,
  vocabularyDocument,
} from './vocabularySync'

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

const signedIn = () =>
  useAuth.setState({
    providers: [],
    user: { id: 'u_ada', name: 'Ada', email: 'ada@example.com', role: 'admin', instanceRole: 'admin' },
    dev: false,
    loaded: true,
  })

const answered = (body: Record<string, unknown>, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }))

describe('keeping the workspace’s words on the server', () => {
  beforeEach(async () => {
    data.clear()
    vi.useFakeTimers()
    cancelVocabularyWrite()
    // Signing in is what starts the live feed and the account read; let those settle against a
    // server that is simply not there, so a test's own fetch count is its own.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    signedIn()
    await vi.advanceTimersByTimeAsync(0)
    useVocabulary.setState({ rev: null, error: undefined, field: undefined })
    useStore.setState({
      issueTypes: [
        { id: 't-none', name: 'None', color: '#64748b' },
        { id: 't-init', name: 'Initiative', color: '#7c3aed' },
      ],
      boardTemplates: [],
      objectives: [],
      keyResults: [],
      autoArchiveDays: undefined,
    })
    // Forget whatever a previous test last sent, without claiming any revision.
    noteVocabularyRev(null)
  })

  afterEach(() => {
    cancelVocabularyWrite()
    vi.useRealTimers()
    vi.stubGlobal('fetch', realFetch)
  })

  it('sends one write after the edits settle, based on the revision adoption set', async () => {
    const fetchMock = answered({ rev: 5 })
    vi.stubGlobal('fetch', fetchMock)
    noteVocabularyRev(4)

    // Two edits inside the debounce are one document, not two writes.
    useStore.getState().addIssueType('Probe', '#123456')
    useStore.getState().addIssueType('Probe again', '#123456')
    scheduleVocabularyWrite()
    scheduleVocabularyWrite()
    await vi.advanceTimersByTimeAsync(700)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe('/api/workspace/vocabulary')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.rev).toBe(4)
    expect((body.issueTypes as { name: string }[]).map((t) => t.name)).toContain('Probe again')
    // The revision the server answered is the one the next write is based on.
    expect(useVocabulary.getState().rev).toBe(5)
  })

  it('sends nothing when the document has not changed since adoption', async () => {
    const fetchMock = answered({ rev: 5 })
    vi.stubGlobal('fetch', fetchMock)
    noteVocabularyRev(4)

    // No edit: the document adopted is the one the server already has.
    scheduleVocabularyWrite()
    await vi.advanceTimersByTimeAsync(700)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('re-reads somebody else’s words after a 409, rather than sending its own again', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/workspace/vocabulary') {
        return new Response(JSON.stringify({ rev: 9 }), { status: 409 })
      }
      // The re-read: another administrator's words, which are the workspace's now.
      return new Response(
        JSON.stringify({
          schema: WORKSPACE_SCHEMA,
          boards: [{ id: 'b-server', name: 'From the server', band: 'team', description: '' }],
          flows: [],
          lanes: [],
          placements: [],
          items: [],
          edges: [],
          links: [],
          users: [{ id: 'u_ada', name: 'Ada' }],
          issueTypes: [{ id: 't-server', name: 'Theirs', color: '#0ea5e9' }],
          objectives: [],
          keyResults: [],
          boardTemplates: [],
          savedFilters: [],
          collapsedLanes: {},
          structureRev: 1,
          vocabularyRev: 9,
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    noteVocabularyRev(4)

    useStore.getState().addIssueType('Mine', '#123456')
    scheduleVocabularyWrite()
    await vi.advanceTimersByTimeAsync(700)

    // One write, one re-read — and no retry of the edit that lost.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(useVocabulary.getState().rev).toBe(9)
    expect(useStore.getState().issueTypes.map((t) => t.id)).toContain('t-server')
    expect(useStore.getState().issueTypes.some((t) => t.name === 'Mine')).toBe(false)

    // And the synced revision is now the one the next edit starts from.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('says why a write was refused, and keeps the edit in this browser', async () => {
    const fetchMock = answered({ error: 'a editor may not change boardTemplates', field: 'boardTemplates' }, 422)
    vi.stubGlobal('fetch', fetchMock)
    noteVocabularyRev(4)

    useStore.getState().addIssueType('Probe', '#123456')
    scheduleVocabularyWrite()
    await vi.advanceTimersByTimeAsync(700)

    expect(useVocabulary.getState().error).toContain('boardTemplates')
    expect(useVocabulary.getState().field).toBe('boardTemplates')
    // A refusal is not a lost edit: the words stay where the person put them.
    expect(useStore.getState().issueTypes.some((t) => t.name === 'Probe')).toBe(true)
    expect(useVocabulary.getState().rev).toBe(4)
  })

  it('writes nothing while nobody is signed in — the browser is the whole workspace', async () => {
    const fetchMock = answered({ rev: 5 })
    vi.stubGlobal('fetch', fetchMock)
    useAuth.setState({ user: null })
    noteVocabularyRev(4)

    useStore.getState().addIssueType('Probe', '#123456')
    scheduleVocabularyWrite()
    await vi.advanceTimersByTimeAsync(700)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is due for a type, a template, an objective or the policy — and never for a saved filter', () => {
    noteVocabularyRev(4)
    expect(vocabularyChanged()).toBe(false)

    // This device's view state moves; the server has no opinion about it.
    useStore.setState({
      savedFilters: [{ id: 'f-1', name: 'Mine', boardId: 'b-1', filters: { typeIds: [], blocked: false, overdue: false, dueSoon: false, unassigned: false, assigneeIds: [], priorities: [], tagIds: [] } }],
      collapsedLanes: { 'l-1': true },
    })
    expect(vocabularyChanged()).toBe(false)

    // A word moves, and the document is due.
    useStore.getState().addIssueType('Probe', '#123456')
    expect(vocabularyChanged()).toBe(true)
  })

  it('carries the policy and never this device’s view state', () => {
    useStore.setState({
      autoArchiveDays: 14,
      savedFilters: [{ id: 'f-1', name: 'Mine', boardId: 'b-1', filters: { typeIds: [], blocked: false, overdue: false, dueSoon: false, unassigned: false, assigneeIds: [], priorities: [], tagIds: [] } }],
      collapsedLanes: { 'l-1': true },
    })

    const document = vocabularyDocument()
    expect(document.autoArchiveDays).toBe(14)
    expect(document).not.toHaveProperty('savedFilters')
    expect(document).not.toHaveProperty('collapsedLanes')
  })
})
