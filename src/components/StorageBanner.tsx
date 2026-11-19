import { AlertTriangle, Download } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { downloadWorkspace } from '@/lib/exportWorkspace'
import { useStorageStatus } from '@/lib/storage'

/**
 * The one thing the app must never be quiet about: work it cannot keep.
 *
 * What "cannot keep" means depends on where the workspace lives. On a static host this browser *is*
 * the storage, so a failed write is the work itself. On an instance the server has the work and
 * this browser holds a cache: a cache that will not write costs a round trip after a reload, not a
 * change — so it is not worth an alarm, and saying "changes are not being saved" there would be
 * false. The one failure that can cost somebody work on an instance is the queue of changes that
 * have not reached the server yet, and that is what the banner says when it happens.
 *
 * There is deliberately no dismiss button — a warning with a close button is a warning that gets
 * closed — and the way out is offered in one action, because the next thing the person should do
 * is take a copy while the change is still in memory.
 */
export function StorageBanner() {
  const signedIn = useAuth((s) => Boolean(s.user))
  const cacheFailed = useStorageStatus((s) => s.failed)
  const queueFailed = useStorageStatus((s) => s.queueFailed)
  if (signedIn ? !queueFailed : !cacheFailed) return null
  return (
    <div
      data-storage-banner
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rose-200 bg-rose-50 px-3 py-2 text-meta text-rose-900"
    >
      <AlertTriangle size={14} className="shrink-0" />
      <span className="min-w-0 flex-1">
        {signedIn ? (
          <>
            <strong className="font-semibold">Changes waiting to be sent could not be stored.</strong>{' '}
            This browser cannot keep them, so they may be lost if you reload or close this tab. Keep
            it open until they reach the server, and export a copy if you have to leave.
          </>
        ) : (
          <>
            <strong className="font-semibold">Changes are not being saved.</strong> This browser has
            run out of room for this workspace, or is refusing to store it. Export a copy now —
            anything changed since the last save will be gone after a reload.
          </>
        )}
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
