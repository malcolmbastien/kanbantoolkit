import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ancestorsOf, childrenOf, isLeaf, laneCardCount, leavesUnder, subtreeIds } from '@/domain/lanes'
import { createSeed } from '@/domain/seed'
import type { Edge, FlowState, IssueType, Item, Lane, Placement, SplitOrientation } from '@/domain/types'

export type MoveResult =
  | { ok: true }
  | { ok: false; needsReason: true; lane: Lane; count: number }

export interface ViewState {
  boardId: string
  selectedItemId: string | null
  search: string
  showDemoGuide: boolean
  showTypeEditor: boolean
  /** Board design controls (split / add / rename / delete lanes) only show in edit mode. */
  editMode: boolean
}

export interface Actions {
  selectBoard: (id: string) => void
  openItem: (id: string | null) => void
  setSearch: (q: string) => void
  toggleDemoGuide: () => void
  toggleTypeEditor: () => void
  toggleEditMode: () => void
  setEditMode: (v: boolean) => void
  resetDemo: () => void

  addIssueType: (name: string, color: string) => void
  updateIssueType: (id: string, patch: Partial<IssueType>) => void
  removeIssueType: (id: string) => void

  addCard: (input: { boardId: string; typeId: string; laneId: string; title: string }) => void
  moveCard: (itemId: string, boardId: string, laneId: string, reason?: string) => MoveResult
  setItemFields: (id: string, patch: Partial<Item>) => void

  splitLane: (laneId: string, orientation: SplitOrientation) => void
  addLane: (parentId: string) => void
  removeLane: (laneId: string) => void
  renameLane: (laneId: string, name: string) => void
  setLaneWip: (laneId: string, wipLimit: number | undefined) => void

  setParent: (childId: string, parentId: string | null) => void
  addChild: (parentId: string, typeId: string, title: string) => void

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
  showDemoGuide: true,
  showTypeEditor: false,
  editMode: false,
}

/** First WIP limit in the target lane's chain that a new card would exceed. */
function firstOver(state: FlowState, laneId: string): { lane: Lane; count: number } | null {
  const self = state.lanes.find((l) => l.id === laneId)
  if (!self) return null
  const chain = [self, ...ancestorsOf(state.lanes, laneId)]
  for (const lane of chain) {
    if (lane.wipLimit === undefined) continue
    const count = laneCardCount(state.lanes, state.placements, lane.id) + 1
    if (count > lane.wipLimit) return { lane, count }
  }
  return null
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...createSeed(),
      ...initialView,

      selectBoard: (boardId) => set({ boardId, selectedItemId: null }),
      openItem: (selectedItemId) => set({ selectedItemId }),
      setSearch: (search) => set({ search }),
      toggleDemoGuide: () => set({ showDemoGuide: !get().showDemoGuide }),
      toggleTypeEditor: () => set({ showTypeEditor: !get().showTypeEditor }),
      toggleEditMode: () => set({ editMode: !get().editMode }),
      setEditMode: (v) => set({ editMode: v }),
      resetDemo: () => set({ ...createSeed(), ...initialView }),

      addIssueType: (name, color) => set({ issueTypes: [...get().issueTypes, { id: uid(), name, color }] }),
      updateIssueType: (id, patch) =>
        set({ issueTypes: get().issueTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
      removeIssueType: (id) => set({ issueTypes: get().issueTypes.filter((t) => t.id !== id) }),

      addCard: ({ boardId, typeId, laneId, title }) => {
        const item: Item = { id: uid(), title, typeId, createdAt: Date.now() }
        const placement: Placement = { id: uid(), boardId, itemId: item.id, laneId }
        set({ items: [...get().items, item], placements: [...get().placements, placement] })
      },

      moveCard: (itemId, boardId, laneId, reason) => {
        const state = get()
        const existing = state.placements.find((p) => p.itemId === itemId && p.boardId === boardId)
        if (existing && existing.laneId === laneId) return { ok: true }
        const over = firstOver(state, laneId)
        if (over && !reason) return { ok: false, needsReason: true, lane: over.lane, count: over.count }
        const placements = existing
          ? state.placements.map((p) => (p.id === existing.id ? { ...p, laneId } : p))
          : [...state.placements, { id: uid(), boardId, itemId, laneId }]
        set({
          placements,
          items: state.items.map((i) => (i.id === itemId ? { ...i, lastMoveReason: reason } : i)),
        })
        return { ok: true }
      },

      setItemFields: (id, patch) =>
        set({ items: get().items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }),

      /** Split a leaf cell into a container of the given orientation, with two sub-lanes. */
      splitLane: (laneId, orientation) => {
        const state = get()
        const lane = state.lanes.find((l) => l.id === laneId)
        if (!lane || !isLeaf(state.lanes, laneId)) return
        const c1: Lane = { id: uid(), boardId: lane.boardId, parentId: laneId, order: 0, name: 'Lane A' }
        const c2: Lane = { id: uid(), boardId: lane.boardId, parentId: laneId, order: 1, name: 'Lane B' }
        const placements = state.placements.map((p) => (p.laneId === laneId ? { ...p, laneId: c1.id } : p))
        set({
          lanes: state.lanes.map((l) => (l.id === laneId ? { ...l, orientation } : l)).concat([c1, c2]),
          placements,
        })
      },

      addLane: (parentId) => {
        const state = get()
        const parent = state.lanes.find((l) => l.id === parentId)
        if (!parent) return
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
      version: 1,
      partialize: (s) => ({
        issueTypes: s.issueTypes,
        boards: s.boards,
        lanes: s.lanes,
        items: s.items,
        placements: s.placements,
        edges: s.edges,
        objectives: s.objectives,
        keyResults: s.keyResults,
        sponsors: s.sponsors,
        boardId: s.boardId,
      }),
    },
  ),
)
