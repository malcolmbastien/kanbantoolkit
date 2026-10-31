import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, RefreshCw, Send, Trash2 } from 'lucide-react'
import {
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_EVENT_TYPES,
  type WebhookDeliveryView,
  type WebhookEndpointView,
  type WebhookEventType,
} from '@/domain/webhooks'
import { cn } from '@/lib/utils'

/**
 * Outbound webhooks, from the administrator's side.
 *
 * An endpoint is a URL, a set of events and a signing secret. The secret is shown once, at the
 * moment it is made; after that the screen can say an endpoint is signed but can never show the key
 * again. The delivery log is the other half: what was sent, what answered, and a retry for the one
 * that did not land.
 */

const FIELD =
  'rounded-md border border-slate-200 bg-white px-2 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-300'
const BUTTON =
  'rounded-md border border-slate-200 px-2 py-1 text-meta font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40'
const STATUS: Record<WebhookDeliveryView['status'], string> = {
  pending: 'bg-amber-50 text-amber-800 ring-amber-300',
  delivering: 'bg-sky-50 text-sky-800 ring-sky-300',
  delivered: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  failed: 'bg-rose-50 text-rose-800 ring-rose-300',
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: 'application/json', 'content-type': 'application/json', ...(init?.headers as Record<string, string>) },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `the server answered ${response.status}`)
  }
  return (await response.json()) as T
}

export function WebhooksPanel() {
  const [endpoints, setEndpoints] = useState<WebhookEndpointView[]>([])
  const [selected, setSelected] = useState<string | undefined>()
  const [deliveries, setDeliveries] = useState<WebhookDeliveryView[]>([])
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<WebhookEventType[]>([])
  const [secret, setSecret] = useState<{ url: string; secret: string } | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const body = await request<{ endpoints: WebhookEndpointView[] }>('/api/admin/webhooks')
    setEndpoints(body.endpoints)
    setSelected((current) => current ?? body.endpoints[0]?.id)
  }

  const loadDeliveries = async (endpointId: string) => {
    const body = await request<{ deliveries: WebhookDeliveryView[] }>(`/api/admin/webhooks/${endpointId}/deliveries`)
    setDeliveries(body.deliveries)
  }

  useEffect(() => {
    let live = true
    void request<{ endpoints: WebhookEndpointView[] }>('/api/admin/webhooks')
      .then((body) => {
        if (!live) return
        setEndpoints(body.endpoints)
        setSelected(body.endpoints[0]?.id)
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : 'The webhooks could not be read.')
      })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!selected) {
      setDeliveries([])
      return
    }
    let live = true
    void request<{ deliveries: WebhookDeliveryView[] }>(`/api/admin/webhooks/${selected}/deliveries`)
      .then((body) => {
        if (live) setDeliveries(body.deliveries)
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : 'The deliveries could not be read.')
      })
    return () => {
      live = false
    }
  }, [selected])

  const act = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      await work()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    act(async () => {
      const created = await request<WebhookEndpointView>('/api/admin/webhooks', {
        method: 'POST',
        body: JSON.stringify({ url: url.trim(), eventTypes: events }),
      })
      setUrl('')
      setEvents([])
      setSecret(created.secret ? { url: created.url, secret: created.secret } : undefined)
      await load()
      setSelected(created.id)
      setNotice('Endpoint created. Copy the signing secret now — it is not shown again.')
    })

  const endpoint = endpoints.find((entry) => entry.id === selected)

  return (
    <div className="space-y-3" data-webhooks-panel>
      <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-body font-semibold text-slate-900">Webhooks</h2>
        <p className="mt-1 max-w-2xl text-meta text-slate-600">
          Send signed events to a URL when work changes. A receiver verifies <code>X-Kanban-Signature</code> over
          the timestamp and the raw body. Deliveries are retried, and the log below says what answered.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-[18rem] flex-1 text-micro font-semibold uppercase tracking-wide text-slate-500">
            Endpoint URL
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/kanban/events"
              aria-label="Endpoint URL"
              className={cn(FIELD, 'mt-1 block w-full')}
            />
          </label>
          <button disabled={busy || !url.trim()} onClick={() => void create()} className={cn(BUTTON, 'bg-indigo-600 text-white hover:bg-indigo-500')}>
            Add endpoint
          </button>
        </div>

        <fieldset className="mt-3">
          <legend className="text-micro font-semibold uppercase tracking-wide text-slate-500">
            Events <span className="font-normal normal-case text-slate-400">— nothing selected means everything</span>
          </legend>
          <div className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {WEBHOOK_EVENT_TYPES.filter((type) => type !== 'webhook.test').map((type) => (
              <label key={type} className="flex items-start gap-2 text-meta text-slate-700">
                <input
                  type="checkbox"
                  checked={events.includes(type)}
                  onChange={(event) =>
                    setEvents((current) => (event.target.checked ? [...current, type] : current.filter((entry) => entry !== type)))
                  }
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">{WEBHOOK_EVENT_LABELS[type]}</span>
                  <span className="ml-1 font-mono text-micro text-slate-500">{type}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {secret && (
          <div data-webhook-secret className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-meta text-amber-900">
            <p className="font-semibold">Signing secret for {secret.url}</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded bg-white/80 px-2 py-1 font-mono text-micro">{secret.secret}</code>
              <button
                onClick={() => void navigator.clipboard?.writeText(secret.secret)}
                className={BUTTON}
                title="Copy the secret"
              >
                <Copy size={11} className="mr-1 inline" /> Copy
              </button>
            </div>
            <p className="mt-1 text-micro">This is the only time it is shown. Store it in the receiver's configuration.</p>
          </div>
        )}

        {error && <p className="mt-3 rounded-md bg-rose-50 px-2 py-1 text-meta text-rose-800">{error}</p>}
        {notice && <p className="mt-3 rounded-md bg-emerald-50 px-2 py-1 text-meta text-emerald-800">{notice}</p>}
      </section>

      <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-body font-semibold text-slate-900">Endpoints</h3>
          <span className="text-micro text-slate-500">{endpoints.length}</span>
          <button
            className={cn(BUTTON, 'ml-auto')}
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const result = await request<{ delivered: number; retried: number; failed: number }>('/api/admin/webhooks/dispatch', {
                  method: 'POST',
                  body: '{}',
                })
                await loadDeliveries(selected ?? '')
                setNotice(`Sent ${result.delivered}, retrying ${result.retried}, failed ${result.failed}.`)
              })
            }
            title="Send every delivery that is due now"
          >
            <RefreshCw size={11} className="mr-1 inline" /> Send due now
          </button>
        </div>

        {endpoints.length === 0 ? (
          <p className="mt-2 text-meta text-slate-600">No endpoint yet. Add one above; it starts with every event.</p>
        ) : (
          <div className="mt-2 divide-y divide-slate-100">
            {endpoints.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center gap-2 py-2">
                <button
                  onClick={() => setSelected(entry.id)}
                  className={cn(
                    'min-w-0 max-w-[55%] flex-1 truncate text-left text-meta font-medium',
                    entry.id === selected ? 'text-indigo-700' : 'text-slate-800 hover:text-indigo-700',
                  )}
                  title={entry.url}
                >
                  {entry.url}
                </button>
                <span className={cn('rounded px-1 py-px text-micro font-semibold ring-1', entry.active ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-slate-200')}>
                  {entry.active ? 'Active' : 'Paused'}
                </span>
                <span className="text-micro text-slate-500">
                  {entry.eventTypes.length === 0 ? 'all events' : `${entry.eventTypes.length} events`}
                </span>
                {entry.disabledReason && <span className="text-micro text-rose-700">{entry.disabledReason}</span>}
                <button
                  className={BUTTON}
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await request(`/api/admin/webhooks/${entry.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ active: !entry.active }),
                      })
                      await load()
                    })
                  }
                >
                  {entry.active ? 'Pause' : 'Resume'}
                </button>
                <button
                  className={BUTTON}
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await request(`/api/admin/webhooks/${entry.id}/test`, { method: 'POST', body: '{}' })
                      setSelected(entry.id)
                      await loadDeliveries(entry.id)
                      setNotice('Test event queued. “Send due now” delivers it immediately.')
                    })
                  }
                >
                  <Send size={11} className="mr-1 inline" /> Test
                </button>
                <button
                  className={cn(BUTTON, 'text-rose-700')}
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Delete the webhook ${entry.url}?`)) return
                    void act(async () => {
                      await request(`/api/admin/webhooks/${entry.id}`, { method: 'DELETE' })
                      setSelected(undefined)
                      await load()
                    })
                  }}
                  title="Delete this endpoint"
                >
                  <Trash2 size={11} className="mr-1 inline" /> Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200" data-webhook-deliveries>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-body font-semibold text-slate-900">Recent deliveries</h3>
          <span className="text-micro text-slate-500">{endpoint?.url ?? 'Choose an endpoint'}</span>
          <a
            className={cn(BUTTON, 'ml-auto no-underline')}
            href={endpoint ? `/api/admin/webhooks/${endpoint.id}/deliveries` : '#'}
            onClick={(event) => {
              if (!endpoint) event.preventDefault()
            }}
            title="Open the delivery log as JSON"
          >
            <ExternalLink size={11} className="mr-1 inline" /> Raw
          </a>
        </div>
        {!endpoint ? (
          <p className="mt-2 text-meta text-slate-600">No endpoint selected.</p>
        ) : deliveries.length === 0 ? (
          <p className="mt-2 text-meta text-slate-600">Nothing delivered yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[42rem] text-left text-meta">
              <thead className="text-micro uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1 pr-2">Event</th>
                  <th className="py-1 pr-2">Status</th>
                  <th className="py-1 pr-2">Tries</th>
                  <th className="py-1 pr-2">Answer</th>
                  <th className="py-1 pr-2">When</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {deliveries.map((delivery) => (
                  <tr key={delivery.id} className="border-t border-slate-100 align-top">
                    <td className="py-1 pr-2 font-mono text-micro text-slate-700">{delivery.eventType}</td>
                    <td className="py-1 pr-2">
                      <span className={cn('rounded px-1 py-px text-micro font-semibold ring-1', STATUS[delivery.status])}>
                        {delivery.status}
                      </span>
                    </td>
                    <td className="py-1 pr-2 tabular-nums text-slate-600">{delivery.attempts}</td>
                    <td className="max-w-[16rem] py-1 pr-2 text-micro text-slate-600">
                      {delivery.responseStatus ? `HTTP ${delivery.responseStatus}` : delivery.error ?? '—'}
                    </td>
                    <td className="whitespace-nowrap py-1 pr-2 text-micro text-slate-500">
                      {new Date(delivery.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-1 text-right">
                      {delivery.status === 'failed' && (
                        <button
                          className={BUTTON}
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              await request(`/api/admin/webhooks/deliveries/${delivery.id}/retry`, { method: 'POST', body: '{}' })
                              await loadDeliveries(endpoint.id)
                              setNotice('Delivery queued again.')
                            })
                          }
                        >
                          <Check size={11} className="mr-1 inline" /> Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
