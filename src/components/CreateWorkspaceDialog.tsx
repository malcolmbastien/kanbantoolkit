import { useRef, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { useDialogFocus } from '@/lib/useDialogFocus'
import { cn } from '@/lib/utils'

/**
 * Making a workspace, for an account that has none.
 *
 * The account making it is the owner: that is what the email in this form *is*. It is shown and not
 * edited, because an owner is a person who asked for the workspace, not a field somebody else can be
 * written into. Once it exists they are its administrator and its payer, and the board opens on it.
 *
 * The public sign-up page (task 162, and the site plan's 151/154) puts this act where a stranger
 * arrives; this dialog is the same act where somebody already inside finds themselves without a
 * workspace — after deleting theirs, or being removed from one.
 */
export function CreateWorkspaceDialog({ onClose }: { onClose(): void }) {
  const user = useAuth((state) => state.user)
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, onClose, true, 'input')

  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  async function create() {
    if (!name.trim()) return
    setBusy(true)
    setError(undefined)
    try {
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'That workspace could not be created.')
        return
      }
      // A fresh load adopts the account's workspace, which is now this one and still empty — the
      // board offers to copy this browser's work into it.
      window.location.assign('/')
    } catch {
      setError('The server could not be reached.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Create a workspace"
        className="w-full max-w-sm rounded-xl bg-white p-4 shadow-2xl ring-1 ring-slate-200"
      >
        <h3 className="text-title font-semibold text-slate-900">Create a workspace</h3>
        <p className="mt-1 text-meta text-slate-700">
          A workspace holds your boards and the people you invite to them. You will be its administrator,
          and the account below is its owner.
        </p>

        <label className="mt-3 block text-micro font-semibold uppercase tracking-wide text-slate-500">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Team Atlas"
            aria-label="Workspace name"
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400"
          />
        </label>

        <div className="mt-2 text-micro font-semibold uppercase tracking-wide text-slate-500">
          Owner
          <p className="mt-1 text-meta font-normal normal-case text-slate-700">{user?.email ?? 'your account'}</p>
          <p className="mt-0.5 text-micro font-normal normal-case text-slate-500">
            The email that asked for the workspace owns it, and is the account that would be billed.
          </p>
        </div>

        {error && <p className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-meta text-rose-800">{error}</p>}

        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-meta font-medium text-slate-600 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            onClick={() => void create()}
            disabled={busy || !name.trim()}
            className={cn(
              'rounded-md bg-slate-900 px-2.5 py-1 text-meta font-medium text-white hover:bg-slate-800',
              'disabled:opacity-40',
            )}
          >
            {busy ? 'Creating…' : 'Create workspace'}
          </button>
        </div>
      </div>
    </div>
  )
}
