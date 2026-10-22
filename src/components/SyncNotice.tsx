import { AlertTriangle, CloudOff } from 'lucide-react'
import { useSync } from '@/lib/sync'

/**
 * Saying that a change did not land.
 *
 * A refusal is not a failure of the app: someone else moved the card first, the server said so, and
 * the card now shows their version. What must not happen is that the edit quietly disappears, so it
 * is named here until a later write for that card succeeds. Nothing is retried and nothing is
 * merged — the words are kept for task 121, which is where a person decides what to do with them.
 */
export function SyncNotice() {
  const refusals = useSync((state) => state.refusals)
  const unreachable = useSync((state) => state.unreachable)

  if (unreachable) {
    return (
      <span
        title="The server could not be reached, so this change is only in this browser."
        className="flex items-center gap-1 rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-meta font-medium text-slate-700"
      >
        <CloudOff size={13} /> Not saving
      </span>
    )
  }

  if (!refusals.length) return null

  const latest = refusals[refusals.length - 1]
  const count = refusals.length === 1 ? '1 change' : `${refusals.length} changes`

  return (
    <span
      title={`${latest.title} was changed elsewhere, so this edit was not applied. The card shows the newer version.`}
      className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-meta font-medium text-amber-800"
    >
      <AlertTriangle size={13} /> {count} refused
    </span>
  )
}
