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
  const waiting = useSync((state) => state.waiting)
  const overflow = useSync((state) => state.overflow)

  // A refusal is the loudest thing here: it is an edit somebody made that did not land.
  if (refusals.length) {
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

  if (overflow) {
    return (
      <span
        title="Too many changes are waiting for a connection, so this one was not held. It is still in this browser."
        className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-meta font-medium text-amber-800"
      >
        <AlertTriangle size={13} /> Not saved
      </span>
    )
  }

  if (unreachable || waiting) {
    return (
      <span
        title="The server could not be reached. These changes are held here and will be sent in order when it is back."
        className="flex items-center gap-1 rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-meta font-medium text-slate-700"
      >
        <CloudOff size={13} /> {waiting ? `${waiting} waiting` : 'Not saving'}
      </span>
    )
  }

  return null
}
