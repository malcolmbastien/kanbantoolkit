import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Plus, X } from 'lucide-react'
import { ROLES } from '@/domain/roles'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'

/**
 * The invitations somebody has sent.
 *
 * A link is made once and shown once. After the dialog closes there is no way back to it — the
 * database keeps only the hash — and the remedy is the resend button, which mints a new link and
 * kills the old one. That is the whole design, and the screen says so rather than letting somebody
 * hunt for a "show link again" that cannot exist.
 *
 * Nothing here needs email: the link is copied and handed over however the administrator likes.
 */

interface Invitation {
  id: string
  email: string
  role: string
  invitedBy?: string
  invitedByName?: string
  createdAt: string
  expiresAt: string
  acceptedAt?: string | null
  revokedAt?: string | null
  state: 'valid' | 'used' | 'expired' | 'revoked'
  acceptedName?: string
}

const FIELD =
  'rounded-md border border-slate-200 bg-white px-2 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400'
const LABEL = 'block text-micro font-semibold uppercase tracking-wide text-slate-500'
const BUTTON = 'rounded-md border border-slate-200 px-2 py-1 text-meta font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40'

/** "in 3 days", "2 hours left" — a date a person has to do arithmetic on is a worse answer. */
function left(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const hours = Math.round(ms / 3_600_000)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} left`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} left`
}

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export function InvitationsPanel() {
  const [invites, setInvites] = useState<Invitation[]>([])
  const [state, setState] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [message, setMessage] = useState<string | undefined>()
  const [creating, setCreating] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('editor')
  const [days, setDays] = useState('14')
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<string | undefined>()
  const [copied, setCopied] = useState(false)
  const issuedRef = useRef<HTMLInputElement>(null)
  const askConfirm = useStore((s) => s.askConfirm)

  const load = useCallback(async () => {
    setError(undefined)
    try {
      const response = await fetch('/api/admin/invites', { headers: { accept: 'application/json' } })
      if (response.status === 401 || response.status === 403) {
        setError('Only an instance administrator can see the invitations.')
        return
      }
      if (!response.ok) {
        setError('The invitations could not be read.')
        return
      }
      setInvites(((await response.json()) as { invites: Invitation[] }).invites)
    } catch {
      setError('The server could not be reached.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!issued) return
    issuedRef.current?.focus()
    issuedRef.current?.select()
    const away = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIssued(undefined)
    }
    document.addEventListener('keydown', away)
    return () => document.removeEventListener('keydown', away)
  }, [issued])

  async function send() {
    setBusy(true)
    setError(undefined)
    try {
      const response = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role, days: Number(days) || 14 }),
      })
      if (!response.ok) {
        // A 409 is the only refusal that exists, and it is about a link already waiting — never
        // about whether the address has an account.
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'The invitation could not be made.')
        return
      }
      const body = (await response.json()) as { url: string }
      setCreating(false)
      setEmail('')
      setIssued(body.url)
      setCopied(false)
      await load()
    } catch {
      setError('The server could not be reached.')
    } finally {
      setBusy(false)
    }
  }

  async function resend(invite: Invitation) {
    askConfirm({
      title: `Send a new link to ${invite.email}?`,
      body: 'The link you sent before stops working the moment this one exists.',
      confirmLabel: 'New link',
      onConfirm: () => {
        void (async () => {
          const response = await fetch(`/api/admin/invites/${invite.id}/resend`, { method: 'POST' })
          if (!response.ok) return setError('That could not be resent.')
          const body = (await response.json()) as { url: string }
          setIssued(body.url)
          setCopied(false)
          await load()
        })()
      },
    })
  }

  function revoke(invite: Invitation) {
    askConfirm({
      title: `Revoke the invitation to ${invite.email}?`,
      body: 'The link stops working immediately. They will need a new one.',
      confirmLabel: 'Revoke',
      danger: true,
      onConfirm: () => {
        void (async () => {
          const response = await fetch(`/api/admin/invites/${invite.id}`, { method: 'DELETE' })
          if (!response.ok) return setError('That could not be revoked.')
          setMessage(`The invitation to ${invite.email} was revoked.`)
          await load()
        })()
      },
    })
  }

  async function copy() {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued)
      setCopied(true)
    } catch {
      setError('The clipboard is not available — select the link and copy it.')
    }
  }

  const shown = state ? invites.filter((invite) => invite.state === state) : invites
  const count = (value: string) => invites.filter((invite) => invite.state === value).length

  return (
    <section className="mt-6 rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-body font-semibold text-slate-900">Invitations</h2>
        <span className="text-meta text-slate-500">
          {count('valid')} pending · {count('used')} accepted
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <select value={state} onChange={(event) => setState(event.target.value)} aria-label="Filter invitations" className={FIELD}>
            <option value="">All</option>
            <option value="valid">Pending</option>
            <option value="used">Accepted</option>
            <option value="expired">Expired</option>
            <option value="revoked">Revoked</option>
          </select>
          <button onClick={() => setCreating(true)} className="flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-meta font-medium text-white hover:bg-indigo-500">
            <Plus size={12} /> Invite
          </button>
        </div>
      </div>

      {message && <p className="mt-3 rounded-md bg-emerald-50 px-2 py-1 text-meta text-emerald-800">{message}</p>}
      {error && !creating && <p className="mt-3 rounded-md bg-rose-50 px-2 py-1 text-meta text-rose-800">{error}</p>}

      {shown.length === 0 ? (
        <p className="mt-3 text-meta text-slate-600">
          {state ? 'No invitation is in that state.' : 'Nobody has been invited yet. Make a link and hand it over.'}
        </p>
      ) : (
        <table className="mt-3 w-full table-fixed border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 text-micro uppercase tracking-wide text-slate-500">
              <th className="py-1.5 font-semibold">Address</th>
              <th className="w-24 py-1.5 font-semibold">Role</th>
              <th className="w-24 py-1.5 font-semibold">State</th>
              <th className="w-32 py-1.5 font-semibold">Expires</th>
              <th className="w-36 py-1.5 font-semibold">Who</th>
              <th className="w-24 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {shown.map((invite) => (
              <tr key={invite.id} className="border-b border-slate-100 last:border-0">
                <td className="truncate py-1.5 pr-2 text-slate-800">{invite.email}</td>
                <td className="py-1.5 text-meta text-slate-700">{invite.role}</td>
                <td className="py-1.5 text-meta text-slate-700">
                  {invite.state === 'valid' ? 'pending' : invite.state === 'used' ? 'accepted' : invite.state}
                </td>
                <td className="py-1.5 text-meta text-slate-600">
                  {invite.state === 'valid' ? left(invite.expiresAt) : day(invite.expiresAt)}
                </td>
                <td className="truncate py-1.5 text-meta text-slate-600">
                  {invite.state === 'used'
                    ? `${invite.acceptedName ?? invite.email}, ${day(invite.acceptedAt)}`
                    : `invited by ${invite.invitedByName ?? 'an administrator'}, ${day(invite.createdAt)}`}
                </td>
                <td className="py-1.5 text-right">
                  {invite.state === 'valid' && (
                    <span className="flex justify-end gap-1">
                      <button onClick={() => resend(invite)} className="rounded border border-slate-200 px-1 py-0.5 text-micro text-slate-600 hover:text-slate-900">
                        Resend
                      </button>
                      <button onClick={() => revoke(invite)} className="rounded border border-rose-200 px-1 py-0.5 text-micro text-rose-700 hover:bg-rose-50">
                        Revoke
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {creating && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Invite somebody">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-2xl ring-1 ring-slate-200">
            <div className="flex items-center justify-between">
              <h3 className="text-body font-semibold text-slate-900">Invite somebody</h3>
              <button onClick={() => setCreating(false)} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100">
                <X size={16} />
              </button>
            </div>

            <label className={cn(LABEL, 'mt-3 block')}>
              Address
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="grace@example.com" className={cn(FIELD, 'mt-1 w-full')} />
            </label>

            <label className={cn(LABEL, 'mt-2 block')}>
              Role
              <select value={role} onChange={(event) => setRole(event.target.value)} className={cn(FIELD, 'mt-1 w-full')}>
                {ROLES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label} — {entry.description}
                  </option>
                ))}
              </select>
            </label>

            <label className={cn(LABEL, 'mt-2 block')}>
              Expires in (days)
              <input value={days} onChange={(event) => setDays(event.target.value)} inputMode="numeric" className={cn(FIELD, 'mt-1 w-full')} />
            </label>

            {error && <p className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-meta text-rose-800">{error}</p>}

            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setCreating(false)} className={BUTTON}>
                Cancel
              </button>
              <button
                onClick={() => void send()}
                disabled={busy || !email.includes('@')}
                className="rounded-md bg-slate-900 px-2.5 py-1 text-meta font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busy ? 'Making…' : 'Make the link'}
              </button>
            </div>
          </div>
        </div>
      )}

      {issued && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Invitation created">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-2xl ring-1 ring-slate-200">
            <h3 className="text-body font-semibold text-slate-900">Here is the link</h3>
            <p className="mt-0.5 text-meta text-slate-600">
              This link is shown once. When this closes it cannot be read again — send a new one if it is lost.
            </p>

            <div className="mt-2 flex gap-1.5">
              <input ref={issuedRef} readOnly value={issued} aria-label="Invitation link" className={cn(FIELD, 'w-full text-micro')} />
              <button onClick={() => void copy()} className="flex shrink-0 items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-meta font-medium text-white hover:bg-slate-800">
                {copied ? <Check size={12} /> : <Copy size={12} />} Copy
              </button>
            </div>
            {/* Announced for a screen reader, which cannot see the tick. */}
            <p role="status" aria-live="polite" className="mt-1 h-4 text-micro text-emerald-700">
              {copied ? 'Link copied.' : ''}
            </p>

            <div className="mt-2 flex justify-end">
              <button onClick={() => setIssued(undefined)} className={BUTTON}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
