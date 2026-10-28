import { describe, expect, it } from 'vitest'
import { persistedSlice, PERSIST_VERSION, WORKSPACE_KEYS } from '../store'
import { readWorkspaceFile } from './workspace'

/** A file that would pass every check, with the patches a test states explicitly. */
const validFile = (patch: Record<string, unknown> = {}): unknown => ({
  app: 'kanbantoolkit',
  exportedAt: '2026-10-16T09:00:00.000Z',
  version: PERSIST_VERSION,
  state: {
    boards: [{ id: 'b1', name: 'Atlas', band: 'team', description: '' }],
    lanes: [{ id: 'l1', boardId: 'b1', parentId: null, order: 0, name: 'Backlog', workflow: 'cards', stage: 'backlog' }],
    items: [],
    placements: [],
    issueTypes: [{ id: 't-story', name: 'User Story', color: '#6366f1' }],
  },
  ...patch,
})

describe('reading a workspace file', () => {
  it('accepts a valid file of the current shape', () => {
    const read = readWorkspaceFile(validFile(), PERSIST_VERSION)
    expect(read.ok).toBe(true)
    expect(read.version).toBe(PERSIST_VERSION)
    expect((read.state as { boards: unknown[] }).boards.length).toBe(1)
  })

  it('refuses what is not a Kanban Toolkit workspace', () => {
    expect(readWorkspaceFile(null, PERSIST_VERSION).ok).toBe(false)
    expect(readWorkspaceFile('nope', PERSIST_VERSION).ok).toBe(false)
    expect(readWorkspaceFile([1, 2], PERSIST_VERSION).ok).toBe(false)
    const read = readWorkspaceFile(validFile({ app: 'kanban-tool' }), PERSIST_VERSION)
    expect(read.ok).toBe(false)
    expect(read.error).toMatch(/not a Kanban Toolkit workspace/)
  })

  it('refuses a shape it cannot honour: no version, or a newer one', () => {
    const noVersion = readWorkspaceFile(validFile({ version: '29' }), PERSIST_VERSION)
    expect(noVersion.ok).toBe(false)
    expect(noVersion.error).toMatch(/shape it was written in/)
    const future = readWorkspaceFile(validFile({ version: PERSIST_VERSION + 1 }), PERSIST_VERSION)
    expect(future.ok).toBe(false)
    expect(future.error).toMatch(/newer Kanban Toolkit/)
    // Fractional and absurd versions say nothing trustworthy either.
    expect(readWorkspaceFile(validFile({ version: 29.5 }), PERSIST_VERSION).ok).toBe(false)
    expect(readWorkspaceFile(validFile({ version: 0 }), PERSIST_VERSION).ok).toBe(false)
  })

  it('refuses an incomplete workspace rather than importing it half-carried', () => {
    const noState = readWorkspaceFile({ app: 'kanbantoolkit', version: PERSIST_VERSION, state: null }, PERSIST_VERSION)
    expect(noState.ok).toBe(false)
    for (const key of ['boards', 'lanes', 'items', 'placements', 'issueTypes'] as const) {
      const inner = (validFile() as Record<string, unknown>).state as Record<string, unknown>
      delete inner[key]
      const read = readWorkspaceFile({ app: 'kanbantoolkit', version: PERSIST_VERSION, state: inner }, PERSIST_VERSION)
      expect(read.ok).toBe(false)
      expect(read.error).toContain(key)
    }
    const empty = readWorkspaceFile(
      {
        app: 'kanbantoolkit',
        version: PERSIST_VERSION,
        state: { boards: [], lanes: [], items: [], placements: [], issueTypes: [] },
      },
      PERSIST_VERSION,
    )
    expect(empty.ok).toBe(false)
    expect(empty.error).toMatch(/no boards/)
    void noState
  })

  it('refuses a board without an id or a name', () => {
    const inner = ((validFile() as Record<string, unknown>).state as Record<string, unknown>)
    inner.boards = [{ id: 7, name: 'Broken' }]
    const read = readWorkspaceFile({ app: 'kanbantoolkit', version: PERSIST_VERSION, state: inner }, PERSIST_VERSION)
    expect(read.ok).toBe(false)
    expect(read.error).toMatch(/id or name/)
  })
})

describe('workspace keys', () => {
  it('the import whitelist and the persisted slice are the same set', () => {
    // Drift between what the app writes and what an import copies would silently drop
    // or leak state — the two lists must agree, so a new persisted key forces the list.
    const keys = (slice: Partial<Record<string, unknown>>) => Object.keys(slice).sort()
    // A board-scoping guard: the persisted slice keys, computed from the getter itself.
    const sample = {
      users: [],
      issueTypes: [],
      items: [],
      edges: [],
      links: [],
      objectives: [],
      keyResults: [],
      boardTemplates: [],
      autoArchiveDays: undefined,
      savedFilters: [],
      collapsedLanes: {},
      boardId: 'b',
      boards: [],
      lanes: [],
      placements: [],
    } as unknown as Parameters<typeof persistedSlice>[0]
    expect(keys(persistedSlice(sample))).toEqual([...WORKSPACE_KEYS].sort())
  })
})
