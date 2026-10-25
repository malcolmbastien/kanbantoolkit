import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Check, Download } from 'lucide-react'
import { loadAuth, useAuth } from '@/lib/auth'
import { downloadWorkspace } from '@/lib/exportWorkspace'
import { useStore } from '@/store'
import { useDialogFocus } from '@/lib/useDialogFocus'
import { RoleSelect } from './RoleSelect'
import { cn } from '@/lib/utils'

/**
 * This workspace's own administration.
 *
 * The boundary made visible: an instance administrator runs the deployment, a workspace
 * administrator runs this team. What is here — the name, the description, who is in it, what they may
 * do, and the end of it — is the second of those, and an editor or a viewer sees none of it.
 *
 * The end of the workspace lives here rather than in a panel of its own. There was one, for the
 * owner and the bill (task 126), and task 166 removed both: nothing is sold, so a workspace has a
 * name, a membership and a way to end it, and no account to keep.
 *
 * The guards are the server's. The UI disables what it can predict and shows the server's sentence
 * for the rest, because "this is the last administrator" is more use than a greyed control.
 */

interface Member {
  id: string
  name: string
  email: string
  status: string
  role: string
  joinedAt: string
}

const FIELD =
  'rounded-md border border-slate-200 bg-white px-2 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400'
const LABEL = 'block text-micro font-semibold uppercase tracking-wide text-slate-500'
const BUTTON = 'rounded-md border border-slate-200 px-2 py-1 text-meta font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40'

export function WorkspacePanel() {
  const me = useAuth((state) => state.user)
  const askConfirm = useStore((state) => state.askConfirm)

  const [members, setMembers] = useState<Member[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('editor')
  const [issued, setIssued] = useState<string | undefined>()
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [typed, setTyped] = useState('')
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | undefined>()
  const [error, setError] = useState<string | undefined>()

  const load = useCallback(async () => {
    setError(undefined)
    try {
      const response = await fetch('/api/admin/workspace', { headers: { accept: 'application/json' } })
      if (response.status === 401 || response.status === 403) {
        setError('Only an administrator of this workspace can change it.')
        return
      }
      if (!response.ok) {
        setError('This workspace could not be read.')
        return
      }
      const body = (await response.json()) as { workspace: { name: string; description: string }; members: Member[] }
      setName(body.workspace.name)
      setDescription(body.workspace.description)
      setMembers(body.members)
    } catch {
      setError('The server could not be reached.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    setBusy(true)
    setMessage(undefined)
    try {
      const response = await fetch('/api/admin/workspace', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, description }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setMessage({ tone: 'bad', text: body?.error ?? 'That could not be saved.' })
        return
      }
      setMessage({ tone: 'ok', text: 'Saved.' })
      await load()
    } catch {
      setMessage({ tone: 'bad', text: 'The server could not be reached.' })
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(member: Member, next: string) {
    setMessage(undefined)
    const response = await fetch(`/api/admin/workspace/members/${member.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: next }),
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      return setMessage({ tone: 'bad', text: body?.error ?? 'That could not be changed.' })
    }
    setMessage({ tone: 'ok', text: `${member.name} is now a ${next}. It applies to their next request.` })
    await load()
  }

  /**
   * The reversible act: the door closes, the person and their name stay.
   *
   * Kept beside removal and never merged with it — one can be undone by an administrator, the other
   * cannot be undone at all.
   */
  async function setActive(member: Member, active: boolean) {
    setMessage(undefined)
    const response = await fetch(`/api/admin/workspace/members/${member.id}/${active ? 'activate' : 'deactivate'}`, {
      method: 'POST',
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      return setMessage({ tone: 'bad', text: body?.error ?? 'That could not be done.' })
    }
    setMessage({
      tone: 'ok',
      text: active ? `${member.name} can sign in again.` : `${member.name} cannot sign in. Their work and their name stay.`,
    })
    await load()
  }

  function remove(member: Member) {
    askConfirm({
      title: `Remove ${member.name} from this workspace?`,
      body: 'This deletes their account — they cannot sign in again until somebody invites them, which creates a new one. Their cards, comments and history stay, and every place that names them says “Former member”.',
      confirmLabel: 'Remove them',
      danger: true,
      onConfirm: () => {
        void (async () => {
          const response = await fetch(`/api/admin/workspace/members/${member.id}`, { method: 'DELETE' })
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null
            return setMessage({ tone: 'bad', text: body?.error ?? 'That could not be done.' })
          }
          setMessage({ tone: 'ok', text: `${member.name} was removed from this workspace.` })
          await load()
        })()
      },
    })
  }

  async function invite() {
    setBusy(true)
    setMessage(undefined)
    try {
      const response = await fetch('/api/admin/workspace/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setMessage({ tone: 'bad', text: body?.error ?? 'The invitation could not be made.' })
        return
      }
      const body = (await response.json()) as { token: string }
      setIssued(`${window.location.origin}/app?invite=${encodeURIComponent(body.token)}`)
      setCopied(false)
      setEmail('')
    } catch {
      setMessage({ tone: 'bad', text: 'The server could not be reached.' })
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued)
      setCopied(true)
    } catch {
      setMessage({ tone: 'bad', text: 'The clipboard is not available — select the link and copy it.' })
    }
  }

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

  if (error) return null

  const adminCount = members.filter((member) => member.role === 'admin' && member.status === 'active').length

  return (
    <section className="mt-6 rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <h2 className="text-body font-semibold text-slate-900">This workspace</h2>

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className={LABEL}>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} className={cn(FIELD, 'mt-1 block w-56')} />
        </label>
        <label className={cn(LABEL, 'min-w-[16rem] flex-1')}>
          Description
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this workspace is for"
            className={cn(FIELD, 'mt-1 block w-full')}
          />
        </label>
        <button onClick={() => void save()} disabled={busy} className={BUTTON}>
          Save
        </button>
      </div>

      {message && (
        <p className={cn('mt-3 rounded-md px-2 py-1 text-meta', message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800')}>
          {message.text}
        </p>
      )}

      <table className="mt-3 w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-200 text-micro uppercase tracking-wide text-slate-500">
            <th className="py-1.5 font-semibold">Member</th>
            <th className="w-24 py-1.5 font-semibold">Status</th>
            <th className="w-64 py-1.5 font-semibold">Role</th>
            <th className="w-20 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const lastAdmin = member.role === 'admin' && member.status === 'active' && adminCount <= 1
            return (
              <tr key={member.id} className="border-b border-slate-100 last:border-0">
                <td className="truncate py-1.5 pr-2">
                  <span className="font-medium text-slate-800">{member.name}</span>
                  <span className="ml-1.5 text-meta text-slate-500">{member.email}</span>
                </td>
                <td className="py-1.5 text-meta text-slate-700">{member.status}</td>
                <td className="py-1.5">
                  <RoleSelect
                    value={member.role}
                    disabled={lastAdmin}
                    onChange={(next) => void changeRole(member, next)}
                    className="w-full"
                  />
                  {lastAdmin && <p className="mt-0.5 text-micro text-slate-500">The last administrator here.</p>}
                </td>
                <td className="py-1.5 text-right">
                  <span className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => void setActive(member, member.status !== 'active')}
                      title={
                        member.status === 'active'
                          ? 'They cannot sign in; their account and name stay'
                          : 'Open their door again'
                      }
                      className={cn(BUTTON, 'px-1.5 text-micro')}
                    >
                      {member.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => remove(member)}
                      disabled={lastAdmin}
                      title={lastAdmin ? 'The last administrator cannot leave' : 'Delete their account; the history keeps their words'}
                      className={cn(BUTTON, 'px-1.5 text-micro')}
                    >
                      Remove
                    </button>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3">
        <label className={LABEL}>
          Invite into this workspace
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="grace@example.com" className={cn(FIELD, 'mt-1 block w-56')} />
        </label>
        <RoleSelect value={role} onChange={setRole} label="As" />
        <button onClick={() => void invite()} disabled={busy || !email.includes('@')} className={BUTTON}>
          Make a link
        </button>
        {me?.role === 'admin' && (
          <p className="mt-1 text-micro text-slate-600">
            <strong>Invite</strong> brings somebody in. <strong>Deactivate</strong> closes their door and keeps
            the account, so their name stays on the work. <strong>Remove</strong> deletes the account: the work
            stays, and every reference to them reads “Former member”. Coming back is a fresh invitation and a
            new account.
          </p>
        )}
      </div>

      {issued && (
        <div className="mt-2 flex items-center gap-1.5">
          <input readOnly value={issued} aria-label="Invitation link" className={cn(FIELD, 'w-full text-micro')} onFocus={(event) => event.target.select()} />
          <button onClick={() => void copy()} className="flex shrink-0 items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-meta font-medium text-white hover:bg-slate-800">
            {copied ? <Check size={12} /> : <Copy size={12} />} Copy
          </button>
          <span role="status" aria-live="polite" className="text-micro text-emerald-700">
            {copied ? 'Link copied.' : ''}
          </span>
        </div>
      )}
      {issued && <p className="mt-1 text-micro text-slate-500">This link is shown once; send a new one if it is lost.</p>}

      <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50/40 p-2.5">
        <p className="text-micro font-semibold uppercase tracking-wide text-rose-700">Delete this workspace</p>
        <p className="mt-1 text-meta text-slate-700">
          Every board, lane and card in it goes, and so do the accounts of everybody in it. The
          deployment stays; an administrator of it can bring the workspace back — empty — by signing
          in. Nothing here can be undone.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={() => downloadWorkspace()} className={cn(BUTTON, 'flex items-center gap-1 text-micro')}>
            <Download size={11} /> Export it first
          </button>
          <button
            onClick={() => setDeleting(true)}
            disabled={busy || removing}
            className="ml-auto rounded-md bg-rose-600 px-2 py-1 text-meta font-medium text-white hover:bg-rose-500 disabled:opacity-40"
          >
            Delete this workspace…
          </button>
        </div>
      </div>

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
