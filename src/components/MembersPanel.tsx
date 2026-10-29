import { useCallback, useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useStore } from '@/store'
import { RoleSelect } from './RoleSelect'
import { cn } from '@/lib/utils'

/**
 * The people in this workspace, for a workspace administrator who does not administer the
 * deployment.
 *
 * An instance administrator gets the same job done in the People tab's full directory — one list,
 * not two — so this panel is shown only where there is no directory to show. The three acts are the
 * same ones the server has always had: invite, deactivate (the reversible one) and remove (which
 * deletes the account and leaves the work).
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

export function MembersPanel() {
  const me = useAuth((state) => state.user)
  const askConfirm = useStore((state) => state.askConfirm)

  const [members, setMembers] = useState<Member[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('editor')
  const [issued, setIssued] = useState<string | undefined>()
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | undefined>()
  const [error, setError] = useState<string | undefined>()

  const load = useCallback(async () => {
    setError(undefined)
    try {
      const response = await fetch('/api/admin/workspace', { headers: { accept: 'application/json' } })
      if (response.status === 401 || response.status === 403) {
        setError('Only an administrator of this workspace can see its people.')
        return
      }
      if (!response.ok) {
        setError('The people in this workspace could not be read.')
        return
      }
      const body = (await response.json()) as { members: Member[] }
      setMembers(body.members)
    } catch {
      setError('The server could not be reached.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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

  /**
   * A one-time password link for a member, minted here because the deployment may have no mail relay
   * (task 154.7). It is shown once, in the same place an invitation is, and handed over how the
   * administrator likes.
   */
  async function reset(member: Member) {
    setMessage(undefined)
    const response = await fetch(`/api/admin/workspace/members/${member.id}/reset`, { method: 'POST' })
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      return setMessage({ tone: 'bad', text: body?.error ?? 'That link could not be made.' })
    }
    const { url } = (await response.json()) as { url: string }
    setIssued(url)
    setCopied(false)
    setMessage({
      tone: 'ok',
      text: `${member.name} can set a password with this link. It works once, in the next fifteen minutes.`,
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

  if (error) return <p className="rounded-xl bg-rose-50 px-3 py-2 text-meta text-rose-800">{error}</p>

  const adminCount = members.filter((member) => member.role === 'admin' && member.status === 'active').length

  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-body font-semibold text-slate-900">People</h2>
        <span className="text-meta text-slate-500">{members.length} in this workspace</span>
      </div>
      <p className="mt-0.5 text-meta text-slate-600">
        Invite somebody in, change what they may do, or close their door. Removing an account leaves
        the work they did and the work that names them.
      </p>

      {message && (
        <p className={cn('mt-3 rounded-md px-2 py-1 text-meta', message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800')}>
          {message.text}
        </p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 text-micro uppercase tracking-wide text-slate-500">
              <th className="py-1.5 pr-3 font-semibold">Member</th>
              <th className="w-24 py-1.5 pr-3 font-semibold">Status</th>
              <th className="w-48 py-1.5 pr-3 font-semibold">Role</th>
              <th className="w-60 py-1.5 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const lastAdmin = member.role === 'admin' && member.status === 'active' && adminCount <= 1
              return (
                <tr key={member.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 pr-3">
                    <span className="font-medium text-slate-800">{member.name}</span>
                    <span className="ml-1.5 text-meta text-slate-500">{member.email}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-meta text-slate-700">{member.status}</td>
                  <td className="py-1.5 pr-3">
                    <RoleSelect
                      value={member.role}
                      disabled={lastAdmin}
                      onChange={(next) => void changeRole(member, next)}
                      compact
                      className="w-full"
                    />
                    {lastAdmin && <p className="mt-0.5 text-micro text-slate-500">The last administrator here.</p>}
                  </td>
                  <td className="py-1.5">
                    <span className="flex items-center justify-end gap-1 whitespace-nowrap">
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
                        onClick={() => void reset(member)}
                        title="A one-time link that lets them set a password — no mail needed"
                        className={cn(BUTTON, 'px-1.5 text-micro')}
                      >
                        Reset
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
      </div>

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
          <p className="mt-1 basis-full text-micro text-slate-600">
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
    </section>
  )
}
