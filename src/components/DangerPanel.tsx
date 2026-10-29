import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { loadAuth } from '@/lib/auth'
import { downloadWorkspace } from '@/lib/exportWorkspace'
import { useDialogFocus } from '@/lib/useDialogFocus'
import { cn } from '@/lib/utils'

/**
 * The end of the workspace.
 *
 * It has a tab of its own because it is not a setting: every board, lane and card goes, and so do
 * the accounts of everybody in it. The deployment stays, and an administrator of it can bring the
 * workspace back — empty — by signing in.
 *
 * The name is typed to confirm, and the server checks it too. The export sits first, because a
 * copy taken before the act is the only undo there is.
 */

const FIELD =
  'rounded-md border border-slate-200 bg-white px-2 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400'
const BUTTON = 'rounded-md border border-slate-200 px-2 py-1 text-meta font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40'

export function DangerPanel() {
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [typed, setTyped] = useState('')
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | undefined>()
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const response = await fetch('/api/admin/workspace', { headers: { accept: 'application/json' } })
        if (!response.ok) {
          if (live) setError('This workspace could not be read.')
          return
        }
        const body = (await response.json()) as { workspace: { name: string } }
        if (live) setName(body.workspace.name)
      } catch {
        if (live) setError('The server could not be reached.')
      }
    })()
    return () => {
      live = false
    }
  }, [])

  /**
   * The irreversible act: the workspace, and the accounts of everybody in it.
   *
   * Not a member's, and not the last instance administrator's — the server refuses both, and the
   * sentence it gives is what this shows. After it, the deployment is still there and an
   * administrator of it can bring the workspace back, empty, by signing in (task 163).
   */
  async function removeWorkspace() {
    setRemoving(true)
    setMessage(undefined)
    try {
      const response = await fetch('/api/workspace', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: typed }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setMessage({ tone: 'bad', text: body?.error ?? 'This workspace could not be deleted.' })
        return
      }
      // The account that asked is deleted with the workspace, so the session is gone with it.
      await loadAuth()
      window.location.assign('/app?workspace=deleted')
    } catch {
      setMessage({ tone: 'bad', text: 'The server could not be reached.' })
    } finally {
      setRemoving(false)
    }
  }

  if (error) return <p className="rounded-xl bg-rose-50 px-3 py-2 text-meta text-rose-800">{error}</p>

  return (
    <section className="rounded-xl border border-rose-200 bg-white p-4 ring-1 ring-rose-100">
      <h2 className="text-body font-semibold text-rose-800">Delete this workspace</h2>
      <p className="mt-1 text-meta text-slate-700">
        Every board, lane and card in it goes, and so do the accounts of everybody in it. The
        deployment stays; an administrator of it can bring the workspace back — empty — by signing
        in. Nothing here can be undone.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={() => downloadWorkspace()} className={cn(BUTTON, 'flex items-center gap-1 text-micro')}>
          <Download size={11} /> Export it first
        </button>
        <button
          onClick={() => setDeleting(true)}
          disabled={removing}
          className="ml-auto rounded-md bg-rose-600 px-2 py-1 text-meta font-medium text-white hover:bg-rose-500 disabled:opacity-40"
        >
          Delete this workspace…
        </button>
      </div>

      {message && (
        <p className={cn('mt-3 rounded-md px-2 py-1 text-meta', message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800')}>
          {message.text}
        </p>
      )}

      {deleting && (
        <DeleteWorkspaceDialog
          name={name || 'this workspace'}
          typed={typed}
          onTyped={setTyped}
          busy={removing}
          onCancel={() => {
            setDeleting(false)
            setTyped('')
          }}
          onConfirm={() => void removeWorkspace()}
        />
      )}
    </section>
  )
}

/** The typed confirmation, which the server checks as well. */
function DeleteWorkspaceDialog({
  name,
  typed,
  onTyped,
  busy,
  onCancel,
  onConfirm,
}: {
  name: string
  typed: string
  onTyped: (value: string) => void
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, onCancel, true, 'input')
  const ready = typed.trim().toLowerCase() === name.toLowerCase()

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Delete this workspace"
        className="w-full max-w-sm rounded-xl bg-white p-4 shadow-2xl ring-1 ring-slate-200"
      >
        <h3 className="text-title font-semibold text-slate-900">Delete “{name}”?</h3>
        <p className="mt-1 text-meta text-slate-700">
          Every board, lane and card in it, and everybody’s account. There is no way back: the
          deployment can make an empty workspace again, but not this one. Type its name to confirm.
        </p>
        <input
          value={typed}
          onChange={(event) => onTyped(event.target.value)}
          placeholder={name}
          aria-label="Type the workspace name to confirm"
          className={cn(FIELD, 'mt-2 w-full')}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onCancel} className={BUTTON}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!ready || busy}
            className="rounded-md bg-rose-600 px-2.5 py-1 text-meta font-semibold text-white hover:bg-rose-500 disabled:opacity-40"
          >
            {busy ? 'Deleting…' : 'Delete this workspace'}
          </button>
        </div>
      </div>
    </div>
  )
}
