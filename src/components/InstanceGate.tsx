import { lazy, Suspense, useEffect, useState } from 'react'
import { loadAuth, useAuth } from '@/lib/auth'
import { isDemoWorkspace } from '@/lib/demo'
import { signedInAs } from '@/lib/identity'
import { useStore } from '@/store'

const SignInPanel = lazy(() => import('./SignInPanel').then((module) => ({ default: module.SignInPanel })))

/**
 * The door to an instance.
 *
 * A deployment with a server is not a demo: the workspace is the account's, and until somebody has
 * an account there is nothing in this browser that belongs to them. So the app waits for the
 * instance to answer, and when the answer is "an instance, and nobody is signed in" it shows one
 * thing — the way in — rather than a board seeded behind the administrator's back.
 *
 * On a static host nothing answers, and the demo is the whole point: this renders the app at once
 * and never asks again. The two tiers share one entry point, so the difference is a fact about the
 * server rather than a different build.
 */
export function InstanceGate({ children }: { children: React.ReactNode }) {
  const loaded = useAuth((s) => s.loaded)
  const instance = useAuth((s) => s.instance)
  const user = useAuth((s) => s.user)
  // A door is what makes an instance a place to sign in to. A deployment with a server and *no*
  // door — no provider, no password, no first run, no development switch — is the public demo: it
  // seeds itself in the browser, exactly as the static host does, and asking it for a sign-in would
  // be asking for something it cannot offer. Every selector is read on its own line: `||` between
  // two hooks skips the second, and a hook that runs on one render and not the next is the one thing
  // React will not forgive.
  const setup = useAuth((s) => s.setup)
  const password = useAuth((s) => s.password)
  const dev = useAuth((s) => s.dev)
  const doors = useAuth((s) => s.providers.length)
  const hasDoor = setup || password || dev || doors > 0
  const signIn = instance && hasDoor && !user
  // A fetch that never answers must not hold the page: after a moment the app draws as the static
  // tier, which is exactly what a server that is not there means.
  const [waited, setWaited] = useState(false)

  useEffect(() => {
    void loadAuth()
    const timer = setTimeout(() => setWaited(true), 1500)
    return () => clearTimeout(timer)
  }, [])

  // An instance with nobody signed in holds nothing of theirs: the demo the browser was handed is
  // not this deployment's data, so it is cleared and the board list starts empty. A workspace the
  // person made themselves is left alone — it is offered to their account after they sign in.
  useEffect(() => {
    if (!loaded || !signIn) return
    const state = useStore.getState()
    const demo = isDemoWorkspace({ boards: state.boards, flows: state.flows, lanes: state.lanes, items: state.items, placements: state.placements })
    if (!demo) return
    state.startEmptyWorkspace()
  }, [loaded, signIn])

  if (!loaded && !waited) return <Splash />

  if (signIn) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-100 px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-600 shadow-sm">
              <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden>
                <rect x="4" y="6" width="4" height="20" rx="1.2" fill="#f8fafc" />
                <rect x="12" y="6" width="4" height="12" rx="1.2" fill="#c7d2fe" />
                <rect x="20" y="6" width="4" height="7" rx="1.2" fill="#a5f3fc" />
              </svg>
            </span>
            <p className="truncate text-body font-semibold tracking-tight text-slate-900">Kanban Toolkit</p>
          </div>

          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900">Sign in to your instance</h1>
          <p className="mt-1 text-meta text-slate-600">Access your team’s boards, initiatives and work.</p>

          <div className="mt-6">
            <Suspense fallback={<p className="text-meta text-slate-600">One moment…</p>}>
              <SignInPanel onSignedIn={(next) => signedInAs(next)} />
            </Suspense>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

/** What the app sits on while the instance is asked who is here. */
function Splash() {
  return (
    <div className="grid min-h-full place-items-center bg-slate-100" aria-busy="true">
      <span className="text-meta font-medium text-slate-500">Kanban Toolkit</span>
    </div>
  )
}

