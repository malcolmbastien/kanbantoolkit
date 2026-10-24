import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { downloadWorkspace } from '@/lib/exportWorkspace'
import { loadAuth } from '@/lib/auth'
import { useStore } from '@/store'
import { useDialogFocus } from '@/lib/useDialogFocus'
import { cn } from '@/lib/utils'

/**
 * The account: its name, what billing needs to be arranged, and the two ways to end things.
 *
 * The Account Admin is the instance administrator under the name the role earns (task 126) — this
 * panel is the visible half of that. It holds no payment machinery on purpose: a billing record
 * points at the provider's customer, and the digits stay with the provider.
 *
 * The destructive acts are the point of the panel, so they are treated as such: each names what it
 * will take, offers the export first, and the account's closure asks for its name typed — checked
 * on the server too, because a confirmation only the client enforces is a suggestion.
 */

interface Account {
  name: string
  billing: { email?: string; company?: string; reference?: string; plan?: string }
}

interface WorkspaceRef {
  id: string
  name: string
}

const FIELD =
  'mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400'
const LABEL = 'block text-micro font-semibold uppercase tracking-wide text-slate-500'
const BUTTON = 'rounded-md border border-slate-200 px-2 py-1 text-meta font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40'

export function AccountPanel() {
  const askConfirm = useStore((state) => state.askConfirm)
  const [account, setAccount] = useState<Account | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceRef[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [reference, setReference] = useState('')
  const [plan, setPlan] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | undefined>()
  const [closing, setClosing] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [record, session] = await Promise.all([
          fetch('/api/admin/account', { headers: { accept: 'application/json' } }),
          fetch('/api/auth/session', { headers: { accept: 'application/json' } }),
        ])
        if (!record.ok) {
          if (live) setError('Only an Account Admin can see this.')
          return
        }
        if (!live) return
        const body = (await record.json()) as Account
        setAccount(body)
        setName(body.name)
        setEmail(body.billing.email ?? '')
        setCompany(body.billing.company ?? '')
        setReference(body.billing.reference ?? '')
        setPlan(body.billing.plan ?? '')
        if (session.ok) {
          const payload = (await session.json()) as { workspaces?: Array<{ id: string; name?: string }> }
          setWorkspaces((payload.workspaces ?? []).map((workspace) => ({ id: workspace.id, name: workspace.id })))
        }
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
      const response = await fetch('/api/admin/account', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, billing: { email, company, reference, plan } }),
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

  function remove(workspace: WorkspaceRef) {
    askConfirm({
      title: `Delete “${workspace.name}”?`,
      body: 'Its boards, lanes, cards, placements and members go with it. The account, its people and its trail stay. Export it first if you may want it again.',
      confirmLabel: 'Delete the workspace',
      danger: true,
      onConfirm: () => {
        void (async () => {
          const response = await fetch(`/api/admin/account/workspaces/${encodeURIComponent(workspace.id)}`, {
            method: 'DELETE',
          })
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null
            setMessage({ tone: 'bad', text: body?.error ?? 'That workspace could not be deleted.' })
            return
          }
          setMessage({ tone: 'ok', text: 'The workspace was deleted.' })
          setWorkspaces((list) => list.filter((entry) => entry.id !== workspace.id))
        })()
      },
    })
  }

  async function close() {
    setBusy('close')
    setMessage(undefined)
    try {
      const response = await fetch('/api/admin/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: typed }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setMessage({ tone: 'bad', text: body?.error ?? 'The account could not be closed.' })
        return
      }
      // Everything is gone, including this session, so there is no panel left to say so in: the
      // app returns to the sign-in surface carrying the reason, which is where a person arrives.
      setClosing(false)
      await loadAuth()
      window.location.assign('/?auth=closed')
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
          <h2 className="text-body font-semibold text-slate-900">Account</h2>
          <span className="text-meta text-slate-600">the name, and what billing needs to be arranged</span>
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
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} className={FIELD} />
          </label>
          <label className={LABEL}>
            Billing email
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="billing@example.com"
              className={FIELD}
            />
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
              A pointer to the provider’s record. Card numbers are never stored here — that is the
              provider’s job, and holding them would be a liability with no upside.
            </span>
          </label>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <button onClick={() => void save()} disabled={busy !== null} className={BUTTON}>
            {busy === 'save' ? 'Saving…' : 'Save the account'}
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-body font-semibold text-slate-900">Ending things</h2>
        <p className="mt-1 text-meta text-slate-600">
          Both are permanent, and both offer the file first. Deleting a workspace leaves the account and its
          people; closing the account removes everything this deployment holds.
        </p>

        <div className="mt-3 space-y-2">
          {workspaces.map((workspace) => (
            <div key={workspace.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2">
              <span className="text-meta font-medium text-slate-800">{workspace.name}</span>
              <span className="ml-auto flex items-center gap-1.5">
                <button onClick={() => downloadWorkspace()} className={cn(BUTTON, 'flex items-center gap-1 text-micro')}>
                  <Download size={11} /> Export first
                </button>
                <button
                  onClick={() => remove(workspace)}
                  disabled={busy !== null}
                  className="rounded-md border border-rose-300 px-2 py-1 text-micro font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                >
                  Delete this workspace
                </button>
              </span>
            </div>
          ))}
          {workspaces.length === 1 && (
            <p className="text-micro text-slate-600">
              This is the account’s only workspace, so it cannot be deleted on its own — closing the account is
              what that means.
            </p>
          )}
        </div>

        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50/40 p-2.5">
          <p className="text-micro font-semibold uppercase tracking-wide text-rose-700">Close the account</p>
          <p className="mt-1 text-meta text-slate-700">
            Removes every workspace and every card in it, the people, their sessions and invitations, the groups,
            the audit trail and the error reports. There is no way back.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <button onClick={() => downloadWorkspace()} className={cn(BUTTON, 'flex items-center gap-1 text-micro')}>
              <Download size={11} /> Export a workspace first
            </button>
            <button
              onClick={() => setClosing(true)}
              disabled={busy !== null}
              className="ml-auto rounded-md bg-rose-600 px-2 py-1 text-meta font-medium text-white hover:bg-rose-500 disabled:opacity-40"
            >
              Close the account…
            </button>
          </div>
        </div>
      </section>

      {closing && (
        <CloseAccountDialog
          name={account.name}
          typed={typed}
          onTyped={setTyped}
          busy={busy === 'close'}
          onCancel={() => {
            setClosing(false)
            setTyped('')
          }}
          onConfirm={() => void close()}
        />
      )}
    </>
  )
}

/** The typed confirmation, which the server checks as well. */
function CloseAccountDialog({
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
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Close the account" className="w-full max-w-sm rounded-xl bg-white p-4 shadow-2xl ring-1 ring-slate-200">
        <h3 className="text-title font-semibold text-slate-900">Close “{name}”?</h3>
        <p className="mt-1 text-meta text-slate-700">
          Every workspace, every card, every person, the trail and the error reports. Type the account’s name to
          confirm.
        </p>
        <input
          value={typed}
          onChange={(event) => onTyped(event.target.value)}
          placeholder={name}
          aria-label="Type the account name to confirm"
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
            {busy ? 'Closing…' : 'Close the account'}
          </button>
        </div>
      </div>
    </div>
  )
}
