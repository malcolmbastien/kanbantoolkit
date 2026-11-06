import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { mySessions, revokeSession, signOutEverywhere, type SessionInfo } from '@/lib/sessions'
import { useAuth } from '@/lib/auth'
import { TokenPanel } from './TokenPanel'
import { useDialogFocus } from '@/lib/useDialogFocus'
import { useStore } from '@/store'

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
  /** Whether this deployment has a relay at all. Absent from an older server means no. */
  mailAvailable?: boolean
  mailOn?: boolean
  mailFrequency?: 'immediate' | 'daily' | 'weekly'
}

interface Identity {
  provider: string
  subject: string
  email: string
}

const MAX_UPLOAD = 10 * 1024 * 1024
/** What the workspace stores: the browser has already made the picture fit this. */
const MAX_STORED = 256 * 1024
const PICTURE_SIDE = 512
const TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** The bytes a base64 data URL decodes to, without decoding it a second time. */
function dataUrlBytes(value: string): number {
  const comma = value.indexOf(',')
  if (comma < 0) return value.length
  const base64 = value.slice(comma + 1)
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

function readPicture(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('picture'))
    }
    image.src = url
  })
}

/**
 * A profile picture is shown at 16–24px. The upload may be a phone photo, but what is stored is a
 * 512px WebP that fits the workspace payload — the original never leaves the browser.
 */
async function preparePicture(file: File): Promise<string> {
  const image = await readPicture(file)
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  if (!sourceWidth || !sourceHeight) throw new Error('picture')

  for (const side of [PICTURE_SIDE, 384, 256]) {
    const scale = Math.min(1, side / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, width, height)

    for (const quality of [0.86, 0.72, 0.58, 0.44]) {
      const data = canvas.toDataURL('image/webp', quality)
      if (dataUrlBytes(data) <= MAX_STORED) return data
    }
  }
  throw new Error('picture too large')
}
const FIELD =
  'w-full rounded-md border border-slate-200 px-2 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400'

/** "3 Mar, 14:05" — enough to recognise a session, and no more precision than that. */
const when = (value: string) =>
  new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function ProfileDialog({ onClose, onSaved }: { onClose(): void; onSaved(): void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  // The role decides which scopes a token may be minted for; the server decides again at mint.
  const account = useAuth((state) => state.user)
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
  const [pictureBusy, setPictureBusy] = useState(false)
  const [mailAvailable, setMailAvailable] = useState(false)
  const [mailOn, setMailOn] = useState(false)
  const [mailFrequency, setMailFrequency] = useState<'immediate' | 'daily' | 'weekly'>('daily')
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
        setMailAvailable(Boolean(body.mailAvailable))
        setMailOn(Boolean(body.mailOn))
        setMailFrequency(body.mailFrequency ?? 'daily')

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
    if (file.size > MAX_UPLOAD) return setError('The picture must be smaller than 10 MB.')

    setError(undefined)
    setPictureBusy(true)
    try {
      setAvatar(await preparePicture(file))
    } catch {
      setError('That picture could not be prepared. Try another png, jpeg or webp.')
    } finally {
      setPictureBusy(false)
    }
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
    const savedName = name.trim().slice(0, 120)
    try {
      const response = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: savedName,
          timezone,
          language,
          avatarUrl: avatar ?? '',
          // Only where the instance has a relay. Sending a preference it cannot honour would be a
          // switch that looks saved and never does anything.
          ...(mailAvailable ? { mailOn, mailFrequency } : {}),
        }),
      })
      if (response.status === 422) {
        setError('The picture was refused: it must be a small png, jpeg or webp.')
        return
      }
      if (!response.ok) {
        setError('That could not be saved.')
        return
      }
      // The drawer, the assignee picker and "Created by" read the workspace directory, not the
      // account. Update the same row here so the new face is visible without a reload; the server
      // has already written it, and the next workspace read would repair it anyway.
      useStore.setState((state) => ({
        users: state.users.map((entry) =>
          entry.id === account?.id ? { ...entry, name: savedName, avatarUrl: avatar } : entry,
        ),
      }))
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
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-4 shadow-2xl ring-1 ring-slate-200">
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
              Email delivery
              {mailAvailable ? (
                <div className="mt-1 space-y-1.5 font-normal normal-case">
                  <label className="flex items-center gap-2 text-meta text-slate-700">
                    <input type="checkbox" checked={mailOn} onChange={(event) => setMailOn(event.target.checked)} />
                    Email me about the work I watch
                  </label>
                  <label className="flex items-center justify-between gap-2 text-meta text-slate-700">
                    How often
                    <select
                      value={mailFrequency}
                      onChange={(event) => setMailFrequency(event.target.value as typeof mailFrequency)}
                      disabled={!mailOn}
                      className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-meta text-slate-800 outline-none disabled:opacity-50"
                    >
                      <option value="immediate">As it happens</option>
                      <option value="daily">Daily, 08:00</option>
                      <option value="weekly">Weekly, Monday 08:00</option>
                    </select>
                  </label>
                  <p className="text-micro text-slate-500">
                    The in-app inbox is always on. Times are in your time zone. One message per
                    period, plain text, with a link that stops it.
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-meta font-normal normal-case text-slate-500">
                  This instance has no mail relay, so email is not offered. The in-app inbox is
                  still here.
                </p>
              )}
            </div>

            <div className="text-micro font-semibold uppercase tracking-wide text-slate-500">
              Picture
              <div className="mt-1 flex items-center gap-2">
                {avatar && <img src={avatar} alt="" className="size-9 rounded-full object-cover ring-1 ring-slate-200" />}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={pictureBusy}
                  onChange={(event) => void onFile(event.target.files?.[0])}
                  className="text-meta font-normal normal-case text-slate-600"
                />
                {pictureBusy && <span className="text-micro font-normal normal-case text-slate-500">Preparing…</span>}
                {avatar && (
                  <button onClick={() => setAvatar(undefined)} className="text-micro font-normal normal-case text-slate-500 hover:text-slate-800">
                    remove
                  </button>
                )}
              </div>
              <p className="mt-1 text-micro font-normal normal-case text-slate-500">
                PNG, JPEG or WebP up to 10 MB. The picture is resized and stored small.
              </p>
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

            <TokenPanel role={account?.role} instanceRole={account?.instanceRole} />

            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={onClose} className="rounded-md border border-slate-200 px-2.5 py-1 text-meta font-medium text-slate-600 hover:text-slate-900">
                Cancel
              </button>
              <button
                onClick={() => void save()}
                disabled={busy || pictureBusy}
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
