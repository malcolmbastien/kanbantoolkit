import { useEffect, useRef, useState } from 'react'
import { Archive, Download, RotateCcw, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The instance administrator's copies of the database.
 *
 * A copy is a file (`VACUUM INTO`), and a restore is staged: the upload is verified, written beside
 * the live database and applied on the next boot with `RESTORE_CONFIRM=yes`. The screen says that
 * in words because a restore that replaced a live file under open connections would be the second
 * mistake on a day that already had one.
 *
 * A Worker has no filesystem. It says so and points at the provider's backups; it does not draw a
 * button that cannot work.
 */

interface BackupFileView {
  name: string
  bytes: number
  createdAt: number
}

const FIELD = 'rounded-md border border-slate-200 bg-white px-2 py-1 text-meta text-slate-800 outline-none focus:ring-2 focus:ring-indigo-300'
const BUTTON =
  'rounded-md border border-slate-200 px-2 py-1 text-meta font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40'

const size = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { accept: 'application/json', ...(init?.headers as Record<string, string>) } })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `the server answered ${response.status}`)
  }
  return (await response.json()) as T
}

export function BackupsPanel() {
  const [mode, setMode] = useState<'file' | 'provider' | undefined>()
  const [backups, setBackups] = useState<BackupFileView[]>([])
  const [error, setError] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = async () => {
    const body = await json<{ mode: 'file' | 'provider'; backups: BackupFileView[] }>('/api/admin/backups')
    setMode(body.mode)
    setBackups(body.backups)
  }

  useEffect(() => {
    let live = true
    void json<{ mode: 'file' | 'provider'; backups: BackupFileView[] }>('/api/admin/backups')
      .then((body) => {
        if (!live) return
        setMode(body.mode)
        setBackups(body.backups)
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : 'The copies could not be read.')
      })
    return () => {
      live = false
    }
  }, [])

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

  const takeCopy = () =>
    act(async () => {
      const copy = await json<BackupFileView>('/api/admin/backups', { method: 'POST', body: '{}' })
      await load()
      setNotice(`Copy taken: ${copy.name} (${size(copy.bytes)}).`)
    })

  const restore = (file: File) =>
    act(async () => {
      const body = await file.arrayBuffer()
      const result = await json<{ staged: boolean; boards: number; items: number; restart: string }>(
        '/api/admin/backups/restore',
        { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body },
      )
      setNotice(`Verified ${result.boards} boards and ${result.items} items. ${result.restart}.`)
      if (input.current) input.current.value = ''
    })

  return (
    <div className="space-y-3" data-backups-panel>
      <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          <Archive size={15} className="text-slate-500" />
          <h2 className="text-body font-semibold text-slate-900">Backups</h2>
          <span className="text-micro text-slate-500">{mode === 'provider' ? 'provider-managed' : 'files on this machine'}</span>
          {mode === 'file' && (
            <button className={cn(BUTTON, 'ml-auto bg-indigo-600 text-white hover:bg-indigo-500')} disabled={busy} onClick={() => void takeCopy()}>
              Take a copy
            </button>
          )}
        </div>

        {mode === 'provider' ? (
          <p className="mt-2 text-meta text-slate-600">
            This deployment runs on Cloudflare, where the database has its own backup and restore. Use the D1
            console or <code>wrangler d1</code>; an in-app file copy is not available here. The export under
            Workspace data remains the copy in the app's own vocabulary.
          </p>
        ) : mode === undefined ? (
          <p className="mt-2 text-meta text-slate-600">Reading the copies…</p>
        ) : (
          <>
            <p className="mt-1 max-w-2xl text-meta text-slate-600">
              A copy is taken with a read transaction, so the server can keep running while it is written. Restore
              verifies an uploaded file, stages it, and applies it on the next restart with{' '}
              <code>RESTORE_CONFIRM=yes</code>.
            </p>

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-micro font-semibold uppercase tracking-wide text-slate-500">
                Restore from a file
                <input
                  ref={input}
                  type="file"
                  accept=".db,application/octet-stream"
                  aria-label="Restore from a file"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void restore(file)
                  }}
                  className={cn(FIELD, 'mt-1 block')}
                />
              </label>
              <button className={BUTTON} disabled={busy} onClick={() => input.current?.click()} title="Choose a database file">
                <Upload size={11} className="mr-1 inline" /> Choose file
              </button>
            </div>

            {backups.length === 0 ? (
              <p className="mt-3 text-meta text-slate-600">No copies yet. Take one now; the schedule is the operator's cron.</p>
            ) : (
              <div className="mt-3 divide-y divide-slate-100">
                {backups.map((backup) => (
                  <div key={backup.name} className="flex flex-wrap items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-micro text-slate-700">{backup.name}</span>
                    <span className="text-micro text-slate-500">{size(backup.bytes)}</span>
                    <span className="text-micro text-slate-500">
                      {new Date(backup.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <a className={cn(BUTTON, 'no-underline')} href={`/api/admin/backups/${encodeURIComponent(backup.name)}`} download>
                      <Download size={11} className="mr-1 inline" /> Download
                    </a>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {error && <p className="mt-3 rounded-md bg-rose-50 px-2 py-1 text-meta text-rose-800">{error}</p>}
        {notice && (
          <p className="mt-3 flex items-start gap-1 rounded-md bg-emerald-50 px-2 py-1 text-meta text-emerald-800">
            <RotateCcw size={12} className="mt-0.5 shrink-0" /> {notice}
          </p>
        )}
      </section>
    </div>
  )
}
