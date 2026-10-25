import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  acceptInvite,
  changePassword,
  consumeLink,
  devSignIn,
  inviteToken,
  linkToken,
  loadAuth,
  passwordSignIn,
  readInvite,
  requestLink,
  setupInstance,
  startSignIn,
  useAuth,
} from '@/lib/auth'
import type { AuthUser } from '@/lib/auth'

/**
 * The sign-in surface, in a chunk of its own.
 *
 * It is the largest thing the account menu draws and the least often used — a person signs in once
 * and then never sees it again — so it is loaded when the menu opens rather than with the board. The
 * first download is a budget, and a form nobody has asked for is the cheapest thing to leave out of
 * it.
 *
 * Three doors, and only the ones the deployment has: the first run (an instance with no accounts and
 * no other way in), a password, and the operator's OIDC issuer. The development switch is a fourth,
 * and only when the instance asks for it by name.
 */
export function SignInPanel({ onSignedIn }: { onSignedIn: (user: AuthUser | null) => void }) {
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [refused, setRefused] = useState(false)
  const [setupName, setSetupName] = useState('')
  const [setupError, setSetupError] = useState<string | undefined>()
  // Twelve hours unless this is asked for: a shared machine should not stay open for a month.
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  // An invitation link is the way in for a deployment with no identity provider and no mail: the
  // link is the proof, and the person chooses the password the account will have (task 154.5).
  const token = inviteToken()
  const [invite, setInvite] = useState<{ email: string; role: string } | 'unavailable' | null>(null)
  const [inviteName, setInviteName] = useState('')
  const [inviteError, setInviteError] = useState<string | undefined>()
  // A link in the address bar: it signs the person in, or asks for the password they came to reset.
  const link = linkToken()
  const [linkState, setLinkState] = useState<'signing' | 'reset' | 'unavailable' | null>(link ? 'signing' : null)
  const [resetError, setResetError] = useState<string | undefined>()
  const [asked, setAsked] = useState(false)

  useEffect(() => {
    if (!token) return
    let live = true
    void readInvite(token).then((answer) => {
      if (live) setInvite(answer ?? 'unavailable')
    })
    return () => {
      live = false
    }
  }, [token])

  useEffect(() => {
    if (!link) return
    let live = true
    void consumeLink(link).then((answer) => {
      if (!live) return
      if (!answer) return setLinkState('unavailable')
      if (answer.reset) return setLinkState('reset')
      onSignedIn(answer.user)
    })
    return () => {
      live = false
    }
    // Once, for the link the page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link])

  async function onReset(event: FormEvent) {
    event.preventDefault()
    if (!password) return
    setBusy(true)
    setResetError(undefined)
    const refusal = await changePassword(password)
    setBusy(false)
    setPassword('')
    if (refusal) {
      setResetError(refusal)
      return
    }
    const next = await loadAuth()
    if (next.user) onSignedIn(next.user)
  }

  async function onAskLink() {
    if (!email.includes('@')) return
    setAsked(true)
    await requestLink(email)
  }

  async function onJoin(event: FormEvent) {
    event.preventDefault()
    if (!token || !password) return
    setBusy(true)
    setInviteError(undefined)
    const answer = await acceptInvite(token, { name: inviteName.trim(), password })
    if (!answer.ok) {
      setBusy(false)
      setInviteError(answer.error)
      return
    }
    const next = await loadAuth()
    setBusy(false)
    setPassword('')
    if (next.user) {
      onSignedIn(next.user)
      return
    }
    setInviteError('The account was made, but this browser could not read the session. Sign in with the password you chose.')
  }
  // A sign-in that did not finish lands on `?auth=denied`, and a closed account leaves no panel to
  // show, so the surface says what happened where the person now is. Read once, at mount, because the
  // URL is rewritten to the current view a moment later.
  const [denied] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('auth') === 'denied',
  )
  const [closed] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('auth') === 'closed',
  )

  async function onSetup(event: FormEvent) {
    event.preventDefault()
    if (!email.includes('@') || !password) return
    setBusy(true)
    setSetupError(undefined)
    const answer = await setupInstance({ name: setupName.trim(), email, password })
    if (!answer.ok) {
      setBusy(false)
      setSetupError(answer.error)
      return
    }
    const next = await loadAuth()
    setBusy(false)
    setPassword('')
    if (next.user) onSignedIn(next.user)
  }

  async function onPassword(event: FormEvent) {
    event.preventDefault()
    if (!email.includes('@') || !password) return
    setBusy(true)
    setRefused(false)
    const ok = await passwordSignIn(email, password, remember)
    if (!ok) {
      setBusy(false)
      setRefused(true)
      return
    }
    // The cookie is the session; asking again says who it belongs to, which is what draws the menu.
    const next = await loadAuth()
    setBusy(false)
    setPassword('')
    if (!next.user) {
      setRefused(true)
      return
    }
    onSignedIn(next.user)
  }

  async function onDev(event: FormEvent) {
    event.preventDefault()
    if (!email.includes('@')) return
    setBusy(true)
    const user = await devSignIn(email, undefined, remember)
    setBusy(false)
    if (!user) return
    onSignedIn(user)
    setEmail('')
  }

  return (
    <>
      {denied && (
        <p className="mx-1.5 mb-2 rounded-md bg-rose-50 px-2 py-1 text-meta text-rose-800">
          Sign-in was not accepted. This instance only admits the people it invited.
        </p>
      )}
      {closed && (
        <p className="mx-1.5 mb-2 rounded-md bg-emerald-50 px-2 py-1 text-meta text-emerald-900">
          The account was closed. Everything it held has been removed. Signing in again begins a new one.
        </p>
      )}

      {link && linkState === 'unavailable' && (
        <p className="mx-1.5 mb-2 rounded-md bg-rose-50 px-2 py-1 text-meta text-rose-800">
          That link is not available — it has been used, has expired, or was never one. Ask for another.
        </p>
      )}

      {link && linkState === 'reset' && (
        <form onSubmit={onReset} className="px-1.5 pb-2">
          <p className="pb-1 text-micro uppercase tracking-wide text-slate-400">Reset</p>
          <p className="pb-1.5 text-meta text-slate-700">
            Choose the password this account will use from now on. Signing in elsewhere is ended when you save.
          </p>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="new-password"
            placeholder="a password of at least 12 characters"
            aria-label="New password"
            className="w-full rounded-md border border-slate-200 px-1.5 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400"
          />
          {resetError && <p className="mt-1 rounded-md bg-rose-50 px-1.5 py-1 text-micro text-rose-800">{resetError}</p>}
          <button
            type="submit"
            disabled={busy || !password}
            className="mt-1 w-full rounded-md bg-slate-900 px-1.5 py-1 text-meta font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save the password'}
          </button>
        </form>
      )}

      {token && invite && (
        <div className="px-1.5 pb-2">
          {invite === 'unavailable' ? (
            <p className="rounded-md bg-rose-50 px-2 py-1 text-meta text-rose-800">
              This invitation is not available — it has been used, has expired, or was taken back. Ask for
              another one.
            </p>
          ) : (
            <form onSubmit={onJoin}>
              <p className="pb-1 text-micro uppercase tracking-wide text-slate-400">Invitation</p>
              <p className="pb-1.5 text-meta text-slate-700">
                You have been invited to join as <strong>{invite.role}</strong>, for{' '}
                <strong>{invite.email}</strong>. Choose a password and you are in.
              </p>
              <input
                value={inviteName}
                onChange={(event) => setInviteName(event.target.value)}
                placeholder="Your name"
                aria-label="Your name"
                className="w-full rounded-md border border-slate-200 px-1.5 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400"
              />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="new-password"
                placeholder="a password of at least 12 characters"
                aria-label="Password"
                className="mt-1 w-full rounded-md border border-slate-200 px-1.5 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400"
              />
              {inviteError && <p className="mt-1 rounded-md bg-rose-50 px-1.5 py-1 text-micro text-rose-800">{inviteError}</p>}
              <button
                type="submit"
                disabled={busy || !password}
                className="mt-1 w-full rounded-md bg-slate-900 px-1.5 py-1 text-meta font-medium text-white hover:bg-slate-800 disabled:opacity-40"
              >
                {busy ? 'Joining…' : 'Join'}
              </button>
            </form>
          )}
        </div>
      )}

      {!(token && invite) && (
        <label className="mb-1.5 flex items-start gap-1.5 px-1.5 text-micro text-slate-600">
        <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="mt-0.5" />
          <span>
            Keep me signed in for 30 days
            <span className="block text-slate-500">Otherwise this browser signs out after 12 hours.</span>
          </span>
        </label>
      )}

      {auth.setup && !(token && invite) && (
        <form onSubmit={onSetup} className="px-1.5 pb-2">
          <p className="pb-1 text-micro uppercase tracking-wide text-slate-400">First run</p>
          <p className="pb-1.5 text-micro text-slate-600">
            This instance has no accounts yet. The account you make here administers it and its one workspace —
            there are no default credentials to use instead.
          </p>
          <input
            value={setupName}
            onChange={(event) => setSetupName(event.target.value)}
            placeholder="Your name"
            aria-label="Your name"
            className="w-full rounded-md border border-slate-200 px-1.5 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400"
          />
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            aria-label="Email address"
            className="mt-1 w-full rounded-md border border-slate-200 px-1.5 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="new-password"
            placeholder="a password of at least 12 characters"
            aria-label="Password"
            className="mt-1 w-full rounded-md border border-slate-200 px-1.5 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400"
          />
          {setupError && <p className="mt-1 rounded-md bg-rose-50 px-1.5 py-1 text-micro text-rose-800">{setupError}</p>}
          <button
            type="submit"
            disabled={busy || !email.includes('@') || !password}
            className="mt-1 w-full rounded-md bg-slate-900 px-1.5 py-1 text-meta font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {busy ? 'Creating…' : 'Create the administrator'}
          </button>
        </form>
      )}

      {auth.password && !auth.setup && !(token && invite) && !link && (
        <form onSubmit={onPassword} className="px-1.5 pb-2">
          <p className="pb-1 text-micro uppercase tracking-wide text-slate-400">Password</p>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            aria-label="Email address"
            className="w-full rounded-md border border-slate-200 px-1.5 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
            placeholder="your password"
            aria-label="Password"
            className="mt-1 w-full rounded-md border border-slate-200 px-1.5 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400"
          />
          {refused && (
            <p className="mt-1 rounded-md bg-rose-50 px-1.5 py-1 text-micro text-rose-800">
              That address and password do not match.
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !email.includes('@') || !password}
            className="mt-1 w-full rounded-md bg-slate-900 px-1.5 py-1 text-meta font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {auth.mail && (
            <p className="pt-1 text-micro text-slate-600">
              {asked ? (
                'If that address has an account, a link is on its way. It works once, and expires in 15 minutes.'
              ) : (
                <button type="button" onClick={() => void onAskLink()} className="underline">
                  Email me a link instead
                </button>
              )}
            </p>
          )}
        </form>
      )}

      {auth.providers.length > 0 && !auth.setup && !(token && invite) && (
        <p className="px-1.5 pb-1.5 text-micro uppercase tracking-wide text-slate-400">
          {auth.password ? 'or continue with' : 'Sign in with'}
        </p>
      )}
      {auth.providers.map((provider) => (
        <button
          key={provider.id}
          onClick={() => startSignIn(provider.id, remember)}
          className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-meta text-slate-700 hover:bg-slate-50 hover:text-slate-900"
        >
          <span className="grid size-5 place-items-center rounded border border-slate-200 text-micro font-semibold text-slate-500">
            {provider.label.charAt(0)}
          </span>
          Continue with {provider.label}
        </button>
      ))}

      {/* The terms belong beside the door, before anybody walks through it (task 150, R2). */}
      <p className="mt-1.5 px-1.5 text-micro text-slate-600">
        By continuing you agree to the <a href="/terms/" className="underline">terms</a> and the{' '}
        <a href="/privacy/" className="underline">privacy notice</a>.
      </p>

      {auth.dev && (
        <p className="mt-1 rounded-md bg-amber-50 px-1.5 py-1 text-micro text-amber-900">
          Development sign-in is on: anybody can be anybody. Never leave it on for an instance people rely on.
        </p>
      )}

      {auth.access === 'open' && !auth.dev && (
        <p className="mt-1 rounded-md bg-slate-50 px-1.5 py-1 text-micro text-slate-600">
          This instance lets anyone with a provider sign in, as a viewer.
        </p>
      )}

      {auth.dev && (
        <form onSubmit={onDev} className="mt-1 border-t border-slate-200 pt-2">
          <p className="px-1.5 pb-1 text-micro uppercase tracking-wide text-slate-400">Development</p>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-md border border-slate-200 px-1.5 py-1 text-meta text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400"
          />
          <button
            type="submit"
            disabled={busy || !email.includes('@')}
            className="mt-1 w-full rounded-md bg-slate-900 px-1.5 py-1 text-meta font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {busy ? 'Signing in…' : 'Sign in as this address'}
          </button>
        </form>
      )}
    </>
  )
}
