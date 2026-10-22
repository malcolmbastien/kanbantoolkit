import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { LogOut, UserRound } from 'lucide-react'
import { useStore } from '@/store'
import { devSignIn, loadAuth, signOut, startSignIn } from '@/lib/auth'
import type { AuthState, AuthUser } from '@/lib/auth'
import { cn } from '@/lib/utils'

/**
 * Who you are here.
 *
 * The control only exists when the instance offers a way in: with no provider configured — or no
 * server at all — it renders nothing, which keeps the static tier exactly as it was. Signing in is
 * additive in this task; the workspace still lives in the browser until task 118 moves it.
 */
export function AccountMenu() {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const users = useStore((s) => s.users)
  const setUser = useStore((s) => s.setUser)

  useEffect(() => {
    let live = true
    loadAuth().then((state) => {
      if (live) setAuth(state)
    })
    return () => {
      live = false
    }
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

  if (!auth || (auth.providers.length === 0 && !auth.dev)) return null

  /**
   * Until the workspace lives on the server, the account and the workspace's own person are two
   * identities. The bridge is a name match: if the workspace already knows somebody by this name,
   * the account becomes them — which is what makes "my work" and a change's author right today.
   * Task 118 replaces the guess with a record.
   */
  function signedIn(user: AuthUser | null) {
    setAuth((current) => (current ? { ...current, user } : current))
    if (!user) {
      setUser(undefined)
      return
    }
    const match = users.find((candidate) => candidate.name.toLowerCase() === user.name.toLowerCase())
    setUser(match?.id)
  }

  async function onDev(event: FormEvent) {
    event.preventDefault()
    if (!email.includes('@')) return
    setBusy(true)
    const user = await devSignIn(email)
    setBusy(false)
    if (!user) return
    signedIn(user)
    setEmail('')
    setOpen(false)
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
                onClick={onSignOut}
                disabled={busy}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-meta text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
              >
                <LogOut size={13} /> Sign out
              </button>
            </>
          ) : (
            <>
              <p className="px-1.5 pb-1.5 text-micro uppercase tracking-wide text-slate-400">Sign in with</p>
              {auth.providers.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => startSignIn(provider.id)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-meta text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                >
                  <span className="grid size-5 place-items-center rounded border border-slate-200 text-micro font-semibold text-slate-500">
                    {provider.label.charAt(0)}
                  </span>
                  Continue with {provider.label}
                </button>
              ))}

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
          )}
        </div>
      )}
    </div>
  )
}
