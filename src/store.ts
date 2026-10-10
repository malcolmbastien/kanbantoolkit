import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { applicableLimit } from '@/domain/derive'
import { createSeed } from '@/domain/seed'
import type {
  Edge,
  FlowState,
  Item,
  ItemType,
  LimitPolicy,
  Resolution,
  SponsorDecision,
} from '@/domain/types'

export type MoveResult =
  | { ok: true }
  | { ok: false; needsReason: true; policy: LimitPolicy; count: number }
  | { ok: false; blocked: true; policy: LimitPolicy; count: number }

export interface ViewState {
  boardId: string
  resolution: Resolution
  scopeId: string
  selectedItemId: string | null
  search: string
  showDemoGuide: boolean
}

interface Actions {
  selectBoard: (boardId: string) => void
  setResolution: (r: Resolution) => void
  setScope: (scopeId: string) => void
  openItem: (id: string | null) => void
  setSearch: (q: string) => void
  toggleDemoGuide: () => void
  resetDemo: () => void

  moveItem: (id: string, toState: string, reason?: string) => MoveResult
  addEpic: (valueStreamId: string, teamId: string | null, title: string, reason?: string) => MoveResult
  addStory: (parentId: string, title: string) => void
  addItem: (partial: {
    type: ItemType
    valueStreamId: string
    teamId: string | null
    title: string
    state?: string
  }) => void
  setItemFields: (id: string, patch: Partial<Item>) => void

  raiseDependency: (blockerId: string, dependentId: string, pinTo?: string, reason?: string) => void
  confirmDependency: (edgeId: string) => void
  rejectDependency: (edgeId: string, reason: string) => void
  setAttribution: (itemId: string, objectiveId: string, on: boolean) => void

  confirmSponsor: (initiativeId: string, decision: SponsorDecision, reason?: string) => void
}

export type Store = FlowState & ViewState & Actions

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

const initialView: ViewState = {
  boardId: 'b-core-epics',
  resolution: 'L2',
  scopeId: 'vs-core',
  selectedItemId: null,
  search: '',
  showDemoGuide: true,
}

/** Count items of a type in a scope for a flow limit (no column = whole scope). */
function countForLimit(state: FlowState, policy: LimitPolicy, scopeId: string | null): number {
  return state.items.filter(
    (i) =>
      i.type === policy.itemType &&
      (scopeId === null || i.valueStreamId === scopeId) &&
      (policy.column === undefined || i.state === policy.column),
  ).length
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...createSeed(),
      ...initialView,

      selectBoard: (boardId) => {
        const board = get().boards.find((b) => b.id === boardId)
        if (!board) return
        set({ boardId, resolution: board.resolution, scopeId: board.scopeId, selectedItemId: null })
      },
      setResolution: (resolution) => set({ resolution }),
      setScope: (scopeId) => set({ scopeId }),
      openItem: (selectedItemId) => set({ selectedItemId }),
      setSearch: (search) => set({ search }),
      toggleDemoGuide: () => set({ showDemoGuide: !get().showDemoGuide }),
      resetDemo: () => set({ ...createSeed(), ...initialView }),

      moveItem: (id, toState, reason) => {
        const state = get()
        const item = state.items.find((i) => i.id === id)
        if (!item) return { ok: true }

        const policy = applicableLimit(
          state.limits,
          item.type === 'initiative' ? 'L1' : item.type === 'epic' ? 'L2' : 'L3',
          item.type,
          item.valueStreamId,
          toState,
        )
        if (policy && (policy.enforcement === 'soft_block' || policy.enforcement === 'hard_block')) {
          const count = countForLimit(state, policy, item.valueStreamId)
          if (count >= policy.limit && item.state !== toState) {
            if (policy.enforcement === 'hard_block') return { ok: false, blocked: true, policy, count }
            if (!reason) return { ok: false, needsReason: true, policy, count }
          }
        }
        const isDone = ['Done', 'Committed'].includes(toState)
        set({
          items: state.items.map((i) =>
            i.id === id
              ? {
                  ...i,
                  state: toState,
                  resolvedAt: isDone ? Date.now() : null,
                  lastMoveReason: reason,
                }
              : i,
          ),
        })
        return { ok: true }
      },

      addEpic: (valueStreamId, teamId, title, reason) => {
        const state = get()
        const policy = applicableLimit(state.limits, 'L2', 'epic', valueStreamId)
        if (policy && (policy.enforcement === 'soft_block' || policy.enforcement === 'hard_block')) {
          const count = countForLimit(state, policy, valueStreamId)
          if (count >= policy.limit) {
            if (policy.enforcement === 'hard_block') return { ok: false, blocked: true, policy, count }
            if (!reason) return { ok: false, needsReason: true, policy, count }
          }
        }
        const it: Item = {
          id: uid(),
          title,
          type: 'epic',
          valueStreamId,
          teamId,
          state: 'Backlog',
          createdAt: Date.now(),
          lastMoveReason: reason,
        }
        set({ items: [...state.items, it] })
        return { ok: true }
      },

      addItem: ({ type, valueStreamId, teamId, title, state: initState }) => {
        const it: Item = {
          id: uid(),
          title,
          type,
          valueStreamId,
          teamId,
          state: initState ?? 'Backlog',
          createdAt: Date.now(),
        }
        set({ items: [...get().items, it] })
      },

      addStory: (parentId, title) => {
        const state = get()
        const parent = state.items.find((i) => i.id === parentId)
        if (!parent) return
        const it: Item = {
          id: uid(),
          title,
          type: 'story',
          valueStreamId: parent.valueStreamId,
          teamId: parent.teamId ?? null,
          state: 'Backlog',
          createdAt: Date.now(),
        }
        const edge: Edge = { id: uid(), kind: 'decomposition', from: parentId, to: it.id }
        set({ items: [...state.items, it], edges: [...state.edges, edge] })
      },

      setItemFields: (id, patch) =>
        set({ items: get().items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }),

      raiseDependency: (blockerId, dependentId, pinTo, reason) => {
        if (blockerId === dependentId) return
        const state = get()
        const exists = state.edges.some(
          (e) => e.kind === 'dependency' && e.from === blockerId && e.to === dependentId,
        )
        if (exists) return
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
          set({
            edges: [
              ...state.edges,
              { id: uid(), kind: 'attribution', from: objectiveId, to: itemId },
            ],
          })
        } else if (!on && existing) {
          set({ edges: state.edges.filter((e) => e.id !== existing.id) })
        }
      },

      confirmSponsor: (initiativeId, decision, reason) => {
        const state = get()
        const stateFor: Record<SponsorDecision, string> = {
          committed: 'Committed',
          rejected: 'Rejected',
          dormant: 'Dormant',
        }
        set({
          items: state.items.map((i) =>
            i.id === initiativeId
              ? { ...i, state: stateFor[decision], resolvedAt: decision === 'committed' ? Date.now() : null }
              : i,
          ),
          sponsors: {
            ...state.sponsors,
            [initiativeId]: { decision, reason, at: Date.now() },
          },
        })
      },
    }),
    {
      name: 'flowline-state',
      version: 1,
      partialize: (s) => ({
        scopes: s.scopes,
        items: s.items,
        edges: s.edges,
        objectives: s.objectives,
        keyResults: s.keyResults,
        limits: s.limits,
        boards: s.boards,
        sponsors: s.sponsors,
        boardId: s.boardId,
        resolution: s.resolution,
        scopeId: s.scopeId,
      }),
    },
  ),
)
