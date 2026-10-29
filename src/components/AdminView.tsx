import { useEffect, useState, type KeyboardEvent } from 'react'
import { ArrowLeft, History, RotateCcw } from 'lucide-react'
import { PeoplePanel } from './PeoplePanel'
import { MembersPanel } from './MembersPanel'
import { InvitationsPanel } from './InvitationsPanel'
import { WorkspacePanel } from './WorkspacePanel'
import { ConnectAgent } from './ConnectAgent'
import { ScimPanel } from './ScimPanel'
import { AuditPanel } from './AuditPanel'
import { DangerPanel } from './DangerPanel'
import { WorkspaceDataPanel } from './WorkspaceDataPanel'
import { useAuth } from '@/lib/auth'
import { listSnapshots, readSnapshot, writeSnapshot, type SnapshotMeta } from '@/lib/snapshots'
import { PERSIST_VERSION, persistedSlice, useStore } from '@/store'
import { cn } from '@/lib/utils'

/**
 * Admin: the workspace without a board in front of it.
 *
 * It answers a different question from every other screen — not "what is the work doing" but "who
 * is here, what may they do, and what would happen if this went away" — which is why each of those
 * questions has a tab rather than a column of panels on one page.
 *
 * The tabs are the authority's: an instance administrator sees the deployment's doors, a workspace
 * administrator sees this team's people and its end, and somebody using the browser-only demo sees
 * the copies it keeps of itself. A tab that would only be able to say "not for you" is not drawn.
 */
type TabId = 'workspace' | 'people' | 'invitations' | 'audit' | 'tools' | 'snapshots' | 'data' | 'danger'

export function AdminView() {
  // The People section exists only where there is somebody to administer: a session, and the
  // instance administrator's role. Without a server the rest of this screen is exactly as it was.
  const admin = useAuth((s) => s.user?.instanceRole === 'admin')
  // The workspace's own administration is a different door: its administrators see it whether or
  // not they run the instance.
  const workspaceAdmin = useAuth((s) => s.user?.role === 'admin' || s.user?.instanceRole === 'admin')
  const setView = useStore((s) => s.setView)
  const signedIn = useAuth((s) => Boolean(s.user))

  const tabs: Array<{ id: TabId; label: string }> = [
    ...(workspaceAdmin ? [{ id: 'workspace' as const, label: 'Workspace' }] : []),
    ...(workspaceAdmin ? [{ id: 'people' as const, label: 'People' }] : []),
    ...(admin ? [{ id: 'invitations' as const, label: 'Invitations' }] : []),
    ...(workspaceAdmin ? [{ id: 'audit' as const, label: 'Audit' }] : []),
    ...(signedIn ? [{ id: 'tools' as const, label: 'Tools & agents' }] : []),
    { id: 'snapshots', label: 'Snapshots' },
    { id: 'data', label: 'Workspace data' },
    ...(workspaceAdmin ? [{ id: 'danger' as const, label: 'Danger' }] : []),
  ]

  const [tab, setTab] = useState<TabId>('workspace')
  const active = tabs.some((entry) => entry.id === tab) ? tab : (tabs[0]?.id ?? 'snapshots')

  /** Left and right walk the tabs, the way every other tab list in the app does. */
  function move(event: KeyboardEvent<HTMLElement>, index: number) {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    setTab(tabs[next].id)
    document.getElementById(`admin-tab-${tabs[next].id}`)?.focus()
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-slate-200 p-4">
      <div className="mx-auto flex w-full max-w-4xl min-h-0 flex-1 flex-col">
        {/* Admin is entered from the workspace and only from there, so it says how to get back. */}
        <button
          onClick={() => setView('boards')}
          className="flex items-center gap-1 self-start text-meta font-medium text-slate-600 transition hover:text-indigo-700"
          title="Back to every board in the organisation"
        >
          <ArrowLeft size={13} /> Boards
        </button>
        <h1 className="mt-1 text-title font-semibold tracking-tight text-slate-900">Admin</h1>

        <nav
          role="tablist"
          aria-label="Admin sections"
          className="mt-3 flex flex-wrap gap-1 border-b border-slate-300"
        >
          {tabs.map((entry, index) => (
            <button
              key={entry.id}
              id={`admin-tab-${entry.id}`}
              role="tab"
              aria-selected={active === entry.id}
              aria-controls={`admin-panel-${entry.id}`}
              tabIndex={active === entry.id ? 0 : -1}
              onClick={() => setTab(entry.id)}
              onKeyDown={(event) => move(event, index)}
              className={cn(
                '-mb-px border-b-2 px-2.5 py-1.5 text-meta font-medium',
                active === entry.id
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-600 hover:text-slate-900',
              )}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <div
          id={`admin-panel-${active}`}
          role="tabpanel"
          aria-labelledby={`admin-tab-${active}`}
          tabIndex={0}
          className="min-h-0 flex-1 pt-4 outline-none"
        >
          {active === 'workspace' && <WorkspacePanel />}
          {active === 'people' && (admin ? <PeoplePanel /> : <MembersPanel />)}
          {active === 'invitations' && <InvitationsPanel />}
          {active === 'audit' && <AuditPanel />}
          {active === 'tools' && (
            <div className="space-y-3">
              <ConnectAgent />
              {admin && <ScimPanel />}
            </div>
          )}
          {active === 'snapshots' && <SnapshotsPanel />}
          {active === 'data' && <WorkspaceDataPanel />}
          {active === 'danger' && <DangerPanel />}
        </div>
      </div>
    </div>
  )
}

/**
 * The copies this browser keeps of the workspace, and — for the demo, which has no account behind
 * it — the way back to the beginning.
 *
 * They live beside the administration because they are about the copy in this browser rather than
 * about the work: a reset is undone by the snapshot the reset itself takes.
 */
function SnapshotsPanel() {
  const importWorkspace = useStore((s) => s.importWorkspace)
  const resetDemo = useStore((s) => s.resetDemo)
  const askConfirm = useStore((s) => s.askConfirm)
  const signedIn = useAuth((s) => Boolean(s.user))
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
    <div className="space-y-3">
      <section data-snapshots className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex items-center gap-1.5 text-meta font-bold uppercase tracking-wide text-slate-600">
          <History size={12} /> Snapshots
        </div>
        <p className="mt-0.5 text-meta text-slate-600">
          A copy is kept every minute while you work — the last 20. They live in this browser, so
          clearing its data removes them too; use Export for something that travels.
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

      {/* The demo, made fresh again. It lives here rather than on the board's toolbar because it is
          not a thing you do to a board: it replaces the whole workspace this browser holds. */}
      {!signedIn && (
        <section data-demo-reset className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
          <div className="flex items-center gap-1.5 text-meta font-bold uppercase tracking-wide text-slate-600">
            <RotateCcw size={12} /> Demo data
          </div>
          <p className="mt-0.5 text-meta text-slate-600">
            Start the demo over: its boards, cards and people, exactly as a fresh browser opens it.
            What is here now is replaced, and a snapshot of it is kept first, so the reset itself can
            be undone from the list above.
          </p>
          <button
            onClick={() =>
              askConfirm({
                title: 'Start the demo over?',
                body: 'Every board, lane and card in this browser is replaced by the demo workspace. A snapshot of what is here is kept first, so this can be undone.',
                confirmLabel: 'Reset the demo',
                danger: true,
                onConfirm: () => {
                  void writeSnapshot(persistedSlice(useStore.getState()), PERSIST_VERSION)
                  resetDemo()
                  void listSnapshots().then(setSnapshots)
                },
              })
            }
            className="mt-2 rounded-md border border-slate-300 px-2 py-1 text-meta font-medium text-slate-700 transition hover:border-rose-300 hover:text-rose-700"
          >
            Reset to the demo…
          </button>
        </section>
      )}
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
