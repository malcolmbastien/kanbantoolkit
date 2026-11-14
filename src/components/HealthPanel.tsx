import { useCallback, useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { downloadText } from '@/lib/download'
import { cn } from '@/lib/utils'

/**
 * The instance administrator's reading of the deployment.
 *
 * This is not a metrics dashboard. It answers whether the database and schema are where they should
 * be, who is here, and what the client has reported failing — the questions that otherwise send a
 * self-hoster to the source. It reads on open and when asked; there is no polling and nothing leaves
 * the instance.
 */

interface HealthView {
  schema: number
  expected: number
  database: 'ok' | 'behind'
  release?: string
  counts: { accounts: number; inactive: number; admins: number; members: number }
  errors: { total: number; newest?: string }
}

interface ErrorRow {
  id: number
  at: string
  message: string
  url: string
  view: string
  release: string
  ua: string
}

interface ErrorDetail extends ErrorRow {
  stack: string
}

const BUTTON = 'rounded-md border border-slate-200 px-2 py-1 text-meta font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40'

const when = (at: string | undefined) => (at === undefined ? '—' : new Date(at).toLocaleString())

async function json<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `the server answered ${response.status}`)
  }
  return (await response.json()) as T
}

function Reading({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
      <div className="text-micro font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 truncate text-body font-semibold tabular-nums text-slate-900" title={value}>
        {value}
      </div>
      {note && <div className="mt-0.5 text-micro text-slate-500">{note}</div>}
    </div>
  )
}

export function HealthPanel({ onOpenTab }: { onOpenTab?: (tab: 'backups' | 'webhooks') => void }) {
  const [health, setHealth] = useState<HealthView | undefined>()
  const [errors, setErrors] = useState<ErrorRow[]>([])
  const [detail, setDetail] = useState<ErrorDetail | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      const [nextHealth, nextErrors] = await Promise.all([
        json<HealthView>('/api/admin/health'),
        json<{ errors: ErrorRow[] }>('/api/admin/errors?limit=50'),
      ])
      setHealth(nextHealth)
      setErrors(nextErrors.errors)
      setDetail(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The instance health could not be read.')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const open = async (id: number) => {
    try {
      setDetail(await json<ErrorDetail>(`/api/admin/errors/${id}`))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That report could not be read.')
    }
  }

  const diagnostics = () => {
    downloadText(
      `kanbantoolkit-health-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ generatedAt: new Date().toISOString(), health, errors }, null, 2),
      'application/json',
    )
  }

  return (
    <section className="space-y-3">
      <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-body font-semibold text-slate-900">Health</h2>
            <p className="mt-1 text-meta text-slate-600">
              The schema, the database and the reports the browser has sent. This page reads the
              instance; it does not send anything from it.
            </p>
          </div>
          <button className={cn(BUTTON, 'inline-flex items-center gap-1')} onClick={() => void load()} disabled={busy}>
            <RefreshCw size={12} className={busy ? 'animate-spin' : undefined} /> Refresh
          </button>
          <button
            className={cn(BUTTON, 'inline-flex items-center gap-1')}
            onClick={diagnostics}
            disabled={!health}
            title="Download the health reading and visible error reports as JSON"
          >
            <Download size={12} /> Diagnostics
          </button>
        </div>

        {error && <p data-health-error className="mt-3 rounded-md bg-rose-50 px-2 py-1 text-meta text-rose-800">{error}</p>}

        {!health && !error ? (
          <p className="mt-3 text-meta text-slate-500">Reading the instance…</p>
        ) : health ? (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Reading label="Schema" value={`${health.schema} of ${health.expected}`} note={health.database === 'ok' ? 'up to date' : 'behind'} />
              <Reading label="Accounts" value={String(health.counts.accounts)} note={`${health.counts.inactive} inactive`} />
              <Reading label="Admins" value={String(health.counts.admins)} note={`${health.counts.members} members`} />
              <Reading label="Errors" value={String(health.errors.total)} note={health.errors.newest ? `newest ${when(health.errors.newest)}` : 'none reported'} />
              <Reading label="Release" value={health.release ?? '—'} note={health.release ? 'running build' : 'not reported'} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-micro text-slate-600">
              <span data-health-database={health.database} className={cn('rounded px-1.5 py-0.5 font-medium', health.database === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')}>
                Database {health.database}
              </span>
              <span className="text-slate-500">Read from the instance database; no remote check.</span>
              {onOpenTab && (
                <>
                  <button className="underline decoration-slate-300 underline-offset-2 hover:text-indigo-700" onClick={() => onOpenTab('backups')}>
                    Backups
                  </button>
                  <button className="underline decoration-slate-300 underline-offset-2 hover:text-indigo-700" onClick={() => onOpenTab('webhooks')}>
                    Webhooks
                  </button>
                </>
              )}
            </div>
          </>
        ) : null}
      </div>

      <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-body font-semibold text-slate-900">Client errors</h2>
        <p className="mt-1 text-meta text-slate-600">
          What the browser reported, newest first. A report carries a message, stack, path, view,
          build and browser — never a query string or an address.
        </p>
        {errors.length === 0 ? (
          <p data-health-errors-empty className="mt-3 text-meta text-slate-600">No client errors have been reported.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table data-health-errors className="w-full border-collapse text-left text-meta">
              <thead>
                <tr className="border-b border-slate-200 text-micro uppercase tracking-wide text-slate-600">
                  <th className="py-1.5 pr-3 font-semibold">When</th>
                  <th className="px-3 py-1.5 font-semibold">View</th>
                  <th className="px-3 py-1.5 font-semibold">Message</th>
                  <th className="px-3 py-1.5 font-semibold">Release</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 last:border-0">
                    <td className="whitespace-nowrap py-1.5 pr-3 text-slate-500">{when(row.at)}</td>
                    <td className="px-3 py-1.5 text-slate-600">{row.view}</td>
                    <td className="max-w-[28rem] px-3 py-1.5">
                      <button
                        className="block w-full truncate text-left text-slate-800 underline decoration-slate-300 underline-offset-2 hover:text-indigo-700"
                        onClick={() => void open(row.id)}
                        title={row.message}
                      >
                        {row.message}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-micro text-slate-500">{row.release}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {errors.length > 0 && <p className="mt-1 text-micro text-slate-500">Showing the newest {errors.length}; refresh for the latest.</p>}
      </div>

      {detail && (
        <div data-health-error-detail className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-body font-semibold text-slate-900">Report #{detail.id}</h2>
              <p className="mt-0.5 text-meta text-slate-600">
                {when(detail.at)} · {detail.view} · {detail.release}
              </p>
            </div>
            <button className={BUTTON} onClick={() => setDetail(undefined)}>
              Close
            </button>
          </div>
          <dl className="mt-3 grid gap-x-4 gap-y-1 text-meta sm:grid-cols-[8rem_1fr]">
            <dt className="font-semibold text-slate-700">Path</dt>
            <dd className="break-all text-slate-600">{detail.url}</dd>
            <dt className="font-semibold text-slate-700">Browser</dt>
            <dd className="break-all text-slate-600">{detail.ua}</dd>
          </dl>
          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-3 text-micro text-slate-100">{detail.stack}</pre>
        </div>
      )}
    </section>
  )
}
