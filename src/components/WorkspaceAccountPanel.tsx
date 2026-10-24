import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { downloadWorkspace } from '@/lib/exportWorkspace'
import { loadAuth } from '@/lib/auth'
import { useDialogFocus } from '@/lib/useDialogFocus'
import { cn } from '@/lib/utils'

/**
 * The workspace's own account: who owns it, what is billed, and the end of it.
 *
 * A workspace is the tenant (task 126, revised): it holds many people's accounts, its boards and its
 * cards, and it is the thing that is charged — to its **owner**, who is one of its administrators
 * rather than a role of its own. So this panel belongs to the workspace's administrator, it edits
 * this workspace and nothing else, and deleting here ends this workspace and only this one: another
 * workspace, the people's accounts and the instance are not in reach.
 *
 * No payment machinery on purpose: the billing record points at the provider's customer, and the
 * digits stay with the provider.
 */

interface Account {
  name: string
  ownerId?: string
  ownerName?: string
  billing: { email?: string; company?: string; reference?: string; plan?: string }
}

interface Member {
  id: string
  name: string
  email: string
}

const FIELD =
  'mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400'
const LABEL = 'block text-micro font-semibold uppercase tracking-wide text-slate-500'
const BUTTON = 'rounded-md border border-slate-200 px-2 py-1 text-meta font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40'

export function WorkspaceAccountPanel() {
  const [account, setAccount] = useState<Account | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [owner, setOwner] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [reference, setReference] = useState('')
  const [plan, setPlan] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | undefined>()
  const [deleting, setDeleting] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [record, list] = await Promise.all([
          fetch('/api/workspace/account', { headers: { accept: 'application/json' } }),
          fetch('/api/admin/workspace', { headers: { accept: 'application/json' } }),
        ])
        if (!record.ok) {
          if (live) setError('Only this workspace’s administrator can see this.')
          return
        }
        if (!live) return
        const body = (await record.json()) as Account
        setAccount(body)
        setOwner(body.ownerId ?? '')
        setEmail(body.billing.email ?? '')
        setCompany(body.billing.company ?? '')
        setReference(body.billing.reference ?? '')
        setPlan(body.billing.plan ?? '')
        if (list.ok) setMembers(((await list.json()) as { members: Member[] }).members)
      } catch {
        if (live) setError('The server could not be reached.')
      }
    })()
    return () => {
      live = false
    }
  }, [])

  async function save() {
    setBusy('save')
    setMessage(undefined)
    try {
      const response = await fetch('/api/workspace/account', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(owner ? { ownerId: owner } : {}),
          billing: { email, company, reference, plan },
        }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setMessage({ tone: 'bad', text: body?.error ?? 'That could not be saved.' })
        return
      }
      setAccount((await response.json()) as Account)
      setMessage({ tone: 'ok', text: 'Saved, and recorded in the audit.' })
    } catch {
      setMessage({ tone: 'bad', text: 'The server could not be reached.' })
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('delete')
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
      // The workspace this person was in is gone, and with it their membership: the app returns to
      // the board, which now has to say so rather than pretend.
      await loadAuth()
      window.location.assign('/app?workspace=deleted')
    } catch {
      setMessage({ tone: 'bad', text: 'The server could not be reached.' })
    } finally {
      setBusy(null)
    }
  }

  if (error) return null
  if (!account) return null

  return (
    <>
      <section className="mt-6 rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-body font-semibold text-slate-900">Workspace account</h2>
          <span className="text-meta text-slate-600">who owns it, and what is billed</span>
        </div>

        {message && (
          <p
            className={cn(
              'mt-2 rounded-md px-2 py-1 text-meta',
              message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800',
            )}
          >
            {message.text}
          </p>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className={LABEL}>
            Owner — the account that is charged
            <select value={owner} onChange={(event) => setOwner(event.target.value)} className={FIELD}>
              <option value="">nobody yet</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} · {member.email}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Billing email
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="billing@example.com" className={FIELD} />
          </label>
          <label className={LABEL}>
            Company
            <input value={company} onChange={(event) => setCompany(event.target.value)} className={FIELD} />
          </label>
          <label className={LABEL}>
            Plan
            <input value={plan} onChange={(event) => setPlan(event.target.value)} placeholder="Team" className={FIELD} />
          </label>
          <label className={cn(LABEL, 'sm:col-span-2')}>
            Billing reference
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="the payment provider's customer id"
              className={FIELD}
            />
            <span className="mt-1 block text-micro font-normal normal-case text-slate-600">
              A pointer to the provider’s record. Card numbers are never stored here — holding them would be a
              liability with no upside.
            </span>
          </label>
        </div>

        <div className="mt-2">
          <button onClick={() => void save()} disabled={busy !== null} className={BUTTON}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
        </div>

        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50/40 p-2.5">
          <p className="text-micro font-semibold uppercase tracking-wide text-rose-700">Delete this workspace</p>
          <p className="mt-1 text-meta text-slate-700">
            Its boards, lanes and cards, and its members’ access, go with it. People keep their accounts and their
            other workspaces; this one is gone, and there is no way back.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button onClick={() => downloadWorkspace()} className={cn(BUTTON, 'flex items-center gap-1 text-micro')}>
              <Download size={11} /> Export it first
            </button>
            <button
              onClick={() => setDeleting(true)}
              disabled={busy !== null}
              className="ml-auto rounded-md bg-rose-600 px-2 py-1 text-meta font-medium text-white hover:bg-rose-500 disabled:opacity-40"
            >
              Delete this workspace…
            </button>
          </div>
        </div>
      </section>

      {deleting && (
        <DeleteWorkspaceDialog
          name={account.name}
          typed={typed}
          onTyped={setTyped}
          busy={busy === 'delete'}
          onCancel={() => {
            setDeleting(false)
            setTyped('')
          }}
          onConfirm={() => void remove()}
        />
      )}
    </>
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
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Delete this workspace" className="w-full max-w-sm rounded-xl bg-white p-4 shadow-2xl ring-1 ring-slate-200">
        <h3 className="text-title font-semibold text-slate-900">Delete “{name}”?</h3>
        <p className="mt-1 text-meta text-slate-700">
          Every board, lane and card in it, and everybody’s access to it. People keep their accounts; this
          workspace does not come back. Type its name to confirm.
        </p>
        <input
          value={typed}
          onChange={(event) => onTyped(event.target.value)}
          placeholder={name}
          aria-label="Type the workspace name to confirm"
          className={cn(FIELD, 'mt-2')}
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
