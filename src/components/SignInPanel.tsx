import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
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
const FIELD =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-meta text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100'
const PRIMARY =
  'mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-meta font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-40'
const SECONDARY =
  'flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-meta font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-white hover:text-slate-900'

/** A label, an optional action beside it, and the field below. */
function Field({ id, label, action, children }: { id: string; label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-micro font-semibold text-slate-700">
          {label}
        </label>
        {action}
      </div>
      {children}
    </div>
  )
}

/** A password field with the eye every browser's own box has, in the app's own words. */
function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
  ariaLabel,
  show,
  onToggle,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  placeholder: string
  ariaLabel: string
  show: boolean
  onToggle: () => void
}) {
  return (
    <div className="relative">
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`${FIELD} pr-10`}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? 'Hide characters' : 'Show characters'}
        title={show ? 'Hide characters' : 'Show characters'}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}

export function SignInPanel({ onSignedIn }: { onSignedIn: (user: AuthUser | null) => void }) {
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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

  const rememberBox =
    !(token && invite) && !link && !auth.setup ? (
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-slate-50 p-3 text-meta text-slate-700 ring-1 ring-slate-200">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
          className="mt-0.5 size-4 accent-indigo-600"
        />
        <span>
          <span className="block font-medium text-slate-800">Keep me signed in for 30 days</span>
          <span className="mt-0.5 block text-micro text-slate-500">Otherwise this browser signs out after 12 hours.</span>
        </span>
      </label>
    ) : null

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
          <p className="pb-1 text-micro font-semibold uppercase tracking-wide text-slate-400">Reset password</p>
          <p className="pb-3 text-meta text-slate-600">
            Choose the password this account will use from now on. Signing in elsewhere is ended when you save.
          </p>
          <Field id="reset-password" label="New password">
            <PasswordInput
              id="reset-password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              placeholder="a password of at least 12 characters"
              ariaLabel="New password"
              show={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
            />
          </Field>
          {resetError && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-micro text-rose-800">{resetError}</p>}
          <button type="submit" disabled={busy || !password} className={PRIMARY}>
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
            <form onSubmit={onJoin} className="space-y-3">
              <p className="text-micro font-semibold uppercase tracking-wide text-slate-400">Invitation</p>
              <p className="text-meta text-slate-600">
                You have been invited to join as <strong className="text-slate-800">{invite.role}</strong>, for{' '}
                <strong className="text-slate-800">{invite.email}</strong>. Choose a password and you are in.
              </p>
              <Field id="invite-name" label="Your name">
                <input
                  id="invite-name"
                  value={inviteName}
                  onChange={(event) => setInviteName(event.target.value)}
                  placeholder="Your name"
                  aria-label="Your name"
                  className={FIELD}
                />
              </Field>
              <Field id="invite-password" label="Password">
                <PasswordInput
                  id="invite-password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="new-password"
                  placeholder="a password of at least 12 characters"
                  ariaLabel="Password"
                  show={showPassword}
                  onToggle={() => setShowPassword((value) => !value)}
                />
              </Field>
              {inviteError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-micro text-rose-800">{inviteError}</p>}
              <button type="submit" disabled={busy || !password} className={`${PRIMARY} !mt-1`}>
                {busy ? 'Joining…' : 'Join'}
              </button>
            </form>
          )}
        </div>
      )}

      {auth.setup && !(token && invite) && (
        <form onSubmit={onSetup} className="space-y-3 px-1.5 pb-2">
          <p className="text-micro font-semibold uppercase tracking-wide text-slate-400">First run</p>
          <p className="text-micro text-slate-600">
            This instance has no accounts yet. The account you make here administers it and its one workspace —
            there are no default credentials to use instead.
          </p>
          <Field id="setup-name" label="Your name">
            <input
              id="setup-name"
              value={setupName}
              onChange={(event) => setSetupName(event.target.value)}
              placeholder="Your name"
              aria-label="Your name"
              className={FIELD}
            />
          </Field>
          <Field id="setup-email" label="Email address">
            <input
              id="setup-email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              aria-label="Email address"
              className={FIELD}
            />
          </Field>
          <Field id="setup-password" label="Password">
            <PasswordInput
              id="setup-password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              placeholder="a password of at least 12 characters"
              ariaLabel="Password"
              show={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
            />
          </Field>
          {setupError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-micro text-rose-800">{setupError}</p>}
          <button type="submit" disabled={busy || !email.includes('@') || !password} className={`${PRIMARY} !mt-1`}>
            {busy ? 'Creating…' : 'Create the administrator'}
          </button>
        </form>
      )}

      {auth.password && !auth.setup && !(token && invite) && !link && (
        <form onSubmit={onPassword} className="space-y-3 px-1.5 pb-2">
          <Field id="signin-email" label="Email address">
            <input
              id="signin-email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              aria-label="Email address"
              className={FIELD}
            />
          </Field>
          <Field
            id="signin-password"
            label="Password"
            action={
              auth.mail ? (
                <button
                  type="button"
                  onClick={() => void onAskLink()}
                  disabled={!email.includes('@') || asked}
                  className="text-micro font-medium text-indigo-600 transition hover:text-indigo-800 disabled:opacity-50"
                >
                  Forgot password?
                </button>
              ) : undefined
            }
          >
            <PasswordInput
              id="signin-password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              placeholder="your password"
              ariaLabel="Password"
              show={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
            />
          </Field>
          {rememberBox}
          {refused && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-micro text-rose-800">
              That address and password do not match.
            </p>
          )}
          <button type="submit" disabled={busy || !email.includes('@') || !password} className={`${PRIMARY} !mt-1`}>
            {busy ? 'Signing in…' : (
              <>
                Sign in <ArrowRight size={15} />
              </>
            )}
          </button>
          {auth.mail && asked && (
            <p className="text-micro text-slate-600">
              If that address has an account, a link is on its way. It works once, and expires in 15 minutes.
            </p>
          )}
        </form>
      )}

      {auth.providers.length > 0 && !auth.setup && !(token && invite) && (
        <div className="px-1.5 pb-2">
          {!auth.password && rememberBox}
          {auth.password ? (
            <div className="my-2 flex items-center gap-3 text-micro font-semibold uppercase tracking-wide text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              or
              <span className="h-px flex-1 bg-slate-200" />
            </div>
          ) : (
            <p className="pb-2 text-micro font-semibold uppercase tracking-wide text-slate-400">Sign in with</p>
          )}
          <div className="space-y-2">
            {auth.providers.map((provider) => (
              <button
                key={provider.id}
                onClick={() => startSignIn(provider.id, remember)}
                className={SECONDARY}
              >
                <span className="grid size-5 place-items-center rounded bg-white text-micro font-semibold text-slate-500 ring-1 ring-slate-200">
                  {provider.label.charAt(0)}
                </span>
                Continue with {provider.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The terms belong beside the door, before anybody walks through it — and they are the
          *project's*, not this instance's: they describe the software and the project's site, and
          both say so. An instance's own policies are its operator's, and no page here can be them. */}
      <p className="mt-1.5 px-1.5 text-micro text-slate-600">
        {auth.project ? (
          <>
            By continuing you agree to Kanban Toolkit’s{' '}
            <a href={`${auth.project}/terms/`} className="underline">
              terms
            </a>{' '}
            and{' '}
            <a href={`${auth.project}/privacy/`} className="underline">
              privacy notice
            </a>
            . They cover the software and the project’s site; this instance’s policies are its
            operator’s.
          </>
        ) : (
          <>Kanban Toolkit is free software. This instance’s terms and privacy policy are its operator’s.</>
        )}
      </p>

      {auth.dev && (
        <p className="mt-1 rounded-md bg-amber-50 px-1.5 py-1 text-micro text-amber-900">
          Development sign-in is on: anybody can be anybody. Never leave it on for an instance people rely on.
        </p>
      )}

      {auth.dev && (
        <form onSubmit={onDev} className="mt-2 space-y-3 border-t border-slate-200 px-1.5 pt-3">
          <p className="text-micro font-semibold uppercase tracking-wide text-slate-400">Development</p>
          <Field id="dev-email" label="Address">
            <input
              id="dev-email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              aria-label="Development email address"
              className={FIELD}
            />
          </Field>
          {!auth.password && auth.providers.length === 0 && rememberBox}
          <button type="submit" disabled={busy || !email.includes('@')} className={`${PRIMARY} !mt-1`}>
            {busy ? 'Signing in…' : 'Sign in as this address'}
          </button>
        </form>
      )}
    </>
  )
}
