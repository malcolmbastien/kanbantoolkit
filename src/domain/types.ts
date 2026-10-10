// Flowline domain model.
//
// Everything reduces to nodes and typed edges. There is deliberately NO board
// membership field on Item: board membership is computed from scope ∩ resolution.

export type ScopeKind = 'enterprise' | 'value_stream' | 'team' | 'function'

/** Flight-level resolutions. A resolution fixes the counting unit. */
export type Resolution = 'L1' | 'L2' | 'L3'

/** Flow item types. Note: an item's *level* is derived, never stored. */
export type ItemType = 'initiative' | 'epic' | 'story' | 'defect'

export interface Scope {
  id: string
  name: string
  kind: ScopeKind
  parentId: string | null
}

export interface Item {
  id: string
  title: string
  description?: string
  type: ItemType
  /** Required: the structural spine. Membership of a board is by value stream. */
  valueStreamId: string
  /** Optional owning team; used only for lane placement, not a board field. */
  teamId?: string | null
  /** Position in this type's lifecycle (see lifecycles.ts). */
  state: string
  /** Relative size, for the size display. Not used for level. */
  size?: number
  assignee?: string
  createdAt: number
  resolvedAt?: number | null
  cancelledAt?: number | null
  /** Reason captured when a soft limit was crossed (audit trail). */
  lastMoveReason?: string
}

export type DepKind = 'FS' | 'SS' | 'FF'
export type DepStatus = 'proposed' | 'confirmed' | 'rejected'
export type EdgeKind = 'decomposition' | 'dependency' | 'attribution'

export interface DependencyDetail {
  fsKind: DepKind
  lagDays?: number
  /** Raise → confirm/reject gate. Only confirmed edges bind. */
  status: DepStatus
  reason?: string
  /** Cross-level endpoint binding: the specific descendant this edge pins to. */
  pinTo?: string
}

export interface Edge {
  id: string
  kind: EdgeKind
  /** decomposition: parent; dependency: blocker; attribution: objective. */
  from: string
  /** decomposition: child; dependency: dependent; attribution: item. */
  to: string
  dep?: DependencyDetail
}

/** Objectives and KRs are commitment-limited entities. Never in columns. */
export interface Objective {
  id: string
  title: string
  period: string
  status: 'active' | 'scored'
  score?: number
}

export interface KeyResult {
  id: string
  objectiveId: string
  title: string
}

export type Enforcement = 'visualize' | 'warn' | 'soft_block' | 'hard_block'

export interface LimitPolicy {
  id: string
  resolution: Resolution
  itemType: ItemType
  /** null = applies to every scope at this resolution. */
  scopeId: string | null
  /** Flow limits key on a column; commitment limits key on a period. */
  column?: string
  limit: number
  enforcement: Enforcement
  thresholds: { yellow: number; red: number }
  effectiveFrom: number
  effectiveUntil?: number | null
}

export interface Board {
  id: string
  name: string
  resolution: Resolution
  scopeId: string
}

export type SponsorDecision = 'committed' | 'rejected' | 'dormant'

export interface SponsorRecord {
  decision: SponsorDecision
  reason?: string
  at: number
}

export interface FlowState {
  scopes: Scope[]
  items: Item[]
  edges: Edge[]
  objectives: Objective[]
  keyResults: KeyResult[]
  limits: LimitPolicy[]
  boards: Board[]
  /** Human overrides of the computed portfolio recommendation. */
  sponsors: Record<string, SponsorRecord>
}
