import type { BoardBand, Objective, Stage } from '@/domain/types'

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const DEP_STATE_STYLES: Record<string, { label: string; className: string }> = {
  Closed: { label: 'Closed', className: 'bg-slate-200 text-slate-600 ring-slate-300' },
  Satisfied: { label: 'Satisfied', className: 'bg-emerald-100 text-emerald-800 ring-emerald-300' },
  OpenPlanningRisk: {
    label: 'Open · planning risk',
    className: 'bg-amber-100 text-amber-800 ring-amber-300',
  },
  OpenLiveBlockage: {
    label: 'Open · live blockage',
    className: 'bg-rose-100 text-rose-800 ring-rose-300',
  },
}

/** Objective status chip. */
export const OBJECTIVE_STATUS_STYLES: Record<Objective['status'], string> = {
  active: 'bg-indigo-100 text-indigo-700 ring-indigo-200',
  scored: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
}

/** A readable text/edge colour from an arbitrary type colour (dark text on light tints). */
export function readableOn(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#0f172a' : '#ffffff'
}

/** Solid-ish chip styling for a stage (used on lane headers). */
export function stageChip(stage: Stage): string {
  switch (stage) {
    case 'done':
      return 'bg-emerald-400/80 text-emerald-950'
    case 'inProgress':
      return 'bg-indigo-400/80 text-indigo-950'
    case 'notStarted':
      return 'bg-slate-400/80 text-slate-900'
    case 'backlog':
      return 'bg-amber-300/90 text-amber-950'
  }
}

/** Small card-symbol dot colour by rollup bucket. */
export const BUCKET_DOT: Record<Stage, string> = {
  backlog: 'bg-amber-400',
  notStarted: 'bg-slate-300',
  inProgress: 'bg-indigo-400',
  done: 'bg-emerald-500',
}

/** Top accent colour for a top-level column, by workflow stage. */
export const STAGE_ACCENT: Record<Stage, string> = {
  backlog: '#fbbf24',
  notStarted: '#94a3b8',
  inProgress: '#818cf8',
  done: '#34d399',
}

/**
 * A lane body, tinted by the stage it belongs to. The stage is then legible from the
 * column itself rather than from a label — and it is the *column's* stage, so a team
 * splitting a column into cells does not lose it.
 */
export const STAGE_SURFACE: Record<Stage, string> = {
  backlog: 'bg-slate-200/60',
  notStarted: 'bg-slate-200/60',
  inProgress: 'bg-indigo-50/70',
  done: 'bg-emerald-50/60',
}

/** The lane's count, as a pill at the header's right edge. */
export const STAGE_PILL: Record<Stage, string> = {
  backlog: 'bg-slate-700 text-white',
  notStarted: 'bg-slate-700 text-white',
  inProgress: 'bg-indigo-600 text-white',
  done: 'bg-emerald-600 text-white',
}

/** The dot that marks a lane's stage in its header. */
export const STAGE_DOT: Record<Stage, string> = {
  backlog: 'bg-amber-500',
  notStarted: 'bg-slate-400',
  inProgress: 'bg-indigo-600',
  done: 'bg-emerald-600',
}

/** A lane header when the column is at or over its WIP limit — the tint always wins. */
export const WIP_HEADER = {
  over: 'border-rose-300 bg-rose-600 text-white',
  at: 'border-amber-300 bg-amber-500 text-white',
} as const

/**
 * The accent a board's initiative surfaces wear. It follows the band badge so the
 * flight level reads from the work itself: Team = green, Program = blue,
 * Portfolio = violet.
 */
export const BAND_ACCENT: Record<
  BoardBand,
  {
    section: string
    header: string
    subtitle: string
    column: string
    columnHeader: string
    columnCount: string
    /** The dot that opens a workflow's section bar. */
    dot: string
    /** The rule under a workflow's section bar. */
    rule: string
  }
> = {
  team: {
    section: 'border-emerald-300 bg-emerald-50/60',
    header: 'border-emerald-300 bg-emerald-800',
    subtitle: 'text-emerald-200',
    column: 'border-emerald-200 bg-emerald-50/70',
    columnHeader: 'bg-emerald-700 text-white',
    columnCount: 'text-emerald-200',
    dot: 'bg-emerald-600',
    rule: 'border-emerald-200',
  },
  program: {
    section: 'border-sky-300 bg-sky-50/60',
    header: 'border-sky-300 bg-sky-800',
    subtitle: 'text-sky-200',
    column: 'border-sky-200 bg-sky-50/70',
    columnHeader: 'bg-sky-700 text-white',
    columnCount: 'text-sky-200',
    dot: 'bg-sky-600',
    rule: 'border-sky-200',
  },
  portfolio: {
    section: 'border-violet-300 bg-violet-50/60',
    header: 'border-violet-300 bg-violet-800',
    subtitle: 'text-violet-200',
    column: 'border-violet-200 bg-violet-50/70',
    columnHeader: 'bg-violet-700 text-white',
    columnCount: 'text-violet-200',
    dot: 'bg-violet-600',
    rule: 'border-violet-200',
  },
}
