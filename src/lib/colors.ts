import type { ItemType, Scope } from '@/domain/types'

/** Left-edge stripe colour by value stream. Stable per id. */
const STREAM_COLORS = [
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

export const TYPE_STYLES: Record<ItemType, { label: string; pill: string; dot: string }> = {
  initiative: {
    label: 'Initiative',
    pill: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    dot: 'bg-indigo-500',
  },
  epic: {
    label: 'Epic',
    pill: 'bg-violet-50 text-violet-700 ring-violet-200',
    dot: 'bg-violet-500',
  },
  story: {
    label: 'Story',
    pill: 'bg-sky-50 text-sky-700 ring-sky-200',
    dot: 'bg-sky-500',
  },
  defect: {
    label: 'Defect',
    pill: 'bg-rose-50 text-rose-700 ring-rose-200',
    dot: 'bg-rose-500',
  },
}

export const DEP_STATE_STYLES: Record<string, { label: string; className: string }> = {
  Closed: { label: 'Closed', className: 'bg-slate-100 text-slate-500 ring-slate-200' },
  Satisfied: { label: 'Satisfied', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  OpenPlanningRisk: {
    label: 'Open · planning risk',
    className: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
  OpenLiveBlockage: {
    label: 'Open · live blockage',
    className: 'bg-rose-50 text-rose-700 ring-rose-200',
  },
  Void: { label: 'Void', className: 'bg-zinc-100 text-zinc-500 ring-zinc-200' },
}
