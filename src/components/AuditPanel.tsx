import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The trail, as a file.
 *
 * A list of every change is a screen somebody has to watch; an export is the record somebody asks
 * for when they need it. The panel therefore states the scope and the retention, offers the filter
 * the export honours, and keeps the reading for the file.
 *
 * Nothing here adds data: the file is a read of `audit_events`, in the scope the caller's role
 * allows.
 */

const FIELD =
  'rounded-md border border-slate-200 bg-white px-2 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400'
const BUTTON = 'rounded-md border border-slate-200 px-2 py-1 text-meta font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40'

export function AuditPanel() {
  const [action, setAction] = useState('')
  const [scope, setScope] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const response = await fetch('/api/admin/audit?limit=1', { headers: { accept: 'application/json' } })
        if (!response.ok) {
          if (live) setError('The trail could not be read.')
          return
        }
        const body = (await response.json()) as { scope: string }
        if (live) setScope(body.scope)
      } catch {
        if (live) setError('The server could not be reached.')
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const query = action.trim() ? '?action=' + encodeURIComponent(action.trim()) : ''
  const href = '/api/admin/audit.csv' + query

  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-body font-semibold text-slate-900">Audit</h2>
        <span className="text-meta text-slate-500">
          {scope === 'workspace' ? 'what this workspace did' : 'every change in this instance'} · kept
          for 90 days
        </span>
      </div>
      <p className="mt-1 text-meta text-slate-600">
        The trail is not shown here. Export it as a CSV file — a row per change, with who did it, what
        it was done to, and the raw action — and read it wherever a record belongs.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block text-micro font-semibold uppercase tracking-wide text-slate-500">
          Filter by action
          <input
            value={action}
            onChange={(event) => setAction(event.target.value)}
            placeholder="e.g. user. or workspace."
            aria-label="Filter by action"
            className={cn(FIELD, 'mt-1 block w-56')}
          />
        </label>
        <a
          href={href}
          download
          className={cn(BUTTON, 'no-underline')}
          title="Download the trail as a CSV file"
        >
          Export audit log (CSV)
        </a>
      </div>
      <p className="mt-1 text-micro text-slate-500">
        A filter narrows the file to the actions it names. Leaving it blank exports everything your
        role may read.
      </p>

      {error && <p className="mt-3 rounded-md bg-rose-50 px-2 py-1 text-meta text-rose-800">{error}</p>}
    </section>
  )
}
