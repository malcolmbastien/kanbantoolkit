import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Who may come in.
 *
 * Two things, and they are different: whether the instance is open at all, and which domains it
 * admits without an invitation. The second is a door — a verified address from a listed domain walks
 * in as a viewer — so it is shown as one rather than as a convenience setting.
 *
 * Nothing here can grant an administrator: a domain admits a viewer, and a role is still somebody's
 * decision about a person.
 */

interface Settings {
  access: 'open' | 'closed'
  allowedDomains: string[]
}

const BUTTON = 'rounded-md border border-slate-200 px-2 py-1 text-meta font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40'
const FIELD = 'rounded-md border border-slate-200 bg-white px-2 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400'

export function AccessPanel() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [domains, setDomains] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | undefined>()
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const response = await fetch('/api/admin/settings', { headers: { accept: 'application/json' } })
        if (!response.ok) return
        const body = (await response.json()) as Settings
        if (!live) return
        setSettings(body)
        setDomains(body.allowedDomains.join('\n'))
      } catch {
        if (live) setError('The access settings could not be read.')
      }
    })()
    return () => {
      live = false
    }
  }, [])

  async function save(next: Partial<Settings>) {
    setBusy(true)
    setMessage(undefined)
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setMessage({ tone: 'bad', text: body?.error ?? 'That could not be saved.' })
        return
      }
      const body = (await response.json()) as Settings
      setSettings(body)
      setDomains(body.allowedDomains.join('\n'))
      setMessage({ tone: 'ok', text: 'Saved, and recorded in the audit.' })
    } catch {
      setMessage({ tone: 'bad', text: 'The server could not be reached.' })
    } finally {
      setBusy(false)
    }
  }

  if (error) return null
  if (!settings) return null

  return (
    <section className="mt-6 rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <h2 className="text-body font-semibold text-slate-900">Access</h2>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-meta text-slate-600">This instance is</span>
        {(['closed', 'open'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => void save({ access: mode })}
            disabled={busy || settings.access === mode}
            className={cn(
              'rounded-md border px-2 py-1 text-meta font-medium',
              settings.access === mode
                ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
            )}
          >
            {mode === 'closed' ? 'closed — nobody without a link' : 'open — anyone with a provider'}
          </button>
        ))}
      </div>

      <label className="mt-3 block text-micro font-semibold uppercase tracking-wide text-slate-500">
        Domains admitted without an invitation
        <textarea
          value={domains}
          onChange={(event) => setDomains(event.target.value)}
          rows={3}
          placeholder="example.com"
          className={cn(FIELD, 'mt-1 block w-full font-mono text-micro')}
        />
      </label>
      <p className="mt-1 text-micro text-slate-500">
        One domain per line, exact. A verified address from one of them may sign in as a <strong>viewer</strong> —
        never an administrator. This is a way in, so it is worth being sure.
      </p>

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() =>
            void save({
              allowedDomains: domains
                .split(/[\s,]+/)
                .map((entry) => entry.trim())
                .filter(Boolean),
            })
          }
          disabled={busy}
          className={BUTTON}
        >
          Save the list
        </button>
        {message && (
          <span className={cn('text-meta', message.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700')}>{message.text}</span>
        )}
      </div>
    </section>
  )
}
