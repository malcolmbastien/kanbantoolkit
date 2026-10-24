import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

/**
 * The trail, and how the instance is.
 *
 * The audit list reads as sentences rather than as a JSON dump — "Ada changed Grace's role to editor"
 * is what somebody came for, and the raw action is one click away in the detail. The health section
 * is the read side of two promises already made: the error inbox from task 107, and the counts the
 * directory shows.
 *
 * Nothing here adds data. Every number is a read of a table that already existed.
 */

interface Event {
  id: number
  at: string
  action: string
  actorName?: string
  targetType?: string
  targetId?: string
  targetName?: string
  data?: Record<string, unknown>
}

interface Health {
  schema: number
  expected: number
  database: string
  counts: { accounts: number; inactive: number; admins: number; members: number }
  errors: { total: number; newest?: string }
}

interface Report {
  id: number
  at: string
  message: string
  stack?: string
  url: string
  view: string
  release: string
  ua: string
}

const FIELD =
  'rounded-md border border-slate-200 bg-white px-2 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400'
const BUTTON = 'rounded-md border border-slate-200 px-2 py-1 text-meta font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40'
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** The row as a person would say it. The raw action stays in the detail for the curious. */
function sentence(event: Event): string {
  const who = event.actorName ?? 'Somebody'
  const whom = event.targetName ?? 'somebody'
  const data = event.data ?? {}

  switch (event.action) {
    case 'signin':
      return `${who} signed in.`
    case 'signin.refused':
      return `A sign-in was refused (${String(data.reason ?? 'not admitted')}).`
    case 'signout':
      return `${who} signed out.`
    case 'invite.create':
      return `${who} made an invitation as ${String(data.role ?? 'editor')}.`
    case 'invite.resend':
      return `${who} issued a new link for an invitation.`
    case 'invite.revoke':
      return `${who} revoked an invitation.`
    case 'invite.accepted':
      return 'An invitation was accepted.'
    case 'user.deactivate':
      return `${who} deactivated ${whom}.`
    case 'user.activate':
      return `${who} let ${whom} back in.`
    case 'user.edit':
      return `${who} edited ${whom}'s details.`
    case 'user.role':
      return `${who} made ${whom} a ${String(data.workspaceRole ?? 'member')}.`
    case 'user.delete':
      return `${who} deleted ${whom}'s account.`
    case 'user.erase':
      return `${who} erased ${whom}.`
    case 'session.revoke':
      return `${who} signed ${whom} out everywhere.`
    case 'identity.unlink':
      return `${who} unlinked a way into their account.`
    case 'instance.access':
      return `${who} set the instance to ${String(data.access ?? 'closed')}.`
    case 'workspace.import':
      return `${who} imported a workspace.`
    case 'workspace.settings':
      return `${who} changed this workspace's name or description.`
    case 'workspace.role':
      return `${who} made ${whom} a ${String(data.role ?? 'member')} here.`
    case 'workspace.member.remove':
      return `${who} removed ${whom} from this workspace.`
    case 'workspace.invite':
      return `${who} invited somebody into this workspace.`
    default:
      return `${who} did ${event.action}.`
  }
}

export function AuditPanel() {
  const [events, setEvents] = useState<Event[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [scope, setScope] = useState('instance')
  const [action, setAction] = useState('')
  const [open, setOpen] = useState<Event | null>(null)
  const [error, setError] = useState<string | undefined>()

  const load = useCallback(
    async (after?: string) => {
      setError(undefined)
      const params = new URLSearchParams()
      if (action.trim()) params.set('action', action.trim())
      if (after) params.set('after', after)

      try {
        const response = await fetch(`/api/admin/audit?${params}`, { headers: { accept: 'application/json' } })
        if (!response.ok) {
          setError('The trail could not be read.')
          return
        }
        const body = (await response.json()) as { events: Event[]; cursor: string | null; scope: string }
        setEvents((current) => (after ? [...current, ...body.events] : body.events))
        setCursor(body.cursor)
        setScope(body.scope)
      } catch {
        setError('The server could not be reached.')
      }
    },
    [action],
  )

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="mt-6 rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-body font-semibold text-slate-900">Audit</h2>
        <span className="text-meta text-slate-500">
          {scope === 'instance' ? 'every change in this instance' : 'what this workspace did'} · kept for 90 days
        </span>
        <input
          value={action}
          onChange={(event) => setAction(event.target.value)}
          placeholder="Filter by action, e.g. user."
          aria-label="Filter by action"
          className={cn(FIELD, 'ml-auto w-64')}
        />
      </div>

      {error ? (
        <p className="mt-3 rounded-md bg-rose-50 px-2 py-1 text-meta text-rose-800">{error}</p>
      ) : events.length === 0 ? (
        <p className="mt-3 text-meta text-slate-600">Nothing has happened yet{action ? ' that matches that filter' : ''}.</p>
      ) : (
        <table className="mt-3 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 text-micro uppercase tracking-wide text-slate-500">
              <th className="w-36 py-1.5 font-semibold">When</th>
              <th className="py-1.5 font-semibold">What</th>
              <th className="w-16 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b border-slate-100 last:border-0">
                <td className="py-1.5 text-meta text-slate-600">{when(event.at)}</td>
                <td className="py-1.5 text-meta text-slate-800">{sentence(event)}</td>
                <td className="py-1.5 text-right">
                  <button onClick={() => setOpen(event)} className="rounded border border-slate-200 px-1.5 py-0.5 text-micro text-slate-600 hover:text-slate-900">
                    Detail
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

      {open && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Event detail">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-2xl ring-1 ring-slate-200">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-body font-semibold text-slate-900">{sentence(open)}</h3>
                <p className="text-meta text-slate-600">{when(open.at)}</p>
              </div>
              <button onClick={() => setOpen(null)} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100">
                ✕
              </button>
            </div>
            <dl className="mt-3 space-y-1 text-meta">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Action</dt><dd className="font-mono text-slate-800">{open.action}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Actor</dt><dd className="text-slate-800">{open.actorName ?? 'system'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Target</dt><dd className="text-slate-800">{open.targetType ?? '—'} {open.targetName ?? open.targetId ?? ''}</dd></div>
            </dl>
            {open.data && (
              <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-micro text-slate-700">{JSON.stringify(open.data, null, 2)}</pre>
            )}
            <div className="mt-3 flex justify-end">
              <button onClick={() => setOpen(null)} className={BUTTON}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export function HealthPanel() {
  const auth = useAuth()
  const [health, setHealth] = useState<Health | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [state, inbox] = await Promise.all([
          fetch('/api/admin/health', { headers: { accept: 'application/json' } }),
          fetch('/api/admin/errors', { headers: { accept: 'application/json' } }),
        ])
        if (!state.ok) {
          if (live) setError('Only an instance administrator can see the health of this instance.')
          return
        }
        if (!live) return
        setHealth((await state.json()) as Health)
        if (inbox.ok) setReports(((await inbox.json()) as { errors: Report[] }).errors)
      } catch {
        if (live) setError('The server could not be reached.')
      }
    })()
    return () => {
      live = false
    }
  }, [])

  async function open(report: Report) {
    const response = await fetch(`/api/admin/errors/${report.id}`, { headers: { accept: 'application/json' } })
    if (response.ok) setReport((await response.json()) as Report)
  }

  if (error) return null

  return (
    <section className="mt-6 rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <h2 className="text-body font-semibold text-slate-900">Health</h2>

      {/* The posture, said plainly, with what to do about it. */}
      <div className="mt-2 space-y-1.5">
        {auth.access === 'open' && (
          <p className="rounded-md bg-amber-50 px-2 py-1 text-meta text-amber-900">
            This instance lets anyone with a provider sign in, as a viewer. Close it in the access setting when it is not wanted.
          </p>
        )}
        {auth.dev && (
          <p className="rounded-md bg-amber-50 px-2 py-1 text-meta text-amber-900">
            Development sign-in is on: anybody can be anybody. It must be off before an instance people rely on goes live.
          </p>
        )}
        {auth.providers.length === 0 && (
          <p className="rounded-md bg-slate-50 px-2 py-1 text-meta text-slate-700">
            No sign-in provider is configured, so the only way in is the development switch. See the README for the client variables.
          </p>
        )}
      </div>

      {health && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'Database', value: health.database === 'ok' ? 'reachable' : 'behind' },
            { label: 'Schema', value: `${health.schema} of ${health.expected}` },
            { label: 'Accounts', value: `${health.counts.accounts} (${health.counts.inactive} inactive)` },
            { label: 'Administrators', value: String(health.counts.admins) },
          ].map((card) => (
            <div key={card.label} className="rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200">
              <p className="text-micro uppercase tracking-wide text-slate-500">{card.label}</p>
              <p className="text-meta font-medium text-slate-800">{card.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center gap-2">
          <h3 className="text-meta font-semibold text-slate-800">Error reports</h3>
          <span className="text-meta text-slate-500">
            {reports.length} stored · at most 30 an hour from one address
          </span>
        </div>
        {reports.length === 0 ? (
          <p className="mt-1 text-meta text-slate-600">Nothing has been reported.</p>
        ) : (
          <table className="mt-1 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 text-micro uppercase tracking-wide text-slate-500">
                <th className="w-36 py-1.5 font-semibold">When</th>
                <th className="py-1.5 font-semibold">Message</th>
                <th className="w-28 py-1.5 font-semibold">Build</th>
                <th className="w-16 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {reports.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 text-meta text-slate-600">{when(entry.at)}</td>
                  <td className="truncate py-1.5 text-meta text-slate-800">{entry.message}</td>
                  <td className="py-1.5 font-mono text-micro text-slate-600">{entry.release}</td>
                  <td className="py-1.5 text-right">
                    <button onClick={() => void open(entry)} className="rounded border border-slate-200 px-1.5 py-0.5 text-micro text-slate-600 hover:text-slate-900">
                      Stack
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {report && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Error report">
          <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-2xl ring-1 ring-slate-200">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-body font-semibold text-slate-900">{report.message}</h3>
                <p className="text-meta text-slate-600">
                  {report.view} · {report.url} · {report.release} · {when(report.at)}
                </p>
              </div>
              <button onClick={() => setReport(null)} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100">
                ✕
              </button>
            </div>
            {/* The path and the build, and nothing that was never stored: no query, no address. */}
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-micro text-slate-700">{report.stack ?? 'no stack'}</pre>
            <p className="mt-1 text-micro text-slate-500">{report.ua}</p>
            <div className="mt-3 flex justify-end">
              <button onClick={() => setReport(null)} className={BUTTON}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
