import { useCallback, useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { ROLES } from '@/domain/roles'
import type { Role } from '@/domain/roles'
import { cn } from '@/lib/utils'

/**
 * The people who may use this instance.
 *
 * A table, a drawer, and the four things an administrator does to somebody: change what they may
 * do, close their door, open it, or delete the account. Everything destructive asks for the address
 * to be typed, because a mis-click in a directory is a person who cannot get in tomorrow.
 *
 * The guards are the server's; the disabled controls here are the explanation. A control that is
 * refused anyway says why beside itself rather than leaving the person to guess.
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

const FIELD =
  'rounded-md border border-slate-200 bg-white px-2 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400'

const when = (value: string | undefined) =>
  value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'never'

export function PeoplePanel() {
  const me = useAuth((state) => state.user)

  const [people, setPeople] = useState<Person[]>([])
  const [admins, setAdmins] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [role, setRole] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [typed, setTyped] = useState('')

  const load = useCallback(
    async (after?: string) => {
      setError(undefined)
      const params = new URLSearchParams()
      if (search.trim()) params.set('q', search.trim())
      if (status) params.set('status', status)
      if (role) params.set('role', role)
      if (after) params.set('after', after)

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
        const body = (await response.json()) as { people: Person[]; cursor: string | null; admins: number }
        setPeople((current) => (after ? [...current, ...body.people] : body.people))
        setCursor(body.cursor)
        setAdmins(body.admins)
      } catch {
        setError('The server could not be reached, so the directory is not available.')
      }
    },
    [search, status, role],
  )

  useEffect(() => {
    void load()
  }, [load])

  // Escape closes the drawer — the same key that closes the board's own.
  useEffect(() => {
    if (!open) return
    const away = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null)
    }
    document.addEventListener('keydown', away)
    return () => document.removeEventListener('keydown', away)
  }, [open])

  const person = people.find((entry) => entry.id === open)

  async function changeRole(target: Person, next: Role) {
    setBusy(target.id)
    setMessage(undefined)
    try {
      const response = await fetch(`/api/admin/users/${target.id}/role`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: next }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setMessage({ tone: 'bad', text: body?.error ?? 'That could not be changed.' })
        return
      }
      setMessage({ tone: 'ok', text: `${target.name} is now a ${next}.` })
      await load()
    } catch {
      setMessage({ tone: 'bad', text: 'The server could not be reached.' })
    } finally {
      setBusy(null)
    }
  }

  async function act(target: Person, kind: 'deactivate' | 'activate' | 'delete') {
    setBusy(target.id)
    setMessage(undefined)
    try {
      const response =
        kind === 'delete'
          ? await fetch(`/api/admin/users/${target.id}`, { method: 'DELETE' })
          : await fetch(`/api/admin/users/${target.id}/${kind}`, { method: 'POST' })

      if (!response.ok) {
        // The guard's sentence verbatim: "you cannot deactivate yourself" is more use than
        // "something went wrong".
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setMessage({ tone: 'bad', text: body?.error ?? 'That could not be done.' })
        return
      }

      setMessage({
        tone: 'ok',
        text:
          kind === 'delete'
            ? `${target.name}'s account was deleted.`
            : kind === 'deactivate'
              ? `${target.name} can no longer sign in.`
              : `${target.name} can sign in again.`,
      })
      setTyped('')
      setOpen(null)
      await load()
    } catch {
      setMessage({ tone: 'bad', text: 'The server could not be reached.' })
    } finally {
      setBusy(null)
    }
  }

  const self = person?.id === me?.id
  const lastAdmin = person?.role === 'admin' && person?.status === 'active' && admins <= 1

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
        </div>
      </div>

      {message && (
        <p className={cn('mt-3 rounded-md px-2 py-1 text-meta', message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800')}>
          {message.text}
        </p>
      )}

      {error ? (
        <p className="mt-3 rounded-md bg-rose-50 px-2 py-1 text-meta text-rose-800">{error}</p>
      ) : people.length === 0 ? (
        <p className="mt-3 text-meta text-slate-600">
          {search || status || role ? 'Nobody matches those filters.' : 'There is nobody here yet but you.'}
        </p>
      ) : (
        <table className="mt-3 w-full table-fixed border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 text-micro uppercase tracking-wide text-slate-500">
              <th className="py-1.5 font-semibold">Person</th>
              <th className="w-28 py-1.5 font-semibold">Role</th>
              <th className="w-24 py-1.5 font-semibold">Status</th>
              <th className="w-28 py-1.5 font-semibold">Last active</th>
              <th className="w-16 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {people.map((entry) => (
              <tr key={entry.id} className="border-b border-slate-100 last:border-0">
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
                      setTyped('')
                      setMessage(undefined)
                    }}
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
        <button onClick={() => void load(cursor)} className="mt-3 rounded-md border border-slate-200 px-2 py-1 text-meta font-medium text-slate-600 hover:text-slate-900">
          More
        </button>
      )}

      {person && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" role="dialog" aria-modal="true" aria-label={`${person.name}`}>
          <div className="flex h-full w-full max-w-sm flex-col overflow-y-auto bg-white p-4 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-body font-semibold text-slate-900">{person.name}</h3>
                <p className="text-meta text-slate-600">{person.email}</p>
              </div>
              <button onClick={() => setOpen(null)} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100">
                <X size={16} />
              </button>
            </div>

            <dl className="mt-3 space-y-1 text-meta">
              <div className="flex justify-between"><dt className="text-slate-500">Status</dt><dd className="text-slate-800">{person.status}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Last active</dt><dd className="text-slate-800">{when(person.lastSeenAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Joined</dt><dd className="text-slate-800">{when(person.joinedAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Instance</dt><dd className="text-slate-800">{person.instanceRole}</dd></div>
            </dl>

            <label className="mt-4 block text-micro font-semibold uppercase tracking-wide text-slate-500">
              Role in this workspace
              <select
                value={person.role}
                disabled={busy === person.id || lastAdmin}
                onChange={(event) => void changeRole(person, event.target.value as Role)}
                className={cn(FIELD, 'mt-1 w-full')}
              >
                {ROLES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label} — {entry.description}
                  </option>
                ))}
              </select>
            </label>
            {lastAdmin && <p className="mt-1 text-meta text-slate-500">This is the last administrator; make somebody else one first.</p>}

            <div className="mt-4 space-y-1.5">
              <button
                onClick={() => void act(person, person.status === 'active' ? 'deactivate' : 'activate')}
                disabled={busy === person.id || (self && person.status === 'active')}
                title={self ? 'You cannot deactivate yourself' : undefined}
                className="w-full rounded-md border border-slate-200 px-2 py-1 text-meta font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                {person.status === 'active' ? 'Deactivate' : 'Activate'}
              </button>
              {self && <p className="text-meta text-slate-500">You cannot deactivate yourself. Ask another administrator.</p>}
            </div>

            <div className="mt-6 border-t border-slate-200 pt-3">
              <p className="text-micro font-semibold uppercase tracking-wide text-rose-700">Danger</p>
              <p className="mt-1 text-meta text-slate-600">Deleting removes the account and the way in. The work that names them stays.</p>
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={person.email}
                aria-label="Type the address to confirm"
                className={cn(FIELD, 'mt-2 w-full')}
              />
              <button
                onClick={() => void act(person, 'delete')}
                disabled={typed.trim().toLowerCase() !== person.email.toLowerCase() || busy === person.id || self}
                title={self ? 'You cannot delete yourself' : 'Type the address to confirm'}
                className="mt-1.5 w-full rounded-md bg-rose-600 px-2 py-1 text-meta font-medium text-white hover:bg-rose-500 disabled:opacity-40"
              >
                Delete account
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
