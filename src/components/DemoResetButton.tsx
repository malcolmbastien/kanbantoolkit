/**
 * Start the demo over, from the workspace home.
 *
 * The reset replaces the whole workspace, so it is not a board action and does not sit on a board's
 * toolbar. A snapshot is taken first, which is what makes the act reversible from the workspace
 * data screen.
 */
import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { writeSnapshot } from '@/lib/snapshots'
import { PERSIST_VERSION, persistedSlice, useStore } from '@/store'

export function DemoResetButton() {
  const resetDemo = useStore((s) => s.resetDemo)
  const askConfirm = useStore((s) => s.askConfirm)
  const [busy, setBusy] = useState(false)

  return (
    <button
      disabled={busy}
      onClick={() =>
        askConfirm({
          title: 'Start the demo over?',
          body: 'The demo workspace replaces every board, lane and card here. A snapshot is taken first.',
          confirmLabel: 'Reset the demo',
          danger: true,
          onConfirm: () => {
            // The undo point is taken first, but the reset does not wait for that write: the person
            // asked for a fresh demo, and the snapshot is the safety net rather than a gate.
            void writeSnapshot(persistedSlice(useStore.getState()), PERSIST_VERSION)
            resetDemo()
            setBusy(false)
          },
        })
      }
      className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-meta font-medium text-slate-600 transition hover:border-rose-300 hover:text-rose-700 disabled:opacity-50"
      title="Replace the demo workspace with a fresh copy"
    >
      <RotateCcw size={13} /> Reset demo data
    </button>
  )
}
