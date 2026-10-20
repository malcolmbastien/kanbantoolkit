import { RefreshCw } from 'lucide-react'
import { useTabSync } from '@/lib/tabSync'

/**
 * A tab that has been overtaken says so, and has stopped saving over the newer workspace.
 *
 * This is the one case the channel cannot smooth over: two tabs wrote at the same moment, or this
 * one was asleep while another changed the workspace. Reloading is the way back — offered, never
 * performed, because a reload throws away whatever is on screen and that is the person's call.
 */
export function StaleTabBanner() {
  const stale = useTabSync((s) => s.stale)
  if (!stale) return null
  return (
    <div
      data-stale-banner
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-indigo-200 bg-indigo-50 px-3 py-2 text-meta text-indigo-900"
    >
      <RefreshCw size={14} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">This workspace changed in another tab.</strong> This tab is
        out of date, so it is not saving over the newer one. Reload to pick up where the other tab
        left off.
      </span>
      <button
        onClick={() => window.location.reload()}
        className="flex shrink-0 items-center gap-1 rounded-md border border-indigo-300 bg-white px-2.5 py-1 font-semibold text-indigo-800 transition hover:border-indigo-400 hover:bg-indigo-100"
        title="Reload this tab to use the workspace the other tab saved"
      >
        <RefreshCw size={13} /> Reload
      </button>
    </div>
  )
}
