import { AlertTriangle, Download } from 'lucide-react'
import { downloadWorkspace } from '@/lib/exportWorkspace'
import { useStorageStatus } from '@/lib/storage'

/**
 * The one thing the app must never be quiet about: it cannot save.
 *
 * There is deliberately no dismiss button — a warning with a close button is a warning that gets
 * closed — and the way out is offered in one action, because the next thing the person should do
 * is take a copy while the workspace is still in memory.
 */
export function StorageBanner() {
  const failed = useStorageStatus((s) => s.failed)
  if (!failed) return null
  return (
    <div
      data-storage-banner
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rose-200 bg-rose-50 px-3 py-2 text-meta text-rose-900"
    >
      <AlertTriangle size={14} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">Changes are not being saved.</strong> This browser has run
        out of room for this workspace, or is refusing to store it. Export a copy now — anything
        changed since the last save will be gone after a reload.
      </span>
      <button
        onClick={downloadWorkspace}
        className="flex shrink-0 items-center gap-1 rounded-md border border-rose-300 bg-white px-2.5 py-1 font-semibold text-rose-800 transition hover:border-rose-400 hover:bg-rose-100"
        title="Download the workspace as a JSON file"
      >
        <Download size={13} /> Export workspace
      </button>
    </div>
  )
}
