import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Plus, Upload } from 'lucide-react'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { useAuth } from '@/lib/auth'
import { copyToAccount, declineImport, useWorkspaceSync } from '@/lib/workspaceSync'
import { persistedSlice, useStore } from '@/store'

/**
 * Offering to put the browser's workspace on the account.
 *
 * One question, asked where the account is, and only when it has an answer worth giving: a local
 * workspace with boards, an account with none, and no earlier answer from this person. The local
 * copy is never removed — R4 — so accepting is a copy rather than a move.
 */
export function ImportNotice() {
  const user = useAuth((state) => state.user)
  const offer = useWorkspaceSync((state) => state.offer)
  const busy = useWorkspaceSync((state) => state.busy)
  const error = useWorkspaceSync((state) => state.error)

  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  // A closed workspace is said even when there is no offer to make: the person is looking at this
  // browser's copy and needs to know the account's is not there — and needs a way to make another.
  if (user && !offer && error) {
    return (
      <span className="flex items-center gap-1.5">
        <span
          title={error}
          className="flex items-center gap-1 rounded-md border border-slate-300 bg-slate-100 px-2 py-1 text-meta font-medium text-slate-700"
        >
          <AlertTriangle size={13} /> No workspace
        </span>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-meta font-medium text-white hover:bg-slate-800"
        >
          <Plus size={13} /> Create a workspace
        </button>
        {creating && <CreateWorkspaceDialog onClose={() => setCreating(false)} />}
      </span>
    )
  }

  if (!user || !offer) return null

  async function onCopy() {
    if (!user) return
    const copied = await copyToAccount(user.id, persistedSlice(useStore.getState()) as Record<string, unknown>)
    if (copied) setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        title="This workspace lives in this browser. Copy it to your account so it is on the server too."
        className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-meta font-medium text-amber-800 hover:bg-amber-100"
      >
        <Upload size={13} /> Copy to account
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <p className="text-body font-medium text-slate-900">This workspace lives in this browser</p>
          <p className="mt-1 text-meta text-slate-600">
            Copy it to {user.email} so it is on the server too. The copy here stays, so nothing is lost if
            anything goes wrong.
          </p>

          {error && <p className="mt-2 text-meta text-rose-700">{error}</p>}

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={onCopy}
              disabled={busy}
              className="rounded-md bg-slate-900 px-2.5 py-1 text-meta font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? 'Copying…' : 'Copy workspace'}
            </button>
            <button
              onClick={() => {
                declineImport(user.id)
                setOpen(false)
              }}
              className="rounded-md border border-slate-200 px-2.5 py-1 text-meta font-medium text-slate-600 hover:text-slate-900"
            >
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
