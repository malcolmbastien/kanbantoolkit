import { useEffect, useState } from 'react'
import { PeoplePanel } from './PeoplePanel'
import { InvitationsPanel } from './InvitationsPanel'
import { WorkspacePanel } from './WorkspacePanel'
import { ConnectAgent } from './ConnectAgent'
import { AuditPanel, HealthPanel } from './AuditPanels'
import { AccessPanel } from './AccessPanel'
import { GroupsPanel } from './GroupsPanel'
import { useAuth } from '@/lib/auth'
import { ArrowLeft, History } from 'lucide-react'
import { listSnapshots, readSnapshot, writeSnapshot, type SnapshotMeta } from '@/lib/snapshots'
import { PERSIST_VERSION, persistedSlice, useStore } from '@/store'

/**
 * Admin: the workspace without a board in front of it.
 *
 * It answers a different question from every other screen — not "what is the work doing" but
 * "what does this browser hold, and what would it do with it" — which is why the snapshot ring
 * lives here rather than beside the board list. Export and import stay in the workspace, where
 * the file belongs.
 */
export function AdminView() {
  // The People section exists only where there is somebody to administer: a session, and the
  // instance administrator's role. Without a server the rest of this screen is exactly as it was.
  const admin = useAuth((s) => s.user?.instanceRole === 'admin')
  // The workspace's own administration is a different door: its administrators see it whether or
  // not they run the instance.
  const workspaceAdmin = useAuth((s) => s.user?.role === 'admin' || s.user?.instanceRole === 'admin')
  const importWorkspace = useStore((s) => s.importWorkspace)
  const setView = useStore((s) => s.setView)
  const askConfirm = useStore((s) => s.askConfirm)
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([])
  const [snapshotError, setSnapshotError] = useState<string | null>(null)

  useEffect(() => {
    void listSnapshots().then(setSnapshots)
  }, [])

  const restoreSnapshot = async (meta: SnapshotMeta) => {
    const snap = await readSnapshot(meta.id)
    if (!snap) {
      setSnapshotError('That snapshot cannot be read, so nothing was changed.')
      return
    }
    setSnapshotError(null)
    askConfirm({
      title: `Restore the workspace from ${new Date(snap.at).toLocaleString()}?`,
      body: 'This replaces the current workspace with that copy. A snapshot of the current state is kept first, so the restore can itself be undone.',
      confirmLabel: 'Restore',
      danger: true,
      onConfirm: () => {
        // The undo point: taken from the workspace as it stands, before the copy replaces it.
        void writeSnapshot(persistedSlice(useStore.getState()), PERSIST_VERSION)
        importWorkspace(snap.state, snap.version)
        void listSnapshots().then(setSnapshots)
      },
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-slate-200 p-4">
      <div className="mx-auto w-full max-w-4xl">
        {/* Admin is entered from the workspace and only from there, so it says how to get back. */}
        <button
          onClick={() => setView('boards')}
          className="flex items-center gap-1 text-meta font-medium text-slate-600 transition hover:text-indigo-700"
          title="Back to every board in the organisation"
        >
          <ArrowLeft size={13} /> Boards
        </button>
        <h1 className="mt-1 text-title font-semibold tracking-tight text-slate-900">Admin</h1>
        {/* The workspace's own administration — its name, its people, and the end of it. */}
        {workspaceAdmin && <WorkspacePanel />}
        {admin && <AccessPanel />}
        {admin && <PeoplePanel />}
        {admin && <InvitationsPanel />}
        {/* Groups sit beside the people who hold roles directly: the same authority, written once
            for several people. */}
        {admin && <GroupsPanel />}
        {/* The trail is read by whoever administers: an instance administrator reads all of it, a
            workspace administrator reads the events their own routes wrote. */}
        {workspaceAdmin && <AuditPanel />}
        {admin && <HealthPanel />}

        {/* A credential for a tool, made here rather than copied from a chat message: the scopes
            are chosen in words, and the config is produced by the instance that knows its own URL. */}
        <ConnectAgent />
        <p className="mt-0.5 text-meta text-slate-600">
          This workspace lives in this browser. The copies below are what it keeps of itself, so a
          mistake is a moment rather than a loss.
        </p>

        {/* Snapshots — the last twenty copies of the workspace. A copy of the current state is
            taken before a restore, which is what makes the restore itself undoable. */}
        <section data-snapshots className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-3">
          <div className="flex items-center gap-1.5 text-meta font-bold uppercase tracking-wide text-slate-600">
            <History size={12} /> Snapshots
          </div>
          <p className="mt-0.5 text-meta text-slate-600">
            A copy is kept every minute while you work — the last 20. They live in this browser,
            so clearing its data removes them too; use Export for something that travels.
          </p>
          {snapshotError && <p className="mt-1 text-meta font-medium text-rose-600">{snapshotError}</p>}
          {snapshots.length === 0 ? (
            <p className="mt-1.5 text-meta text-slate-600">
              No snapshots yet. One is written a minute after you start changing the workspace.
            </p>
          ) : (
            <ul className="mt-1.5 max-h-80 divide-y divide-slate-100 overflow-auto rounded border border-slate-200">
              {snapshots.map((snap) => (
                <li key={snap.id} className="flex items-center gap-2 px-2 py-1 text-meta">
                  <span className="min-w-0 flex-1 truncate text-slate-700" title={new Date(snap.at).toLocaleString()}>
                    {when(snap.at)}
                  </span>
                  <button
                    onClick={() => void restoreSnapshot(snap)}
                    className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
                    title={`Restore the workspace as it was at ${new Date(snap.at).toLocaleString()}`}
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

/** How long ago a copy was taken, in the words a person uses. The exact time is on the title. */
function when(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(at).toLocaleString()
}
