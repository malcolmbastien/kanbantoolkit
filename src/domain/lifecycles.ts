import type { ItemType, Resolution } from './types'

/**
 * A lifecycle is the column set for a resolution. Scope and resolution are
 * independent: switching resolution changes BOTH the column set and the
 * counting unit, without changing scope.
 */
export interface Lifecycle {
  resolution: Resolution
  label: string
  itemTypes: ItemType[]
  states: string[]
  /** States that count as resolved (terminal-success). */
  done: string[]
  /** States that count as cancelled/void. */
  cancelled: string[]
  /** States that count as "not started" (first column / parked). */
  start: string[]
  /** Column accent colours for the dense LeanKit look. */
  accents: Record<string, string>
}

export const LIFECYCLES: Record<Resolution, Lifecycle> = {
  L1: {
    resolution: 'L1',
    label: 'Initiative',
    itemTypes: ['initiative'],
    // Dormant is a first-class state — not an archive.
    states: ['Idea', 'Option', 'Bet', 'Committed', 'Rejected', 'Dormant'],
    done: ['Committed'],
    cancelled: ['Rejected'],
    start: ['Idea', 'Option', 'Dormant'],
    accents: {
      Idea: 'bg-slate-400',
      Option: 'bg-sky-400',
      Bet: 'bg-indigo-400',
      Committed: 'bg-emerald-500',
      Rejected: 'bg-rose-500',
      Dormant: 'bg-zinc-400',
    },
  },
  L2: {
    resolution: 'L2',
    label: 'Epic',
    itemTypes: ['epic'],
    states: ['Backlog', 'Analyze', 'In Progress', 'Ready', 'Done'],
    done: ['Done'],
    cancelled: [],
    start: ['Backlog'],
    accents: {
      Backlog: 'bg-slate-400',
      Analyze: 'bg-amber-400',
      'In Progress': 'bg-indigo-500',
      Ready: 'bg-violet-500',
      Done: 'bg-emerald-500',
    },
  },
  L3: {
    resolution: 'L3',
    label: 'Story',
    itemTypes: ['story', 'defect'],
    states: ['Backlog', 'In Progress', 'Review', 'Done'],
    done: ['Done'],
    cancelled: [],
    start: ['Backlog'],
    accents: {
      Backlog: 'bg-slate-400',
      'In Progress': 'bg-indigo-500',
      Review: 'bg-amber-400',
      Done: 'bg-emerald-500',
    },
  },
}

export const RESOLUTIONS: Resolution[] = ['L1', 'L2', 'L3']

/** The resolution an item of this type is normally read at. Not stored on the item. */
export function nominalResolution(type: ItemType): Resolution {
  switch (type) {
    case 'initiative':
      return 'L1'
    case 'epic':
      return 'L2'
    case 'story':
    case 'defect':
      return 'L3'
  }
}

export function isDone(lifecycle: Lifecycle, state: string): boolean {
  return lifecycle.done.includes(state)
}

export function isCancelled(lifecycle: Lifecycle, state: string): boolean {
  return lifecycle.cancelled.includes(state)
}

export function isNotStarted(lifecycle: Lifecycle, state: string): boolean {
  return lifecycle.start.includes(state)
}
