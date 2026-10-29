import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * This workspace's name.
 *
 * The boundary made visible: an instance administrator runs the deployment, a workspace
 * administrator runs this team. The name is the team's own — set once by the installation, and
 * afterwards whatever the people in it decide to call themselves.
 *
 * Everything else about the workspace lives in the tabs beside this one: its people under People,
 * and the end of it under Danger.
 */

const FIELD =
  'rounded-md border border-slate-200 bg-white px-2 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400'
const LABEL = 'block text-micro font-semibold uppercase tracking-wide text-slate-500'
const BUTTON = 'rounded-md border border-slate-200 px-2 py-1 text-meta font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40'

export function WorkspacePanel() {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | undefined>()
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const response = await fetch('/api/admin/workspace', { headers: { accept: 'application/json' } })
        if (response.status === 401 || response.status === 403) {
          if (live) setError('Only an administrator of this workspace can change it.')
          return
        }
        if (!response.ok) {
          if (live) setError('This workspace could not be read.')
          return
        }
        const body = (await response.json()) as { workspace: { name: string } }
        if (live) setName(body.workspace.name)
      } catch {
        if (live) setError('The server could not be reached.')
      }
    })()
    return () => {
      live = false
    }
  }, [])

  async function save() {
    setBusy(true)
    setMessage(undefined)
    try {
      const response = await fetch('/api/admin/workspace', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setMessage({ tone: 'bad', text: body?.error ?? 'That could not be saved.' })
        return
      }
      setMessage({ tone: 'ok', text: 'Saved.' })
    } catch {
      setMessage({ tone: 'bad', text: 'The server could not be reached.' })
    } finally {
      setBusy(false)
    }
  }

  if (error) return null

  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <h2 className="text-body font-semibold text-slate-900">This workspace</h2>
      <p className="mt-0.5 text-meta text-slate-600">
        Its name. An administrator of this workspace sees this; an instance administrator sees the
        rest of Admin beside it.
      </p>

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className={LABEL}>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} className={cn(FIELD, 'mt-1 block w-56')} />
        </label>
        <button onClick={() => void save()} disabled={busy || !name.trim()} className={BUTTON}>
          Save
        </button>
      </div>

      {message && (
        <p className={cn('mt-3 rounded-md px-2 py-1 text-meta', message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800')}>
          {message.text}
        </p>
      )}
    </section>
  )
}
