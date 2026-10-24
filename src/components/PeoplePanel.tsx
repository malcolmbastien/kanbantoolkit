import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { ROLES } from '@/domain/roles'
import { RoleSelect } from './RoleSelect'
import { cn } from '@/lib/utils'
import { useDialogFocus } from '@/lib/useDialogFocus'

/**
 * The people who may use this instance.
 *
 * A table, a drawer, and what an administrator does to somebody: change their name or address,
 * change what they may do, close their door or open it, sign out their devices, resend what they
 * were sent, delete the account — or erase the person and leave the work.
 *
 * The guards are the server's; the disabled controls here are the explanation. A refusal is shown in
 * the server's own words, because "you cannot deactivate yourself" is more use than "something went
 * wrong". Everything destructive asks for the address to be typed.
 */

interface Person {
  id: string
  name: string
  email: string
  avatarUrl?: string
  status: string
  lastSeenAt?: string
  joinedAt: string
  instanceRole: string
  role: string
}

interface Detail {
  person: Person
  sessions: { live: number; lastSeenAt?: string }
  invite?: { id: string; role: string; expiresAt: string }
  audit: Array<{ at: string; action: string; actor: string | null }>
}

const FIELD =
  'rounded-md border border-slate-200 bg-white px-2 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400'
const LABEL = 'block text-micro font-semibold uppercase tracking-wide text-slate-500'
const BUTTON = 'rounded-md border border-slate-200 px-2 py-1 text-meta font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40'

const when = (value: string | undefined) =>
  value ? new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never'

export function PeoplePanel() {
  const me = useAuth((state) => state.user)

  const [people, setPeople] = useState<Person[]>([])
  const [providers, setProviders] = useState<string[]>([])
  const [admins, setAdmins] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [role, setRole] = useState('')
  const [provider, setProvider] = useState('')
  const [sort, setSort] = useState('name')

  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [typed, setTyped] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkRole, setBulkRole] = useState('editor')
  const [draftName, setDraftName] = useState('')
  const [draftEmail, setDraftEmail] = useState('')
  const [issued, setIssued] = useState<string | undefined>()
  const closeRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)

  const load = useCallback(
    async (after?: string) => {
      setError(undefined)
      const params = new URLSearchParams()
      if (search.trim()) params.set('q', search.trim())
      if (status) params.set('status', status)
      if (role) params.set('role', role)
      if (provider) params.set('provider', provider)
      if (sort !== 'name') params.set('sort', sort)
      if (after && sort === 'name') params.set('after', after)

      try {
        const response = await fetch(`/api/admin/users?${params}`, { headers: { accept: 'application/json' } })
        if (response.status === 401 || response.status === 403) {
          setError('Only an instance administrator can see the people here.')
          return
        }
        if (!response.ok) {
          setError('The directory could not be read. It may be a moment; try again.')
          return
        }
        const body = (await response.json()) as {
          people: Person[]
          cursor: string | null
          admins: number
          providers: string[]
        }
        setPeople((current) => (after ? [...current, ...body.people] : body.people))
        setCursor(body.cursor)
        setAdmins(body.admins)
        setProviders(body.providers)
      } catch {
        setError('The server could not be reached, so the directory is not available.')
      }
    },
    [search, status, role, provider, sort],
  )

  useEffect(() => {
    void load()
  }, [load])

  // A selection belongs to what is on screen: narrowing the list drops what is no longer visible,
  // so a bulk action can only ever touch rows the operator can see.
  useEffect(() => {
    setSelected(new Set())
  }, [search, status, role, provider, sort])

  // The drawer's own facts, read when it opens rather than kept from the list.
  useEffect(() => {
    if (!open) {
      setDetail(null)
      return
    }
    let live = true
    void (async () => {
      try {
        const response = await fetch(`/api/admin/users/${open}`, { headers: { accept: 'application/json' } })
        if (!response.ok) return
        const body = (await response.json()) as Detail
        if (!live) return
        setDetail(body)
        setDraftName(body.person.name)
        setDraftEmail(body.person.email)
        setIssued(undefined)
        setTyped('')
      } catch {
        // The drawer still shows what the list knew.
      }
    })()
    return () => {
      live = false
    }
  }, [open])

  // The drawer is a dialog that happens to slide in from the edge: the caret is in it, Tab stays
  // in it, Escape closes it, and the caret goes back to the row that was opened.
  useDialogFocus(drawerRef, () => setOpen(null), Boolean(open))

  const person = detail?.person ?? people.find((entry) => entry.id === open)
  const self = person?.id === me?.id
  const lastAdmin = person?.role === 'admin' && person?.status === 'active' && admins <= 1

  async function call(kind: string, path: string, init: RequestInit, done: string) {
    if (!person) return
    setBusy(kind)
    setMessage(undefined)
    try {
      const response = await fetch(path, init)
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setMessage({ tone: 'bad', text: body?.error ?? 'That could not be done.' })
        return undefined
      }
      setMessage({ tone: 'ok', text: done })
      await load()
      return (await response.json().catch(() => null)) as unknown
    } catch {
      setMessage({ tone: 'bad', text: 'The server could not be reached.' })
      return undefined
    } finally {
      setBusy(null)
    }
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  /**
   * Several people at once.
   *
   * The whole selection is judged by the server before anything is written, the way a bulk parent
   * change refuses a selection that would cycle. This side does not guess at the answer and does not
   * change a row optimistically: a half-applied selection is one nobody could reason about after.
   */
  async function bulk(operation: 'deactivate' | 'activate' | 'role') {
    setBusy('bulk')
    setMessage(undefined)
    try {
      const response = await fetch('/api/admin/users/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [...selected], operation, ...(operation === 'role' ? { role: bulkRole } : {}) }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setMessage({ tone: 'bad', text: body?.error ?? 'That selection could not be changed.' })
        return
      }

      const body = (await response.json()) as { changed: number }
      setMessage({ tone: 'ok', text: `${body.changed} ${body.changed === 1 ? 'person' : 'people'} changed.` })
      setSelected(new Set())
      await load()
    } catch {
      setMessage({ tone: 'bad', text: 'The server could not be reached.' })
    } finally {
      setBusy(null)
    }
  }

  async function refresh() {
    if (!open) return
    const response = await fetch(`/api/admin/users/${open}`, { headers: { accept: 'application/json' } })
    if (response.ok) setDetail((await response.json()) as Detail)
  }

  // The export carries the filters the list is showing — the directory as it is seen.
  const exportQuery = new URLSearchParams()
  if (search.trim()) exportQuery.set('q', search.trim())
  if (status) exportQuery.set('status', status)

  return (
    <section className="mt-6 rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-body font-semibold text-slate-900">People</h2>
        <span className="text-meta text-slate-500">{people.length} shown</span>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <label className="relative">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or email"
              aria-label="Search people"
              className={cn(FIELD, 'w-56 pl-6')}
            />
          </label>
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status" className={FIELD}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select value={role} onChange={(event) => setRole(event.target.value)} aria-label="Filter by role" className={FIELD}>
            <option value="">Any role</option>
            {ROLES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <select value={provider} onChange={(event) => setProvider(event.target.value)} aria-label="Filter by provider" className={FIELD}>
            <option value="">Any provider</option>
            {providers.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort" className={FIELD}>
            <option value="name">By name</option>
            <option value="active">By last active</option>
          </select>
          {/* The directory as a file: the columns a person needs, and nothing that could sign in. */}
          <a
            href={`/api/admin/users.csv?${exportQuery.toString()}`}
            download
            className={cn(BUTTON, 'no-underline')}
            title="Download the directory as a CSV file"
          >
            Export CSV
          </a>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1.5">
          <span className="text-meta font-medium text-slate-700">{selected.size} selected</span>
          <button onClick={() => void bulk('deactivate')} disabled={busy === 'bulk'} className={cn(BUTTON, 'px-1.5 text-micro')}>
            Deactivate
          </button>
          <button onClick={() => void bulk('activate')} disabled={busy === 'bulk'} className={cn(BUTTON, 'px-1.5 text-micro')}>
            Activate
          </button>
          <span className="flex items-center gap-1">
            <RoleSelect value={bulkRole} onChange={setBulkRole} label="Role to apply" className="text-micro" />
            <button onClick={() => void bulk('role')} disabled={busy === 'bulk'} className={cn(BUTTON, 'px-1.5 text-micro')}>
              Set role
            </button>
          </span>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-micro text-slate-500 hover:text-slate-800">
            Clear
          </button>
        </div>
      )}

      {message && (
        <p className={cn('mt-3 rounded-md px-2 py-1 text-meta', message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800')}>
          {message.text}
        </p>
      )}

      {error ? (
        <p className="mt-3 rounded-md bg-rose-50 px-2 py-1 text-meta text-rose-800">{error}</p>
      ) : people.length === 0 ? (
        <p className="mt-3 text-meta text-slate-600">
          {search || status || role || provider ? 'Nobody matches those filters.' : 'There is nobody here yet but you.'}
        </p>
      ) : (
        <table className="mt-3 w-full table-fixed border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 text-micro uppercase tracking-wide text-slate-500">
              <th className="w-6 py-1.5" />
              <th className="py-1.5 font-semibold">Person</th>
              <th className="w-28 py-1.5 font-semibold">Role</th>
              <th className="w-24 py-1.5 font-semibold">Status</th>
              <th className="w-32 py-1.5 font-semibold">Last active</th>
              <th className="w-16 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {people.map((entry) => (
              <tr key={entry.id} className="border-b border-slate-100 last:border-0">
                <td className="py-1.5">
                  <input
                    type="checkbox"
                    checked={selected.has(entry.id)}
                    onChange={(event) => {
                      const next = new Set(selected)
                      if (event.target.checked) next.add(entry.id)
                      else next.delete(entry.id)
                      setSelected(next)
                    }}
                    aria-label={`Select ${entry.name}`}
                  />
                </td>
                <td className="truncate py-1.5 pr-2">
                  <span className="font-medium text-slate-800">{entry.name}</span>
                  <span className="ml-1.5 text-meta text-slate-500">{entry.email}</span>
                </td>
                <td className="py-1.5 text-meta text-slate-700">{entry.role}</td>
                <td className="py-1.5">
                  <span className="flex items-center gap-1 text-meta text-slate-700">
                    <span className={cn('size-1.5 rounded-full', entry.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400')} />
                    {entry.status}
                  </span>
                </td>
                <td className="py-1.5 text-meta text-slate-600">{when(entry.lastSeenAt)}</td>
                <td className="py-1.5 text-right">
                  <button
                    onClick={() => {
                      setOpen(entry.id)
                      setMessage(undefined)
                    }}
                    aria-label={`Open ${entry.name}`}
                    className="rounded border border-slate-200 px-1.5 py-0.5 text-micro font-medium text-slate-600 hover:text-slate-900"
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {cursor && (
        <button onClick={() => void load(cursor)} className={cn(BUTTON, 'mt-3')}>
          More
        </button>
      )}

      {person && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30">
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={person.name}
            className="flex h-full w-full max-w-sm flex-col gap-4 overflow-y-auto bg-white p-4 shadow-2xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-body font-semibold text-slate-900">{person.name}</h3>
                <p className="text-meta text-slate-600">{person.email}</p>
              </div>
              <button ref={closeRef} onClick={() => setOpen(null)} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100">
                <X size={16} />
              </button>
            </div>

            <dl className="space-y-1 text-meta">
              <div className="flex justify-between"><dt className="text-slate-500">Status</dt><dd className="text-slate-800">{person.status}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Last active</dt><dd className="text-slate-800">{when(person.lastSeenAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Joined</dt><dd className="text-slate-800">{when(person.joinedAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Instance</dt><dd className="text-slate-800">{person.instanceRole}</dd></div>
            </dl>

            <div className="grid grid-cols-2 gap-2">
              <label className={LABEL}>
                Name
                <input value={draftName} onChange={(event) => setDraftName(event.target.value)} className={cn(FIELD, 'mt-1 w-full')} />
              </label>
              <label className={LABEL}>
                Email
                <input value={draftEmail} onChange={(event) => setDraftEmail(event.target.value)} className={cn(FIELD, 'mt-1 w-full')} />
              </label>
            </div>
            <button
              onClick={() =>
                void call('edit', `/api/admin/users/${person.id}`, json('PATCH', { name: draftName, email: draftEmail }), 'Saved.').then(refresh)
              }
              disabled={busy === 'edit'}
              className={BUTTON}
            >
              Save details
            </button>

            <label className={LABEL}>
              Role in this workspace
              <select
                value={person.role}
                disabled={busy === 'role' || lastAdmin}
                onChange={(event) =>
                  void call(
                    'role',
                    `/api/admin/users/${person.id}/role`,
                    json('PATCH', { role: event.target.value }),
                    `Now a ${event.target.value}.`,
                  ).then(refresh)
                }
                className={cn(FIELD, 'mt-1 w-full')}
              >
                {ROLES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label} — {entry.description}
                  </option>
                ))}
              </select>
            </label>
            {lastAdmin && <p className="text-meta text-slate-500">This is the last administrator; make somebody else one first.</p>}

            <div>
              <p className={LABEL}>Sessions</p>
              <p className="mt-1 text-meta text-slate-700">
                {detail?.sessions.live ?? 0} live · last seen {when(detail?.sessions.lastSeenAt)}
              </p>
              <button
                onClick={() => void call('sessions', `/api/admin/users/${person.id}/sessions/revoke`, { method: 'POST' }, 'Signed out everywhere.').then(refresh)}
                disabled={busy === 'sessions' || !(detail?.sessions.live ?? 0)}
                className={cn(BUTTON, 'mt-1.5')}
              >
                Sign out everywhere
              </button>
            </div>

            {detail?.invite && (
              <div>
                <p className={LABEL}>Invitation</p>
                <p className="mt-1 text-meta text-slate-700">Pending as {detail.invite.role}, expires {when(detail.invite.expiresAt)}.</p>
                <button
                  onClick={() =>
                    void call('resend', `/api/admin/invites/${detail.invite!.id}/resend`, { method: 'POST' }, 'A new link was issued.').then(
                      async (answer) => {
                        const url = (answer as { url?: string } | null)?.url
                        if (url) setIssued(url)
                        await refresh()
                      },
                    )
                  }
                  disabled={busy === 'resend'}
                  className={cn(BUTTON, 'mt-1.5')}
                >
                  Resend link
                </button>
                {issued && (
                  <input readOnly value={issued} aria-label="New invitation link" className={cn(FIELD, 'mt-1.5 w-full text-micro')} onFocus={(event) => event.target.select()} />
                )}
              </div>
            )}

            {detail?.audit?.length ? (
              <div>
                <p className={LABEL}>Recent</p>
                <ul className="mt-1 space-y-0.5 text-meta text-slate-700">
                  {detail.audit.map((entry, index) => (
                    <li key={`${entry.at}-${index}`} className="flex justify-between gap-2">
                      <span className="truncate">{entry.action}</span>
                      <span className="shrink-0 text-slate-500">{entry.actor ?? 'system'} · {when(entry.at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <button
              onClick={() => void call('status', `/api/admin/users/${person.id}/${person.status === 'active' ? 'deactivate' : 'activate'}`, { method: 'POST' }, person.status === 'active' ? 'Can no longer sign in.' : 'Can sign in again.').then(refresh)}
              disabled={busy === 'status' || (self && person.status === 'active')}
              title={self ? 'You cannot deactivate yourself' : undefined}
              className={cn(BUTTON, 'w-full')}
            >
              {person.status === 'active' ? 'Deactivate' : 'Activate'}
            </button>
            {self && person.status === 'active' && <p className="-mt-3 text-meta text-slate-500">You cannot deactivate yourself. Ask another administrator.</p>}

            <div className="border-t border-slate-200 pt-3">
              <p className="text-micro font-semibold uppercase tracking-wide text-rose-700">Danger</p>
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={person.email}
                aria-label="Type the address to confirm"
                className={cn(FIELD, 'mt-2 w-full')}
              />
              <div className="mt-1.5 flex gap-1.5">
                <button
                  onClick={() => void call('delete', `/api/admin/users/${person.id}`, { method: 'DELETE' }, 'Account deleted.').then(() => setOpen(null))}
                  disabled={typed.trim().toLowerCase() !== person.email.toLowerCase() || busy === 'delete' || self}
                  title={self ? 'You cannot delete yourself' : 'Type the address to confirm'}
                  className="flex-1 rounded-md bg-rose-600 px-2 py-1 text-meta font-medium text-white hover:bg-rose-500 disabled:opacity-40"
                >
                  Delete account
                </button>
                <button
                  onClick={() => void call('erase', `/api/admin/users/${person.id}/erase`, { method: 'POST' }, 'The person was erased; the work remains.').then(() => setOpen(null))}
                  disabled={typed.trim().toLowerCase() !== person.email.toLowerCase() || busy === 'erase' || self}
                  title="Erase the person, keep the work"
                  className="flex-1 rounded-md border border-rose-300 px-2 py-1 text-meta font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                >
                  Erase person
                </button>
              </div>
              <p className="mt-1 text-micro text-slate-500">
                Delete removes the account and the way in. Erase keeps the work and removes the person from it.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
