import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { childrenOf, isLeaf, leafLanes, leavesUnder, STAGES, STAGE_LABELS, subtreeIds } from '@/domain/lanes'
import { createSeed } from '@/domain/seed'
import type { Board, BoardLevel, Edge, FlowState, IssueType, Item, Lane, Placement, SplitOrientation } from '@/domain/types'

export interface Draft {
  boards: FlowState['boards']
  lanes: FlowState['lanes']
  placements: FlowState['placements']
  boardId: string
}

export interface ViewState {
  boardId: string
  selectedItemId: string | null
  search: string
  showTypeEditor: boolean
  /** Board design controls (split / add / rename / delete lanes) only show in edit mode. */
  editMode: boolean
  /** Snapshot taken on entering edit mode; Cancel restores it, Save drops it. */
  draft: Draft | null
  /** Focus lens: highlight this item and its ancestors/descendants; dim the rest. */
  lensId: string | null
}
export interface Actions {
  selectBoard: (id: string) => void
  openItem: (id: string | null) => void
  setSearch: (q: string) => void
  toggleTypeEditor: () => void
  beginEdit: () => void
  saveEdit: () => void
  cancelEdit: () => void
  setBoardDerived: (id: string, derived: boolean) => void
  toggleLens: (id: string) => void
  setLens: (id: string | null) => void
  clearLens: () => void
  addManagementTeam: (managementBoardId: string, teamBoardId: string) => void
  removeManagementTeam: (managementBoardId: string, teamBoardId: string) => void
  resetDemo: () => void

  addIssueType: (name: string, color: string) => void
  updateIssueType: (id: string, patch: Partial<IssueType>) => void
  removeIssueType: (id: string) => void

  addBoard: (name: string, level?: BoardLevel) => void
  removeBoard: (id: string) => void
  renameBoard: (id: string, name: string) => void
  setBoardLevel: (id: string, level: BoardLevel) => void

  addCard: (input: { boardId: string; typeId: string; laneId: string; title: string }) => void
  moveCard: (itemId: string, boardId: string, laneId: string, reason?: string) => void
  setItemFields: (id: string, patch: Partial<Item>) => void

  splitLane: (laneId: string, orientation: SplitOrientation, count?: number) => void
  addLane: (parentId: string) => void
  setLaneOrientation: (laneId: string, orientation: SplitOrientation) => void
  setLaneFlags: (laneId: string, patch: Partial<Pick<Lane, 'isStart' | 'isDone' | 'isCancelled'>>) => void
  removeLane: (laneId: string) => void
  renameLane: (laneId: string, name: string) => void
  setLaneWip: (laneId: string, wipLimit: number | undefined) => void

  setParent: (childId: string, parentId: string | null) => void
  addChild: (parentId: string, typeId: string, title: string) => void
  /** Create a team-level initiative on a team board, linked (as a child) to a management initiative. */
  linkTeamInitiative: (parentId: string, boardId: string, title: string) => void

  raiseDependency: (blockerId: string, dependentId: string, pinTo?: string, reason?: string) => void
  confirmDependency: (edgeId: string) => void
  rejectDependency: (edgeId: string, reason: string) => void
  setAttribution: (itemId: string, objectiveId: string, on: boolean) => void
}

export type Store = FlowState & ViewState & Actions

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

const initialView: ViewState = {
  boardId: 'b-core',
  selectedItemId: null,
  search: '',
  showTypeEditor: false,
  editMode: false,
  draft: null,
  lensId: null,
}

/**
 * Backfills fields added after earlier persisted versions. Currently: `Board.level`
 * (boards saved before the flight-level badge existed). Exported for testing.
 */
export function migrateState(persisted: unknown): Partial<Store> {
  const p = (persisted ?? {}) as Record<string, unknown>
  const levelById: Record<string, BoardLevel> = {
    'b-portfolio': 'portfolio',
    'b-core': 'project',
    'b-platform': 'project',
    'b-design': 'team',
  }
  if (Array.isArray(p.boards)) {
    p.boards = (p.boards as { id: string; level?: BoardLevel }[]).map((b) => ({
      ...b,
      level: b.level ?? levelById[b.id] ?? 'team',
    }))
  }
  return p as Partial<Store>
}

/**
 * Persisted-state migration. The board model has been reshaped several times, so any
 * state older than v5 is reseeded with the current demo design.
 */
export function migratePersisted(persisted: unknown, version: number): Partial<Store> {
  if (version < 6) return createSeed() as unknown as Partial<Store>
  return migrateState(persisted)
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...createSeed(),
      ...initialView,

      selectBoard: (boardId) => set({ boardId, selectedItemId: null }),
      openItem: (selectedItemId) => set({ selectedItemId }),
      setSearch: (search) => set({ search }),
      toggleTypeEditor: () => set({ showTypeEditor: !get().showTypeEditor }),

      beginEdit: () => {
        const s = get()
        if (s.editMode) return
        set({
          editMode: true,
          draft: {
            boards: structuredClone(s.boards),
            lanes: structuredClone(s.lanes),
            placements: structuredClone(s.placements),
            boardId: s.boardId,
          },
        })
      },
      saveEdit: () => set({ editMode: false, draft: null }),
      setBoardDerived: (id, derived) =>
        set({ boards: get().boards.map((b) => (b.id === id ? { ...b, derived } : b)) }),
      toggleLens: (id) => set({ lensId: get().lensId === id ? null : id }),
      setLens: (id) => set({ lensId: id }),
      clearLens: () => set({ lensId: null }),

      addManagementTeam: (managementBoardId, teamBoardId) =>
        set({
          boards: get().boards.map((b) =>
            b.id === managementBoardId && !(b.teamBoardIds ?? []).includes(teamBoardId)
              ? { ...b, teamBoardIds: [...(b.teamBoardIds ?? []), teamBoardId] }
              : b,
          ),
        }),
      removeManagementTeam: (managementBoardId, teamBoardId) =>
        set({
          boards: get().boards.map((b) =>
            b.id === managementBoardId
              ? { ...b, teamBoardIds: (b.teamBoardIds ?? []).filter((t) => t !== teamBoardId) }
              : b,
          ),
        }),
      cancelEdit: () => {
        const d = get().draft
        if (!d) {
          set({ editMode: false })
          return
        }
        set({ editMode: false, draft: null, boards: d.boards, lanes: d.lanes, placements: d.placements, boardId: d.boardId })
      },
      resetDemo: () => set({ ...createSeed(), ...initialView }),

      addIssueType: (name, color) => set({ issueTypes: [...get().issueTypes, { id: uid(), name, color }] }),
      updateIssueType: (id, patch) =>
        set({ issueTypes: get().issueTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
      removeIssueType: (id) => set({ issueTypes: get().issueTypes.filter((t) => t.id !== id) }),

      addBoard: (name, level = 'team') => {
        const boardId = uid()
        const rootId = uid()
        const board: Board = { id: boardId, name, level, ...(level === 'portfolio' ? { teamBoardIds: [] } : {}) }
        const root: Lane = { id: rootId, boardId, parentId: null, order: 0, name: '', orientation: 'columns' }
        // Every board starts as the fixed three typed columns; users split them to refine.
        const cols: Lane[] = STAGES.map((s, i) => ({
          id: uid(),
          boardId,
          parentId: rootId,
          order: i,
          name: STAGE_LABELS[s],
          stage: s,
        }))
        set({ boards: [...get().boards, board], lanes: [...get().lanes, root, ...cols], boardId, editMode: true })
      },

      removeBoard: (id) => {
        const state = get()
        if (state.boards.length <= 1) return
        const laneIds = new Set(state.lanes.filter((l) => l.boardId === id).map((l) => l.id))
        const boards = state.boards
          .filter((b) => b.id !== id)
          .map((b) => (b.teamBoardIds ? { ...b, teamBoardIds: b.teamBoardIds.filter((t) => t !== id) } : b))
        set({
          boards,
          lanes: state.lanes.filter((l) => l.boardId !== id),
          placements: state.placements.filter((p) => p.boardId !== id && !laneIds.has(p.laneId)),
          boardId: state.boardId === id ? boards[0].id : state.boardId,
        })
      },

      renameBoard: (id, name) => set({ boards: get().boards.map((b) => (b.id === id ? { ...b, name } : b)) }),
      setBoardLevel: (id, level) => set({ boards: get().boards.map((b) => (b.id === id ? { ...b, level } : b)) }),

      addCard: ({ boardId, typeId, laneId, title }) => {
        const item: Item = { id: uid(), title, typeId, createdAt: Date.now() }
        const placement: Placement = { id: uid(), boardId, itemId: item.id, laneId }
        set({ items: [...get().items, item], placements: [...get().placements, placement] })
      },

      moveCard: (itemId, boardId, laneId) => {
        const state = get()
        const existing = state.placements.find((p) => p.itemId === itemId && p.boardId === boardId)
        if (existing && existing.laneId === laneId) return
        const placements = existing
          ? state.placements.map((p) => (p.id === existing.id ? { ...p, laneId } : p))
          : [...state.placements, { id: uid(), boardId, itemId, laneId }]
        set({ placements })
      },

      setItemFields: (id, patch) =>
        set({ items: get().items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }),

      /** Split a leaf cell into a container of the given orientation, with N sub-lanes. */
      splitLane: (laneId, orientation, count = 2) => {
        const state = get()
        const lane = state.lanes.find((l) => l.id === laneId)
        if (!lane || !isLeaf(state.lanes, laneId)) return
        const children: Lane[] = Array.from({ length: count }, (_, i) => ({
          id: uid(),
          boardId: lane.boardId,
          parentId: laneId,
          order: i,
          name: orientation === 'rows' ? `Row ${i + 1}` : `Column ${i + 1}`,
        }))
        const placements = state.placements.map((p) => (p.laneId === laneId ? { ...p, laneId: children[0].id } : p))
        set({
          lanes: state.lanes.map((l) => (l.id === laneId ? { ...l, orientation } : l)).concat(children),
          placements,
        })
      },

      setLaneOrientation: (laneId, orientation) => {
        const state = get()
        const lane = state.lanes.find((l) => l.id === laneId)
        if (!lane || lane.parentId === null) return // never flip the board root
        set({ lanes: state.lanes.map((l) => (l.id === laneId ? { ...l, orientation } : l)) })
      },

      setLaneFlags: (laneId, patch) =>
        set({ lanes: get().lanes.map((l) => (l.id === laneId ? { ...l, ...patch } : l)) }),

      addLane: (parentId) => {
        const state = get()
        const parent = state.lanes.find((l) => l.id === parentId)
        if (!parent) return
        // The top-level columns are fixed (three typed stages); refine by splitting.
        if (parent.parentId === null) return
        const order = childrenOf(state.lanes, parentId).length
        const name = parent.orientation === 'rows' ? `Row ${order + 1}` : `Column ${order + 1}`
        const child: Lane = { id: uid(), boardId: parent.boardId, parentId, order, name }
        const lanes = state.lanes.map((l) => (l.id === parentId ? { ...l, orientation: parent.orientation ?? 'columns' } : l))
        set({ lanes: lanes.concat([child]) })
      },

      removeLane: (laneId) => {
        const state = get()
        const lane = state.lanes.find((l) => l.id === laneId)
        if (!lane || lane.parentId === null) return
        const parent = state.lanes.find((l) => l.id === lane.parentId)
        if (parent?.parentId === null) return // top-level columns are fixed; refine, don't delete
        const ids = new Set(subtreeIds(state.lanes, laneId))
        const siblings = childrenOf(state.lanes, lane.parentId).filter((l) => l.id !== laneId)
        const target = siblings.flatMap((s) => leavesUnder(state.lanes, s.id))[0]
        const placements = state.placements
          .map((p) => (ids.has(p.laneId) ? (target ? { ...p, laneId: target.id } : null) : p))
          .filter((p): p is Placement => p !== null)
        set({ lanes: state.lanes.filter((l) => !ids.has(l.id)), placements })
      },

      renameLane: (laneId, name) => set({ lanes: get().lanes.map((l) => (l.id === laneId ? { ...l, name } : l)) }),
      setLaneWip: (laneId, wipLimit) =>
        set({ lanes: get().lanes.map((l) => (l.id === laneId ? { ...l, wipLimit } : l)) }),

      setParent: (childId, parentId) => {
        const state = get()
        let edges = state.edges.filter((e) => !(e.kind === 'decomposition' && e.to === childId))
        if (parentId && parentId !== childId) edges = [...edges, { id: uid(), kind: 'decomposition', from: parentId, to: childId }]
        set({ edges })
      },

      addChild: (parentId, typeId, title) => {
        const item: Item = { id: uid(), title, typeId, createdAt: Date.now() }
        const edge: Edge = { id: uid(), kind: 'decomposition', from: parentId, to: item.id }
        set({ items: [...get().items, item], edges: [...get().edges, edge] })
      },

      linkTeamInitiative: (parentId, boardId, title) => {
        const state = get()
        const lane = leafLanes(state.lanes, boardId)[0]
        const typeId = state.issueTypes.find((t) => t.name === 'Initiative')?.id ?? state.issueTypes[0]?.id
        if (!lane || !typeId) return
        const item: Item = { id: uid(), title, typeId, createdAt: Date.now() }
        set({
          items: [...state.items, item],
          placements: [...state.placements, { id: uid(), boardId, itemId: item.id, laneId: lane.id }],
          edges: [...state.edges, { id: uid(), kind: 'decomposition', from: parentId, to: item.id }],
        })
      },

      raiseDependency: (blockerId, dependentId, pinTo, reason) => {
        if (blockerId === dependentId) return
        const state = get()
        if (state.edges.some((e) => e.kind === 'dependency' && e.from === blockerId && e.to === dependentId)) return
        set({
          edges: [...state.edges, { id: uid(), kind: 'dependency', from: blockerId, to: dependentId, dep: { fsKind: 'FS', status: 'proposed', pinTo, reason } }],
        })
      },

      confirmDependency: (edgeId) =>
        set({ edges: get().edges.map((e) => (e.id === edgeId && e.dep ? { ...e, dep: { ...e.dep, status: 'confirmed' } } : e)) }),

      rejectDependency: (edgeId, reason) =>
        set({ edges: get().edges.map((e) => (e.id === edgeId && e.dep ? { ...e, dep: { ...e.dep, status: 'rejected', reason } } : e)) }),

      setAttribution: (itemId, objectiveId, on) => {
        const state = get()
        const existing = state.edges.find((e) => e.kind === 'attribution' && e.from === objectiveId && e.to === itemId)
        if (on && !existing) set({ edges: [...state.edges, { id: uid(), kind: 'attribution', from: objectiveId, to: itemId }] })
        else if (!on && existing) set({ edges: state.edges.filter((e) => e.id !== existing.id) })
      },
    }),
    {
      name: 'flowline-state-v3',
      version: 6,
      // Reshaped board model; older state is reseeded (see migratePersisted).
      migrate: (persisted, version) => migratePersisted(persisted, version) as Store,
      // While editing, persist the pre-edit (draft) design so a reload reverts to it.
      partialize: (s) => {
        const design = s.draft ?? { boards: s.boards, lanes: s.lanes, placements: s.placements, boardId: s.boardId }
        return {
          issueTypes: s.issueTypes,
          items: s.items,
          edges: s.edges,
          objectives: s.objectives,
          keyResults: s.keyResults,
          sponsors: s.sponsors,
          boardId: design.boardId,
          boards: design.boards,
          lanes: design.lanes,
          placements: design.placements,
        }
      },
    },
  ),
)
