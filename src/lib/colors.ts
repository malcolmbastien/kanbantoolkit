import type { BoardBand, Stage } from '@/domain/types'

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
  notStarted: '#22d3ee',
  inProgress: '#818cf8',
  done: '#34d399',
}

/**
 * The accent a board's initiative surfaces wear. A coordination board takes its
 * band's colour — a Program's initiatives are blue, a Portfolio's violet — so the
 * flight level reads from the work itself, not just the header badge. A team board
 * keeps the app's indigo: it renders work, not a management summary.
 */
export const BAND_ACCENT: Record<
  BoardBand,
  { section: string; header: string; subtitle: string; column: string; columnHeader: string; columnCount: string }
> = {
  team: {
    section: 'border-indigo-300 bg-indigo-50/60',
    header: 'border-indigo-300 bg-indigo-800',
    subtitle: 'text-indigo-200',
    column: 'border-indigo-200 bg-indigo-50/70',
    columnHeader: 'bg-indigo-700 text-white',
    columnCount: 'text-indigo-200',
  },
  program: {
    section: 'border-sky-300 bg-sky-50/60',
    header: 'border-sky-300 bg-sky-800',
    subtitle: 'text-sky-200',
    column: 'border-sky-200 bg-sky-50/70',
    columnHeader: 'bg-sky-700 text-white',
    columnCount: 'text-sky-200',
  },
  portfolio: {
    section: 'border-violet-300 bg-violet-50/60',
    header: 'border-violet-300 bg-violet-800',
    subtitle: 'text-violet-200',
    column: 'border-violet-200 bg-violet-50/70',
    columnHeader: 'bg-violet-700 text-white',
    columnCount: 'text-violet-200',
  },
}
