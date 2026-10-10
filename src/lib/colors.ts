import type { ItemType, Scope } from '@/domain/types'

/** Left-edge stripe / tint colour by value stream. Stable per id. */
export const STREAM_COLORS = [
  '#6366f1', // indigo
  '#0ea5e9', // sky
  '#14b8a6', // teal
  '#f59e0b', // amber
  '#ec4899', // pink
  '#8b5cf6', // violet
]

export function streamColor(valueStreamId: string, scopes: Scope[]): string {
  const streams = scopes.filter((s) => s.kind === 'value_stream')
  const idx = Math.max(0, streams.findIndex((s) => s.id === valueStreamId))
  return STREAM_COLORS[idx % STREAM_COLORS.length]
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const TYPE_STYLES: Record<
  ItemType,
  { label: string; chip: string; pill: string; dot: string }
> = {
  initiative: {
    label: 'Initiative',
    chip: 'bg-indigo-600 text-white',
    pill: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    dot: 'bg-indigo-500',
  },
  epic: {
    label: 'Epic',
    chip: 'bg-violet-600 text-white',
    pill: 'bg-violet-50 text-violet-700 ring-violet-200',
    dot: 'bg-violet-500',
  },
  story: {
    label: 'Story',
    chip: 'bg-sky-600 text-white',
    pill: 'bg-sky-50 text-sky-700 ring-sky-200',
    dot: 'bg-sky-500',
  },
  defect: {
    label: 'Defect',
    chip: 'bg-rose-600 text-white',
    pill: 'bg-rose-50 text-rose-700 ring-rose-200',
    dot: 'bg-rose-500',
  },
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
  Void: { label: 'Void', className: 'bg-zinc-200 text-zinc-600 ring-zinc-300' },
}
