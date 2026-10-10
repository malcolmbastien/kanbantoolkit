import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { laneCardCount, subtreeIds } from '@/domain/lanes'
import { createSeed } from '@/domain/seed'
import type {
  Edge,
  FlowState,
  IssueType,
  Item,
  Lane,
  Placement,
} from '@/domain/types'

export type MoveResult =
  | { ok: true }
  | { ok: false; needsReason: true; lane: Lane; count: number }
  | { ok: false; blocked: true; lane: Lane; count: number }

export interface ViewState {
  boardId: string
  selectedItemId: string | null
  search: string
  showDemoGuide: boolean
  showTypeEditor: boolean
}

export interface Actions {
  selectBoard: (id: string) => void
  openItem: (id: string | null) => void
  setSearch: (q: string) => void
  toggleDemoGuide: () => void
  toggleTypeEditor: () => void
  resetDemo: () => void

  addIssueType: (name: string, color: string) => void
  updateIssueType: (id: string, patch: Partial<IssueType>) => void
  removeIssueType: (id: string) => void

  addCard: (input: {
    boardId: string
    typeId: string
    columnLaneId: string
    rowLaneId: string | null
    title: string
  }) => void
  moveCard: (
    itemId: string,
    boardId: string,
    columnLaneId: string,
    rowLaneId: string | null,
    reason?: string,
  ) => MoveResult
  setItemFields: (id: string, patch: Partial<Item>) => void

  splitLane: (laneId: string) => void
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
}

function laneOver(state: FlowState, laneId: string): { lane: Lane; count: number } | null {
  const lane = state.lanes.find((l) => l.id === laneId)
  if (!lane || lane.wipLimit === undefined) return null
  const count = laneCardCount(state.lanes, state.placements, laneId, lane.axis)
  return { lane, count: count + 1 }
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
      resetDemo: () => set({ ...createSeed(), ...initialView }),

      addIssueType: (name, color) =>
        set({ issueTypes: [...get().issueTypes, { id: uid(), name, color }] }),
      updateIssueType: (id, patch) =>
        set({ issueTypes: get().issueTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
      removeIssueType: (id) =>
        set({ issueTypes: get().issueTypes.filter((t) => t.id !== id) }),

      addCard: ({ boardId, typeId, columnLaneId, rowLaneId, title }) => {
        const item: Item = { id: uid(), title, typeId, createdAt: Date.now() }
        const placement: Placement = { id: uid(), boardId, itemId: item.id, columnLaneId, rowLaneId }
        set({ items: [...get().items, item], placements: [...get().placements, placement] })
      },

      moveCard: (itemId, boardId, columnLaneId, rowLaneId, reason) => {
        const state = get()
        const existing = state.placements.find((p) => p.itemId === itemId && p.boardId === boardId)
        const moved = existing && existing.columnLaneId === columnLaneId && existing.rowLaneId === rowLaneId

        if (!moved) {
          for (const lid of [columnLaneId, rowLaneId].filter(Boolean) as string[]) {
            const over = laneOver(state, lid)
            if (over && over.count > (over.lane.wipLimit ?? Infinity)) {
              if (!reason) return { ok: false, needsReason: true, lane: over.lane, count: over.count }
            }
          }
        }

        const placements = existing
          ? state.placements.map((p) =>
              p.id === existing.id ? { ...p, columnLaneId, rowLaneId } : p,
            )
          : [...state.placements, { id: uid(), boardId, itemId, columnLaneId, rowLaneId }]
        set({
          placements,
          items: state.items.map((i) => (i.id === itemId ? { ...i, lastMoveReason: reason } : i)),
        })
        return { ok: true }
      },

      setItemFields: (id, patch) =>
        set({ items: get().items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }),

      splitLane: (laneId) => {
        const state = get()
        const lane = state.lanes.find((l) => l.id === laneId)
        if (!lane) return
        const childCount = state.lanes.filter((l) => l.parentId === laneId).length
        const c1: Lane = { id: uid(), boardId: lane.boardId, axis: lane.axis, parentId: laneId, name: `${lane.name} A`, order: childCount }
        const c2: Lane = { id: uid(), boardId: lane.boardId, axis: lane.axis, parentId: laneId, name: `${lane.name} B`, order: childCount + 1 }
        // Reassign any cards currently in the lane's subtree to the first child.
        const ids = new Set(subtreeIds(state.lanes, laneId))
        const placements = state.placements.map((p) => {
          if (lane.axis === 'vertical')
            return ids.has(p.columnLaneId) ? { ...p, columnLaneId: c1.id } : p
          return p.rowLaneId && ids.has(p.rowLaneId) ? { ...p, rowLaneId: c1.id } : p
        })
        set({ lanes: [...state.lanes, c1, c2], placements })
      },

      renameLane: (laneId, name) =>
        set({ lanes: get().lanes.map((l) => (l.id === laneId ? { ...l, name } : l)) }),

      setLaneWip: (laneId, wipLimit) =>
        set({ lanes: get().lanes.map((l) => (l.id === laneId ? { ...l, wipLimit } : l)) }),

      setParent: (childId, parentId) => {
        const state = get()
        // exactly one parent: drop any existing decomposition parent of the child.
        let edges = state.edges.filter((e) => !(e.kind === 'decomposition' && e.to === childId))
        if (parentId && parentId !== childId) {
          edges = [...edges, { id: uid(), kind: 'decomposition', from: parentId, to: childId }]
        }
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
        const edge: Edge = {
          id: uid(),
          kind: 'dependency',
          from: blockerId,
          to: dependentId,
          dep: { fsKind: 'FS', status: 'proposed', pinTo, reason },
        }
        set({ edges: [...state.edges, edge] })
      },

      confirmDependency: (edgeId) =>
        set({
          edges: get().edges.map((e) =>
            e.id === edgeId && e.dep ? { ...e, dep: { ...e.dep, status: 'confirmed' } } : e,
          ),
        }),

      rejectDependency: (edgeId, reason) =>
        set({
          edges: get().edges.map((e) =>
            e.id === edgeId && e.dep ? { ...e, dep: { ...e.dep, status: 'rejected', reason } } : e,
          ),
        }),

      setAttribution: (itemId, objectiveId, on) => {
        const state = get()
        const existing = state.edges.find(
          (e) => e.kind === 'attribution' && e.from === objectiveId && e.to === itemId,
        )
        if (on && !existing) {
          set({ edges: [...state.edges, { id: uid(), kind: 'attribution', from: objectiveId, to: itemId }] })
        } else if (!on && existing) {
          set({ edges: state.edges.filter((e) => e.id !== existing.id) })
        }
      },
    }),
    {
      name: 'flowline-state-v2',
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
