import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { LifeBuoy, LogOut, Settings2, ShieldCheck, UserRound } from 'lucide-react'
import { useStore } from '@/store'

// A dialog nobody has opened yet is not part of the first download — and neither is the sign-in
// surface, which a person uses once and then never again.
const ProfileDialog = lazy(() => import('./ProfileDialog').then((module) => ({ default: module.ProfileDialog })))
const SignInPanel = lazy(() => import('./SignInPanel').then((module) => ({ default: module.SignInPanel })))
import { loadAuth, signOut, useAuth } from '@/lib/auth'
import type { AuthUser } from '@/lib/auth'
import { personFor } from '@/lib/identity'
import { cn } from '@/lib/utils'

/**
 * Who you are here.
 *
 * The control only exists when the instance offers a way in — or when somebody *is* in: a session
 * outlives the provider that made it, and a signed-in person must always be able to see who they
 * are and to leave. With no provider and no session — the static tier, or a deployment that has
 * closed its doors — it renders nothing, exactly as before.
 */
export function AccountMenu() {
  const auth = useAuth()
  // A sign-in that did not finish lands on `?auth=denied`; the menu opens itself to say why.
  const [profileOpen, setProfileOpen] = useState(false)
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    const query = new URLSearchParams(window.location.search)
    // A refused sign-in opens the menu to say why, and an invitation link opens it because the whole
    // reason the person is here is to accept one.
    return query.get('auth') === 'denied' || Boolean(query.get('invite')) || Boolean(query.get('link'))
  })
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const users = useStore((s) => s.users)
  const setUser = useStore((s) => s.setUser)

  // Asked once, into the one store the write path also reads.
  useEffect(() => {
    void loadAuth()
  }, [])

  // A popover that stays put while you click inside it, and gets out of the way otherwise.
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const hasDoor = auth.providers.length > 0 || auth.dev || auth.password || auth.setup
  if (!auth.loaded || (!auth.user && !hasDoor)) return null

  /**
   * The account is the authority; which person it *is* in this workspace is `personFor`'s question,
   * and `useSignedInPerson` keeps the store in step with it from then on (including after a reload,
   * which is when the old bridge forgot). Signing out has no account left to read, so it clears the
   * pick here.
   */
  function signedIn(user: AuthUser | null) {
    useAuth.setState({ user })
    if (!user) {
      setUser(undefined)
      return
    }
    setUser(personFor(user, users)?.id)
  }



  async function onSignOut() {
    setBusy(true)
    await signOut()
    setBusy(false)
    signedIn(null)
    setOpen(false)
  }

  const initial = auth.user?.name.trim().charAt(0).toUpperCase()

  return (
    <div ref={ref} className="relative">
      {profileOpen && (
        <Suspense fallback={null}>
          <ProfileDialog onClose={() => setProfileOpen(false)} onSaved={() => void loadAuth()} />
        </Suspense>
      )}

      <button
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2 py-1 text-meta font-medium transition',
          auth.user
            ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
        )}
        title={auth.user ? `${auth.user.email} — ${auth.user.role}` : 'Sign in'}
      >
        {initial ? (
          <span className="grid size-[20px] place-items-center rounded-full bg-emerald-600 text-micro font-semibold text-white">
            {initial}
          </span>
        ) : (
          <UserRound size={13} />
        )}
        <span className="max-w-[120px] truncate">{auth.user ? auth.user.name : 'Sign in'}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          {auth.user ? (
            <>
              <div className="px-1.5 pb-2">
                <p className="truncate text-body font-medium text-slate-900">{auth.user.name}</p>
                <p className="truncate text-meta text-slate-500">{auth.user.email}</p>
                <p className="mt-1 text-micro uppercase tracking-wide text-slate-400">{auth.user.role}</p>
              </div>
              <button
                onClick={() => {
                  setOpen(false)
                  setProfileOpen(true)
                }}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-meta text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              >
                <Settings2 size={13} /> Profile
              </button>

              {/* Admin is the instance's own administration, so it is offered only to the people
                  who have it. The server checks again; this is the courtesy, not the rule. */}
              {(auth.user.instanceRole === 'admin' || auth.user.role === 'admin') && (
                <button
                  onClick={() => {
                    setOpen(false)
                    useStore.getState().setView('admin')
                  }}
                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-meta text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                >
                  <ShieldCheck size={13} /> Admin
                </button>
              )}

              {/* Somebody inside still needs a way out to a person. The project answers on its own
                  tracker rather than in a mailbox — an address published in an app is somebody's
                  inbox for as long as the app exists — so this is the repository's issue form. */}
              <a
                href="https://github.com/malcolmbastien/flowline/issues/new/choose"
                target="_blank"
                rel="noreferrer noopener"
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-meta text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              >
                <LifeBuoy size={13} /> Help &amp; support
              </a>

              <button
                onClick={onSignOut}
                disabled={busy}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-meta text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
              >
                <LogOut size={13} /> Sign out
              </button>
            </>
          ) : (
            <Suspense fallback={null}>
              <SignInPanel
                onSignedIn={(user) => {
                  signedIn(user)
                  // Signing in is the end of the menu's business: the trigger becomes the person.
                  setOpen(false)
                }}
              />
            </Suspense>
          )}
        </div>
      )}
    </div>
  )
}
