import { ChartNoAxesGantt } from 'lucide-react'

/**
 * The board's initiatives laid out over time.
 *
 * The routing, the toggle and the workspace link exist; the frame itself — axis, today marker,
 * bars from the layout function — is the next subtask. This stub exists so `?view=timeline`
 * resolves to something honest rather than falling through to the board.
 */
export function TimelineView() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <ChartNoAxesGantt size={20} className="text-slate-400" />
        <h2 className="text-title font-semibold text-slate-800">Timeline</h2>
        <p className="text-meta text-slate-600">This board's initiatives laid out over time — the axis is on its way.</p>
      </div>
    </div>
  )
}
