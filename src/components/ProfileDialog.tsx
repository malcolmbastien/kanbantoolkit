import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { mySessions, revokeSession, signOutEverywhere, type SessionInfo } from '@/lib/sessions'
import { useDialogFocus } from '@/lib/useDialogFocus'

/**
 * The profile a person owns.
 *
 * Name, picture, time zone and language — and nothing else. The address is shown and not offered,
 * because it is the address a provider vouched for; changing it here would be claiming one nobody
 * verified. The ways into the account are listed underneath, and the last one cannot be removed.
 *
 * Every call fails soft: with no server there is no profile service, and the dialog says so rather
 * than the menu breaking.
 */

interface Profile {
  name: string
  email: string
  avatarUrl?: string
  timezone?: string
  language?: string
}

interface Identity {
  provider: string
  subject: string
  email: string
}

const MAX_AVATAR = 256 * 1024
const TYPES = ['image/png', 'image/jpeg', 'image/webp']
const FIELD =
  'w-full rounded-md border border-slate-200 px-2 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400'

/** "3 Mar, 14:05" — enough to recognise a session, and no more precision than that. */
const when = (value: string) =>
  new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function ProfileDialog({ onClose, onSaved }: { onClose(): void; onSaved(): void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  // A modal like every other: the caret is in it until it closes, and then it goes back.
  useDialogFocus(dialogRef, onClose)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [identities, setIdentities] = useState<Identity[]>([])
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionBusy, setSessionBusy] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState('')
  const [language, setLanguage] = useState('')
  const [avatar, setAvatar] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const response = await fetch('/api/me', { headers: { accept: 'application/json' } })
        if (!response.ok) throw new Error('no profile service')
        const body = (await response.json()) as Profile
        if (!live) return
        setProfile(body)
        setName(body.name)
        setTimezone(body.timezone ?? '')
        setLanguage(body.language ?? '')
        setAvatar(body.avatarUrl)

        const list = await fetch('/api/me/identities', { headers: { accept: 'application/json' } })
        if (list.ok) setIdentities(((await list.json()) as { identities: Identity[] }).identities)
        if (live) setSessions(await mySessions())
      } catch {
        if (live) setError('This instance has no profile service.')
      }
    })()
    return () => {
      live = false
    }
  }, [])

  async function onFile(file: File | undefined) {
    if (!file) return
    if (!TYPES.includes(file.type)) return setError('The picture must be a png, jpeg or webp.')
    if (file.size > MAX_AVATAR) return setError('The picture must be smaller than 256 KB.')

    const reader = new FileReader()
    reader.onload = () => {
      setError(undefined)
      setAvatar(String(reader.result))
    }
    reader.readAsDataURL(file)
  }

  /**
   * End one session. Ending *this* one is a sign-out, so the dialog closes rather than showing a
   * list that includes a browser which is no longer allowed to read it.
   */
  async function endSession(session: SessionInfo) {
    setSessionBusy(session.id)
    setError(undefined)
    const ended = await revokeSession(session.id)
    setSessionBusy(null)
    if (!ended) return setError('That session could not be ended.')
    if (session.current) {
      onSaved()
      onClose()
      return
    }
    setSessions(await mySessions())
  }

  async function endEverywhere() {
    setSessionBusy('everywhere')
    setError(undefined)
    const ended = await signOutEverywhere()
    setSessionBusy(null)
    if (!ended) return setError('That could not be done.')
    onSaved()
    onClose()
  }

  async function save() {
    setBusy(true)
    setError(undefined)
    try {
      const response = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, timezone, language, avatarUrl: avatar ?? '' }),
      })
      if (response.status === 422) {
        setError('The picture was refused: it must be a small png, jpeg or webp.')
        return
      }
      if (!response.ok) {
        setError('That could not be saved.')
        return
      }
      onSaved()
      onClose()
    } catch {
      setError('The server could not be reached.')
    } finally {
      setBusy(false)
    }
  }

  async function unlink(identity: Identity) {
    setError(undefined)
    try {
      const response = await fetch(`/api/me/identities/${encodeURIComponent(identity.provider)}/${encodeURIComponent(identity.subject)}`, {
        method: 'DELETE',
      })
      if (response.status === 409) return setError('That is the only way into your account. Link another before removing it.')
      if (!response.ok) return setError('That could not be removed.')
      setIdentities((list) => list.filter((entry) => entry !== identity))
    } catch {
      setError('The server could not be reached.')
    }
  }

  return (
    <div ref={dialogRef} className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Your profile">
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-center justify-between">
          <h2 className="text-body font-semibold text-slate-900">Your profile</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        {!profile && !error && <p className="mt-3 text-meta text-slate-600">Loading…</p>}
        {error && <p className="mt-3 rounded-md bg-rose-50 px-2 py-1 text-meta text-rose-800">{error}</p>}

        {profile && (
          <div className="mt-3 space-y-3">
            <label className="block text-micro font-semibold uppercase tracking-wide text-slate-500">
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} className={cn(FIELD, 'mt-1')} />
            </label>

            <div className="text-micro font-semibold uppercase tracking-wide text-slate-500">
              Email
              <p className="mt-1 text-meta font-normal normal-case text-slate-700">{profile.email}</p>
              <p className="mt-0.5 text-micro font-normal normal-case text-slate-500">
                Your provider verifies this; change it there, not here.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-micro font-semibold uppercase tracking-wide text-slate-500">
                Time zone
                <input
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  placeholder="Europe/London"
                  className={cn(FIELD, 'mt-1')}
                />
              </label>
              <label className="block text-micro font-semibold uppercase tracking-wide text-slate-500">
                Language
                <input
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                  placeholder="en"
                  className={cn(FIELD, 'mt-1')}
                />
              </label>
            </div>

            <div className="text-micro font-semibold uppercase tracking-wide text-slate-500">
              Picture
              <div className="mt-1 flex items-center gap-2">
                {avatar && <img src={avatar} alt="" className="size-9 rounded-full object-cover ring-1 ring-slate-200" />}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => void onFile(event.target.files?.[0])}
                  className="text-meta font-normal normal-case text-slate-600"
                />
                {avatar && (
                  <button onClick={() => setAvatar(undefined)} className="text-micro font-normal normal-case text-slate-500 hover:text-slate-800">
                    remove
                  </button>
                )}
              </div>
            </div>

            <div className="text-micro font-semibold uppercase tracking-wide text-slate-500">
              Ways in
              <ul className="mt-1 space-y-1">
                {identities.map((identity) => (
                  <li key={`${identity.provider}:${identity.subject}`} className="flex items-center justify-between gap-2 text-meta font-normal normal-case text-slate-700">
                    <span className="truncate">
                      {identity.provider} · {identity.email}
                    </span>
                    <button
                      onClick={() => void unlink(identity)}
                      disabled={identities.length <= 1}
                      title={identities.length <= 1 ? 'This is the only way into your account' : 'Unlink this provider'}
                      className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-micro text-slate-600 hover:text-slate-900 disabled:opacity-40"
                    >
                      unlink
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="text-micro font-semibold uppercase tracking-wide text-slate-500">
              Where you’re signed in
              <ul className="mt-1 space-y-1">
                {sessions.map((session) => (
                  <li
                    key={session.id}
                    className="flex items-center justify-between gap-2 text-meta font-normal normal-case text-slate-700"
                  >
                    <span className="min-w-0">
                      <span className="truncate">
                        {session.device}
                        {session.current && <span className="ml-1.5 text-micro text-indigo-700">this device</span>}
                      </span>
                      <span className="block text-micro text-slate-600">
                        {session.lastSeenAt ? `last used ${when(session.lastSeenAt)}` : 'not used yet'} · ends{' '}
                        {when(session.expiresAt)}
                      </span>
                    </span>
                    <button
                      onClick={() => void endSession(session)}
                      disabled={sessionBusy !== null}
                      title={session.current ? 'This signs this browser out' : 'Sign this device out'}
                      className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-micro text-slate-600 hover:text-slate-900 disabled:opacity-40"
                    >
                      {sessionBusy === session.id ? 'ending…' : 'end'}
                    </button>
                  </li>
                ))}
                {sessions.length === 0 && <li className="text-meta font-normal normal-case text-slate-600">No sessions.</li>}
              </ul>
              {sessions.length > 0 && (
                <button
                  onClick={() => void endEverywhere()}
                  disabled={sessionBusy !== null}
                  className="mt-1.5 rounded-md border border-rose-300 px-2 py-0.5 text-micro font-medium normal-case text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                >
                  Sign out everywhere
                </button>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={onClose} className="rounded-md border border-slate-200 px-2.5 py-1 text-meta font-medium text-slate-600 hover:text-slate-900">
                Cancel
              </button>
              <button
                onClick={() => void save()}
                disabled={busy}
                className="rounded-md bg-slate-900 px-2.5 py-1 text-meta font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
