import type { ObjectiveStatus } from './types'

/**
 * The objective's lifecycle, in the order a person reads it.
 *
 * `reviewed` and the older `scored` named the state after a period had been reviewed and closed.
 * They are the same state the app now calls **Archived**, so old data is read into it rather than
 * being a status the new vocabulary cannot name.
 */
export const OBJECTIVE_STATUSES: ObjectiveStatus[] = ['draft', 'active', 'archived', 'cancelled']

export const OBJECTIVE_STATUS_LABELS: Record<ObjectiveStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
  cancelled: 'Cancelled',
}

export function normalizeObjectiveStatus(raw: unknown): ObjectiveStatus {
  if (raw === 'draft' || raw === 'active' || raw === 'archived' || raw === 'cancelled') return raw
  if (raw === 'reviewed' || raw === 'scored') return 'archived'
  return 'active'
}
